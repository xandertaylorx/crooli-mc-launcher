const $ = s => document.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  kids.flat().filter(k => k != null).forEach(k => el.append(k));
  return el;
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let S = null;                     // saved settings
let versions = [], fabricSet = new Set();
let state = 'idle';               // idle | preparing | running

// ================= small pixel helpers =================
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function mix(a, b, t) {
  const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
function dirtTile() {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d'), r = rng(7);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = 0.62 + r() * 0.3, speck = r() > 0.9 ? 0.65 : 1;
    g.fillStyle = `rgb(${Math.round(134 * v * speck)},${Math.round(96 * v * speck)},${Math.round(67 * v * speck)})`;
    g.fillRect(x, y, 1, 1);
  }
  return c.toDataURL();
}
const DIRT = dirtTile();

// Player face, hair colour picked from the name so each player looks a bit different
function drawFace(name) {
  const g = $('#face').getContext('2d');
  const hairs = ['#3b2a1a', '#6b4423', '#c9a14a', '#262626', '#8a3b22', '#d9d2c5'];
  let hsh = 0; for (const ch of name) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const pal = { H: hairs[hsh % hairs.length], S: '#c69c7c', D: '#a77b5c', W: '#f2f2f2', B: '#4a5fc1', M: '#6b3f2e' };
  ['HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH', 'SSSSSSSS', 'SWBSSBWS', 'SSSDDSSS', 'SSMMMMSS', 'SSSSSSSS']
    .forEach((row, y) => [...row].forEach((k, x) => { g.fillStyle = pal[k]; g.fillRect(x, y, 1, 1); }));
}

// ================= the sky scene =================
const sky = $('#sky'), sg = sky.getContext('2d');
let W = 0, H = 0, clouds = [], terrain = null, lastFrame = 0;

function timeOfDay() {
  const hr = new Date().getHours() + new Date().getMinutes() / 60;
  if (hr < 5 || hr >= 21) return { top: '#141d45', bottom: '#2f3d78', far: '#26334f', near: '#2c4a2a', grass: '#3b6230', stars: true, moon: true, cloud: 'rgba(170,180,215,.28)' };
  if (hr < 7.5) return { top: '#4b5ea6', bottom: '#f0ad84', far: '#7a7f98', near: '#4f7a3a', grass: '#6a9a48', sun: (hr - 5) / 2.5, cloud: 'rgba(255,236,226,.85)' };
  if (hr >= 18) return { top: '#3e4483', bottom: '#f2915e', far: '#6c6c8a', near: '#4a7136', grass: '#628f43', sun: 1 - (hr - 18) / 3, cloud: 'rgba(255,220,205,.82)' };
  return { top: '#6c9ef4', bottom: '#bcd7ff', far: '#86ae9a', near: '#5f9e3f', grass: '#86c95f', sun: 0.5 + (hr - 12) / 13, cloud: 'rgba(255,255,255,.93)' };
}

function buildTerrain() {
  const r = rng(1234);
  const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
  const far = [], near = [];
  for (let x = 0; x < W; x++) {
    far[x] = Math.round((Math.sin(x / 23 + ph[0]) * 8 + Math.sin(x / 9 + ph[1]) * 3) / 2) * 2;
    near[x] = Math.round((Math.sin(x / 31 + ph[2]) * 5 + Math.sin(x / 13 + ph[3]) * 2) / 2) * 2;
  }
  const trees = [0.14, 0.58, 0.63, 0.86].map(f => Math.floor(W * f));
  const noise = Array.from({ length: W * 8 }, () => r());
  terrain = { far, near, trees, noise };
  // Minecraft clouds are flat, solid slabs: a long body with a shorter block on top
  clouds = Array.from({ length: Math.max(3, Math.round(W / 70)) }, (_, i) => {
    const w = 18 + Math.floor(r() * 16), top = 6 + Math.floor(r() * 8), off = 2 + Math.floor(r() * (w - top - 2));
    return { x: (i / 3) * W * 1.1 + r() * 40, y: Math.floor(H * (0.36 + r() * 0.16)), w, top, off, speed: 0.6 + r() * 0.5 };
  });
}

function drawScene(t = 0) {
  if (!W || !terrain) return;
  const p = timeOfDay(), g = sg;
  // stepped sky bands, like the game's sky fog
  const bands = 14;
  for (let i = 0; i < bands; i++) { g.fillStyle = mix(p.top, p.bottom, i / (bands - 1)); g.fillRect(0, Math.floor(i * H / bands), W, Math.ceil(H / bands) + 1); }
  if (p.stars) { const r = rng(99); for (let i = 0; i < W / 3; i++) { g.fillStyle = r() > 0.8 ? '#fff' : 'rgba(255,255,255,.55)'; g.fillRect(Math.floor(r() * W), Math.floor(r() * H * 0.6), 1, 1); } }
  // sun / moon: plain squares, the way Minecraft draws them
  const sx = Math.floor(W * 0.78), size = 12;
  if (p.moon) { g.fillStyle = '#e6eaf4'; g.fillRect(sx, 14, size, size); g.fillStyle = '#c3c9d8'; g.fillRect(sx + 3, 17, 3, 3); g.fillRect(sx + 7, 22, 2, 2); }
  else if (p.sun != null) {
    const sy = Math.floor(10 + Math.abs(p.sun - 0.5) * H * 0.7);
    g.fillStyle = '#fff3b8'; g.fillRect(sx, sy, size, size);
  }
  // clouds drift slowly
  for (const c of clouds) {
    const x = Math.floor(((c.x + t * c.speed / 1000) % (W + 60)) - 40);
    g.fillStyle = p.cloud;
    g.fillRect(x, c.y, c.w, 3); g.fillRect(x + c.off, c.y - 2, c.top, 2);
  }
  const ground = H - 3;
  const { far, near, trees, noise } = terrain;
  g.fillStyle = p.far;
  for (let x = 0; x < W; x++) { const top = ground - 28 - far[x]; g.fillRect(x, top, 1, ground - top); }
  for (let x = 0; x < W; x++) {
    const top = ground - 9 - near[x];
    g.fillStyle = p.near; g.fillRect(x, top, 1, ground - top);
    g.fillStyle = p.grass; g.fillRect(x, top, 1, noise[x] > 0.6 ? 2 : 1);
    for (let y = top + 3; y < ground; y += 2) if (noise[(x * 7 + y) % noise.length] > 0.82) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, y, 1, 1); }
  }
  for (const tx of trees) {
    const base = ground - 9 - near[tx];
    g.fillStyle = '#6b4a2c'; g.fillRect(tx, base - 6, 2, 6);
    g.fillStyle = p.moon ? '#21401f' : '#3f7a2a'; g.fillRect(tx - 4, base - 12, 10, 6); g.fillRect(tx - 2, base - 14, 6, 2);
    g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(tx - 4, base - 8, 10, 2);
  }
  for (let x = 0; x < W; x++) {
    g.fillStyle = p.grass; g.fillRect(x, ground, 1, 2);
    g.fillStyle = noise[x + 50] > 0.5 ? p.grass : p.near; g.fillRect(x, ground + 2, 1, 1);
  }
}

function sizeScene() {
  const r = sky.getBoundingClientRect();
  if (!r.width) return;
  const px = Math.max(2, Math.round(r.width / 320));
  W = Math.ceil(r.width / px); H = Math.ceil(r.height / px);
  sky.width = W; sky.height = H;
  const ground = $('.ground');
  ground.style.backgroundImage = `url(${DIRT})`;
  ground.style.backgroundSize = `${16 * px}px ${16 * px}px`;
  buildTerrain(); drawScene(performance.now());
}
function loop(now) {
  if ($('#view-play').classList.contains('active') && !document.hidden && now - lastFrame > 66) { drawScene(now); lastFrame = now; }
  requestAnimationFrame(loop);
}
new ResizeObserver(sizeScene).observe(sky);
if (!reduceMotion) requestAnimationFrame(loop);
setInterval(() => drawScene(performance.now()), 60000); // keep time of day current

// ================= UI basics =================
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500);
}
const inst = () => (S && S.instances.find(i => i.id === S.selected)) || null;
const loaderName = i => (i.loader === 'fabric' ? 'Fabric' : 'Vanilla');
const gb = mb => `${+(mb / 1024).toFixed(1)} GB`;

function show(view) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'mods') refreshMods();
  if (view === 'play') requestAnimationFrame(sizeScene);
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => show(b.dataset.view));

// ================= render =================
async function render() {
  const sel = $('#sel-inst'); sel.replaceChildren();
  S.instances.forEach(i => sel.append(h('option', { value: i.id, textContent: `${i.name} (${loaderName(i)} ${i.mc})`, selected: i.id === S.selected })));
  if (!S.instances.length) sel.append(h('option', { textContent: 'No installations yet' }));
  sel.disabled = !S.instances.length;
  $('#in-name').value = S.username; $('#s-name').value = S.username; $('#s-java').value = S.javaPath || '';
  drawFace(S.username);

  const i = inst();
  $('#btn-folder').disabled = !i;
  if (!i) {
    $('#play-title').textContent = 'Welcome';
    $('#play-sub').textContent = 'Make an installation to pick a Minecraft version, then press Play.';
  } else {
    $('#play-title').textContent = i.name;
    let sub = `${loaderName(i)} ${i.mc} with ${gb(i.ram)} of memory`;
    if (i.loader === 'fabric') {
      const n = (await api.listMods(i.id)).filter(m => m.enabled).length;
      sub = `Fabric ${i.mc}, ${n === 0 ? 'no mods yet' : n === 1 ? '1 mod' : n + ' mods'}, ${gb(i.ram)} of memory`;
    }
    $('#play-sub').textContent = sub;
  }
  renderPlayButton();
  renderInstances();
}

function renderPlayButton() {
  const b = $('#btn-play'), i = inst();
  const [l1, l2] = !i ? ['Get started', 'Create an installation']
    : state === 'preparing' ? ['Starting', 'Getting files ready']
    : state === 'running' ? ['Playing', `Minecraft ${i.mc} is running`]
    : ['Play', `Minecraft ${i.mc}${i.loader === 'fabric' ? ' with Fabric' : ''}`];
  b.querySelector('.l1').textContent = l1; $('#play-l2').textContent = l2;
  b.disabled = state !== 'idle';
}

function renderInstances() {
  const list = $('#inst-list'); list.replaceChildren();
  if (!S.instances.length) { list.append(h('div', { className: 'empty', textContent: 'No installations yet. Create one on the right.' })); return; }
  S.instances.forEach(x => {
    const play = h('button', { className: 'mc-btn small green', textContent: 'Play', disabled: state !== 'idle' });
    play.onclick = async e => { e.stopPropagation(); await select(x.id); show('play'); launch(); };
    const folder = h('button', { className: 'link quiet', textContent: 'Open folder' });
    folder.onclick = e => { e.stopPropagation(); api.openInstance(x.id); };
    const del = h('button', { className: 'link quiet danger', textContent: 'Delete' });
    del.onclick = async e => {
      e.stopPropagation();
      if (confirm(`Delete "${x.name}"? Its worlds, mods and settings will be removed for good.`)) { S = await api.deleteInstance(x.id); render(); toast(`Deleted ${x.name}`); }
    };
    list.append(h('div', { className: 'row clickable' + (x.id === S.selected ? ' sel' : ''), onclick: () => select(x.id) },
      h('div', { className: 'info' },
        h('div', { className: 't' }, x.name, h('span', { className: 'tag', textContent: loaderName(x) })),
        h('div', { className: 'd', textContent: `Minecraft ${x.mc}, ${gb(x.ram)} of memory` })),
      h('div', { className: 'acts' }, folder, del, play)));
  });
}

async function select(id) { S = await api.saveSettings({ selected: id }); await render(); if ($('#view-mods').classList.contains('active')) refreshMods(); }
$('#sel-inst').onchange = e => select(e.target.value);

// ================= new installation =================
function fillVersions() {
  const snaps = $('#f-snap').checked, sel = $('#f-version'), prev = sel.value;
  sel.replaceChildren();
  versions.filter(v => v.type === 'release' || (snaps && v.type === 'snapshot')).forEach(v => sel.append(h('option', { value: v.id, textContent: v.id })));
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  updateLoaderOption();
}
function updateLoaderOption() {
  const ok = fabricSet.has($('#f-version').value);
  const opt = $('#f-loader').querySelector('[value=fabric]');
  opt.disabled = !ok; opt.textContent = ok ? 'Fabric, mods allowed' : 'Fabric (not out for this version)';
  if (!ok) $('#f-loader').value = 'vanilla';
}
$('#f-snap').onchange = fillVersions;
$('#f-version').onchange = updateLoaderOption;
$('#inst-form').onsubmit = async e => {
  e.preventDefault();
  const name = $('#f-name').value.trim() || 'My World';
  S = await api.saveInstance({ name, mc: $('#f-version').value, loader: $('#f-loader').value, ram: +$('#f-ram').value });
  S = await api.saveSettings({ selected: S.instances[S.instances.length - 1].id });
  await render(); show('play'); toast(`Created ${name}`);
};

// ================= settings & name =================
function cleanName(n) { n = n.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16); return n.length >= 3 ? n : 'Player'; }
$('#settings-form').onsubmit = async e => {
  e.preventDefault();
  S = await api.saveSettings({ username: cleanName($('#s-name').value), javaPath: $('#s-java').value.trim() || null });
  render(); toast('Settings saved');
};
$('#in-name').onchange = async e => { S = await api.saveSettings({ username: cleanName(e.target.value) }); render(); };
$('#in-name').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };

// ================= play & log =================
// The game logs in log4j XML; turn it into readable lines.
let logPrefix = '';
function log(raw) {
  let line = raw;
  const ev = line.match(/<log4j:Event [^>]*level="(\w+)"[^>]*thread="([^"]*)"/);
  if (ev) { logPrefix = `[${ev[2]}/${ev[1]}] `; return; }
  if (/^\s*<\/log4j:Event>/.test(line)) return;
  if (line.includes('<log4j:Message>')) { line = logPrefix + line; logPrefix = ''; }
  line = line.replace(/<\/?log4j:Message>|<!\[CDATA\[|\]\]>|<\/?log4j:[^>]*>/g, '');
  if (!line.trim()) return;
  const el = $('#log'), atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  el.append(document.createTextNode(line.trim() + '\n'));
  while (el.childNodes.length > 2000) el.firstChild.remove();
  if (atEnd) el.scrollTop = el.scrollHeight;
}
async function launch() {
  const i = inst();
  if (!i) { show('instances'); $('#f-name').focus(); return; }
  if (state !== 'idle') return;
  $('#log').textContent = '';
  const r = await api.launch(i.id);
  if (r && r.error) { toast(r.error); log('Error: ' + r.error); $('#log-drawer').hidden = false; }
}
$('#btn-play').onclick = launch;
$('#btn-folder').onclick = () => inst() && api.openInstance(inst().id);
$('#btn-log').onclick = () => { $('#log-drawer').hidden = !$('#log-drawer').hidden; };
$('#btn-log-close').onclick = () => { $('#log-drawer').hidden = true; };

api.on('game:log', log);
api.on('toast', toast);
api.on('game:progress', ({ label, done, total }) => {
  $('#progress').hidden = false;
  $('#bar').style.width = total ? (done / total * 100) + '%' : '100%';
  $('#bar-label').textContent = label + (total ? `  ${done} of ${total}` : '');
});
api.on('game:state', st => {
  state = st;
  if (st !== 'preparing') $('#progress').hidden = true;
  renderPlayButton(); renderInstances();
});

// ================= news =================
async function loadNews() {
  const items = await api.news(), box = $('#news-list');
  if (!items.length) { $('.news').hidden = true; return; }
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  box.replaceChildren(...items.map(n => h('div', { className: 'news-item', title: n.text || '' },
    n.image ? h('img', { src: n.image, alt: '' }) : null,
    h('div', {}, h('b', { textContent: n.title }), h('span', { textContent: fmt.format(new Date(n.date)) })))));
}

// ================= mods =================
let searchSeq = 0;
async function refreshMods() {
  const i = inst(), note = $('#mods-note');
  $('#mods-title').textContent = i ? `Mods for ${i.name}` : 'Mods';
  $('#mod-search').hidden = false;
  if (!i || i.loader !== 'fabric') {
    note.textContent = !i ? 'Create an installation first.' : `${i.name} is Vanilla, so it can't load mods. Make a Fabric installation to add mods.`;
    $('#mod-search').hidden = true;
    const go = h('button', { className: 'mc-btn green', textContent: 'New Fabric installation' });
    go.onclick = () => { show('instances'); $('#f-loader').value = 'fabric'; $('#f-name').focus(); };
    $('#mod-results').replaceChildren(h('div', { className: 'empty' }, go));
    $('#mod-installed').replaceChildren();
    return;
  }
  note.textContent = `Showing Fabric mods that work with Minecraft ${i.mc}, from Modrinth. Required mods are installed for you.`;
  renderInstalled(await api.listMods(i.id));
  runSearch();
}
function renderInstalled(files) {
  const box = $('#mod-installed'); box.replaceChildren();
  if (!files.length) return box.append(h('div', { className: 'empty', textContent: 'No mods yet. Install some from the list.' }));
  files.forEach(f => {
    const toggle = h('button', { className: 'link quiet', textContent: f.enabled ? 'Turn off' : 'Turn on' });
    toggle.onclick = async () => renderInstalled(await api.toggleMod(inst().id, f.file));
    const rm = h('button', { className: 'link quiet danger', textContent: 'Remove' });
    rm.onclick = async () => renderInstalled(await api.removeMod(inst().id, f.file));
    box.append(h('div', { className: 'row' + (f.enabled ? '' : ' off') },
      h('div', { className: 'info' }, h('div', { className: 't', textContent: f.file.replace(/\.jar(\.disabled)?$/, ''), title: f.file })),
      h('div', { className: 'acts' }, toggle, rm)));
  });
}
async function runSearch() {
  const i = inst(); if (!i || i.loader !== 'fabric') return;
  const seq = ++searchSeq, box = $('#mod-results');
  box.replaceChildren(h('div', { className: 'empty', textContent: 'Searching Modrinth…' }));
  const r = await api.searchMods({ query: $('#mod-q').value.trim(), mc: i.mc, loader: i.loader });
  if (seq !== searchSeq) return;
  box.replaceChildren();
  if (r.error) return box.append(h('div', { className: 'empty', textContent: `Couldn't reach Modrinth. Check your connection and search again.` }));
  if (!r.hits.length) return box.append(h('div', { className: 'empty', textContent: `No mods match that for Minecraft ${i.mc}. Try a different word.` }));
  const nf = new Intl.NumberFormat(undefined, { notation: 'compact' });
  r.hits.forEach(m => {
    const btn = h('button', { className: 'mc-btn small green', textContent: 'Install' });
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Installing…';
      const res = await api.installMod(i.id, m.id);
      if (res.error) { toast(res.error); btn.disabled = false; btn.textContent = 'Install'; return; }
      btn.textContent = 'Installed';
      toast(res.files.length > 1 ? `Installed ${m.title} and ${res.files.length - 1} required mod${res.files.length > 2 ? 's' : ''}` : `Installed ${m.title}`);
      renderInstalled(await api.listMods(i.id));
    };
    box.append(h('div', { className: 'row' },
      m.icon ? h('img', { src: m.icon, alt: '' }) : h('div', { className: 'ph' }),
      h('div', { className: 'info' },
        h('div', { className: 't', textContent: m.title }),
        h('div', { className: 'd', textContent: m.description, title: m.description }),
        h('div', { className: 'd', textContent: `by ${m.author}, ${nf.format(m.downloads)} downloads` })),
      h('div', { className: 'acts' }, btn)));
  });
}
$('#mod-search').onsubmit = e => { e.preventDefault(); runSearch(); };

// ================= updates =================
let update = null, updateDismissed = null;
function renderUpdate(u) {
  update = u || update;
  if (!update) return;
  const bar = $('#update-bar'), btn = $('#update-btn'), v = update.latest;
  const sUpdate = $('#s-update');
  const show = ['available', 'downloading', 'ready'].includes(update.state) && updateDismissed !== `${v}:${update.state}`;
  bar.hidden = !show;
  if (update.state === 'available') {
    $('#update-text').textContent = `Crooli MC Launcher ${v} is out.`;
    btn.hidden = false; btn.textContent = update.auto ? 'Getting it ready…' : 'Download update';
    btn.disabled = !!update.auto;
    sUpdate.textContent = `Version ${v} is available.`;
  } else if (update.state === 'downloading') {
    $('#update-text').textContent = `Downloading version ${v}… ${update.percent || 0}%`;
    btn.hidden = true;
    sUpdate.textContent = `Downloading version ${v}.`;
  } else if (update.state === 'ready') {
    $('#update-text').textContent = `Version ${v} is ready to install.`;
    btn.hidden = false; btn.disabled = false; btn.textContent = 'Restart to update';
    sUpdate.textContent = `Version ${v} installs when you restart.`;
  } else if (update.state === 'latest') {
    sUpdate.textContent = 'You have the latest version.';
  } else if (update.state === 'error') {
    sUpdate.textContent = "Couldn't reach GitHub to check for updates.";
  }
}
$('#update-btn').onclick = async () => {
  const r = await api.applyUpdate();
  if (r && r.error) return toast(r.error);
  if (update.state !== 'ready') toast('Opening the download in your browser');
};
$('#update-later').onclick = () => { updateDismissed = `${update.latest}:${update.state}`; $('#update-bar').hidden = true; };
$('#btn-check').onclick = async () => {
  const b = $('#btn-check'); b.disabled = true; b.textContent = 'Checking…';
  renderUpdate(await api.checkUpdate());
  b.disabled = false; b.textContent = 'Check for updates';
};
api.on('update', renderUpdate);

// ================= boot =================
(async () => {
  const init = await api.init();
  S = init.settings; versions = init.versions; fabricSet = new Set(init.fabric);
  $('#s-dir').textContent = init.dataDir;
  $('#s-version').textContent = init.version;
  renderUpdate(init.update);
  fillVersions(); await render(); sizeScene();
  loadNews();
})();
