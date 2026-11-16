const { app, BrowserWindow, ipcMain, shell, Menu, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const core = require('./core/util');

// Allow tests / portable use: CROOLI_HOME overrides the data folder
core.setRoot(process.env.CROOLI_HOME || path.join(app.getPath('appData'), 'CrooliLauncher'));

const store = require('./core/store');
const V = require('./core/versions');
const L = require('./core/launch');
const mods = require('./core/modrinth');
const packs = require('./core/packs');
const skin = require('./core/skin');
const importer = require('./core/importer');
const crooli = require('./core/crooli-mods');
const compat = require('./core/compat');
const { createUpdater } = require('./core/updater');
const servers = require('./core/servers');

let win, game = null;
const send = (ch, p) => win && !win.isDestroyed() && win.webContents.send(ch, p);
const updater = createUpdater({ app, shell, send });
const instDir = id => path.join(core.dirs.instances(), path.basename(id));
const getInst = id => store.load().instances.find(i => i.id === id);

const appIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));

function createWindow() {
  win = new BrowserWindow({
    icon: appIcon,
    width: 1080, height: 720, minWidth: 900, minHeight: 620,
    backgroundColor: '#33363c', title: 'Crooli MC Launcher', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') Menu.setApplicationMenu(null);
  // Packaged Mac apps get their icon from the bundle; while developing, set the Dock icon ourselves.
  if (process.platform === 'darwin' && app.dock && !app.isPackaged && !appIcon.isEmpty()) app.dock.setIcon(appIcon);
  createWindow();
  // Packaged builds check on their own; CROOLI_UPDATE_CHECK=1 lets a dev build try it too.
  if (app.isPackaged || process.env.CROOLI_UPDATE_CHECK) updater.start();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => app.quit());
// The launcher is really closing: if an update was downloaded, put it in place now.
app.on('will-quit', () => { try { updater.onQuit(); } catch {} });

// Running servers get a proper "stop" (which saves the world) before the app closes.
let stoppingServers = false;
app.on('before-quit', (e) => {
  if (!servers.isRunning() || stoppingServers) return;
  e.preventDefault();
  stoppingServers = true;
  servers.stopAll(send).finally(() => app.quit());
});

// ---- IPC ----
ipcMain.handle('init', async () => {
  let versions = [], fabric = [];
  try { versions = await V.listVersions(); } catch (e) { send('toast', 'Could not reach Mojang: ' + e.message); }
  try { fabric = [...await V.listFabricGameVersions()]; } catch {}
  return { settings: store.load(), versions: versions.map(v => ({ id: v.id, type: v.type })), fabric, dataDir: core.root(), version: app.getVersion(), update: updater.get() };
});

ipcMain.handle('update:check', () => updater.check(true));
ipcMain.handle('update:apply', () => {
  if (game) return { error: 'Close Minecraft first, then update.' };
  if (servers.isRunning()) return { error: 'Stop your servers first, then update.' };
  updater.apply();
  return { ok: true };
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

let launching = null; // the job for a launch that is still getting files ready
ipcMain.handle('game:launch', async (_e, id, opts = {}) => {
  if (game || launching) return { error: 'The game is already running.' };
  const inst = getInst(id), s = store.load();
  if (!inst) return { error: 'No instance selected.' };
  // Don't start a game that Fabric is going to refuse: check the mods' own rules first.
  if (inst.loader === 'fabric' && !opts.force) {
    let problems = [];
    try { problems = compat.check(compat.scan(instDir(id))); } catch {}
    if (problems.length) return { conflicts: problems.map((p) => p.text) };
  }
  const job = core.newJob();
  launching = job;
  try {
    send('game:state', 'preparing');
    game = await job.run(() => L.launch(inst, { name: s.username }, (t, p) => send('game:' + t, p), { javaOverride: s.javaPath || null }));
    launching = null;
    send('game:state', 'running');
    game.on('exit', code => { game = null; send('game:state', 'idle'); send('game:log', `Game exited with code ${code}`); });
    game.on('error', err => { game = null; send('game:state', 'idle'); send('game:log', 'Failed to start: ' + err.message); });
    return { ok: true };
  } catch (e) {
    launching = null; game = null;
    if (e.cancelled || job.cancelled()) {
      job.rollback();
      send('game:state', 'idle');
      return { cancelled: true };
    }
    send('game:state', 'idle');
    return { error: e.message };
  }
});
// Stops a launch that is still downloading, then deletes the files that launch had downloaded.
ipcMain.handle('game:cancel', () => { if (launching) { send('game:state', 'cancelling'); launching.abort(); } return { ok: true }; });
ipcMain.handle('game:kill', () => { if (game) game.kill(); });

// ---- mods, resource packs and shader packs (kind is "mod", "resourcepack" or "shader") ----
const KINDS = ['mod', 'resourcepack', 'shader'];
const kindOf = (k) => (KINDS.includes(k) ? k : 'mod');
ipcMain.handle('packs:search', async (_e, args) => { try { return await mods.search({ ...args, type: kindOf(args.type) }); } catch (e) { return { error: e.message }; } });
ipcMain.handle('packs:install', async (_e, { id, projectId, type }) => {
  const inst = getInst(id), kind = kindOf(type);
  if (!inst) return { error: 'Pick an installation first.' };
  if (kind === 'mod' && inst.loader !== 'fabric') return { error: 'Switch this installation to Fabric first.' };
  if (kind === 'shader' && inst.loader !== 'fabric') return { error: 'Shader packs need Fabric and Iris. Make a Fabric installation.' };
  // For mods: remember what was there, install, and make sure the result still works together. A mod that
  // would leave the installation with a conflict is fixed if possible and otherwise taken back out.
  const dir = path.join(instDir(id), 'mods');
  const had = kind === 'mod' && fs.existsSync(dir) ? new Set(fs.readdirSync(dir)) : null;
  const known = new Set();
  if (had) { try { compat.check(compat.scan(instDir(id))).forEach((p) => known.add(p.text)); } catch {} }
  try {
    const res = await mods.install(instDir(id), projectId, inst.mc, inst.loader, kind);
    if (had) {
      const fresh = () => compat.check(compat.scan(instDir(id))).filter((p) => !known.has(p.text));
      let bad = []; try { bad = fresh(); } catch {}
      if (bad.length) {
        try { await compat.autofix(instDir(id), inst); bad = fresh(); } catch {}
      }
      if (bad.length) {
        for (const f of fs.readdirSync(dir)) if (!had.has(f)) fs.rmSync(path.join(dir, f), { force: true });
        return { error: `That mod can't be added to this installation: ${bad[0].text} It was removed again.` };
      }
    }
    return res;
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('packs:list', (_e, { id, type }) => packs.list(instDir(id), kindOf(type), (getInst(id) || {}).mc));
const whenClosed = () => (game ? 'Close Minecraft first: it saves its settings when it quits and would undo this.' : null);
ipcMain.handle('packs:toggle', (_e, { id, type, file }) => {
  const kind = kindOf(type);
  if (kind !== 'mod' && whenClosed()) return { error: whenClosed() };
  try { packs.toggle(instDir(id), kind, file, (getInst(id) || {}).mc); return { list: packs.list(instDir(id), kind, (getInst(id) || {}).mc) }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('packs:remove', (_e, { id, type, file }) => {
  const kind = kindOf(type);
  if (kind !== 'mod' && whenClosed()) return { error: whenClosed() };
  packs.remove(instDir(id), kind, file, (getInst(id) || {}).mc);
  return { list: packs.list(instDir(id), kind, (getInst(id) || {}).mc) };
});
// Add things from the computer: a file/folder picker, or paths from a drag-and-drop.
function addPaths(id, paths) {
  const inst = getInst(id);
  if (!inst) return { error: 'Pick an installation first.' };
  const results = packs.addLocal(instDir(id), paths, { loader: inst.loader });
  return { results, lists: Object.fromEntries(KINDS.map((k) => [k, packs.list(instDir(id), k, inst.mc)])) };
}
ipcMain.handle('packs:pick', async (_e, { id, folder }) => {
  const r = await dialog.showOpenDialog(win, {
    title: folder ? 'Choose a pack folder' : 'Choose a mod, resource pack or shader pack',
    properties: folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
    filters: folder ? undefined : [{ name: 'Mods and packs', extensions: ['jar', 'zip'] }],
  });
  return r.canceled ? { canceled: true } : addPaths(id, r.filePaths);
});
ipcMain.handle('packs:add', (_e, { id, paths }) => addPaths(id, (paths || []).filter((p) => typeof p === 'string')));

// ---- servers ----
const getSrv = id => (store.load().servers || []).find(s => s.id === id);
const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

ipcMain.handle('servers:save', (_e, input) => {
  const s = store.load();
  s.servers = s.servers || [];
  const isNew = !input.id;
  if (isNew && !input.agreedEula) return { error: 'Agree to the Minecraft EULA to create a server.' };
  const srv = {
    id: input.id || (String(input.name || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server') + '-' + Date.now().toString(36),
    name: String(input.name || 'My Server').slice(0, 40),
    mc: String(input.mc),
    type: input.type === 'fabric' ? 'fabric' : 'vanilla',
    ram: clampInt(input.ram, 1024, 32768, 2048),
    port: clampInt(input.port, 1024, 65535, 25565),
    gamemode: ['survival', 'creative', 'adventure', 'spectator'].includes(input.gamemode) ? input.gamemode : 'survival',
    difficulty: ['peaceful', 'easy', 'normal', 'hard'].includes(input.difficulty) ? input.difficulty : 'normal',
    offline: !!input.offline,
  };
  const prev = s.servers.find(x => x.id === srv.id);
  if (prev) { srv.opts = prev.opts; srv.whitelist = prev.whitelist; }
  if (isNew) servers.writeEula(srv.id);
  const i = s.servers.findIndex(x => x.id === srv.id);
  if (i >= 0) s.servers[i] = srv; else s.servers.push(srv);
  s.selectedServer = srv.id;
  store.save(s);
  return s;
});

ipcMain.handle('servers:delete', async (_e, id) => {
  await servers.stop(id, send);
  const s = store.load();
  s.servers = (s.servers || []).filter(x => x.id !== id);
  if (s.selectedServer === id) s.selectedServer = s.servers[0] ? s.servers[0].id : null;
  store.save(s);
  fs.rmSync(servers.dirOf(id), { recursive: true, force: true });
  return s;
});

ipcMain.handle('servers:start', async (_e, id) => {
  const srv = getSrv(id);
  if (!srv) return { error: 'Pick a server first.' };
  try { await servers.start(srv, send, { javaOverride: store.load().javaPath || null }); return { ok: true }; }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('servers:stop', async (_e, id) => { await servers.stop(id, send); return { ok: true }; });
ipcMain.handle('servers:command', (_e, { id, text }) => {
  try { servers.command(id, text); return { ok: true }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('servers:status', (_e, id) => ({ ...servers.status(id), ...servers.addresses((getSrv(id) || {}).port || 25565) }));
// On/off options and the whitelist, changeable whenever. Running servers get told straight away where they can be.
ipcMain.handle('servers:options', (_e, id) => {
  const srv = getSrv(id); if (!srv) return { error: 'Pick a server first.' };
  return { ...servers.readOptions(srv), whitelistNames: servers.readWhitelist(id), difficulty: srv.difficulty, gamemode: srv.gamemode };
});
ipcMain.handle('servers:set-option', (_e, { id, key, value }) => {
  const s = store.load(); const srv = (s.servers || []).find((x) => x.id === id);
  if (!srv) return { error: 'Pick a server first.' };
  const on = !!value;
  if (key === 'whitelist') {
    srv.whitelist = on; servers.setProperty(id, 'white-list', String(on)); servers.setProperty(id, 'enforce-whitelist', String(on));
  } else if (key === 'difficulty' || key === 'gamemode') {
    const ok = key === 'difficulty' ? ['peaceful', 'easy', 'normal', 'hard'] : ['survival', 'creative', 'adventure', 'spectator'];
    if (!ok.includes(value)) return { error: 'Not a valid choice.' };
    srv[key] = value; servers.setProperty(id, key, value);
    if (servers.isRunning()) { try { servers.command(id, key === 'difficulty' ? `difficulty ${value}` : `defaultgamemode ${value}`); } catch {} }
    store.save(s); return { ok: true };
  } else {
    if (!/^[a-z-]+$/.test(key)) return { error: 'Unknown option.' };
    srv.opts = { ...(srv.opts || {}), [key]: on }; servers.setProperty(id, key, String(on));
  }
  store.save(s);
  try { servers.applyLive(srv, key, on); } catch {}
  return { ok: true };
});
ipcMain.handle('servers:whitelist-add', async (_e, { id, name }) => {
  const srv = getSrv(id); if (!srv) return { error: 'Pick a server first.' };
  try { await servers.whitelistAdd(srv, name); return { ok: true }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('servers:whitelist-remove', (_e, { id, name }) => {
  const srv = getSrv(id); if (!srv) return { error: 'Pick a server first.' };
  try { servers.whitelistRemove(srv, name); return { ok: true }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('servers:whitelist-list', (_e, id) => ({ names: servers.readWhitelist(id) }));
ipcMain.handle('servers:open', (_e, { id, sub }) => {
  const where = { world: 'world', mods: 'mods' }[sub] || '';
  const p = path.join(servers.dirOf(id), where);
  fs.mkdirSync(p, { recursive: true });
  return shell.openPath(p);
});

// ---- skins ----
ipcMain.handle('skin:load', () => skin.load());
ipcMain.handle('skin:save', (_e, s) => { try { skin.save(s); return { ok: true }; } catch (e) { return { error: e.message }; } });
ipcMain.handle('skin:clear', () => { skin.clear(); return { ok: true }; });
ipcMain.handle('skin:lookup', async (_e, name) => { try { return await skin.lookup(String(name).trim()); } catch (e) { return { error: e.message }; } });

// ---- importing installs from other launchers ----
const found = new Map(); // id -> what the scan found, so the renderer only ever names an install it was shown
const present = (c) => ({ ...c, dir: c.dir });
function scanFor(extra) {
  const list = importer.scan(extra);
  found.clear();
  list.forEach((c) => found.set(c.id, c));
  return list.map(present);
}
ipcMain.handle('import:scan', () => scanFor([]));
ipcMain.handle('import:folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder to look in', properties: ['openDirectory'] });
  return r.canceled ? { canceled: true } : { list: scanFor(r.filePaths) };
});
ipcMain.handle('import:run', async (_e, { id, name, mc, parts }) => {
  const cand = found.get(id);
  if (!cand) return { error: 'That install isn’t in the list any more. Look again and try once more.' };
  const version = String(mc || cand.mc || '');
  if (!version) return { error: 'Pick the Minecraft version this install uses.' };
  let entries = [];
  try { entries = await L.manifest(); } catch { return { error: 'Couldn’t reach Mojang to check the version. Check your connection.' }; }
  if (!entries.some((v) => v.id === version)) return { error: `Minecraft ${version} isn’t available to download from Mojang, so it can’t be imported.` };
  let loader = cand.loader === 'fabric' ? 'fabric' : 'vanilla';
  if (loader === 'fabric') {
    try { if (!(await V.listFabricGameVersions()).has(version)) loader = 'vanilla'; } catch { loader = 'vanilla'; }
  }
  const s = store.load();
  const instName = String(name || cand.name).slice(0, 32) || 'Imported';
  const id2 = (instName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported') + '-' + Date.now().toString(36);
  const dest = instDir(id2);
  try {
    const copied = await importer.copyInto(cand, dest, parts || {}, loader, (label) => send('import:progress', label));
    s.instances.push({ id: id2, name: instName, mc: version, loader, ram: 4096 });
    s.selected = id2;
    store.save(s);
    return { settings: s, copied, loader, downgraded: cand.loader === 'fabric' && loader !== 'fabric' };
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true }); // never leave a half-copied installation behind
    return { error: `Couldn’t finish copying: ${e.message}` };
  }
});

// ---- Crooli's mods: the mods and shader packs on xandertaylorx.github.io/minecraft-mods ----
ipcMain.handle('crooli:list', async () => { try { return { mods: await crooli.list() }; } catch (e) { return { error: e.message }; } });
ipcMain.handle('crooli:install', async (_e, { id, modId }) => {
  const inst = getInst(id);
  if (!inst) return { error: 'Pick an installation first.' };
  try { return await crooli.install(instDir(id), inst, modId); } catch (e) { return { error: e.message }; }
});

// ---- mod compatibility ----
ipcMain.handle('compat:fix', async (_e, id) => {
  const inst = getInst(id);
  if (!inst) return { error: 'Pick an installation first.' };
  try {
    const r = await compat.autofix(instDir(id), inst, (label) => send('compat:step', label));
    return { fixed: r.fixed, actions: r.actions, problems: r.problems.map((p) => p.text) };
  } catch (e) { return { error: `Couldn't fix it: ${e.message}` }; }
});
