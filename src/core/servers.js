// Minecraft servers: download the server jar, write eula.txt and server.properties, run it, and pipe its console.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { getJson, downloadFile, dirs } = require('./util');
const V = require('./versions');
const L = require('./launch');
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

// Update only the keys we manage; anything the user set by hand stays.
function writeProperties(srv) {
  const file = path.join(dirOf(srv.id), 'server.properties');
  const want = {
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

// Downloads the right jar once per version/type; re-downloads if either changes.
async function ensureJar(srv, vj, progress) {
  const dir = dirOf(srv.id);
  const stamp = path.join(dir, '.crooli-server.json');
  const jarName = srv.type === 'fabric' ? 'fabric-server-launch.jar' : 'server.jar';
  let have = {};
  try { have = JSON.parse(fs.readFileSync(stamp, 'utf8')); } catch {}
  if (have.mc === srv.mc && have.type === srv.type && fs.existsSync(path.join(dir, jarName))) return jarName;

  progress('Downloading the server…');
  if (srv.type === 'fabric') {
    const loader = (await getJson(`${FABRIC}/versions/loader/${srv.mc}`))[0];
    if (!loader) throw new Error(`Fabric isn't available for Minecraft ${srv.mc} yet.`);
    const installer = (await getJson(`${FABRIC}/versions/installer`)).find((i) => i.stable) || (await getJson(`${FABRIC}/versions/installer`))[0];
    await downloadFile(`${FABRIC}/versions/loader/${srv.mc}/${loader.loader.version}/${installer.version}/server/jar`, path.join(dir, jarName));
  } else {
    const s = vj.downloads && vj.downloads.server;
    if (!s) throw new Error(`Mojang doesn't publish a server for Minecraft ${srv.mc}.`);
    await downloadFile(s.url, path.join(dir, jarName), { sha1: s.sha1, size: s.size });
  }
  fs.writeFileSync(stamp, JSON.stringify({ mc: srv.mc, type: srv.type }));
  return jarName;
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
    const jar = await ensureJar(srv, vj, progress);
    writeProperties(srv);
    progress('Preparing Java…');
    const java = javaOverride || await ensureJava((vj.javaVersion && vj.javaVersion.component) || 'jre-legacy', () => {});
    const ram = srv.ram || 2048;
    const args = [`-Xmx${ram}M`, `-Xms${Math.min(1024, ram)}M`, '-jar', jar, 'nogui'];
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

module.exports = { dirOf, writeEula, writeProperties, start, stop, stopAll, command, status, addresses, isRunning };
