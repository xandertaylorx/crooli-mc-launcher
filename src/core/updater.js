// Keeps the launcher up to date by itself.
//
// Both platforms work the same way for the person using it: a new version is found, downloaded in the background,
// and installed when the launcher is closed (or right away with "Restart and update").
//   Windows: electron-updater does the download and the install.
//   macOS:   Apple only lets apps signed with a paid developer certificate use the standard updater, so this does it
//            directly. It downloads the .dmg, checks it against the SHA-256 GitHub publishes for it, and when the
//            launcher closes a small helper script swaps the app in place and (for "Restart and update") reopens it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getJson, root, UA } = require('./util');

const REPO = 'xandertaylorx/crooli-mc-launcher';
const EVERY = 6 * 60 * 60 * 1000;

// "0.10.0" > "0.9.2"
function newer(a, b) {
  const pa = a.split(/[.-]/).map(Number), pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// The script that replaces the app once the launcher has quit. Written out as a file because it has to outlive us.
// It never leaves you without an app: the old one is put back if any step fails.
const HELPER = `#!/bin/bash
# args: launcher pid, dmg, app bundle, relaunch (1 or 0), log file, expected version
PID="$1"; DMG="$2"; APP="$3"; RELAUNCH="$4"; LOG="$5"; WANT="$6"
exec >>"$LOG" 2>&1
echo "== $(date) updating $APP to $WANT"
for i in $(seq 1 200); do kill -0 "$PID" 2>/dev/null || break; sleep 0.3; done
MNT=$(mktemp -d /tmp/crooli-update.XXXXXX)
if ! hdiutil attach -nobrowse -noverify -noautoopen -readonly -mountpoint "$MNT" "$DMG" >/dev/null 2>&1 \\
   && ! diskutil image attach --mountOptions nobrowse --readOnly --mountPoint "$MNT" "$DMG" >/dev/null 2>&1; then
  echo "could not open the download"; rmdir "$MNT" 2>/dev/null
  [ "$RELAUNCH" = 1 ] && open "$APP"; exit 1
fi
SRC=$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)
DIR=$(dirname "$APP")
STAGE="$DIR/.crooli-new-$$.app"; OLD="$DIR/.crooli-old-$$.app"
rm -rf "$STAGE"
if [ -n "$SRC" ] && ditto "$SRC" "$STAGE"; then
  hdiutil detach "$MNT" -quiet -force
  GOT=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$STAGE/Contents/Info.plist" 2>/dev/null)
  if [ -n "$WANT" ] && [ "$GOT" != "$WANT" ]; then
    echo "the download is version $GOT, expected $WANT; leaving the app as it is"; rm -rf "$STAGE"
  elif mv "$APP" "$OLD"; then
    if mv "$STAGE" "$APP"; then rm -rf "$OLD"; xattr -cr "$APP" 2>/dev/null; rm -f "$DMG"; echo "updated to $GOT"
    else echo "swap failed, putting the old app back"; mv "$OLD" "$APP"; rm -rf "$STAGE"; fi
  else echo "could not replace the app (no permission?)"; rm -rf "$STAGE"; fi
else
  echo "copy failed"; hdiutil detach "$MNT" -quiet -force; rm -rf "$STAGE"
fi
rmdir "$MNT" 2>/dev/null
[ "$RELAUNCH" = 1 ] && open "$APP"
exit 0
`;

function createUpdater({ app, shell, send }) {
  const current = app.getVersion();
  let state = { state: 'idle', current };
  let auto = null;           // electron-updater, on Windows
  let macAuto = false;       // can this Mac install replace itself?
  let installing = false;
  let download = null;       // { file, version } once a Mac update is downloaded and verified

  const set = (patch) => { state = { ...state, ...patch }; send('update', state); };
  const updatesDir = () => path.join(root(), 'updates');

  /* ----- where this app lives, and whether we may replace it ----- */
  function bundlePath() {
    if (process.platform !== 'darwin' || !app.isPackaged) return null;
    const m = app.getPath('exe').match(/^(.*\.app)\/Contents\/MacOS\//);
    return m ? m[1] : null;
  }
  function canReplace(bundle) {
    if (!bundle) return false;
    // Run from a disk image or from a quarantined Downloads folder: Mac copies it somewhere temporary first.
    if (/^\/Volumes\//.test(bundle) || /AppTranslocation/.test(bundle)) return false;
    try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); return true; } catch { return false; }
  }
  macAuto = canReplace(bundlePath());

  if (process.platform === 'win32' && app.isPackaged) {
    try {
      auto = require('electron-updater').autoUpdater;
      auto.autoDownload = true;
      auto.autoInstallOnAppQuit = true; // installs when the launcher is closed
      auto.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
      auto.on('update-downloaded', () => set({ state: 'ready' }));
      auto.on('error', () => set({ state: 'available', auto: false })); // fall back to the download link
    } catch { auto = null; }
  }

  /* ----- macOS: download and verify ----- */
  async function downloadMac(asset, version) {
    fs.mkdirSync(updatesDir(), { recursive: true });
    const file = path.join(updatesDir(), asset.name), part = file + '.part';
    // Already have this exact file from an earlier check? Use it.
    if (fs.existsSync(file) && fs.statSync(file).size === asset.size) { download = { file, version }; return set({ state: 'ready' }); }
    set({ state: 'downloading', percent: 0 });
    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': UA } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let got = 0, last = 0;
    for await (const chunk of res.body) {
      hash.update(chunk); got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const pct = asset.size ? Math.floor((got / asset.size) * 100) : 0;
      if (pct !== last) { last = pct; set({ percent: pct }); }
    }
    await new Promise((r) => out.end(r));
    const sum = hash.digest('hex');
    const want = (asset.digest || '').replace(/^sha256:/, '');
    if ((want && sum !== want) || (asset.size && got !== asset.size)) { fs.rmSync(part, { force: true }); throw new Error('The download didn’t match its checksum.'); }
    fs.renameSync(part, file);
    download = { file, version };
    set({ state: 'ready' });
  }

  /* ----- checking ----- */
  async function check(manual = false) {
    try {
      const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
      const latest = rel.tag_name.replace(/^v/, '');
      if (!newer(latest, current)) {
        if (manual) set({ state: 'latest', latest });
        return state;
      }
      if (['downloading', 'ready'].includes(state.state)) return state;
      const files = rel.assets || [];
      const dmg = process.arch === 'arm64'
        ? files.find((a) => /arm64.*\.dmg$/i.test(a.name))
        : files.find((a) => /(x64|intel).*\.dmg$/i.test(a.name));
      const url = process.platform === 'darwin' && dmg ? dmg.browser_download_url : rel.html_url;
      const self = !!auto || (macAuto && !!dmg);
      set({ state: 'available', latest, url, notes: rel.html_url, auto: self });
      if (auto) auto.checkForUpdates().catch(() => set({ state: 'available', auto: false }));
      else if (macAuto && dmg) {
        try { await downloadMac(dmg, latest); }
        catch { set({ state: 'available', auto: false }); } // no luck: the Download button still works
      }
    } catch {
      if (manual) set({ state: 'error' });
    }
    return state;
  }

  /* ----- installing ----- */
  function installMac(relaunch) {
    if (installing || !download || !macAuto) return false;
    installing = true;
    const script = path.join(updatesDir(), 'install.sh');
    fs.writeFileSync(script, HELPER, { mode: 0o755 });
    spawn('/bin/bash', [script, String(process.pid), download.file, bundlePath(), relaunch ? '1' : '0', path.join(updatesDir(), 'update.log'), download.version], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }

  // "Restart and update" (once downloaded), or open the download page when it can't update itself.
  function apply() {
    if (state.state === 'ready' && auto) return auto.quitAndInstall();
    if (state.state === 'ready' && download) { if (installMac(true)) app.quit(); return; }
    if (state.url) shell.openExternal(state.url);
  }

  // The launcher is really closing now: put a downloaded update in place without reopening anything.
  function onQuit() { if (state.state === 'ready' && download) installMac(false); }

  function start() {
    // Clear downloads left from an older run, but keep the log of the last update.
    try { for (const f of fs.readdirSync(updatesDir())) if (/\.(dmg|part)$/.test(f)) fs.rmSync(path.join(updatesDir(), f), { force: true }); } catch {}
    setTimeout(() => check(), 4000);
    setInterval(() => check(), EVERY);
  }

  return { check, apply, start, onQuit, get: () => state, _canReplace: () => macAuto };
}

module.exports = { createUpdater, newer, HELPER };
