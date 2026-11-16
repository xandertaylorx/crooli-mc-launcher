const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const core = require('./core/util');

// Allow tests / portable use: CROOLI_HOME overrides the data folder
core.setRoot(process.env.CROOLI_HOME || path.join(app.getPath('appData'), 'CrooliLauncher'));

const store = require('./core/store');
const V = require('./core/versions');
const L = require('./core/launch');
const mods = require('./core/modrinth');

let win, game = null;
const send = (ch, p) => win && !win.isDestroyed() && win.webContents.send(ch, p);
const instDir = id => path.join(core.dirs.instances(), path.basename(id));
const getInst = id => store.load().instances.find(i => i.id === id);

function createWindow() {
  win = new BrowserWindow({
    width: 1080, height: 720, minWidth: 900, minHeight: 620,
    backgroundColor: '#33363c', title: 'Crooli Launcher', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => app.quit());

// ---- IPC ----
ipcMain.handle('init', async () => {
  let versions = [], fabric = [];
  try { versions = await V.listVersions(); } catch (e) { send('toast', 'Could not reach Mojang: ' + e.message); }
  try { fabric = [...await V.listFabricGameVersions()]; } catch {}
  return { settings: store.load(), versions: versions.map(v => ({ id: v.id, type: v.type })), fabric, dataDir: core.root() };
});

// Mojang's public Java Edition patch notes (what the official launcher shows)
ipcMain.handle('news', async () => {
  try {
    const d = await core.getJson('https://launchercontent.mojang.com/v2/javaPatchNotes.json');
    return d.entries.slice(0, 4).map(e => ({
      title: e.title, type: e.type, date: e.date, text: e.shortText,
      image: e.image && e.image.url ? 'https://launchercontent.mojang.com' + e.image.url : null,
    }));
  } catch { return []; }
});

ipcMain.handle('settings:save', (_e, patch) => { const s = { ...store.load(), ...patch }; store.save(s); return s; });

ipcMain.handle('instance:save', (_e, inst) => {
  const s = store.load();
  if (!inst.id) inst.id = inst.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
  const i = s.instances.findIndex(x => x.id === inst.id);
  if (i >= 0) s.instances[i] = inst; else s.instances.push(inst);
  if (!s.selected) s.selected = inst.id;
  store.save(s); return s;
});

ipcMain.handle('instance:delete', (_e, id) => {
  const s = store.load();
  s.instances = s.instances.filter(i => i.id !== id);
  if (s.selected === id) s.selected = s.instances[0] ? s.instances[0].id : null;
  store.save(s);
  fs.rmSync(instDir(id), { recursive: true, force: true });
  return s;
});

ipcMain.handle('instance:open', (_e, id) => { fs.mkdirSync(instDir(id), { recursive: true }); return shell.openPath(instDir(id)); });

ipcMain.handle('game:launch', async (_e, id) => {
  if (game) return { error: 'The game is already running.' };
  const inst = getInst(id), s = store.load();
  if (!inst) return { error: 'No instance selected.' };
  try {
    send('game:state', 'preparing');
    game = await L.launch(inst, { name: s.username }, (t, p) => send('game:' + t, p), { javaOverride: s.javaPath || null });
    send('game:state', 'running');
    game.on('exit', code => { game = null; send('game:state', 'idle'); send('game:log', `Game exited with code ${code}`); });
    game.on('error', err => { game = null; send('game:state', 'idle'); send('game:log', 'Failed to start: ' + err.message); });
    return { ok: true };
  } catch (e) {
    game = null; send('game:state', 'idle');
    return { error: e.message };
  }
});
ipcMain.handle('game:kill', () => { if (game) game.kill(); });

ipcMain.handle('mods:search', async (_e, args) => { try { return await mods.search(args); } catch (e) { return { error: e.message }; } });
ipcMain.handle('mods:install', async (_e, { id, projectId }) => {
  const inst = getInst(id);
  if (inst.loader === 'vanilla') return { error: 'Switch this instance to Fabric first.' };
  try { return { files: await mods.install(instDir(id), projectId, inst.mc, inst.loader) }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('mods:list', (_e, id) => mods.listInstalled(instDir(id)));
ipcMain.handle('mods:remove', (_e, { id, file }) => { mods.remove(instDir(id), file); return mods.listInstalled(instDir(id)); });
ipcMain.handle('mods:toggle', (_e, { id, file }) => { mods.toggle(instDir(id), file); return mods.listInstalled(instDir(id)); });
