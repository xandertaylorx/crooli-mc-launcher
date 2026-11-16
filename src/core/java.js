const fs = require('fs');
const path = require('path');
const { getJson, downloadAll, dirs } = require('./util');

const ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function platformKeys() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? ['mac-os-arm64', 'mac-os'] : ['mac-os'];
  if (process.platform === 'win32') return process.arch === 'arm64' ? ['windows-arm64', 'windows-x64'] : process.arch === 'ia32' ? ['windows-x86'] : ['windows-x64'];
  return ['linux'];
}

function javaBin(dir) {
  const cands = process.platform === 'darwin'
    ? ['jre.bundle/Contents/Home/bin/java', 'bin/java']
    : process.platform === 'win32' ? ['bin/javaw.exe', 'bin/java.exe'] : ['bin/java'];
  for (const c of cands) { const p = path.join(dir, c); if (fs.existsSync(p)) return p; }
  return null;
}

// Download Mojang's bundled Java for a given component (e.g. "java-runtime-delta"). Returns path to java binary.
async function ensureJava(component, onProgress) {
  const all = await getJson(ALL);
  let entry = null, usedKey = null;
  for (const key of platformKeys()) {
    const list = all[key] && all[key][component];
    if (list && list.length) { entry = list[0]; usedKey = key; break; }
  }
  if (!entry) throw new Error(`No Java runtime "${component}" available for this platform`);

  const dir = path.join(dirs.runtime(), component, usedKey);
  const done = path.join(dir, '.installed');
  if (fs.existsSync(done) && javaBin(dir)) return javaBin(dir);

  const manifest = await getJson(entry.manifest.url);
  const tasks = [], links = [];
  for (const [rel, f] of Object.entries(manifest.files)) {
    const dest = path.join(dir, rel);
    if (f.type === 'directory') fs.mkdirSync(dest, { recursive: true });
    else if (f.type === 'link') links.push({ dest, target: f.target });
    else if (f.downloads && f.downloads.raw) {
      tasks.push({ url: f.downloads.raw.url, dest, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size, mode: f.executable ? 0o755 : 0o644 });
    }
  }
  await downloadAll(tasks, onProgress);
  for (const l of links) {
    try { fs.mkdirSync(path.dirname(l.dest), { recursive: true }); if (!fs.existsSync(l.dest)) fs.symlinkSync(l.target, l.dest); } catch {}
  }
  fs.writeFileSync(done, 'ok');
  const bin = javaBin(dir);
  if (!bin) throw new Error('Java downloaded but binary not found');
  return bin;
}

module.exports = { ensureJava };
