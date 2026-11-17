// Worlds you can download into an installation. The list lives on the website (worlds.json, built by
// scripts/build-worlds.js) and every entry has been checked: it's a real Java world, with its size and SHA-256.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { root, UA } = require('./util');

const LIST_URL = process.env.CROOLI_WORLDS_URL || 'https://mclauncher.crooli.com/worlds.json';
let cache = null;

async function list() {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.data;
  const keep = path.join(root(), 'cache', 'worlds.json');
  try {
    const res = await fetch(LIST_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.writeFileSync(keep, JSON.stringify(data));
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    try { return JSON.parse(fs.readFileSync(keep, 'utf8')); } catch {}   // offline: the last list we saw
    throw new Error('Couldn’t load the list of worlds. Check your internet and try again.');
  }
}

const recordFile = (instDir) => path.join(instDir, '.crooli-worlds.json');
const readRecord = (instDir) => { try { return JSON.parse(fs.readFileSync(recordFile(instDir), 'utf8')); } catch { return {}; } };

// world id -> folder name, for worlds that are still there
function downloaded(instDir) {
  const rec = readRecord(instDir), saves = path.join(instDir, 'saves'), out = {};
  for (const [id, folder] of Object.entries(rec)) if (fs.existsSync(path.join(saves, folder, 'level.dat'))) out[id] = folder;
  return out;
}
function saved(instDir) {
  const saves = path.join(instDir, 'saves');
  try { return fs.readdirSync(saves, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b)); } catch { return []; }
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'World';

// Downloads the zip, checks it against the list's SHA-256, and unpacks the world into saves/.
async function install(instDir, w, onProgress = () => {}) {
  if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com)\//.test(w.url)) throw new Error('That download address isn’t one this launcher trusts.');
  const res = await fetch(w.url, { headers: { 'User-Agent': UA } });
  if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || w.size || 0, limit = Math.max(w.size || 0, 1) * 1.05 + 1048576;
  const hash = crypto.createHash('sha256'), chunks = [];
  let got = 0, last = -1;
  for await (const c of res.body) {
    got += c.length;
    if (got > limit) throw new Error('The file is bigger than the list says, so it was stopped.');
    hash.update(c); chunks.push(c);
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== last) { last = pct; onProgress(pct); }
  }
  if (w.sha256 && hash.digest('hex') !== w.sha256) throw new Error('The download didn’t match its checksum, so it wasn’t installed.');
  const zip = new AdmZip(Buffer.concat(chunks));
  const entries = zip.getEntries();
  const lvl = entries.filter((e) => /(^|\/)level\.dat$/.test(e.entryName)).sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length)[0];
  if (!lvl) throw new Error('That zip doesn’t hold a Java world.');
  const rootPrefix = lvl.entryName.slice(0, -'level.dat'.length);
  const saves = path.join(instDir, 'saves');
  fs.mkdirSync(saves, { recursive: true });
  const base = safeName(w.folder || w.name);
  let folder = base, n = 2;
  while (fs.existsSync(path.join(saves, folder))) folder = `${base} (${n++})`;
  const dest = path.join(saves, folder);
  try {
    for (const e of entries) {
      if (!e.entryName.startsWith(rootPrefix) || /(^|\/)session\.lock$/.test(e.entryName)) continue;
      const rel = e.entryName.slice(rootPrefix.length);
      if (!rel) continue;
      const target = path.join(dest, rel);
      if (!path.resolve(target).startsWith(path.resolve(dest) + path.sep)) continue; // never write outside the world folder
      if (e.isDirectory) fs.mkdirSync(target, { recursive: true });
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, e.getData()); }
    }
  } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); throw new Error(`Couldn’t unpack the world: ${e.message}`); }
  const rec = readRecord(instDir); rec[w.id] = folder;
  fs.writeFileSync(recordFile(instDir), JSON.stringify(rec));
  return { folder };
}

module.exports = { list, install, downloaded, saved };
