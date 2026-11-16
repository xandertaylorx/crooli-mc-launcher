const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const UA = 'CrooliLauncher/0.4.2 (https://mclauncher.crooli.com)';

let ROOT = null;
function setRoot(r) { ROOT = r; fs.mkdirSync(r, { recursive: true }); }
function root() { if (!ROOT) throw new Error('root not set'); return ROOT; }
const dirs = {
  versions: () => path.join(root(), 'versions'),
  libraries: () => path.join(root(), 'libraries'),
  assets: () => path.join(root(), 'assets'),
  runtime: () => path.join(root(), 'runtime'),
  instances: () => path.join(root(), 'instances'),
  servers: () => path.join(root(), 'servers'),
};

/* ---------- cancellable jobs ----------
   A job covers one launch. While it runs, every download is aborted when the job is cancelled, and every
   file the job newly created is remembered so it can be rolled back. Files that were already on disk
   (shared libraries, assets from an earlier launch) are never touched. The job travels with the async
   call chain, so nothing downstream has to pass it around. */
const jobs = new AsyncLocalStorage();
class Cancelled extends Error { constructor() { super('Cancelled'); this.cancelled = true; } }

function newJob() {
  const ac = new AbortController();
  const created = new Set();
  const job = {
    signal: ac.signal,
    cancelled: () => ac.signal.aborted,
    abort: () => ac.abort(),
    track: (f) => created.add(f),
    run: (fn) => jobs.run(job, fn),
    // Deletes what this job created, then any folders that were left empty. Returns how many files went.
    rollback() {
      let n = 0;
      const parents = new Set();
      for (const f of created) {
        for (const p of [f, f + '.part']) { try { fs.rmSync(p, { recursive: true, force: true }); n++; } catch {} }
        parents.add(path.dirname(f));
      }
      const top = root();
      for (let d of parents) {
        while (d.startsWith(top) && d !== top) {
          try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); } catch { break; }
          d = path.dirname(d);
        }
      }
      // Downloads that were cut off can leave empty folders behind: sweep those too.
      const sweep = (d) => {
        let kids; try { kids = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const k of kids) if (k.isDirectory()) sweep(path.join(d, k.name));
        try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch {}
      };
      for (const d of [dirs.versions(), dirs.libraries(), dirs.assets(), dirs.runtime()]) sweep(d);
      created.clear();
      return n;
    },
  };
  return job;
}
const currentJob = () => jobs.getStore() || null;
const track = (f) => { const j = currentJob(); if (j) j.track(f); };
const checkCancel = () => { const j = currentJob(); if (j && j.cancelled()) throw new Cancelled(); };

async function getJson(url) {
  checkCancel();
  const j = currentJob();
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: j ? j.signal : undefined });
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

// Download one file (to a .part then rename). Retries a few times; stops at once if the job is cancelled.
async function downloadFile(url, dest, { sha1, size } = {}) {
  const job = currentJob();
  checkCancel();
  if (await fileOk(dest, sha1, size)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: job ? job.signal : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (sha1 && crypto.createHash('sha1').update(buf).digest('hex') !== sha1) throw new Error('checksum mismatch');
      checkCancel();
      const tmp = dest + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      if (job) job.track(dest);
      return true;
    } catch (e) {
      if (job && job.cancelled()) throw new Cancelled();
      lastErr = e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw new Error(`Failed to download ${url}: ${lastErr.message}`);
}

// Download many files with limited concurrency. tasks: [{url,dest,sha1,size}]
// Waits for every worker to finish before reporting a failure, so a rollback never races a write.
async function downloadAll(tasks, onProgress, concurrency = 16) {
  let i = 0, done = 0, failed = false;
  const total = tasks.length;
  onProgress && onProgress(0, total);
  async function worker() {
    while (i < tasks.length && !failed) {
      const t = tasks[i++];
      try { await downloadFile(t.url, t.dest, t); } catch (e) { failed = true; throw e; }
      if (t.mode) { try { fs.chmodSync(t.dest, t.mode); } catch {} }
      done++;
      onProgress && onProgress(done, total);
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, tasks.length || 1) }, worker));
  const bad = results.find(r => r.status === 'rejected');
  if (bad) throw bad.reason;
}

const OS = process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'windows' : 'linux';
const ARCH = process.arch; // 'arm64' | 'x64' | 'ia32'

module.exports = { UA, setRoot, root, dirs, getJson, downloadFile, downloadAll, fileOk, OS, ARCH, newJob, currentJob, track, checkCancel, Cancelled };
