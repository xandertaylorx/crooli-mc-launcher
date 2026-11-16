const fs = require('fs');
const path = require('path');
const { getJson, downloadFile, UA } = require('./util');

const API = 'https://api.modrinth.com/v2';
const q = o => encodeURIComponent(JSON.stringify(o));

// Search mods compatible with a game version + loader. Empty query = most downloaded.
async function search({ query = '', mc, loader = 'fabric', offset = 0 }) {
  const facets = [['project_type:mod'], [`categories:${loader}`]];
  if (mc) facets.push([`versions:${mc}`]);
  const url = `${API}/search?query=${encodeURIComponent(query)}&facets=${q(facets)}&limit=20&offset=${offset}&index=${query ? 'relevance' : 'downloads'}`;
  const r = await getJson(url);
  return {
    total: r.total_hits,
    hits: r.hits.map(h => ({
      id: h.project_id, slug: h.slug, title: h.title, author: h.author, description: h.description,
      downloads: h.downloads, icon: h.icon_url,
    })),
  };
}

async function latestVersion(projectId, mc, loader) {
  const vs = await getJson(`${API}/project/${projectId}/version?loaders=${q([loader])}&game_versions=${q([mc])}`);
  return vs[0] || null;
}

function modsDir(instDir) { return path.join(instDir, 'mods'); }

function listInstalled(instDir) {
  const d = modsDir(instDir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled')).map(f => ({
    file: f, enabled: f.endsWith('.jar'), size: fs.statSync(path.join(d, f)).size,
  }));
}

function remove(instDir, file) {
  const p = path.join(modsDir(instDir), path.basename(file)); // basename: no path traversal
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function toggle(instDir, file) {
  const d = modsDir(instDir), b = path.basename(file);
  const from = path.join(d, b);
  const to = b.endsWith('.disabled') ? path.join(d, b.slice(0, -9)) : from + '.disabled';
  fs.renameSync(from, to);
}

// Install a mod and its required dependencies. Returns installed file names.
async function install(instDir, projectId, mc, loader, _seen = new Set()) {
  if (_seen.has(projectId)) return [];
  _seen.add(projectId);
  const v = await latestVersion(projectId, mc, loader);
  if (!v) throw new Error(`No ${loader} build for Minecraft ${mc} found for that mod`);
  const file = v.files.find(f => f.primary) || v.files[0];
  const dest = path.join(modsDir(instDir), path.basename(file.filename));
  await downloadFile(file.url, dest, { sha1: file.hashes && file.hashes.sha1, size: file.size });
  const done = [file.filename];
  for (const dep of v.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      try { done.push(...await install(instDir, dep.project_id, mc, loader, _seen)); } catch (e) { done.push(`(dependency failed: ${e.message})`); }
    }
  }
  return done;
}

module.exports = { search, install, listInstalled, remove, toggle };
