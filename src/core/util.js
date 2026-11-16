const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'CrooliLauncher/0.1.0 (personal minecraft launcher)';

let ROOT = null;
function setRoot(r) { ROOT = r; fs.mkdirSync(r, { recursive: true }); }
function root() { if (!ROOT) throw new Error('root not set'); return ROOT; }
const dirs = {
  versions: () => path.join(root(), 'versions'),
  libraries: () => path.join(root(), 'libraries'),
  assets: () => path.join(root(), 'assets'),
  runtime: () => path.join(root(), 'runtime'),
  instances: () => path.join(root(), 'instances'),
};

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function fileOk(file, sha1, size) {
  try {
    const st = fs.statSync(file);
    if (size != null && st.size !== size) return false;
    if (sha1 && (await sha1File(file)) !== sha1) return false;
    return true;
  } catch { return false; }
}

// Download one file (to a .part then rename). Retries a few times.
async function downloadFile(url, dest, { sha1, size } = {}) {
  if (await fileOk(dest, sha1, size)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (sha1 && crypto.createHash('sha1').update(buf).digest('hex') !== sha1) throw new Error('checksum mismatch');
      const tmp = dest + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      return true;
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 400 * (attempt + 1))); }
  }
  throw new Error(`Failed to download ${url}: ${lastErr.message}`);
}

// Download many files with limited concurrency. tasks: [{url,dest,sha1,size}]
async function downloadAll(tasks, onProgress, concurrency = 16) {
  let i = 0, done = 0;
  const total = tasks.length;
  onProgress && onProgress(0, total);
  async function worker() {
    while (i < tasks.length) {
      const t = tasks[i++];
      await downloadFile(t.url, t.dest, t);
      if (t.mode) { try { fs.chmodSync(t.dest, t.mode); } catch {} }
      done++;
      onProgress && onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker));
}

const OS = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'windows' : 'linux';
const ARCH = process.arch; // 'arm64' | 'x64' | 'ia32'

module.exports = { UA, setRoot, root, dirs, getJson, downloadFile, downloadAll, fileOk, OS, ARCH };
