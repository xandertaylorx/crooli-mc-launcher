// A tunnel so friends outside your Wi-Fi can join a server without port forwarding. It uses `bore`
// (github.com/ekzhang/bore, MIT): a small program that connects out to a public relay, which hands back an address
// like bore.pub:12345. No account is needed. The program is downloaded once, checked against GitHub's checksum,
// and kept in the launcher's data folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { root, UA } = require('./util');

const VERSION = 'v0.6.0';
const RELAY = 'bore.pub';
const tunnels = new Map(); // server id -> { child, state, address }

function assetName() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'darwin') return `bore-${VERSION}-${arch}-apple-darwin.tar.gz`;
  if (process.platform === 'win32') return `bore-${VERSION}-x86_64-pc-windows-msvc.zip`;
  return `bore-${VERSION}-${arch}-unknown-linux-musl.tar.gz`;
}
const binPath = () => path.join(root(), 'tools', 'bore', VERSION, process.platform === 'win32' ? 'bore.exe' : 'bore');

async function ensureBinary() {
  const bin = binPath();
  if (fs.existsSync(bin)) return bin;
  const name = assetName();
  const rel = await (await fetch(`https://api.github.com/repos/ekzhang/bore/releases/tags/${VERSION}`, { headers: { 'User-Agent': UA } })).json();
  const asset = (rel.assets || []).find((a) => a.name === name);
  if (!asset) throw new Error('The tunnel program isn’t available for this computer.');
  const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Couldn’t download the tunnel program.');
  const buf = Buffer.from(await res.arrayBuffer());
  const want = (asset.digest || '').replace(/^sha256:/, '');
  if (want && crypto.createHash('sha256').update(buf).digest('hex') !== want) throw new Error('The tunnel program didn’t match its checksum, so it wasn’t used.');
  const dir = path.dirname(bin);
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, name);
  fs.writeFileSync(archive, buf);
  if (name.endsWith('.zip')) new (require('adm-zip'))(archive).extractAllTo(dir, true);
  else execFileSync('tar', ['-xzf', archive, '-C', dir]);
  fs.rmSync(archive, { force: true });
  if (!fs.existsSync(bin)) throw new Error('The tunnel program couldn’t be unpacked.');
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  return bin;
}

const get = (id) => { const t = tunnels.get(id); return t ? { state: t.state, address: t.address || null, error: t.error || null } : { state: 'off' }; };

// Starts a tunnel to a running server's port. Calls emit('server:tunnel', {...}) as it changes.
async function start(id, port, emit) {
  if (tunnels.has(id)) return get(id);
  const t = { child: null, state: 'starting', address: null };
  tunnels.set(id, t);
  const push = () => emit('server:tunnel', { id, ...get(id) });
  push();
  try {
    const bin = await ensureBinary();
    if (!tunnels.has(id)) return get(id); // stopped while downloading
    const child = spawn(bin, ['local', String(port), '--local-host', '127.0.0.1', '--to', RELAY], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.child = child;
    const timer = setTimeout(() => { if (t.state === 'starting') fail('The relay didn’t answer. Check your internet and try again.'); }, 20000);
    const fail = (msg) => { t.state = 'error'; t.error = msg; clearTimeout(timer); try { child.kill(); } catch {} push(); };
    const read = (d) => {
      const text = d.toString();
      const m = text.match(new RegExp(`${RELAY.replace('.', '\\.')}:(\\d+)`)) || text.match(/remote_port=(\d+)/);
      if (m && t.state === 'starting') { t.address = `${RELAY}:${m[1]}`; t.state = 'on'; clearTimeout(timer); push(); }
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.on('error', (e) => fail(`Couldn’t start the tunnel: ${e.message}`));
    child.on('exit', () => { clearTimeout(timer); if (tunnels.get(id) === t) { if (t.state !== 'error') { tunnels.delete(id); emit('server:tunnel', { id, state: 'off' }); } } });
  } catch (e) { t.state = 'error'; t.error = e.message; push(); }
  return get(id);
}

function stop(id, emit) {
  const t = tunnels.get(id);
  if (!t) return;
  tunnels.delete(id);
  try { t.child && t.child.kill(); } catch {}
  if (emit) emit('server:tunnel', { id, state: 'off' });
}
const stopAll = () => { for (const id of [...tunnels.keys()]) stop(id); };

module.exports = { start, stop, stopAll, get, RELAY };
