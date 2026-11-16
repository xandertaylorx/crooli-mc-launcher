const fs = require('fs');
const path = require('path');
const { getJson, downloadFile, downloadAll, dirs, OS, ARCH } = require('./util');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2';

async function listVersions() {
  const m = await getJson(MANIFEST);
  return m.versions.map(v => ({ id: v.id, type: v.type, url: v.url, sha1: v.sha1 }));
}

async function listFabricGameVersions() {
  const list = await getJson(`${FABRIC_META}/versions/game`);
  return new Set(list.map(v => v.version));
}

// ---- rules ----
function ruleMatches(rule) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== OS) return false;
    if (rule.os.arch) {
      if (rule.os.arch === 'x86') { if (ARCH !== 'ia32') return false; }
      else if (rule.os.arch !== ARCH) return false;
    }
  }
  if (rule.features) return false; // demo / custom resolution stay off
  return true;
}
function rulesAllow(rules) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const r of rules) if (ruleMatches(r)) allowed = r.action === 'allow';
  return allowed;
}

function mavenPath(name) {
  const [g, a, v, c] = name.split(':');
  const ext = 'jar';
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext}`;
}

// Fetch + cache the vanilla version json
async function getVersionJson(id, manifestEntries) {
  const file = path.join(dirs.versions(), id, `${id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = manifestEntries.find(v => v.id === id);
  if (!entry) throw new Error(`Unknown Minecraft version ${id}`);
  await downloadFile(entry.url, file, { sha1: entry.sha1 });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function getFabricProfile(mcVersion, loaderVersion) {
  const lv = loaderVersion || (await getJson(`${FABRIC_META}/versions/loader/${mcVersion}`))[0].loader.version;
  const id = `fabric-loader-${lv}-${mcVersion}`;
  const file = path.join(dirs.versions(), id, `${id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const prof = await getJson(`${FABRIC_META}/versions/loader/${mcVersion}/${lv}/profile/json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prof));
  return prof;
}

// Merge a mod-loader profile onto the vanilla json
function merge(vanilla, loader) {
  if (!loader) return vanilla;
  const va = vanilla.arguments || {}, la = loader.arguments || {};
  return {
    ...vanilla,
    id: loader.id,
    mainClass: loader.mainClass || vanilla.mainClass,
    libraries: [...(loader.libraries || []), ...vanilla.libraries],
    arguments: { game: [...(va.game || []), ...(la.game || [])], jvm: [...(va.jvm || []), ...(la.jvm || [])] },
  };
}

// Work out which library files we need. Returns {classpath: [], downloads: [], natives: []}
function resolveLibraries(vj) {
  const downloads = [], classpath = [], natives = [];
  for (const lib of vj.libraries) {
    if (!rulesAllow(lib.rules)) continue;
    const libDir = dirs.libraries();

    // Old-style natives (<= 1.12): classifier from lib.natives
    if (lib.natives && lib.natives[OS]) {
      const key = lib.natives[OS].replace('${arch}', ARCH === 'ia32' ? '32' : '64');
      const art = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[key];
      if (art) {
        const dest = path.join(libDir, art.path);
        downloads.push({ url: art.url, dest, sha1: art.sha1, size: art.size });
        natives.push({ file: dest, exclude: (lib.extract && lib.extract.exclude) || [] });
      }
      continue;
    }

    const art = lib.downloads && lib.downloads.artifact;
    if (art) {
      if (!art.url) continue;
      const dest = path.join(libDir, art.path);
      downloads.push({ url: art.url, dest, sha1: art.sha1, size: art.size });
      classpath.push(dest);
    } else if (lib.name) {
      // Fabric-style: just name + maven base url
      const p = mavenPath(lib.name);
      const dest = path.join(libDir, p);
      downloads.push({ url: (lib.url || 'https://libraries.minecraft.net/') + p, dest, sha1: lib.sha1 });
      classpath.push(dest);
    }
  }
  return { downloads, classpath, natives };
}

async function ensureAssets(vj, onProgress) {
  const idx = vj.assetIndex;
  const idxFile = path.join(dirs.assets(), 'indexes', `${idx.id}.json`);
  await downloadFile(idx.url, idxFile, { sha1: idx.sha1 });
  const index = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  const tasks = Object.values(index.objects).map(o => ({
    url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
    dest: path.join(dirs.assets(), 'objects', o.hash.slice(0, 2), o.hash),
    sha1: o.hash, size: o.size,
  }));
  // de-dup
  const seen = new Set();
  const uniq = tasks.filter(t => !seen.has(t.dest) && seen.add(t.dest));
  await downloadAll(uniq, onProgress);

  // pre-1.7 style "virtual" assets
  let assetsRoot = dirs.assets();
  if (index.virtual || index.map_to_resources) {
    const vroot = path.join(dirs.assets(), 'virtual', idx.id);
    for (const [name, o] of Object.entries(index.objects)) {
      const src = path.join(dirs.assets(), 'objects', o.hash.slice(0, 2), o.hash);
      const dst = path.join(vroot, name);
      if (!fs.existsSync(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
    }
    assetsRoot = vroot;
  }
  return { assetsRoot, mapToResources: !!index.map_to_resources };
}

module.exports = { listVersions, listFabricGameVersions, getVersionJson, getFabricProfile, merge, resolveLibraries, ensureAssets, rulesAllow };
