const $ = s => document.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  kids.flat().forEach(k => el.append(k));
  return el;
};

let S = null;            // settings
let versions = [], fabricSet = new Set();
let running = false;

// ---------- dirt background (drawn at runtime, no image files) ----------
(function dirt() {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = 0.55 + rnd() * 0.35, speck = rnd() > 0.9 ? 0.6 : 1;
    g.fillStyle = `rgb(${Math.round(121 * v * speck)},${Math.round(85 * v * speck)},${Math.round(58 * v * speck)})`;
    g.fillRect(x, y, 1, 1);
  }
  document.body.style.backgroundImage = `url(${c.toDataURL()})`;
  document.body.style.backgroundSize = '96px 96px';
  document.body.style.backgroundBlendMode = 'multiply';
  document.body.style.backgroundColor = '#6a6a6a';
})();

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500);
}
const inst = () => S.instances.find(i => i.id === S.selected) || null;
const label = i => `${i.name} — ${i.loader === 'fabric' ? 'Fabric ' : ''}${i.mc}`;

// ---------- navigation ----------
function show(view) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'mods') refreshMods();
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => show(b.dataset.view));

// ---------- render ----------
function render() {
  const sel = $('#sel-inst'); sel.replaceChildren();
  S.instances.forEach(i => sel.append(h('option', { value: i.id, textContent: label(i), selected: i.id === S.selected })));
  if (!S.instances.length) sel.append(h('option', { textContent: '(no instances yet)' }));
  $('#in-name').value = S.username; $('#s-name').value = S.username; $('#s-java').value = S.javaPath || '';
  const i = inst();
  $('#play-title').textContent = i ? `Ready: ${i.name}` : 'Welcome!';
  $('#play-sub').textContent = i
    ? `Minecraft ${i.mc} · ${i.loader === 'fabric' ? 'Fabric (mods enabled)' : 'Vanilla'} · ${i.ram} MB`
    : 'Create an instance on the Instances tab to get started.';
  $('#btn-play').disabled = running || !i;

  const list = $('#inst-list'); list.replaceChildren();
  if (!S.instances.length) list.append(h('div', { className: 'empty', textContent: 'No instances yet — make one on the right →' }));
  S.instances.forEach(x => {
    list.append(h('div', { className: 'item' + (x.id === S.selected ? ' sel' : ''), onclick: () => select(x.id) },
      h('div', { className: 'info' }, h('div', { className: 't', textContent: x.name }),
        h('div', { className: 'd', textContent: `${x.loader === 'fabric' ? 'Fabric' : 'Vanilla'} · Minecraft ${x.mc} · ${x.ram} MB` })),
      h('button', { className: 'btn small', textContent: 'Folder', onclick: e => { e.stopPropagation(); api.openInstance(x.id); } }),
      h('button', { className: 'btn small red', textContent: 'Delete', onclick: async e => {
        e.stopPropagation();
        if (confirm(`Delete "${x.name}" and all its worlds and mods? This cannot be undone.`)) { S = await api.deleteInstance(x.id); render(); }
      } })));
  });
}
async function select(id) { S = await api.saveSettings({ selected: id }); render(); if ($('#view-mods').classList.contains('active')) refreshMods(); }
$('#sel-inst').onchange = e => select(e.target.value);

// ---------- create instance ----------
function fillVersions() {
  const snaps = $('#f-snap').checked, sel = $('#f-version'), prev = sel.value;
  sel.replaceChildren();
  versions.filter(v => v.type === 'release' || (snaps && v.type === 'snapshot')).forEach(v => sel.append(h('option', { value: v.id, textContent: v.id })));
  if (prev) sel.value = prev;
  updateLoaderOption();
}
function updateLoaderOption() {
  const fabricOk = fabricSet.has($('#f-version').value);
  const opt = $('#f-loader').querySelector('[value=fabric]');
  opt.disabled = !fabricOk; opt.textContent = fabricOk ? 'Fabric (mods)' : 'Fabric (not available)';
  if (!fabricOk) $('#f-loader').value = 'vanilla';
}
$('#f-snap').onchange = fillVersions;
$('#f-version').onchange = updateLoaderOption;
$('#inst-form').onsubmit = async e => {
  e.preventDefault();
  const name = $('#f-name').value.trim() || 'My World';
  S = await api.saveInstance({ name, mc: $('#f-version').value, loader: $('#f-loader').value, ram: +$('#f-ram').value || 2048 });
  S = await api.saveSettings({ selected: S.instances[S.instances.length - 1].id });
  render(); show('play'); toast(`Created "${name}". Hit PLAY!`);
};

// ---------- settings ----------
$('#settings-form').onsubmit = async e => {
  e.preventDefault();
  S = await api.saveSettings({ username: cleanName($('#s-name').value), javaPath: $('#s-java').value.trim() || null });
  render(); toast('Saved.');
};
$('#in-name').onchange = async e => { S = await api.saveSettings({ username: cleanName(e.target.value) }); render(); };
function cleanName(n) { n = n.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16); return n.length >= 3 ? n : 'Player'; }

// ---------- play ----------
function log(line) {
  const el = $('#log'), atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  el.append(document.createTextNode(line + '\n'));
  while (el.childNodes.length > 2000) el.firstChild.remove();
  if (atEnd) el.scrollTop = el.scrollHeight;
}
$('#btn-play').onclick = async () => {
  if (running) return;
  const i = inst(); if (!i) return;
  $('#log').textContent = '';
  const r = await api.launch(i.id);
  if (r && r.error) { toast(r.error); log('ERROR: ' + r.error); }
};
$('#btn-folder').onclick = () => inst() && api.openInstance(inst().id);

api.on('game:log', log);
api.on('toast', toast);
api.on('game:progress', ({ label, done, total }) => {
  $('#progress').classList.remove('hidden');
  $('#bar').style.width = total ? (done / total * 100) + '%' : '100%';
  $('#bar-label').textContent = label + (total ? ` ${done}/${total}` : '');
});
api.on('game:state', st => {
  running = st !== 'idle';
  $('#btn-play').textContent = st === 'idle' ? 'PLAY' : st === 'running' ? 'RUNNING' : 'WAIT…';
  if (st !== 'preparing') setTimeout(() => $('#progress').classList.toggle('hidden', true), st === 'running' ? 300 : 0);
  $('#btn-play').disabled = running || !inst();
});

// ---------- mods ----------
let searchSeq = 0;
async function refreshMods() {
  const i = inst();
  $('#mods-title').textContent = i ? `Mods — ${i.name}` : 'Mods';
  const note = $('#mods-note');
  if (!i) { note.textContent = 'Create an instance first.'; return; }
  if (i.loader !== 'fabric') { note.textContent = 'This instance is Vanilla. Mods need Fabric — create a Fabric instance.'; $('#mod-results').replaceChildren(); $('#mod-installed').replaceChildren(); return; }
  note.textContent = `Showing Fabric mods for Minecraft ${i.mc} from Modrinth.`;
  renderInstalled(await api.listMods(i.id));
  runSearch();
}
function renderInstalled(files) {
  const box = $('#mod-installed'); box.replaceChildren();
  if (!files.length) box.append(h('div', { className: 'empty', textContent: 'No mods installed.' }));
  files.forEach(f => box.append(h('div', { className: 'item' + (f.enabled ? '' : ' dim') },
    h('div', { className: 'info' }, h('div', { className: 't', textContent: f.file.replace(/\.jar(\.disabled)?$/, '') })),
    h('button', { className: 'btn small', textContent: f.enabled ? 'Off' : 'On', onclick: async () => renderInstalled(await api.toggleMod(inst().id, f.file)) }),
    h('button', { className: 'btn small red', textContent: 'X', onclick: async () => renderInstalled(await api.removeMod(inst().id, f.file)) }))));
}
async function runSearch() {
  const i = inst(); if (!i || i.loader !== 'fabric') return;
  const seq = ++searchSeq, box = $('#mod-results');
  box.replaceChildren(h('div', { className: 'empty', textContent: 'Searching…' }));
  const r = await api.searchMods({ query: $('#mod-q').value.trim(), mc: i.mc, loader: i.loader });
  if (seq !== searchSeq) return;
  box.replaceChildren();
  if (r.error) return box.append(h('div', { className: 'empty', textContent: 'Search failed: ' + r.error }));
  if (!r.hits.length) return box.append(h('div', { className: 'empty', textContent: 'Nothing found.' }));
  r.hits.forEach(m => {
    const btn = h('button', { className: 'btn small green', textContent: 'Install' });
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '…';
      const res = await api.installMod(i.id, m.id);
      if (res.error) { toast(res.error); btn.disabled = false; btn.textContent = 'Install'; return; }
      btn.textContent = 'Done'; toast(`Installed ${res.files.length} file(s)`);
      renderInstalled(await api.listMods(i.id));
    };
    box.append(h('div', { className: 'item' },
      m.icon ? h('img', { src: m.icon, alt: '' }) : h('div', { className: 'ph' }),
      h('div', { className: 'info' },
        h('div', { className: 't', textContent: m.title }),
        h('div', { className: 'd', textContent: `by ${m.author} · ${m.downloads.toLocaleString()} downloads` }),
        h('div', { className: 'd', textContent: m.description })),
      btn));
  });
}
$('#mod-search').onsubmit = e => { e.preventDefault(); runSearch(); };

// ---------- boot ----------
(async () => {
  const init = await api.init();
  S = init.settings; versions = init.versions; fabricSet = new Set(init.fabric);
  $('#s-dir').textContent = init.dataDir;
  fillVersions(); render();
  if (!S.instances.length) { show('instances'); }
})();
