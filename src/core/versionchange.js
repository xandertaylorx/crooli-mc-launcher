// Changing the Minecraft version of an installation, keeping its mods working: each mod is swapped for the build
// that matches the new version, mods with no such build are turned off (not deleted), anything a new build needs is
// added, and worlds are zipped first because an older version can damage a world a newer one has opened.
const fs = require('fs');
const path = require('path');
const { UA, downloadFile } = require('./util');
const { dirFor } = require('./packs');
const modrinth = require('./modrinth');
const compat = require('./compat');

const API = 'https://api.modrinth.com/v2';
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Modrinth said ${r.status}`);
  return r.json();
}
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Modrinth said ${r.status}`);
  return r.json();
}
async function pooled(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// What would happen if this installation moved to newMc.
async function plan(instDir, inst, newMc) {
  const empty = { items: [], missing: [], unknown: [], same: 0, adds: [] };
  if (!inst.loader || inst.loader === 'vanilla') return empty;
  const dir = dirFor(instDir, 'mod');
  if (!fs.existsSync(dir)) return empty;
  const files = fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/.test(f) && !f.startsWith('.'));
  if (!files.length) return empty;
  const crypto = require('crypto');
  const hashOf = new Map(files.map((f) => [crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex'), f]));
  const current = await post(`${API}/version_files`, { hashes: [...hashOf.keys()], algorithm: 'sha1' });
  const unknown = [], byProject = new Map();
  for (const [hash, file] of hashOf) {
    const cur = current[hash];
    if (!cur) { unknown.push(file); continue; }
    if (!byProject.has(cur.project_id)) byProject.set(cur.project_id, { cur, files: [] });
    byProject.get(cur.project_id).files.push(file);
  }
  const projects = [...byProject.keys()];
  const found = await pooled(projects, 6, async (p) => { try { return await modrinth.latestVersion(p, newMc, inst.loader, 'mod'); } catch { return null; } });
  let titles = new Map();
  try { titles = new Map((await get(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(projects))}`)).map((p) => [p.id, p.title])); } catch {}
  const items = [], missing = [], installed = new Set(projects);
  let same = 0;
  projects.forEach((p, i) => {
    const { cur, files: fs_ } = byProject.get(p), f = found[i], title = titles.get(p) || fs_[0];
    if (!f) { fs_.forEach((file) => missing.push({ file, title })); return; }
    const v = f.version;
    if (v.id === cur.id) { same++; return; }
    const file = v.files.find((x) => x.primary) || v.files[0];
    if (!file) { fs_.forEach((fl) => missing.push({ file: fl, title })); return; }
    items.push({ files: fs_, enabled: !fs_[0].endsWith('.disabled'), project: p, title, from: cur.version_number, to: v.version_number, url: file.url, filename: file.filename, sha1: file.hashes && file.hashes.sha1, size: file.size,
      deps: (v.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id) });
  });
  // required mods the new builds bring that aren't installed yet
  const adds = [...new Set(items.flatMap((it) => it.deps))].filter((d) => !installed.has(d));
  return { items: items.sort((a, b) => a.title.localeCompare(b.title)), missing: missing.sort((a, b) => a.title.localeCompare(b.title)), unknown, same, adds };
}

// Zips the worlds into the installation's backups folder. Returns the file, or null when there are none.
function backupWorlds(instRoot, label) {
  const saves = path.join(instRoot, 'saves');
  if (!fs.existsSync(saves) || !fs.readdirSync(saves).length) return Promise.resolve(null);
  const yazl = require('yazl');
  const dir = path.join(instRoot, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(), pad = (n) => String(n).padStart(2, '0');
  const dest = path.join(dir, `worlds-before-${label}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`);
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile(), out = fs.createWriteStream(dest);
    out.on('close', () => resolve(dest)); out.on('error', reject); zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);
    const walk = (rel) => { for (const e of fs.readdirSync(path.join(saves, rel), { withFileTypes: true })) { const r = path.join(rel, e.name); if (e.isDirectory()) walk(r); else if (e.isFile() && !/session\.lock$/.test(e.name)) zip.addFile(path.join(saves, r), path.posix.join('saves', ...r.split(path.sep))); } };
    try { walk(''); zip.end(); } catch (e) { reject(e); }
  });
}

// Does it. All new builds are downloaded first; if any download fails nothing is changed.
async function apply(instDir, instRoot, inst, newMc, p, onStep = () => {}) {
  const dir = dirFor(instDir, 'mod');
  fs.mkdirSync(dir, { recursive: true });
  onStep('Backing up your worlds…');
  const backup = await backupWorlds(instRoot, inst.mc);
  const temps = [];
  const cleanup = () => temps.forEach((t) => fs.rmSync(t, { force: true }));
  let n = 0;
  try {
    for (const it of p.items) {
      onStep(`Downloading ${it.title}…`, ++n, p.items.length);
      const tmp = path.join(dir, '.crooli-new-' + path.basename(it.filename));
      temps.push(tmp);
      await downloadFile(it.url, tmp, { sha1: it.sha1, size: it.size });
    }
  } catch (e) { cleanup(); throw new Error(`Couldn’t download ${p.items[n - 1] ? p.items[n - 1].title : 'a mod'}, so nothing was changed. ${e.message}`); }

  // Swap. Every old file is kept as a backup until the end so this can be undone.
  const undo = [];
  const result = { updated: 0, disabled: [], added: [], problems: [], backup };
  try {
    onStep('Swapping mods…');
    for (const it of p.items) {
      const tmp = path.join(dir, '.crooli-new-' + path.basename(it.filename));
      for (const old of it.files) { const bak = path.join(dir, '.crooli-old-' + old); fs.renameSync(path.join(dir, old), bak); undo.push(() => fs.renameSync(bak, path.join(dir, old))); }
      const target = path.join(dir, path.basename(it.filename) + (it.enabled ? '' : '.disabled'));
      fs.renameSync(tmp, target); undo.push(() => fs.rmSync(target, { force: true }));
      result.updated++;
    }
    for (const m of p.missing) {
      if (m.file.endsWith('.disabled') || !fs.existsSync(path.join(dir, m.file))) continue;
      fs.renameSync(path.join(dir, m.file), path.join(dir, m.file + '.disabled'));
      undo.push(() => fs.renameSync(path.join(dir, m.file + '.disabled'), path.join(dir, m.file)));
      result.disabled.push(m.title);
    }
  } catch (e) {
    undo.reverse().forEach((u) => { try { u(); } catch {} }); cleanup();
    throw new Error(`Something went wrong swapping the mods, so they were put back. ${e.message}`);
  }
  // Keep the old files as backups only until this point; now they can go.
  for (const f of fs.readdirSync(dir)) if (f.startsWith('.crooli-old-')) fs.rmSync(path.join(dir, f), { force: true });

  // Things the new builds need that aren't there
  const target = { ...inst, mc: newMc };
  for (const pid of p.adds) {
    onStep('Adding what the new builds need…');
    try { const r = await modrinth.install(instDir, pid, newMc, inst.loader, 'mod'); result.added.push(...r.files); } catch {}
  }

  // Do they still work together?
  if (['fabric', 'quilt'].includes(inst.loader)) {
    try {
      let problems = compat.check(compat.scan(instDir));
      if (problems.length) { onStep('Fixing mods that don’t fit together…'); try { const fx = await compat.autofix(instDir, target); problems = fx.problems; } catch {} }
      result.problems = problems.map((x) => x.text);
    } catch {}
  }
  return result;
}

module.exports = { plan, apply, backupWorlds };
