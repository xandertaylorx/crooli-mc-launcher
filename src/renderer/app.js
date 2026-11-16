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
  if (view === 'servers') selectServer();
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
      const n = (await api.listPacks(i.id, 'mod')).filter(m => m.enabled).length;
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
    : state === 'preparing' ? ['Cancel', 'Stop and remove what it downloaded']
    : state === 'cancelling' ? ['Cancelling', 'Cleaning up…']
    : state === 'running' ? ['Playing', `Minecraft ${i.mc} is running`]
    : ['Play', `Minecraft ${i.mc}${i.loader === 'fabric' ? ' with Fabric' : ''}`];
  b.querySelector('.l1').textContent = l1; $('#play-l2').textContent = l2;
  b.disabled = state === 'running' || state === 'cancelling';
  b.classList.toggle('cancel', state === 'preparing');
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
  if (state === 'preparing') { await api.cancelLaunch(); return; }
  if (state !== 'idle') return;
  $('#log').textContent = '';
  const r = await api.launch(i.id);
  if (r && r.cancelled) toast('Cancelled. What it had downloaded was removed.');
  else if (r && r.error) { toast(r.error); log('Error: ' + r.error); $('#log-drawer').hidden = false; }
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
  if (st !== 'preparing' && st !== 'cancelling') $('#progress').hidden = true;
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

// ================= mods, resource packs, shaders =================
const KIND = {
  mod:          { title: 'Mods',           one: 'mod',           search: 'Search Modrinth for mods',           installed: 'Installed mods' },
  resourcepack: { title: 'Resource packs', one: 'resource pack', search: 'Search Modrinth for resource packs', installed: 'Installed packs' },
  shader:       { title: 'Shaders',        one: 'shader pack',   search: 'Search Modrinth for shader packs',   installed: 'Installed shaders' },
};
let kind = 'mod', searchSeq = 0, installedList = [];

function noteFor(i) {
  if (kind === 'mod') return `Showing Fabric mods that work with Minecraft ${i.mc}, from Modrinth. Required mods are installed for you.`;
  if (kind === 'resourcepack') return `Showing resource packs for Minecraft ${i.mc}. Installing one turns it on.`;
  return `Showing shader packs for Minecraft ${i.mc} that Iris can load. Installing one turns it on.`;
}

async function refreshMods() {
  const i = inst();
  document.querySelectorAll('#kind-tabs .subtab').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  $('#mods-title').textContent = i ? `${KIND[kind].title} for ${i.name}` : KIND[kind].title;
  $('#installed-title').textContent = KIND[kind].installed;
  $('#mod-q').placeholder = KIND[kind].search;
  $('#add-file').disabled = $('#add-folder').disabled = !i;
  $('#shader-hint').hidden = true;
  const blocked = !i || (kind !== 'resourcepack' && i.loader !== 'fabric');
  $('#mod-search').hidden = blocked;
  if (blocked) {
    $('#mods-note').textContent = !i ? 'Create an installation first.'
      : kind === 'mod' ? `${i.name} is Vanilla, so it can't load mods. Make a Fabric installation to add mods.`
      : `Shader packs run through Iris, a Fabric mod, so ${i.name} needs to be a Fabric installation.`;
    const go = h('button', { className: 'mc-btn green', textContent: i ? 'New Fabric installation' : 'New installation' });
    go.onclick = () => { show('instances'); $('#f-loader').value = 'fabric'; $('#f-name').focus(); };
    $('#mod-results').replaceChildren(h('div', { className: 'empty' }, go));
    $('#mod-installed').replaceChildren();
    if (i) renderInstalled(await api.listPacks(i.id, kind));
    return;
  }
  $('#mods-note').textContent = noteFor(i);
  renderInstalled(await api.listPacks(i.id, kind));
  if (kind === 'shader') {
    const mods = await api.listPacks(i.id, 'mod');
    $('#shader-hint').hidden = mods.some((m) => /iris/i.test(m.file) && m.enabled);
  }
  runSearch();
}

const kindLabel = (f) => f.file.replace(/\.jar(\.disabled)?$/, '').replace(/\.zip$/i, '');
function renderInstalled(files) {
  installedList = files;
  const box = $('#mod-installed'); box.replaceChildren();
  if (!files.length) return box.append(h('div', { className: 'empty', textContent: kind === 'mod' ? 'No mods yet. Install some from the list, or add your own.' : `No ${KIND[kind].one}s yet.` }));
  const on = kind === 'mod' ? ['Turn off', 'Turn on'] : ['Turn off', 'Use'];
  files.forEach((f) => {
    const toggle = h('button', { className: 'link quiet', textContent: f.enabled ? on[0] : on[1] });
    toggle.onclick = async () => {
      const r = await api.togglePack(inst().id, kind, f.file);
      if (r.error) return toast(r.error);
      renderInstalled(r.list);
    };
    const rm = h('button', { className: 'link quiet danger', textContent: 'Remove' });
    rm.onclick = async () => {
      const r = await api.removePack(inst().id, kind, f.file);
      if (r.error) return toast(r.error);
      renderInstalled(r.list);
    };
    box.append(h('div', { className: 'row' + (f.enabled || kind !== 'mod' ? '' : ' off') },
      h('div', { className: 'info' }, h('div', { className: 't', title: f.file, textContent: kindLabel(f) }), kind !== 'mod' ? h('div', { className: 'd', textContent: f.enabled ? 'In use' : 'Not in use' }) : null),
      h('div', { className: 'acts' }, toggle, rm)));
  });
}

async function runSearch() {
  const i = inst(); if (!i) return;
  const seq = ++searchSeq, box = $('#mod-results');
  box.replaceChildren(h('div', { className: 'empty', textContent: 'Searching Modrinth…' }));
  const r = await api.searchPacks({ query: $('#mod-q').value.trim(), mc: i.mc, loader: i.loader, type: kind });
  if (seq !== searchSeq) return;
  box.replaceChildren();
  if (r.error) return box.append(h('div', { className: 'empty', textContent: `Couldn't reach Modrinth. Check your connection and search again.` }));
  if (!r.hits.length) return box.append(h('div', { className: 'empty', textContent: `Nothing matches that for Minecraft ${i.mc}. Try a different word.` }));
  const nf = new Intl.NumberFormat(undefined, { notation: 'compact' });
  r.hits.forEach((m) => {
    const btn = h('button', { className: 'mc-btn small green', textContent: 'Install' });
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Installing…';
      const res = await api.installPack(i.id, m.id, kind);
      if (res.error) { toast(res.error); btn.disabled = false; btn.textContent = 'Install'; return; }
      btn.textContent = 'Installed';
      if (kind === 'mod') toast(res.files.length > 1 ? `Installed ${m.title} and ${res.files.length - 1} required mod${res.files.length > 2 ? 's' : ''}` : `Installed ${m.title}`);
      else {
        // Turn it on straight away, as the "easy install" promise says.
        const file = res.files[0];
        const t = await api.togglePack(i.id, kind, file);
        const on = !t.error && (t.list.find((x) => x.file === file) || {}).enabled;
        toast(`${on ? 'Installed and turned on' : 'Installed'} ${m.title}${res.exact ? '' : '. It isn’t marked for this version, so it may look off'}`);
        if (!t.error) return renderInstalled(t.list);
      }
      renderInstalled(await api.listPacks(i.id, kind));
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
$('#mod-search').onsubmit = (e) => { e.preventDefault(); runSearch(); };
document.querySelectorAll('#kind-tabs .subtab').forEach((b) => (b.onclick = () => { kind = b.dataset.kind; $('#mod-q').value = ''; refreshMods(); }));

// Iris is what runs shader packs on Fabric. This installs it with Sodium, which it needs.
$('#install-iris').onclick = async () => {
  const i = inst(), b = $('#install-iris'); if (!i) return;
  b.disabled = true; b.textContent = 'Installing…';
  const r = await api.searchPacks({ query: 'iris shaders', mc: i.mc, loader: i.loader, type: 'mod' });
  const iris = r.hits && r.hits.find((x) => x.slug === 'iris');
  const res = iris ? await api.installPack(i.id, iris.id, 'mod') : { error: `Iris isn't out for Minecraft ${i.mc} yet.` };
  b.disabled = false; b.textContent = 'Install Iris';
  if (res.error) return toast(res.error);
  toast('Installed Iris and what it needs');
  refreshMods();
};

// ---- adding things from the computer: buttons, and dragging files onto the window ----
function reportAdded(r) {
  if (r.error) return toast(r.error);
  const good = r.results.filter((x) => !x.error), bad = r.results.filter((x) => x.error);
  const names = { mod: 'a mod', resourcepack: 'a resource pack', shader: 'a shader pack' };
  if (good.length) toast(good.length === 1 ? `Added ${good[0].name} as ${names[good[0].kind]}${good[0].warn ? '. ' + good[0].warn : ''}` : `Added ${good.length} items`);
  if (bad.length) setTimeout(() => toast(`${bad[0].name}: ${bad[0].error}`), good.length ? 2600 : 0);
  // Jump to the tab of whatever was just added.
  if (good.length) kind = good[0].kind;
  refreshMods();
}
$('#add-file').onclick = async () => { const r = await api.pickPacks(inst().id, false); if (!r.canceled) reportAdded(r); };
$('#add-folder').onclick = async () => { const r = await api.pickPacks(inst().id, true); if (!r.canceled) reportAdded(r); };
let dragDepth = 0;
const droppable = (e) => $('#view-mods').classList.contains('active') && e.dataTransfer && [...e.dataTransfer.types].includes('Files');
addEventListener('dragenter', (e) => { if (droppable(e)) { dragDepth++; $('#drop-hint').hidden = false; } });
addEventListener('dragleave', (e) => { if (droppable(e) && --dragDepth <= 0) { dragDepth = 0; $('#drop-hint').hidden = true; } });
addEventListener('dragover', (e) => { if (droppable(e)) e.preventDefault(); });
addEventListener('drop', async (e) => {
  if (!droppable(e)) return;
  e.preventDefault(); dragDepth = 0; $('#drop-hint').hidden = true;
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (inst() && paths.length) reportAdded(await api.addPacks(inst().id, paths));
});

// ================= servers =================
const srvStates = {};            // id -> { state, players }
let srvEditing = null;           // server being edited, or 'new'
const srvList = () => (S && S.servers) || [];
const srvSel = () => srvList().find((x) => x.id === S.selectedServer) || srvList()[0] || null;
const STATE_TEXT = { stopped: 'Stopped', preparing: 'Getting ready', starting: 'Starting', running: 'Running', stopping: 'Stopping' };

// The console follows new output unless you've scrolled up to read something.
let srvFollow = true;
$('#srv-log').addEventListener('wheel', () => setTimeout(() => {
  const el = $('#srv-log');
  srvFollow = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
}, 50), { passive: true });
function srvLogLine(line) {
  const el = $('#srv-log');
  const cls = line.startsWith('»') ? 'sys' : line.startsWith('> ') ? 'me' : /\bERROR\b|\/ERROR\]|Exception/.test(line) ? 'err' : /\bWARN\b|\/WARN\]/.test(line) ? 'warn' : '';
  el.append(h('div', { className: cls, textContent: line }));
  while (el.childNodes.length > 800) el.firstChild.remove();
  if (srvFollow) el.scrollTop = el.scrollHeight;
}

function renderSrvList() {
  const box = $('#srv-list'); box.replaceChildren();
  const sel = srvSel();
  if (!srvList().length) box.append(h('div', { className: 'empty', textContent: 'None yet.' }));
  srvList().forEach((x) => {
    const st = (srvStates[x.id] || {}).state || 'stopped';
    box.append(h('div', { className: 'row clickable' + (sel && x.id === sel.id && !srvEditing ? ' sel' : ''), onclick: () => selectServer(x.id) },
      h('div', { className: 'info' },
        h('div', { className: 't' }, h('span', { className: 'dot ' + st }), x.name),
        h('div', { className: 'd', textContent: `${x.type === 'fabric' ? 'Fabric' : 'Vanilla'} ${x.mc}, ${STATE_TEXT[st].toLowerCase()}` }))));
  });
}

function renderSrvDetail(addr) {
  const sel = srvSel();
  $('#srv-form').hidden = !srvEditing;
  $('#srv-empty').hidden = !!srvEditing || !!sel;
  $('#srv-detail').hidden = !!srvEditing || !sel;
  if (srvEditing || !sel) return;
  const st = srvStates[sel.id] || { state: 'stopped', players: [] };
  $('#srv-name').textContent = sel.name;
  $('#srv-meta').textContent = `${sel.type === 'fabric' ? 'Fabric' : 'Vanilla'} ${sel.mc}, ${gb(sel.ram)} of memory, ${sel.gamemode}, ${sel.difficulty}` +
    (st.state === 'running' ? `. ${st.players.length === 1 ? '1 player' : st.players.length + ' players'} online` : '');
  const pill = $('#srv-status'); pill.className = 'pill ' + st.state; pill.textContent = STATE_TEXT[st.state];
  const t = $('#srv-toggle');
  const busy = ['preparing', 'starting', 'stopping'].includes(st.state);
  t.textContent = st.state === 'stopped' ? 'Start' : st.state === 'stopping' ? 'Stopping…' : 'Stop';
  t.className = 'mc-btn ' + (st.state === 'stopped' ? 'green' : 'danger');
  t.disabled = st.state === 'stopping' || st.state === 'preparing';
  $('#srv-input').disabled = st.state !== 'running' && st.state !== 'starting';
  $('#srv-mods-link').hidden = sel.type !== 'fabric';
  $('#srv-delete').disabled = busy;
  if (st.state !== 'running') $('#srv-addr').replaceChildren();
  else if (addr) {
    const a = $('#srv-addr'); a.replaceChildren();
    {
      const chip = (label, value) => {
        const b = h('button', { type: 'button', textContent: 'Copy' });
        b.onclick = () => { navigator.clipboard.writeText(value); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1500); };
        return h('span', { className: 'addr' }, `${label} `, h('code', { textContent: value }), b);
      };
      a.append(chip('This computer', addr.local));
      (addr.lan || []).forEach((x) => a.append(chip('Same Wi-Fi', x)));
    }
  }
}

async function selectServer(id) {
  srvEditing = null;
  if (id) S = await api.saveSettings({ selectedServer: id });
  const sel = srvSel();
  $('#srv-log').replaceChildren(); srvFollow = true;
  if (sel) {
    const st = await api.serverStatus(sel.id);
    srvStates[sel.id] = { state: st.state, players: st.players };
    st.log.forEach(srvLogLine);
    renderSrvDetail(st);
  } else renderSrvDetail();
  renderSrvList();
}

function openServerForm(srv) {
  srvEditing = srv ? srv.id : 'new';
  const vs = $('#sf-version'); vs.replaceChildren();
  versions.filter((v) => v.type === 'release').forEach((v) => vs.append(h('option', { value: v.id, textContent: v.id })));
  $('#sf-name').value = srv ? srv.name : srvList().length ? `Server ${srvList().length + 1}` : 'My Server';
  vs.value = srv ? srv.mc : (versions.find((v) => v.type === 'release') || {}).id;
  $('#sf-type').value = srv ? srv.type : 'vanilla';
  $('#sf-ram').value = String(srv ? srv.ram : 4096);
  $('#sf-gamemode').value = srv ? srv.gamemode : 'survival';
  $('#sf-difficulty').value = srv ? srv.difficulty : 'normal';
  $('#sf-port').value = srv ? srv.port : 25565 + srvList().length;
  $('#sf-offline').checked = srv ? srv.offline : true;
  $('#srv-form-title').textContent = srv ? `${srv.name} settings` : 'New server';
  $('#sf-submit').textContent = srv ? 'Save changes' : 'Agree and create server';
  $('#sf-eula').hidden = !!srv;
  updateServerTypeOption();
  renderSrvDetail(); renderSrvList();
  $('#sf-name').focus();
}
function updateServerTypeOption() {
  const ok = fabricSet.has($('#sf-version').value);
  const opt = $('#sf-type').querySelector('[value=fabric]');
  opt.disabled = !ok; opt.textContent = ok ? 'Fabric, for server mods' : 'Fabric (not out for this version)';
  if (!ok) $('#sf-type').value = 'vanilla';
}
$('#sf-version').onchange = updateServerTypeOption;
document.querySelectorAll('[data-new-server]').forEach((b) => (b.onclick = () => openServerForm(null)));
$('#sf-cancel').onclick = () => { srvEditing = null; selectServer(); };
$('#srv-form').onsubmit = async (e) => {
  e.preventDefault();
  const isNew = srvEditing === 'new';
  const r = await api.saveServer({
    id: isNew ? undefined : srvEditing, agreedEula: isNew,
    name: $('#sf-name').value.trim() || 'My Server', mc: $('#sf-version').value, type: $('#sf-type').value,
    ram: +$('#sf-ram').value, gamemode: $('#sf-gamemode').value, difficulty: $('#sf-difficulty').value,
    port: +$('#sf-port').value, offline: $('#sf-offline').checked,
  });
  if (r.error) return toast(r.error);
  S = r; srvEditing = null;
  await selectServer();
  toast(isNew ? 'Server created. Press Start when you’re ready.' : 'Saved. Changes apply next time it starts.');
};
$('#srv-edit').onclick = () => openServerForm(srvSel());
$('#srv-delete').onclick = async () => {
  const sel = srvSel(); if (!sel) return;
  if (!confirm(`Delete "${sel.name}"? Its world and files will be removed for good.`)) return;
  S = await api.deleteServer(sel.id); delete srvStates[sel.id];
  await selectServer(); toast(`Deleted ${sel.name}`);
};
$('#srv-toggle').onclick = async () => {
  const sel = srvSel(); if (!sel) return;
  const st = (srvStates[sel.id] || {}).state || 'stopped';
  if (st === 'stopped') {
    $('#srv-log').replaceChildren();
    const r = await api.startServer(sel.id);
    if (r.error) toast(r.error);
  } else await api.stopServer(sel.id);
};
$('#srv-cmd').onsubmit = async (e) => {
  e.preventDefault();
  const sel = srvSel(), text = $('#srv-input').value.trim();
  if (!sel || !text) return;
  srvFollow = true;
  srvLogLine(`> ${text}`);
  const r = await api.serverCommand(sel.id, text);
  if (r.error) toast(r.error); else $('#srv-input').value = '';
};
document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => srvSel() && api.openServerFolder(srvSel().id, b.dataset.open)));

api.on('server:log', ({ id, line }) => { if (srvSel() && id === srvSel().id && !srvEditing) srvLogLine(line); });
api.on('server:state', (st) => {
  srvStates[st.id] = { state: st.state, players: st.players || [] };
  renderSrvList();
  if (srvSel() && st.id === srvSel().id) renderSrvDetail(st.local ? st : null);
  if (st.state === 'running' && st.local && $('#srv-addr').childElementCount === 0) renderSrvDetail(st);
});

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
