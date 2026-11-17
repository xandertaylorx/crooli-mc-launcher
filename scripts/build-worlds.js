#!/usr/bin/env node
// Builds web/worlds.json: the list of downloadable Minecraft Java worlds the launcher's Worlds tab and the website show.
//
// It only lists worlds it has checked itself. For each candidate GitHub repository with an open licence it downloads
// the release zip, confirms it holds a real Java world (a level.dat with region files), reads the world's name and the
// Minecraft version it was last saved in, and records the file's size and SHA-256 so the launcher can verify the
// download. Run: `node scripts/build-worlds.js` (needs the `gh` CLI signed in, and `unzip`).
// Add or remove repos by editing scripts/worlds-sources.json (extra repos to try, and repos to skip).
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'web');
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, 'worlds-sources.json'), 'utf8'));
const MAX_BYTES = (SRC.maxMB || 200) * 1048576;
const ALLOW = new Set(['MIT', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'Unlicense', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'GPL-3.0', 'GPL-2.0', 'LGPL-3.0', 'MPL-2.0', 'CC-BY-3.0', 'CC-BY-SA-3.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0']);
const gh = (args) => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const log = (...a) => console.log(...a);
const clean = (t) => String(t || '').replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim(); // Minecraft colour codes out of names

/* ---- a small reader for the NBT in level.dat ---- */
function nbt(buf) {
  let p = 0;
  const rd = {
    1: () => buf.readInt8(p++), 2: () => { const v = buf.readInt16BE(p); p += 2; return v; }, 3: () => { const v = buf.readInt32BE(p); p += 4; return v; },
    4: () => { const v = buf.readBigInt64BE(p); p += 8; return Number(v); }, 5: () => { const v = buf.readFloatBE(p); p += 4; return v; }, 6: () => { const v = buf.readDoubleBE(p); p += 8; return v; },
    7: () => { const n = buf.readInt32BE(p); p += 4 + n; return null; }, 8: () => { const n = buf.readUInt16BE(p); p += 2; const s = buf.toString('utf8', p, p + n); p += n; return s; },
    9: () => { const t = buf[p++], n = buf.readInt32BE(p); p += 4; const a = []; for (let i = 0; i < n; i++) a.push(rd[t]()); return a; },
    10: () => { const o = {}; for (;;) { const t = buf[p++]; if (t === 0) return o; const n = buf.readUInt16BE(p); p += 2; const k = buf.toString('utf8', p, p + n); p += n; o[k] = rd[t](); } },
    11: () => { const n = buf.readInt32BE(p); p += 4 + n * 4; return null; }, 12: () => { const n = buf.readInt32BE(p); p += 4 + n * 8; return null; },
  };
  p++; const n = buf.readUInt16BE(p); p += 2 + n; // root type and name
  return rd[10]();
}

/* ---- find candidate repositories ---- */
const repos = new Map();
for (const q of SRC.queries) {
  for (let page = 1; page <= 3; page++) {
    let r; try { r = gh([`search/repositories?q=${encodeURIComponent(q)}&per_page=100&page=${page}`]); } catch { break; }
    for (const it of r.items) repos.set(it.full_name, it);
    if (r.items.length < 100) break;
    sleep(2200);
  }
  sleep(2200);
}
for (const name of SRC.extraRepos || []) { try { repos.set(name, gh([`repos/${name}`])); } catch {} }
log(`${repos.size} repositories found`);

const worlds = [], skipped = {};
const skip = (why, name) => { (skipped[why] = skipped[why] || []).push(name); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-'));
fs.mkdirSync(path.join(OUT, 'world-icons'), { recursive: true });

for (const [full, repo] of repos) {
  if ((SRC.skipRepos || []).includes(full)) continue;
  const lic = repo.license && repo.license.spdx_id;
  if (!lic || !ALLOW.has(lic)) { skip('no open licence', full); continue; }
  if (/bedrock|mcpe|\.mcworld|mcmap|editor|viewer|renderer|generator|plugin|server-?software|tool/i.test(full + ' ' + (repo.description || ''))) { skip('looks like a tool', full); continue; }
  let rels; try { rels = gh([`repos/${full}/releases?per_page=8`]); } catch { continue; }
  let taken = 0;
  for (const rel of rels) {
    if (rel.draft || taken >= 3) continue;
    for (const a of rel.assets) {
      if (taken >= 3 || !/\.zip$/i.test(a.name) || a.size < 20000 || a.size > MAX_BYTES) continue;
      const file = path.join(tmp, `${repo.id}-${a.id}.zip`);
      try {
        execFileSync('curl', ['-fsSL', '--max-time', '240', '-o', file, a.browser_download_url], { stdio: 'ignore' });
        const list = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean);
        const lvl = list.filter((n) => /(^|\/)level\.dat$/.test(n)).sort((x, y) => x.split('/').length - y.split('/').length)[0];
        if (!lvl) { skip('no level.dat', `${full}/${a.name}`); continue; }
        const root = lvl.slice(0, -'level.dat'.length);
        if (list.some((n) => /(^|\/)(db\/|levelname\.txt)/.test(n))) { skip('bedrock', `${full}/${a.name}`); continue; }
        if (!list.some((n) => n.startsWith(root + 'region/') || /\/DIM-?1\/region\//.test(n) || n.startsWith(root + 'DIM'))) { skip('no region files', `${full}/${a.name}`); continue; }
        const data = nbt(zlib.gunzipSync(execFileSync('unzip', ['-p', file, lvl], { maxBuffer: 1 << 26 }))).Data || {};
        const mc = data.Version && data.Version.Name ? clean(data.Version.Name).match(/\d+(\.\d+)+/)?.[0] || null : null;
        const id = `${repo.owner.login}-${repo.name}-${a.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        let icon = null;
        if (list.includes(root + 'icon.png')) { try { fs.writeFileSync(path.join(OUT, 'world-icons', id + '.png'), execFileSync('unzip', ['-p', file, root + 'icon.png'], { maxBuffer: 1 << 24 })); icon = `world-icons/${id}.png`; } catch {} }
        const entry = {
          id, name: clean(data.LevelName || a.name.replace(/\.zip$/i, '')).slice(0, 80), author: repo.owner.login,
          description: (repo.description || '').slice(0, 220), mc: mc || '1.8', mcKnown: !!mc, dataVersion: data.DataVersion || null,
          size: a.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
          url: a.browser_download_url, folder: root.replace(/\/$/, '').split('/').pop() || null,
          license: lic, source: repo.html_url, stars: repo.stargazers_count, downloads: a.download_count, updated: a.updated_at, icon,
        };
        // one entry per world: later releases of the same world ("Bingo 5.3.1", "Bingo 5.3.2") are skipped, newest wins
        const stem = (n) => n.toLowerCase().replace(/[\d.]+/g, '').replace(/\bv\b|\bby\b.*$/g, '').replace(/[^a-z\u00c0-\uffff]+/g, ' ').trim();
        const dup = worlds.find((x) => x.source === entry.source && stem(x.name) === stem(entry.name));
        if (dup) { skip('older copy of a world already listed', `${full}/${a.name}`); fs.rmSync(file, { force: true }); continue; }
        worlds.push(entry);
        taken++; log(`+ ${data.LevelName || a.name} (${mc || 'pre-1.9'}) from ${full}`);
      } catch (e) { skip('could not check', `${full}/${a.name}`); }
      finally { fs.rmSync(file, { force: true }); }
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
worlds.sort((a, b) => b.downloads - a.downloads || b.stars - a.stars);
fs.writeFileSync(path.join(OUT, 'worlds.json'), JSON.stringify({ updated: new Date().toISOString(), count: worlds.length, worlds }, null, 1));
log(`\n${worlds.length} worlds written to web/worlds.json`);
for (const [k, v] of Object.entries(skipped)) log(`  skipped, ${k}: ${v.length}`);
