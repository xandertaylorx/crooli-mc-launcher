// Checks GitHub for a newer release.
// Windows: electron-updater downloads it in the background and installs on restart.
// macOS: unsigned apps can't replace themselves, so we point at the right .dmg for this Mac instead.
const { getJson } = require('./util');

const REPO = 'xandertaylorx/crooli-mc-launcher';
const EVERY = 6 * 60 * 60 * 1000;

// "0.10.0" > "0.9.2"
function newer(a, b) {
  const pa = a.split(/[.-]/).map(Number), pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function createUpdater({ app, shell, send }) {
  const current = app.getVersion();
  const canAutoInstall = process.platform === 'win32' && app.isPackaged;
  let state = { state: 'idle', current };
  let auto = null;

  const set = (patch) => { state = { ...state, ...patch }; send('update', state); };

  if (canAutoInstall) {
    try {
      auto = require('electron-updater').autoUpdater;
      auto.autoDownload = true;
      auto.autoInstallOnAppQuit = true;
      auto.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
      auto.on('update-downloaded', () => set({ state: 'ready' }));
      auto.on('error', () => set({ state: 'available' })); // fall back to the download link
    } catch { auto = null; }
  }

  async function check(manual = false) {
    try {
      const rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
      const latest = rel.tag_name.replace(/^v/, '');
      if (!newer(latest, current)) {
        if (manual) set({ state: 'latest', latest });
        return state;
      }
      if (state.state === 'downloading' || state.state === 'ready') return state;
      const files = rel.assets || [];
      const dmg = process.arch === 'arm64'
        ? files.find((a) => /arm64.*\.dmg$/i.test(a.name))
        : files.find((a) => /(x64|intel).*\.dmg$/i.test(a.name));
      const url = process.platform === 'darwin' && dmg ? dmg.browser_download_url : rel.html_url;
      set({ state: 'available', latest, url, notes: rel.html_url, auto: !!auto });
      if (auto) auto.checkForUpdates().catch(() => set({ state: 'available', auto: false }));
    } catch {
      if (manual) set({ state: 'error' });
    }
    return state;
  }

  // Install (Windows, once downloaded) or open the download page (everything else).
  function apply() {
    if (state.state === 'ready' && auto) return auto.quitAndInstall();
    if (state.url) shell.openExternal(state.url);
  }

  function start() {
    setTimeout(() => check(), 4000);
    setInterval(() => check(), EVERY);
  }

  return { check, apply, start, get: () => state };
}

module.exports = { createUpdater, newer };
