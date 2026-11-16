// Mods, resource packs and shader packs inside an installation: what's installed, turning them on and off,
// removing them, and adding ones that came from the user's own computer.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const NAMES = { mod: 'a mod', resourcepack: 'a resource pack', shader: 'a shader pack' };
const dirFor = (instDir, kind) => path.join(instDir, DIRS[kind]);
const safe = (name) => path.basename(name); // never let a file name climb out of the folder

/* ---------- options.txt (which resource packs are on) ---------- */
const optFile = (instDir) => path.join(instDir, 'options.txt');

function readPackList(instDir) {
  try {
    const m = fs.readFileSync(optFile(instDir), 'utf8').match(/^resourcePacks:(.*)$/m);
    if (m) return JSON.parse(m[1]);
  } catch {}
  return null;
}

// Adds or removes one "file/<name>" entry, leaving every other line and pack as it was.
// Before Minecraft 1.13 the list holds bare file names; from 1.13 on they're written as "file/<name>".
function legacyOf(mc) {
  const m = String(mc || '').match(/^1\.(\d+)/);
  if (m) return +m[1] < 13;
  if (/^(rd-|inf-|c0\.|[abr]\d)/.test(mc)) return true;
  const w = String(mc || '').match(/^(\d{2})w\d+/);
  return !!w && +w[1] <= 17;
}
const packEntry = (fileName, mc) => (legacyOf(mc) ? fileName : `file/${fileName}`);

function setResourcePack(instDir, fileName, on, mc) {
  const entry = packEntry(fileName, mc);
  let text = '';
  try { text = fs.readFileSync(optFile(instDir), 'utf8'); } catch {}
  const list = readPackList(instDir) || ['vanilla'];
  const next = list.filter((x) => x !== entry);
  if (on) next.push(entry); // last in the list = checked first, so it wins over earlier packs
  const line = `resourcePacks:${JSON.stringify(next)}`;
  text = /^resourcePacks:.*$/m.test(text) ? text.replace(/^resourcePacks:.*$/m, line) : (text && !text.endsWith('\n') ? text + '\n' : text) + line + '\n';
  fs.mkdirSync(instDir, { recursive: true });
  fs.writeFileSync(optFile(instDir), text);
}

/* ---------- Iris (which shader pack is on) ---------- */
const irisFile = (instDir) => path.join(instDir, 'config', 'iris.properties');
function readIris(instDir) {
  const out = {};
  try { for (const l of fs.readFileSync(irisFile(instDir), 'utf8').split(/\r?\n/)) { const m = l.match(/^([^#=\s][^=]*)=(.*)$/); if (m) out[m[1]] = m[2]; } } catch {}
  return out;
}
function setShaderPack(instDir, fileName) {
  const want = fileName ? { shaderPack: fileName, enableShaders: 'true' } : { enableShaders: 'false' };
  let lines = [];
  try { lines = fs.readFileSync(irisFile(instDir), 'utf8').split(/\r?\n/); } catch {}
  const seen = new Set();
  const out = lines.map((l) => { const m = l.match(/^([^#=\s][^=]*)=/); if (m && m[1] in want) { seen.add(m[1]); return `${m[1]}=${want[m[1]]}`; } return l; });
  for (const [k, v] of Object.entries(want)) if (!seen.has(k)) out.push(`${k}=${v}`);
  fs.mkdirSync(path.dirname(irisFile(instDir)), { recursive: true });
  fs.writeFileSync(irisFile(instDir), out.filter((l, i) => l || i < out.length - 1).join('\n') + '\n');
}

/* ---------- what's installed ---------- */
function entries(instDir, kind) {
  const d = dirFor(instDir, kind);
  if (!fs.existsSync(d)) return [];
  const list = fs.readdirSync(d, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  if (kind === 'mod') return list.filter((e) => e.isFile() && /\.jar(\.disabled)?$/.test(e.name));
  return list.filter((e) => e.isDirectory() || /\.zip$/i.test(e.name));
}

function size(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    return fs.readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0);
  } catch { return 0; }
}

function list(instDir, kind, mc) {
  const packs = kind === 'resourcepack' ? readPackList(instDir) || [] : [];
  const iris = kind === 'shader' ? readIris(instDir) : {};
  return entries(instDir, kind).map((e) => ({
    file: e.name,
    isDir: e.isDirectory(),
    size: size(path.join(dirFor(instDir, kind), e.name)),
    enabled: kind === 'mod' ? !e.name.endsWith('.disabled')
      : kind === 'resourcepack' ? packs.includes(packEntry(e.name, mc))
      : iris.enableShaders === 'true' && iris.shaderPack === e.name,
  }));
}

function toggle(instDir, kind, file, mc) {
  const name = safe(file);
  const d = dirFor(instDir, kind);
  if (kind === 'mod') {
    const to = name.endsWith('.disabled') ? name.slice(0, -9) : name + '.disabled';
    fs.renameSync(path.join(d, name), path.join(d, to));
  } else if (kind === 'resourcepack') {
    setResourcePack(instDir, name, !(readPackList(instDir) || []).includes(packEntry(name, mc)), mc);
  } else {
    const iris = readIris(instDir);
    setShaderPack(instDir, iris.enableShaders === 'true' && iris.shaderPack === name ? null : name);
  }
}

function remove(instDir, kind, file, mc) {
  const name = safe(file);
  fs.rmSync(path.join(dirFor(instDir, kind), name), { recursive: true, force: true });
  if (kind === 'resourcepack') setResourcePack(instDir, name, false, mc);
  if (kind === 'shader' && readIris(instDir).shaderPack === name) setShaderPack(instDir, null);
}

/* ---------- adding from the computer ---------- */
// Works out what a file or folder is, so the user never has to say.
function classify(p) {
  let st;
  try { st = fs.statSync(p); } catch { return { error: "That file couldn't be read." }; }
  if (st.isDirectory()) {
    if (fs.existsSync(path.join(p, 'pack.mcmeta'))) return { kind: 'resourcepack' };
    if (fs.existsSync(path.join(p, 'shaders'))) return { kind: 'shader' };
    return { error: 'That folder isn’t a resource pack or shader pack. It should contain pack.mcmeta or a shaders folder.' };
  }
  const ext = path.extname(p).toLowerCase();
  if (ext !== '.jar' && ext !== '.zip') return { error: 'Only .jar mods and .zip packs (or pack folders) can be added.' };
  let names;
  try { names = new AdmZip(p).getEntries().map((e) => e.entryName); } catch { return { error: "That file isn't a valid zip or jar." }; }
  if (ext === '.jar') {
    if (names.includes('fabric.mod.json')) return { kind: 'mod' };
    if (names.some((n) => n === 'META-INF/mods.toml' || n === 'META-INF/neoforge.mods.toml' || n === 'mcmod.info')) return { kind: 'mod', warn: 'This looks like a Forge or NeoForge mod. Crooli MC Launcher runs Fabric, so it won’t load.' };
    return { kind: 'mod', warn: 'No mod information found in this jar. It may not load.' };
  }
  if (names.includes('pack.mcmeta')) return { kind: 'resourcepack' };
  if (names.some((n) => n.startsWith('shaders/'))) return { kind: 'shader' };
  const inner = names.find((n) => /^[^/]+\/(pack\.mcmeta|shaders\/)/.test(n));
  if (inner) return { error: `The files are inside a folder (${inner.split('/')[0]}) in this zip. Unzip it and add that inner folder instead.` };
  return { error: 'That zip isn’t a resource pack or shader pack. It should contain pack.mcmeta or a shaders folder.' };
}

function addLocal(instDir, paths, { loader } = {}) {
  return paths.map((p) => {
    const name = path.basename(p);
    const c = classify(p);
    if (c.error) return { name, error: c.error };
    if (c.kind === 'mod' && loader !== 'fabric') return { name, error: 'Mods need a Fabric installation. Make one on the Installations tab.' };
    const dest = path.join(dirFor(instDir, c.kind), safe(name));
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(p, dest, { recursive: true, force: true });
    } catch (e) { return { name, error: `Couldn't copy it: ${e.message}` }; }
    return { name, kind: c.kind, warn: c.warn };
  });
}

module.exports = { DIRS, NAMES, legacyOf, list, toggle, remove, classify, addLocal, setResourcePack, setShaderPack, dirFor };
