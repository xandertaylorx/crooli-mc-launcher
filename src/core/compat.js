// Mod compatibility. Every Fabric mod carries its own rules in fabric.mod.json: what it needs ("depends") and what it
// can't run next to ("breaks"). Fabric checks those at startup and stops with an error box if they aren't met.
// This reads the same rules before the game starts, so a conflict can be explained, fixed or refused up front.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { getJson, downloadFile } = require('./util');

const API = 'https://api.modrinth.com/v2';
const VIRTUAL = new Set(['minecraft', 'java', 'fabricloader']); // checked by the game itself; never a reason to refuse

/* ---------- versions and ranges (the subset of Fabric's semantic versions that mods use) ---------- */
function parseVer(s) {
  s = String(s == null ? '' : s).trim().replace(/^v/i, '');
  const plus = s.indexOf('+'); if (plus >= 0) s = s.slice(0, plus);
  let pre = null; const dash = s.indexOf('-'); if (dash >= 0) { pre = s.slice(dash + 1); s = s.slice(0, dash); }
  const nums = s.split('.');
  if (!s || !nums.every((n) => /^\d+$/.test(n))) return null;
  return { nums: nums.map(Number), pre: pre ? pre.split('.') : null };
}
function cmp(a, b) {
  const n = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < n; i++) { const x = a.nums[i] || 0, y = b.nums[i] || 0; if (x !== y) return x < y ? -1 : 1; }
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) { if (+x !== +y) return +x < +y ? -1 : 1; } else if (xn) return -1; else if (yn) return 1; else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
const bump = (nums, at) => { const r = nums.slice(0, at + 1); r[at] = (r[at] || 0) + 1; return { nums: r, pre: null }; };

function matchOne(v, c) {
  if (c === '*' || c === '' || /^[xX]$/.test(c)) return true;
  const m = c.match(/^(>=|<=|>|<|=|~|\^)?\s*(.*)$/);
  const op = m[1] || '=', rest = m[2].replace(/\+.*$/, '');
  const parts = rest.split('.');
  const wild = parts.findIndex((p) => /^[xX*]$/.test(p));
  if (wild >= 0 && op === '=') return parts.slice(0, wild).every((p, i) => (v.nums[i] || 0) === Number(p));
  const t = parseVer(parts.map((p) => (/^[xX*]$/.test(p) ? '0' : p)).join('.'));
  if (!t) return true; // a version we can't read is never a reason to refuse
  if (op === '>=') return cmp(v, t) >= 0;
  if (op === '>') return cmp(v, t) > 0;
  if (op === '<=') return cmp(v, t) <= 0;
  if (op === '<') return cmp(v, t) < 0;
  if (op === '~') return cmp(v, t) >= 0 && cmp(v, bump(t.nums, t.nums.length >= 2 ? 1 : 0)) < 0;
  if (op === '^') return cmp(v, t) >= 0 && cmp(v, bump(t.nums, t.nums[0] > 0 ? 0 : t.nums[1] > 0 ? 1 : 2)) < 0;
  return cmp(v, t) === 0;
}
// range is a string ("1.2.x", ">=1 <2", "<=1.0 || >=3") or a list of those (any one may match)
function inRange(version, range) {
  const v = parseVer(version);
  if (!v) return true;
  return (Array.isArray(range) ? range : [range]).some((r) => String(r).split('||').some((g) => g.trim().split(/\s+/).filter(Boolean).every((c) => matchOne(v, c))));
}

/* ---------- reading mods ---------- */
const metaCache = new Map(); // "path|size|mtime" -> entries

function entriesOf(zip, depth = 0) {
  const out = [];
  const e = zip.getEntry('fabric.mod.json');
  if (e) {
    try {
      const j = JSON.parse(zip.readAsText(e).replace(/^﻿/, ''));
      out.push({
        id: j.id, version: String(j.version || ''), name: j.name || j.id,
        depends: j.depends || {}, breaks: j.breaks || {},
        provides: Array.isArray(j.provides) ? j.provides.map((p) => (typeof p === 'string' ? p : p.id)) : [],
        nested: depth > 0,
      });
      if (depth < 2) for (const jar of j.jars || []) {
        const ne = jar && zip.getEntry(jar.file);
        if (ne) { try { out.push(...entriesOf(new AdmZip(ne.getData()), depth + 1)); } catch {} }
      }
    } catch {}
  }
  return out;
}
function readJar(file) {
  const st = fs.statSync(file), key = `${file}|${st.size}|${st.mtimeMs}`;
  if (!metaCache.has(key)) { let r = []; try { r = entriesOf(new AdmZip(file)); } catch {} metaCache.set(key, r); }
  return metaCache.get(key);
}

// All the enabled mods in an installation: [{ file, entries }]
function scan(instDir) {
  const dir = path.join(instDir, 'mods');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jar') && !f.startsWith('.')).sort().map((f) => ({ file: f, entries: readJar(path.join(dir, f)) }));
}

/* ---------- checking ---------- */
function check(jars) {
  const present = new Map(); // mod id (and the ids it also answers to) -> what provides it
  for (const j of jars) for (const e of j.entries) for (const id of [e.id, ...e.provides]) if (id && !present.has(id)) present.set(id, { id, version: e.version, name: e.name, file: j.file });
  const problems = [], seen = new Set();
  const add = (p) => { if (!seen.has(p.text)) { seen.add(p.text); problems.push(p); } };
  for (const j of jars) for (const e of j.entries) {
    const me = { id: e.id, name: e.name, version: e.version, file: j.file };
    for (const [id, range] of Object.entries(e.depends)) {
      if (VIRTUAL.has(id)) continue;
      const have = present.get(id);
      if (!have) add({ kind: 'missing', mod: me, other: { id }, range, text: `${e.name} needs ${id}, which isn't installed.` });
      else if (!inRange(have.version, range)) add({ kind: 'version', mod: me, other: have, range, text: `${e.name} ${e.version.split('+')[0]} needs ${have.name} ${fmtRange(range)}, but ${have.version.split('+')[0]} is installed.` });
    }
    for (const [id, range] of Object.entries(e.breaks)) {
      const have = present.get(id);
      if (have && have.id !== e.id && inRange(have.version, range)) add({ kind: 'breaks', mod: me, other: have, range, text: `${e.name} ${e.version.split('+')[0]} doesn't work with ${have.name} ${have.version.split('+')[0]}.` });
    }
  }
  return problems;
}
const fmtRange = (r) => (Array.isArray(r) ? r : [r]).join(' or ');

/* ---------- fixing ---------- */
const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const q = (o) => encodeURIComponent(JSON.stringify(o));

// Newest-first builds of the mod a jar belongs to, for this Minecraft version. Modrinth recognises a jar by its hash.
async function otherBuilds(jarPath, mc) {
  const v = await getJson(`${API}/version_file/${sha1(jarPath)}?algorithm=sha1`);
  const all = await getJson(`${API}/project/${v.project_id}/version?game_versions=${q([mc])}&loaders=${q(['fabric'])}`);
  // Stable builds first, then betas and alphas.
  const rank = { release: 0, beta: 1, alpha: 2 };
  return all.filter((b) => b.id !== v.id).sort((a, b) => (rank[a.version_type] - rank[b.version_type]) || (new Date(b.date_published) - new Date(a.date_published)));
}

// Tries other builds of one mod until the set of problems gets smaller. Returns a description of what it did, or null.
async function tryReplace(instDir, mc, jars, target, baseline) {
  const dir = path.join(instDir, 'mods');
  let builds;
  try { builds = await otherBuilds(path.join(dir, target.file), mc); } catch { return null; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crooli-compat-'));
  try {
    for (const b of builds.slice(0, 10)) {
      const f = b.files.find((x) => x.primary) || b.files[0];
      if (!f) continue;
      const cand = path.join(tmp, path.basename(f.filename));
      try { await downloadFile(f.url, cand, { sha1: f.hashes && f.hashes.sha1, size: f.size }); } catch { continue; }
      const entries = readJar(cand);
      const next = jars.filter((j) => j.file !== target.file).concat([{ file: path.basename(cand), entries }]);
      const after = check(next);
      if (after.length < baseline) {
        const old = target.file;
        fs.rmSync(path.join(dir, old), { force: true });
        fs.copyFileSync(cand, path.join(dir, path.basename(cand)));
        return `Replaced ${old.replace(/\.jar$/, '')} with ${path.basename(cand).replace(/\.jar$/, '')}.`;
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return null;
}

// Works through the problems one at a time, replacing a mod with another build or adding a missing one.
async function autofix(instDir, inst, onStep = () => {}) {
  const modrinth = require('./modrinth');
  const actions = [];
  let jars = scan(instDir), problems = check(jars);
  for (let round = 0; round < 6 && problems.length; round++) {
    const p = problems[0];
    let note = null;
    onStep(`Fixing: ${p.text}`);
    if (p.kind === 'missing') {
      try { await modrinth.install(instDir, p.other.id, inst.mc, 'fabric', 'mod'); note = `Installed ${p.other.id}.`; } catch {}
    } else {
      for (const t of [p.other, p.mod]) {
        if (!t.file) continue;
        note = await tryReplace(instDir, inst.mc, jars, t, problems.length);
        if (note) break;
      }
    }
    if (!note) break;
    actions.push(note);
    jars = scan(instDir); problems = check(jars);
  }
  return { fixed: problems.length === 0, actions, problems };
}

module.exports = { scan, check, autofix, inRange, parseVer };
