// Finds Minecraft installs made by other launchers and copies what the user picks into a new installation.
// Scanning only reads folder names, version files and logs. It never opens account or login files, never
// writes anything, and importing copies: the original install is left exactly as it was.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME = os.homedir();
const APPDATA = process.platform === 'win32' ? (process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'))
  : process.platform === 'darwin' ? path.join(HOME, 'Library', 'Application Support')
  : path.join(HOME, '.local', 'share');

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const list = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
const visible = (e) => !e.name.startsWith('.');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const SUPPORTED = ['vanilla', 'fabric'];
const AdmZip = require('adm-zip');
const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

/* ---------- what's inside a game folder ---------- */
function describe(gameDir) {
  const n = (sub, ok) => list(path.join(gameDir, sub)).filter((e) => visible(e) && ok(e)).length;
  return {
    worlds: n('saves', (e) => e.isDirectory() && isFile(path.join(gameDir, 'saves', e.name, 'level.dat'))),
    mods: n('mods', (e) => e.isFile() && /\.jar(\.disabled)?$/.test(e.name)),
    resourcepacks: n('resourcepacks', (e) => e.isDirectory() || /\.zip$/i.test(e.name)),
    shaders: n('shaderpacks', (e) => e.isDirectory() || /\.zip$/i.test(e.name)),
    config: isDir(path.join(gameDir, 'config')),
    settings: isFile(path.join(gameDir, 'options.txt')) || isFile(path.join(gameDir, 'servers.dat')),
  };
}
const looksLikeGameDir = (d) => isDir(d) && ['mods', 'saves', 'resourcepacks', 'config'].some((s) => isDir(path.join(d, s))) || isFile(path.join(d, 'options.txt'));

// Rough size of a folder, giving up after a moment so a huge world doesn't stall the scan.
function sizeOf(dir, ms = 700) {
  const deadline = Date.now() + ms;
  let total = 0, partial = false;
  const stack = [dir];
  while (stack.length) {
    if (Date.now() > deadline) { partial = true; break; }
    const d = stack.pop();
    for (const e of list(d)) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += fs.statSync(p).size; } catch {} }
    }
  }
  return { bytes: total, partial };
}

/* ---------- version and loader, when the launcher doesn't say ---------- */
function fromLog(gameDir) {
  let text = '';
  try {
    const fd = fs.openSync(path.join(gameDir, 'logs', 'latest.log'), 'r');
    const buf = Buffer.alloc(96 * 1024);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    text = buf.toString('utf8', 0, read);
  } catch { return {}; }
  let m = text.match(/Loading Minecraft (\S+) with Fabric Loader (\S+)/);
  if (m) return { mc: m[1], loader: 'fabric', loaderVersion: m[2] };
  m = text.match(/Loading Minecraft (\S+) with Quilt Loader (\S+)/);
  if (m) return { mc: m[1], loader: 'quilt', loaderVersion: m[2] };
  m = text.match(/(?:--fml\.mcVersion|mcVersion)[ =,]+(\d[\w.]*)/);
  if (m) return { mc: m[1], loader: /neoforge/i.test(text) ? 'neoforge' : 'forge' };
  m = text.match(/Minecraft Version: (\d[\w.\-]*)/);
  if (m) return { mc: m[1], loader: 'vanilla' };
  return {};
}

/* ---------- candidates ---------- */
// When nothing says which loader an install uses, the mods themselves do: look inside a few of them.
function sniffLoader(gameDir) {
  const jars = list(path.join(gameDir, 'mods')).filter((e) => e.isFile() && /\.jar(\.disabled)?$/.test(e.name)).slice(0, 6);
  for (const j of jars) {
    try {
      const names = new AdmZip(path.join(gameDir, 'mods', j.name)).getEntries().map((e) => e.entryName);
      if (names.includes('fabric.mod.json')) return 'fabric';
      if (names.includes('quilt.mod.json')) return 'quilt';
      if (names.includes('META-INF/neoforge.mods.toml')) return 'neoforge';
      if (names.includes('META-INF/mods.toml')) return 'forge';
    } catch {}
  }
  return null;
}

function make(source, name, gameDir, info) {
  const parts = describe(gameDir);
  const loader = info.loader || sniffLoader(gameDir) || 'vanilla';
  const ok = SUPPORTED.includes(loader);
  const sizes = {};
  if (parts.worlds) sizes.worlds = sizeOf(path.join(gameDir, 'saves'));
  return {
    id: crypto.createHash('sha1').update(`${gameDir}|${info.mc}|${loader}`).digest('hex').slice(0, 16),
    source, name: String(name || path.basename(gameDir)).slice(0, 60),
    mc: info.mc || null, loader, loaderName: LOADER_NAMES[loader] || loader, loaderVersion: info.loaderVersion || null,
    supported: ok, dir: gameDir, parts, sizes,
    note: ok ? null : `${LOADER_NAMES[loader] || loader} isn't supported yet. You can bring over its worlds and packs as a Vanilla installation; its mods won't run here.`,
  };
}

// The official Minecraft Launcher (and TLauncher, which uses the same folder).
function scanOfficial(root) {
  const out = [];
  if (!isDir(path.join(root, 'versions'))) return out;
  for (const e of list(path.join(root, 'versions'))) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const vdir = path.join(root, 'versions', e.name);
    const j = readJson(path.join(vdir, `${e.name}.json`));
    if (!j) continue;
    const libs = (j.libraries || []).map((l) => l.name || '');
    let loader = 'vanilla', mc = j.inheritsFrom || null, loaderVersion = null;
    const mainClass = j.mainClass || '';
    if (/fabricmc/i.test(mainClass) || libs.some((n) => n.startsWith('net.fabricmc:fabric-loader'))) {
      loader = 'fabric';
      const l = libs.find((n) => n.startsWith('net.fabricmc:fabric-loader:')); if (l) loaderVersion = l.split(':')[2];
      const i = libs.find((n) => n.startsWith('net.fabricmc:intermediary:')); if (!mc && i) mc = i.split(':')[2];
    } else if (libs.some((n) => n.startsWith('org.quiltmc:quilt-loader'))) loader = 'quilt';
    else if (libs.some((n) => n.startsWith('net.neoforged:'))) loader = 'neoforge';
    else if (libs.some((n) => /^net\.minecraftforge:(forge|fmlloader)/.test(n)) || /cpw\.mods|forge/i.test(mainClass)) loader = 'forge';
    if (loader === 'vanilla') { if (!isFile(path.join(vdir, `${e.name}.jar`))) continue; mc = mc || e.name; } // only versions that were actually played
    // Some launchers keep each version's worlds and mods inside its own folder.
    const isolated = looksLikeGameDir(vdir);
    const gameDir = isolated ? vdir : root;
    const info = loader === 'vanilla' ? { mc, loader } : { ...fromLog(gameDir), ...(mc ? { mc } : {}), loader, loaderVersion };
    out.push(make('Minecraft Launcher', loader === 'vanilla' ? `Minecraft ${mc}` : e.name, gameDir, { ...info, mc: info.mc || mc }));
  }
  return out;
}

// Prism Launcher, PolyMC and MultiMC share one instance format.
function scanPrism(instancesDir, source) {
  const out = [];
  for (const e of list(instancesDir)) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const idir = path.join(instancesDir, e.name);
    const pack = readJson(path.join(idir, 'mmc-pack.json'));
    if (!pack) continue;
    const gameDir = [path.join(idir, 'minecraft'), path.join(idir, '.minecraft')].find(isDir);
    if (!gameDir) continue;
    const comp = (uid) => (pack.components || []).find((c) => c.uid === uid);
    let loader = 'vanilla', loaderVersion = null;
    for (const [uid, l] of [['net.fabricmc.fabric-loader', 'fabric'], ['org.quiltmc.quilt-loader', 'quilt'], ['net.neoforged', 'neoforge'], ['net.minecraftforge', 'forge']]) {
      if (comp(uid)) { loader = l; loaderVersion = comp(uid).version || null; break; }
    }
    let name = e.name;
    try { const m = fs.readFileSync(path.join(idir, 'instance.cfg'), 'utf8').match(/^name=(.*)$/m); if (m) name = m[1].trim(); } catch {}
    out.push(make(source, name, gameDir, { mc: comp('net.minecraft') && comp('net.minecraft').version, loader, loaderVersion }));
  }
  return out;
}

// CurseForge keeps a minecraftinstance.json in each instance.
function scanCurseForge(instancesDir) {
  const out = [];
  for (const e of list(instancesDir)) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const idir = path.join(instancesDir, e.name);
    const j = readJson(path.join(idir, 'minecraftinstance.json'));
    if (!j) continue;
    const base = (j.baseModLoader && j.baseModLoader.name) || '';
    const loader = ['fabric', 'quilt', 'neoforge', 'forge'].find((l) => base.toLowerCase().startsWith(l)) || 'vanilla';
    out.push(make('CurseForge', j.name || e.name, idir, { mc: j.gameVersion || (j.baseModLoader && j.baseModLoader.minecraftVersion), loader, loaderVersion: base.split('-')[1] || null }));
  }
  return out;
}

// Anything else (Modrinth App, ATLauncher, GDLauncher, a folder someone points us at): a folder of game files,
// with the version read from its last log.
function scanGeneric(dir, source) {
  const out = [];
  const tryDir = (d, label) => { if (looksLikeGameDir(d)) out.push(make(source, label, d, fromLog(d))); };
  tryDir(dir, path.basename(dir));
  for (const e of list(dir)) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const d = path.join(dir, e.name);
    tryDir(d, e.name);
    for (const sub of ['minecraft', '.minecraft']) tryDir(path.join(d, sub), e.name);
  }
  return out;
}

/* ---------- the places to look ---------- */
function knownPlaces() {
  const docs = path.join(HOME, 'Documents');
  const p = (...a) => path.join(...a);
  return {
    official: [p(APPDATA, process.platform === 'win32' ? '.minecraft' : 'minecraft'), p(HOME, '.minecraft')],
    prism: [['Prism Launcher', p(APPDATA, 'PrismLauncher', 'instances')], ['PolyMC', p(APPDATA, 'PolyMC', 'instances')], ['MultiMC', p(APPDATA, 'MultiMC', 'instances')], ['MultiMC', p(HOME, 'MultiMC', 'instances')]],
    curseforge: [p(docs, 'curseforge', 'minecraft', 'Instances'), p(HOME, 'curseforge', 'minecraft', 'Instances')],
    generic: [['Modrinth App', p(APPDATA, 'ModrinthApp', 'profiles')], ['Modrinth App', p(APPDATA, 'com.modrinth.theseus', 'profiles')], ['ATLauncher', p(APPDATA, 'ATLauncher', 'instances')], ['ATLauncher', p(HOME, 'ATLauncher', 'instances')], ['GDLauncher', p(APPDATA, 'gdlauncher_carbon', 'data', 'instances')], ['GDLauncher', p(APPDATA, 'gdlauncher_next', 'instances')]],
  };
}

function scan(extraDirs = []) {
  const k = knownPlaces();
  let all = [];
  for (const d of k.official) all.push(...scanOfficial(d));
  for (const [s, d] of k.prism) all.push(...scanPrism(d, s));
  for (const d of k.curseforge) all.push(...scanCurseForge(d));
  for (const [s, d] of k.generic) if (isDir(d)) all.push(...scanGeneric(d, s));
  // A folder the user points us at can be any of the above, or just a game folder.
  for (const d of extraDirs) {
    all.push(...scanOfficial(d), ...scanPrism(d, 'Other folder'), ...scanPrism(path.join(d, 'instances'), 'Other folder'), ...scanCurseForge(d), ...scanCurseForge(path.join(d, 'Instances')), ...scanGeneric(d, 'Other folder'));
    // The folder itself might be one instance rather than a folder of them.
    const parent = path.dirname(d);
    if (isFile(path.join(d, 'mmc-pack.json'))) all.push(...scanPrism(parent, 'Other folder').filter((c) => c.dir.startsWith(d)));
    if (isFile(path.join(d, 'minecraftinstance.json'))) all.push(...scanCurseForge(parent).filter((c) => c.dir === d));
  }
  // The same folder can be recognised twice (say, as a CurseForge instance and as a plain game folder):
  // keep whichever description knows the version.
  const best = new Map();
  for (const c of all) {
    const have = best.get(c.dir);
    if (!have || (!have.mc && c.mc) || (have.source === 'Other folder' && c.source !== 'Other folder' && c.mc)) best.set(c.dir, c);
  }
  all = [...best.values()].filter((c) => c.parts.worlds || c.parts.mods || c.parts.resourcepacks || c.parts.shaders || c.parts.settings || c.parts.config);
  // Things we can run first, then by name.
  return all.sort((a, b) => (b.supported - a.supported) || a.name.localeCompare(b.name));
}

/* ---------- copying ---------- */
const skip = (src) => !/(^|[\\/])(\.DS_Store|Thumbs\.db)$/.test(src);

// Copies the chosen parts of a found install into destDir. Returns what was copied. Throws on the first failure
// (the caller removes the half-made installation).
async function copyInto(cand, destDir, parts, loader, onStep = () => {}) {
  const src = cand.dir, copied = {};
  const cp = (from, to) => fs.promises.cp(from, to, { recursive: true, force: true, filter: skip });
  fs.mkdirSync(destDir, { recursive: true });
  if (parts.worlds) {
    const worlds = list(path.join(src, 'saves')).filter((e) => e.isDirectory() && isFile(path.join(src, 'saves', e.name, 'level.dat')));
    for (const w of worlds) { onStep(`Copying world ${w.name}…`); await cp(path.join(src, 'saves', w.name), path.join(destDir, 'saves', w.name)); }
    copied.worlds = worlds.length;
  }
  if (parts.mods && loader === 'fabric') {
    const mods = list(path.join(src, 'mods')).filter((e) => e.isFile() && /\.jar(\.disabled)?$/.test(e.name));
    onStep('Copying mods…');
    fs.mkdirSync(path.join(destDir, 'mods'), { recursive: true });
    for (const m of mods) fs.copyFileSync(path.join(src, 'mods', m.name), path.join(destDir, 'mods', m.name));
    copied.mods = mods.length;
  }
  for (const [key, dir, label] of [['resourcepacks', 'resourcepacks', 'resource packs'], ['shaders', 'shaderpacks', 'shader packs']]) {
    if (!parts[key]) continue;
    onStep(`Copying ${label}…`);
    const items = list(path.join(src, dir)).filter((e) => visible(e) && (e.isDirectory() || /\.zip$/i.test(e.name)));
    for (const it of items) await cp(path.join(src, dir, it.name), path.join(destDir, dir, it.name));
    copied[key] = items.length;
  }
  if (parts.settings) {
    onStep('Copying settings…');
    for (const f of ['options.txt', 'servers.dat']) if (isFile(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(destDir, f));
    copied.settings = true;
  }
  if (parts.config && loader === 'fabric' && isDir(path.join(src, 'config'))) {
    onStep('Copying mod settings…');
    await cp(path.join(src, 'config'), path.join(destDir, 'config'));
    copied.config = true;
  }
  return copied;
}

module.exports = { scan, copyInto, describe, SUPPORTED, LOADER_NAMES };
