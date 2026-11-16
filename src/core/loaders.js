// Mod loaders: Fabric (built in), Quilt, NeoForge and Forge. For each one this knows which Minecraft versions it
// supports and how to get its version profile ready for launching.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getJson, downloadFile, dirs, root, UA, track, currentJob, checkCancel } = require('./util');
const V = require('./versions');

const QUILT_META = 'https://meta.quiltmc.org/v3';
const NEO_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';

const NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge', forge: 'Forge' };
const MODDED = ['fabric', 'quilt', 'neoforge', 'forge'];
// What each loader can run, for searching Modrinth. Quilt loads Fabric mods as well.
const MOD_LOADERS = { fabric: ['fabric'], quilt: ['quilt', 'fabric'], neoforge: ['neoforge'], forge: ['forge'] };
// Shader packs run through Iris (Fabric, Quilt, NeoForge); Forge has no equivalent we support.
const SHADER_LOADERS = ['fabric', 'quilt', 'neoforge'];

const num = (s) => s.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
function mcAtLeast(mc, major, minor) { const [a, b] = num(mc); return a > major || (a === major && b >= minor); }

let cache = {};
async function once(key, fn) { return cache[key] || (cache[key] = fn().catch((e) => { delete cache[key]; throw e; })); }

/* ----- which Minecraft versions each loader supports ----- */
async function quiltGameVersions() { return once('quiltGames', async () => new Set((await getJson(`${QUILT_META}/versions/game`)).map((v) => v.version))); }

// NeoForge versions are written 21.1.172 for Minecraft 1.21.1.
function neoToMc(v) {
  const [a, b] = num(v);
  return a >= 26 ? `${a}.${b}` : `1.${a}${b ? '.' + b : ''}`;
}
async function neoVersions() {
  return once('neo', async () => {
    const res = await fetch(NEO_META, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('Couldn’t reach NeoForge.');
    const xml = await res.text();
    const byMc = new Map();
    for (const m of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
      const v = m[1];
      if (!/^\d+\.\d+\.\d+/.test(v)) continue;
      const mc = neoToMc(v), cur = byMc.get(mc);
      const stable = !/beta|alpha|snapshot/i.test(v);
      const better = !cur || (stable && !cur.stable) || (stable === cur.stable && cmpVer(v, cur.v) > 0);
      if (better) byMc.set(mc, { v, stable });
    }
    return byMc;
  });
}
function cmpVer(a, b) { const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; }
async function forgeVersions() {
  return once('forge', async () => {
    const p = (await getJson(FORGE_PROMOS)).promos || {};
    const byMc = new Map();
    for (const [k, v] of Object.entries(p)) {
      const m = k.match(/^(.+)-(recommended|latest)$/);
      if (!m || !mcAtLeast(m[1], 1, 13)) continue; // the installer for older versions works differently
      if (m[2] === 'recommended' || !byMc.has(m[1])) byMc.set(m[1], { v, stable: m[2] === 'recommended' });
    }
    return byMc;
  });
}

// { fabric: [mc...], quilt: [...], neoforge: [...], forge: [...] } for the version dropdowns.
async function support(fabricSet) {
  const out = { fabric: [...fabricSet], quilt: [], neoforge: [], forge: [] };
  const settle = async (key, fn) => { try { out[key] = await fn(); } catch {} };
  await Promise.all([
    settle('quilt', async () => [...await quiltGameVersions()]),
    settle('neoforge', async () => [...(await neoVersions()).keys()]),
    settle('forge', async () => [...(await forgeVersions()).keys()]),
  ]);
  return out;
}

/* ----- getting a loader ready ----- */
async function quiltProfile(mc) {
  const list = await getJson(`${QUILT_META}/versions/loader/${mc}`);
  if (!list.length) throw new Error(`Quilt isn't available for Minecraft ${mc} yet.`);
  const lv = (list.find((l) => !/beta|alpha|pre/i.test(l.loader.version)) || list[0]).loader.version;
  const id = `quilt-loader-${lv}-${mc}`;
  const file = path.join(dirs.versions(), id, `${id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const prof = await getJson(`${QUILT_META}/versions/loader/${mc}/${lv}/profile/json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prof)); track(file);
  return prof;
}

const javaForInstaller = (java) => (process.platform === 'win32' ? java.replace(/javaw\.exe$/i, 'java.exe') : java);

// Runs a loader's own installer (NeoForge and Forge both ship one) to put its libraries and version file in place.
async function runInstaller({ java, jar, args, cwd, onLine }) {
  checkCancel();
  await new Promise((resolve, reject) => {
    const child = spawn(javaForInstaller(java), ['-jar', jar, ...args], { cwd });
    const job = currentJob();
    const stop = () => { try { child.kill(); } catch {} };
    if (job) job.signal.addEventListener('abort', stop, { once: true });
    let tail = '';
    const pipe = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => { tail = (tail + '\n' + l).slice(-1500); onLine && onLine(l); });
    child.stdout.on('data', pipe); child.stderr.on('data', pipe);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(job && job.cancelled() ? Object.assign(new Error('Cancelled'), { cancelled: true }) : new Error(`The loader’s installer failed (exit ${code}). ${tail.split('\n').slice(-3).join(' ').trim()}`))));
  });
}

const profilesFile = () => path.join(root(), 'launcher_profiles.json');
function ensureProfilesFile() { if (!fs.existsSync(profilesFile())) fs.writeFileSync(profilesFile(), JSON.stringify({ profiles: {}, version: 3 })); }

function findInstalled(prefix, mc) {
  try {
    for (const d of fs.readdirSync(dirs.versions())) {
      if (!d.startsWith(prefix)) continue;
      const f = path.join(dirs.versions(), d, `${d}.json`);
      if (!fs.existsSync(f)) continue;
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j.inheritsFrom === mc || (j.id && d.includes(mc))) return j;
    }
  } catch {}
  return null;
}

async function installerProfile(loader, mc, { java, jar, onLine }) {
  const isNeo = loader === 'neoforge';
  const info = (await (isNeo ? neoVersions() : forgeVersions())).get(mc);
  if (!info) throw new Error(`${NAMES[loader]} isn't available for Minecraft ${mc}.`);
  const v = info.v;
  const prefix = isNeo ? `neoforge-${v}` : `${mc}-forge-${v}`;
  const have = findInstalled(prefix, mc);
  if (have) return have;
  const installer = path.join(dirs.versions(), '.installers', `${loader}-${isNeo ? v : mc + '-' + v}-installer.jar`);
  const url = isNeo
    ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`
    : `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${v}/forge-${mc}-${v}-installer.jar`;
  await downloadFile(url, installer);
  ensureProfilesFile();
  await runInstaller({ java, jar: installer, args: ['--installClient', root()], cwd: root(), onLine });
  const done = findInstalled(prefix, mc);
  if (!done) throw new Error(`${NAMES[loader]} installed, but its version file couldn’t be found.`);
  return done;
}

// The profile to merge onto the vanilla version json, with the loader ready to run.
async function profileFor(loader, mc, ctx) {
  if (loader === 'fabric') return V.getFabricProfile(mc);
  if (loader === 'quilt') return quiltProfile(mc);
  if (loader === 'neoforge' || loader === 'forge') return installerProfile(loader, mc, ctx);
  return null;
}

// The loader version a server or client will use for a Minecraft version (NeoForge and Forge only).
async function pickVersion(loader, mc) {
  const info = (await (loader === 'neoforge' ? neoVersions() : forgeVersions())).get(mc);
  return info ? info.v : null;
}

module.exports = { pickVersion, runInstaller, javaForInstaller, NAMES, MODDED, MOD_LOADERS, SHADER_LOADERS, support, profileFor, neoToMc, quiltGameVersions };
