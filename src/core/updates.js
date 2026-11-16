// "Update all" for mods: find newer builds of what is installed, and swap them in one at a time, keeping each
// swap only if the mods still work together afterwards.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UA, downloadFile } = require('./util');
const { dirFor } = require('./packs');
const compat = require('./compat');
const { MOD_LOADERS } = require('./loaders');

const API = 'https://api.modrinth.com/v2';
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
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

// What can be updated: [{ file, enabled, title, from, to, version }]
async function plan(instDir, mc, loader) {
  const dir = dirFor(instDir, 'mod');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/.test(f) && !f.startsWith('.'));
  if (!files.length) return [];
  const hashOf = new Map(files.map((f) => [sha1(path.join(dir, f)), f]));
  const hashes = [...hashOf.keys()];
  const current = await post(`${API}/version_files`, { hashes, algorithm: 'sha1' });      // what each file is
  const latest = await post(`${API}/version_files/update`, { hashes, algorithm: 'sha1', loaders: MOD_LOADERS[loader] || [loader], game_versions: [mc] }); // newest for this game version
  const out = [];
  for (const [hash, file] of hashOf) {
    const cur = current[hash], next = latest[hash];
    if (!cur || !next || next.id === cur.id) continue;
    if (new Date(next.date_published) <= new Date(cur.date_published)) continue;
    // Stable stays stable: a beta is only offered to someone already on a beta.
    if (next.version_type !== 'release' && cur.version_type === 'release') continue;
    const f = next.files.find((x) => x.primary) || next.files[0];
    if (!f) continue;
    out.push({ file, enabled: !file.endsWith('.disabled'), project: next.project_id, from: cur.version_number, to: next.version_number, url: f.url, filename: f.filename, sha1: f.hashes && f.hashes.sha1, size: f.size });
  }
  if (out.length) {
    try {
      const ps = await get(`${API}/projects?ids=${encodeURIComponent(JSON.stringify([...new Set(out.map((u) => u.project))]))}`);
      const title = new Map(ps.map((p) => [p.id, p.title]));
      out.forEach((u) => (u.title = title.get(u.project) || u.filename));
    } catch { out.forEach((u) => (u.title = u.filename)); }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// Applies a plan. Each update is checked on its own; one that would leave a conflict is put back.
async function apply(instDir, updates, onStep = () => {}) {
  const dir = dirFor(instDir, 'mod');
  const done = [], skipped = [];
  const problems = () => { try { return compat.check(compat.scan(instDir)); } catch { return []; } };
  const known = new Set(problems().map((p) => p.text));
  let n = 0;
  for (const u of updates) {
    onStep(`Updating ${u.title}…`, ++n, updates.length);
    const old = path.join(dir, path.basename(u.file));
    if (!fs.existsSync(old)) { skipped.push({ title: u.title, why: 'It was removed.' }); continue; }
    const target = path.join(dir, path.basename(u.filename) + (u.enabled ? '' : '.disabled'));
    const fresh = path.join(dir, '.crooli-new-' + path.basename(u.filename));
    const backup = path.join(dir, '.crooli-old-' + path.basename(u.file));
    try {
      await downloadFile(u.url, fresh, { sha1: u.sha1, size: u.size });
      fs.renameSync(old, backup);
      fs.renameSync(fresh, target);
      const bad = problems().filter((p) => !known.has(p.text));
      if (bad.length) {
        fs.rmSync(target, { force: true }); fs.renameSync(backup, old);
        skipped.push({ title: u.title, why: bad[0].text });
        continue;
      }
      fs.rmSync(backup, { force: true });
      done.push({ title: u.title, from: u.from, to: u.to });
    } catch (e) {
      fs.rmSync(fresh, { force: true });
      if (fs.existsSync(backup)) { fs.rmSync(target, { force: true }); if (!fs.existsSync(old)) fs.renameSync(backup, old); }
      skipped.push({ title: u.title, why: e.message });
    }
  }
  return { done, skipped };
}

module.exports = { plan, apply };
