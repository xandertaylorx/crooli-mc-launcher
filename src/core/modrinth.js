const path = require('path');
const { getJson, downloadFile } = require('./util');
const { dirFor } = require('./packs');
const { MOD_LOADERS } = require('./loaders');
const loadersOf = (l) => MOD_LOADERS[l] || [l];

const API = 'https://api.modrinth.com/v2';
const q = o => encodeURIComponent(JSON.stringify(o));
const TYPES = ['mod', 'resourcepack', 'shader'];

// Search Modrinth for something that works with a game version. Empty query = most downloaded.
//   mod:          Fabric mods for the version
//   resourcepack: packs for the version
//   shader:       packs that Iris can load
async function search({ query = '', mc, loader = 'fabric', type = 'mod', offset = 0, serverSide = false }) {
  if (!TYPES.includes(type)) throw new Error('Unknown type');
  const facets = [[`project_type:${type}`]];
  if (type === 'mod') facets.push(loadersOf(loader).map((l) => `categories:${l}`));
  if (type === 'shader') facets.push(['categories:iris']);
  if (mc) facets.push([`versions:${mc}`]);
  if (serverSide) facets.push(['server_side:required', 'server_side:optional']); // mods a server can actually use
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

// Newest build for this game version. Resource packs and shaders are loose about versions, so if nothing is
// marked for this exact version the newest one is used and the caller is told.
async function latestVersion(projectId, mc, loader, type) {
  const loaders = type === 'mod' ? `&loaders=${q(loadersOf(loader))}` : '';
  let vs = await getJson(`${API}/project/${projectId}/version?game_versions=${q([mc])}${loaders}`);
  // Prefer stable releases. Betas and alphas are only used when there is nothing stable for this version,
  // because mods are tested against each other's stable builds (a beta of one can break another).
  const rank = { release: 0, beta: 1, alpha: 2 };
  vs = vs.map((v, i) => [v, i]).sort((a, b) => ((rank[a[0].version_type] ?? 3) - (rank[b[0].version_type] ?? 3)) || (a[1] - b[1])).map((x) => x[0]);
  if (type === 'shader') vs = [...vs.filter(v => (v.loaders || []).includes('iris')), ...vs.filter(v => !(v.loaders || []).includes('iris'))];
  if (vs[0]) return { version: vs[0], exact: true };
  if (type === 'mod') return null;
  const any = await getJson(`${API}/project/${projectId}/version`);
  return any[0] ? { version: any[0], exact: false } : null;
}

// Install something and, for mods, the mods it requires. Returns { files, exact }.
async function install(instDir, projectId, mc, loader, type = 'mod', _seen = new Set()) {
  if (_seen.has(projectId)) return { files: [], exact: true };
  _seen.add(projectId);
  const found = await latestVersion(projectId, mc, loader, type);
  if (!found) throw new Error(`No ${type === 'mod' ? loader + ' ' : ''}build for Minecraft ${mc} found`);
  const v = found.version;
  const file = v.files.find(f => f.primary) || v.files[0];
  const dest = path.join(dirFor(instDir, type), path.basename(file.filename));
  await downloadFile(file.url, dest, { sha1: file.hashes && file.hashes.sha1, size: file.size });
  const done = [file.filename];
  if (type === 'mod') {
    for (const dep of v.dependencies || []) {
      if (dep.dependency_type === 'required' && dep.project_id) {
        try { done.push(...(await install(instDir, dep.project_id, mc, loader, 'mod', _seen)).files); } catch (e) { done.push(`(dependency failed: ${e.message})`); }
      }
    }
  }
  return { files: done, exact: found.exact };
}

module.exports = { search, install };
