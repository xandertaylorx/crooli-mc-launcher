// Minecraft servers: download the server jar, write eula.txt and server.properties, run it, and pipe its console.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { getJson, downloadFile, dirs } = require('./util');
const V = require('./versions');
const L = require('./launch');
const loaders = require('./loaders');
const { ensureJava } = require('./java');

const FABRIC = 'https://meta.fabricmc.net/v2';
const LOG_LINES = 600;

const dirOf = (id) => path.join(dirs.servers(), path.basename(id));
const running = new Map(); // id -> { child, state, players:Set }
const logs = new Map();    // id -> last lines

// ---------- files ----------
function writeEula(id) {
  fs.mkdirSync(dirOf(id), { recursive: true });
  fs.writeFileSync(path.join(dirOf(id), 'eula.txt'),
    `# Agreed in Crooli MC Launcher on ${new Date().toISOString()}\n# https://aka.ms/MinecraftEULA\neula=true\n`);
}

// The simple on/off settings shown in the app. `restart` ones only take effect the next time the server starts.
const OPTIONS = [
  { key: 'pvp', label: 'Players can fight each other', def: true, restart: true },
  { key: 'allow-flight', label: 'Allow flying', desc: 'Stops the server kicking people who fly with mods or elytra tricks.', def: false, restart: true },
  { key: 'enable-command-block', label: 'Command blocks', def: false, restart: true },
  { key: 'allow-nether', label: 'The Nether', def: true, restart: true },
  { key: 'spawn-monsters', label: 'Monsters', def: true, restart: true },
  { key: 'spawn-animals', label: 'Animals', def: true, restart: true },
  { key: 'spawn-npcs', label: 'Villagers', def: true, restart: true },
];
const BOOL_KEYS = new Set(OPTIONS.map((o) => o.key));

function readProps(id) {
  const out = {};
  try {
    for (const l of fs.readFileSync(path.join(dirOf(id), 'server.properties'), 'utf8').split(/\r?\n/)) {
      const m = l.match(/^([^#=\s][^=]*)=(.*)$/); if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

// Current value of every option: what is in the server's own file if it has one, else what we will write.
function readOptions(srv) {
  const file = readProps(srv.id), mine = srv.opts || {};
  const val = {};
  for (const o of OPTIONS) val[o.key] = o.key in file ? file[o.key] === 'true' : o.key in mine ? !!mine[o.key] : o.def;
  val.whitelist = 'white-list' in file ? file['white-list'] === 'true' : !!srv.whitelist;
  return { options: OPTIONS.map((o) => ({ ...o, value: val[o.key] })), whitelist: val.whitelist };
}

// Update only the keys we manage; anything the user set by hand stays.
function writeProperties(srv) {
  const file = path.join(dirOf(srv.id), 'server.properties');
  const extra = {};
  for (const [k, v] of Object.entries(srv.opts || {})) if (BOOL_KEYS.has(k)) extra[k] = v ? 'true' : 'false';
  const want = {
    ...extra,
    'white-list': srv.whitelist ? 'true' : 'false',
    'enforce-whitelist': srv.whitelist ? 'true' : 'false',
    'server-port': String(srv.port || 25565),
    'online-mode': srv.offline ? 'false' : 'true',
    gamemode: srv.gamemode || 'survival',
    difficulty: srv.difficulty || 'normal',
    motd: (srv.motd || srv.name || 'A Minecraft Server').replace(/[\r\n]/g, ' '),
    'max-players': String(srv.maxPlayers || 10),
  };
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : ['#Minecraft server properties'];
  const seen = new Set();
  const out = lines.map((l) => {
    const m = l.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m && m[1] in want) { seen.add(m[1]); return `${m[1]}=${want[m[1]]}`; }
    return l;
  });
  for (const [k, v] of Object.entries(want)) if (!seen.has(k)) out.push(`${k}=${v}`);
  fs.writeFileSync(file, out.filter((l, i) => l || i < out.length - 1).join('\n') + '\n');
}

// ---------- every setting in server.properties ----------
// Settings the launcher also keeps in its own list. Editing one of these here has to update that list too, or the next
// start would put the old value back.
function readAllProperties(id) {
  const file = path.join(dirOf(id), 'server.properties');
  if (!fs.existsSync(file)) return null;
  return readProps(id);
}
function writeAllProperties(id, values) {
  const file = path.join(dirOf(id), 'server.properties');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : ['#Minecraft server properties'];
  const seen = new Set();
  const out = lines.map((l) => {
    const m = l.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m && m[1] in values) { seen.add(m[1]); return `${m[1]}=${values[m[1]]}`; }
    return l;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}=${v}`);
  fs.writeFileSync(file, out.filter((l, i) => l || i < out.length - 1).join('\n') + '\n');
}

// ---------- export ----------
// Zips the server so it can be put on a real server host: the world, mods, settings and the jars, plus start scripts.
// Logs, crash reports, the installer we used and lock files are left out.
const SKIP = /^(logs|crash-reports|\.installers|\.crooli-.*|\.DS_Store)$|session\.lock$/;
function startScripts(srv) {
  let launch = ['-jar', 'server.jar', 'nogui'];
  try { launch = JSON.parse(fs.readFileSync(path.join(dirOf(srv.id), '.crooli-server.json'), 'utf8')).launch || launch; } catch {}
  const ram = srv.ram || 2048, mem = `-Xmx${ram}M -Xms${Math.min(1024, ram)}M`;
  const unix = launch.join(' '), win = unix.replace('unix_args.txt', 'win_args.txt');
  const sh = `#!/bin/sh\ncd "$(dirname "$0")"\njava ${mem} ${unix}\n`;
  const bat = `@echo off\r\ncd /d "%~dp0"\r\njava ${mem} ${win}\r\npause\r\n`;
  const readme = `${srv.name}\r\nMinecraft ${srv.mc} (${srv.type})\r\n\r\nTo run this server:\r\n1. Install Java (21 for recent Minecraft versions, 17 for 1.18 to 1.20.4, 8 for older ones).\r\n2. Run start.sh (Mac and Linux) or start.bat (Windows).\r\n\r\nThe Minecraft EULA was accepted when you made the server in Crooli MC Launcher (eula.txt). Settings are in server.properties.\r\nIf your host has its own start command, use the same Java arguments as in start.sh.\r\n`;
  return { sh, bat, readme };
}
function exportZip(srv, dest, onProgress = () => {}) {
  const yazl = require('yazl');
  const dir = dirOf(srv.id), top = (srv.name || 'server').replace(/[^\w .-]+/g, '').trim() || 'server';
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const out = fs.createWriteStream(dest);
    out.on('close', () => resolve({ bytes: fs.statSync(dest).size }));
    out.on('error', reject); zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);
    let n = 0;
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        if (SKIP.test(e.name)) continue;
        const r = path.join(rel, e.name);
        if (e.isDirectory()) walk(r);
        else if (e.isFile()) { zip.addFile(path.join(dir, r), path.posix.join(top, ...r.split(path.sep))); onProgress(++n); }
      }
    };
    try {
      walk('');
      const sc = startScripts(srv);
      zip.addBuffer(Buffer.from(sc.sh), `${top}/start.sh`, { mode: 0o100755 });
      zip.addBuffer(Buffer.from(sc.bat), `${top}/start.bat`);
      zip.addBuffer(Buffer.from(sc.readme), `${top}/README.txt`);
      zip.end();
    } catch (e) { reject(e); }
  });
}

// ---------- whitelist ----------
const wlFile = (id) => path.join(dirOf(id), 'whitelist.json');
function readWhitelist(id) {
  try { return JSON.parse(fs.readFileSync(wlFile(id), 'utf8')).map((e) => e.name).filter(Boolean).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); }
  catch { return []; }
}
const dashed = (hex) => hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
function offlineUuid(name) {
  const b = require('crypto').createHash('md5').update('OfflinePlayer:' + name).digest();
  b[6] = (b[6] & 0x0f) | 0x30; b[8] = (b[8] & 0x3f) | 0x80;
  return dashed(b.toString('hex'));
}
async function uuidFor(srv, name) {
  if (srv.offline) return { uuid: offlineUuid(name), name };
  const r = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, { headers: { 'User-Agent': 'CrooliMCLauncher' } });
  if (r.status === 204 || r.status === 404) throw new Error(`There's no Minecraft account called ${name}.`);
  if (!r.ok) throw new Error('Couldn’t reach Mojang to look that name up. Try again in a moment.');
  const j = await r.json();
  return { uuid: dashed(j.id), name: j.name };
}
const validName = (n) => /^\w{3,16}$/.test(n);

// Running servers get the command (they keep their own list in memory); stopped ones get the file edited.
async function whitelistAdd(srv, rawName) {
  const name = String(rawName || '').trim();
  if (!validName(name)) throw new Error('Player names are 3 to 16 letters, numbers or underscores.');
  if (running.has(srv.id) && running.get(srv.id).child) { command(srv.id, `whitelist add ${name}`); return; }
  const who = await uuidFor(srv, name);
  let list = []; try { list = JSON.parse(fs.readFileSync(wlFile(srv.id), 'utf8')); } catch {}
  if (list.some((e) => (e.name || '').toLowerCase() === who.name.toLowerCase())) return;
  list.push({ uuid: who.uuid, name: who.name });
  fs.mkdirSync(dirOf(srv.id), { recursive: true });
  fs.writeFileSync(wlFile(srv.id), JSON.stringify(list, null, 2));
}
function whitelistRemove(srv, name) {
  if (running.has(srv.id) && running.get(srv.id).child) { command(srv.id, `whitelist remove ${name}`); return; }
  let list = []; try { list = JSON.parse(fs.readFileSync(wlFile(srv.id), 'utf8')); } catch {}
  fs.writeFileSync(wlFile(srv.id), JSON.stringify(list.filter((e) => (e.name || '').toLowerCase() !== String(name).toLowerCase()), null, 2));
}

// Changes made while the server is running: tell it where it can, and always keep the file and our copy in step.
function applyLive(srv, key, value) {
  const r = running.get(srv.id);
  if (!r || !r.child) return;
  if (key === 'whitelist') command(srv.id, value ? 'whitelist on' : 'whitelist off');
}
function setProperty(id, key, value) {
  const file = path.join(dirOf(id), 'server.properties');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let hit = false;
  const out = lines.map((l) => (l.startsWith(key + '=') ? ((hit = true), `${key}=${value}`) : l));
  if (!hit) out.push(`${key}=${value}`);
  fs.writeFileSync(file, out.filter((l, i) => l || i < out.length - 1).join('\n') + '\n');
}

// Downloads and installs the server once per version/type (again if either changes). Returns the arguments that follow the
// memory flags: ["-jar", "x.jar", "nogui"], or for NeoForge and Forge ["@libraries/.../unix_args.txt", "nogui"].
const TYPE_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge', forge: 'Forge' };
async function ensureServer(srv, vj, java, progress) {
  const dir = dirOf(srv.id);
  const stamp = path.join(dir, '.crooli-server.json');
  let have = {};
  try { have = JSON.parse(fs.readFileSync(stamp, 'utf8')); } catch {}
  if (have.mc === srv.mc && have.type === srv.type && have.launch) {
    const probe = have.launch.find((a) => a.endsWith('.jar') || a.startsWith('@'));
    if (probe && fs.existsSync(path.join(dir, probe.replace(/^@/, '')))) return have.launch;
  }

  progress(`Setting up the ${TYPE_NAMES[srv.type] || 'Vanilla'} server…`);
  let launch;
  if (srv.type === 'fabric') {
    const loader = (await getJson(`${FABRIC}/versions/loader/${srv.mc}`))[0];
    if (!loader) throw new Error(`Fabric isn't available for Minecraft ${srv.mc} yet.`);
    const installer = (await getJson(`${FABRIC}/versions/installer`)).find((i) => i.stable) || (await getJson(`${FABRIC}/versions/installer`))[0];
    await downloadFile(`${FABRIC}/versions/loader/${srv.mc}/${loader.loader.version}/${installer.version}/server/jar`, path.join(dir, 'fabric-server-launch.jar'));
    launch = ['-jar', 'fabric-server-launch.jar', 'nogui'];
  } else if (srv.type === 'quilt') {
    const inst = (await getJson('https://meta.quiltmc.org/v3/versions/installer'))[0];
    const jar = path.join(dir, '.installers', `quilt-installer-${inst.version}.jar`);
    await downloadFile(inst.url, jar);
    await loaders.runInstaller({ java, jar, args: ['install', 'server', srv.mc, '--download-server', `--install-dir=${dir}`], cwd: dir, onLine: () => {} });
    if (!fs.existsSync(path.join(dir, 'quilt-server-launch.jar'))) throw new Error('Quilt installed, but its server file wasn’t created.');
    launch = ['-jar', 'quilt-server-launch.jar', 'nogui'];
  } else if (srv.type === 'neoforge' || srv.type === 'forge') {
    const isNeo = srv.type === 'neoforge';
    const v = await loaders.pickVersion(srv.type, srv.mc);
    if (!v) throw new Error(`${TYPE_NAMES[srv.type]} isn't available for Minecraft ${srv.mc}.`);
    const jar = path.join(dir, '.installers', `${srv.type}-${v}-installer.jar`);
    await downloadFile(isNeo
      ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`
      : `https://maven.minecraftforge.net/net/minecraftforge/forge/${srv.mc}-${v}/forge-${srv.mc}-${v}-installer.jar`, jar);
    await loaders.runInstaller({ java, jar, args: ['--installServer'], cwd: dir, onLine: (l) => { if (/^Considering library|Downloading|Processor|Task:/.test(l)) progress(l.slice(0, 90)); } });
    const base = path.join(dir, 'libraries', ...(isNeo ? ['net', 'neoforged', 'neoforge', v] : ['net', 'minecraftforge', 'forge', `${srv.mc}-${v}`]));
    const argsFile = path.join(base, process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt');
    if (!fs.existsSync(argsFile)) throw new Error(`${TYPE_NAMES[srv.type]} installed, but its start file wasn’t created.`);
    launch = [`@${path.relative(dir, argsFile).split(path.sep).join('/')}`, 'nogui'];
  } else {
    const s = vj.downloads && vj.downloads.server;
    if (!s) throw new Error(`Mojang doesn't publish a server for Minecraft ${srv.mc}.`);
    await downloadFile(s.url, path.join(dir, 'server.jar'), { sha1: s.sha1, size: s.size });
    launch = ['-jar', 'server.jar', 'nogui'];
  }
  fs.writeFileSync(stamp, JSON.stringify({ mc: srv.mc, type: srv.type, launch }));
  return launch;
}

// ---------- network ----------
function addresses(port) {
  const lan = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) lan.push(a.address);
  }
  return { local: `localhost:${port}`, lan: lan.slice(0, 2).map((ip) => `${ip}:${port}`) };
}

// ---------- process ----------
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function pushLog(id, line, emit) {
  const buf = logs.get(id) || [];
  buf.push(line);
  if (buf.length > LOG_LINES) buf.splice(0, buf.length - LOG_LINES);
  logs.set(id, buf);
  emit('server:log', { id, line });
}

function setState(id, state, emit, extra = {}) {
  const r = running.get(id);
  if (r) r.state = state;
  emit('server:state', { id, state, players: r ? [...r.players] : [], ...extra });
}

async function start(srv, emit, { javaOverride } = {}) {
  if (running.has(srv.id)) throw new Error('That server is already running.');
  const progress = (msg) => { pushLog(srv.id, `» ${msg}`, emit); };
  running.set(srv.id, { child: null, state: 'preparing', players: new Set() });
  setState(srv.id, 'preparing', emit);
  try {
    if (!fs.existsSync(path.join(dirOf(srv.id), 'eula.txt'))) throw new Error('The EULA hasn’t been agreed for this server.');
    const entries = await L.manifest();
    const vj = await V.getVersionJson(srv.mc, entries);
    progress('Preparing Java…');
    const java = javaOverride || await ensureJava((vj.javaVersion && vj.javaVersion.component) || 'jre-legacy', () => {});
    const launch = await ensureServer(srv, vj, java, progress);
    writeProperties(srv);
    const ram = srv.ram || 2048;
    const args = [`-Xmx${ram}M`, `-Xms${Math.min(1024, ram)}M`, ...launch];
    progress(`Starting Minecraft ${srv.mc} server…`);
    const child = spawn(java, args, { cwd: dirOf(srv.id) });
    const r = running.get(srv.id);
    r.child = child;
    setState(srv.id, 'starting', emit);

    let partial = '';
    const onData = (d) => {
      const text = partial + d.toString();
      const lines = text.split(/\r?\n/);
      partial = lines.pop();
      for (const raw of lines) {
        const line = stripAnsi(raw);
        if (!line.trim()) continue;
        pushLog(srv.id, line, emit);
        if (/Done \([\d.,]+s\)!/.test(line)) setState(srv.id, 'running', emit, addresses(srv.port || 25565));
        let m = line.match(/: (\w{2,16}) joined the game/);
        if (m) { r.players.add(m[1]); setState(srv.id, r.state, emit); }
        m = line.match(/: (\w{2,16}) left the game/);
        if (m) { r.players.delete(m[1]); setState(srv.id, r.state, emit); }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      running.delete(srv.id);
      pushLog(srv.id, `» Server stopped${code ? ` (exit code ${code})` : ''}.`, emit);
      emit('server:state', { id: srv.id, state: 'stopped', players: [] });
    });
    child.on('error', (e) => {
      running.delete(srv.id);
      pushLog(srv.id, `» Couldn't start: ${e.message}`, emit);
      emit('server:state', { id: srv.id, state: 'stopped', players: [] });
    });
  } catch (e) {
    running.delete(srv.id);
    pushLog(srv.id, `» ${e.message}`, emit);
    emit('server:state', { id: srv.id, state: 'stopped', players: [] });
    throw e;
  }
}

function command(id, text) {
  const r = running.get(id);
  if (!r || !r.child) throw new Error('Start the server first.');
  r.child.stdin.write(text.replace(/^\//, '').replace(/[\r\n]+/g, ' ') + '\n');
}

// Asks the server to save and stop; forces it after a while if it hangs.
function stop(id, emit, force = 15000) {
  const r = running.get(id);
  if (!r || !r.child) return Promise.resolve();
  setState(id, 'stopping', emit);
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { r.child.kill(); } catch {} }, force);
    r.child.once('exit', () => { clearTimeout(t); resolve(); });
    try { r.child.stdin.write('stop\n'); } catch { r.child.kill(); }
  });
}

const stopAll = (emit) => Promise.all([...running.keys()].map((id) => stop(id, emit)));
const isRunning = () => running.size > 0;
const status = (id) => {
  const r = running.get(id);
  return { state: r ? r.state : 'stopped', players: r ? [...r.players] : [], log: logs.get(id) || [] };
};

module.exports = { exportZip, readAllProperties, writeAllProperties, dirOf, writeEula, writeProperties, readOptions, readWhitelist, whitelistAdd, whitelistRemove, applyLive, setProperty, start, stop, stopAll, command, status, addresses, isRunning };
