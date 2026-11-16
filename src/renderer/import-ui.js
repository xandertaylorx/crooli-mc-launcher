// Installations > "Find installs from other launchers": lists what the scan found and imports the parts you pick.
// Needs app.js first.
(() => {
  const dlg = $('#import-dialog'), listBox = $('#import-list'), statusEl = $('#import-status');
  const fmtSize = (s) => (s ? `${s.partial ? 'over ' : ''}${s.bytes >= 1073741824 ? (s.bytes / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(s.bytes / 1048576)) + ' MB'}` : '');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function describe(c) {
    const p = c.parts, bits = [];
    bits.push(c.mc ? `Minecraft ${c.mc}` : 'Version unknown');
    bits.push(c.loaderName);
    if (p.worlds) bits.push(plural(p.worlds, 'world'));
    if (p.mods) bits.push(plural(p.mods, 'mod'));
    if (p.resourcepacks) bits.push(plural(p.resourcepacks, 'resource pack'));
    if (p.shaders) bits.push(plural(p.shaders, 'shader pack'));
    return bits.join(', ');
  }

  function optionsPanel(c) {
    const p = c.parts, box = h('div', { className: 'found-options', hidden: true });
    const name = h('input', { type: 'text', value: c.name, maxLength: 32 });
    const row = h('div', { className: 'row2' }, h('label', {}, 'Name for the new installation', name));
    let ver = null;
    if (!c.mc) {
      ver = h('select');
      versions.filter((v) => v.type === 'release').forEach((v) => ver.append(h('option', { value: v.id, textContent: v.id })));
      row.append(h('label', {}, 'Which Minecraft version is it?', ver));
    }
    // Things that can come across. Mods and mod settings only make sense for Fabric.
    const defs = [
      ['worlds', p.worlds, `Worlds${c.sizes.worlds ? ` (${fmtSize(c.sizes.worlds)})` : ''}`, true],
      ['mods', p.mods && c.supported && c.loader === 'fabric', `Mods (${p.mods})`, true],
      ['resourcepacks', p.resourcepacks, `Resource packs (${p.resourcepacks})`, true],
      ['shaders', p.shaders, `Shader packs (${p.shaders})`, true],
      ['settings', p.settings, 'Game settings and server list', true],
      ['config', p.config && c.loader === 'fabric', 'Mod settings', true],
    ].filter((d) => d[1]);
    const checks = h('div', { className: 'checks' });
    const boxes = {};
    for (const [key, , label] of defs) {
      boxes[key] = h('input', { type: 'checkbox', checked: true });
      checks.append(h('label', {}, boxes[key], label));
    }
    if (p.mods && c.loader !== 'fabric') checks.append(h('label', { className: 'off' }, h('input', { type: 'checkbox', disabled: true }), c.loader === 'vanilla' ? `Mods (${p.mods}), not copied: none of them look like Fabric mods` : `Mods (${p.mods}), ${c.loaderName} mods won’t run here`));
    const go = h('button', { className: 'mc-btn green', type: 'button', textContent: 'Import' });
    const msg = h('span', { className: 'sub' });
    go.onclick = async () => {
      const parts = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.checked]));
      if (!Object.values(parts).some(Boolean)) return (msg.textContent = 'Tick at least one thing to bring over.');
      go.disabled = true; go.textContent = 'Importing…'; msg.textContent = '';
      const r = await api.runImport({ id: c.id, name: name.value.trim(), mc: ver ? ver.value : c.mc, parts });
      go.disabled = false; go.textContent = 'Import';
      if (r.error) { msg.textContent = r.error; return; }
      S = r.settings; await render();
      dlg.close();
      toast(`Imported ${name.value.trim() || c.name}${r.downgraded ? ' as Vanilla, since Fabric isn’t out for that version' : ''}. Press Play when you’re ready.`);
    };
    box.append(row, checks, h('div', { className: 'go' }, go, msg));
    return box;
  }

  function row(c) {
    const panel = optionsPanel(c);
    const btn = h('button', { className: 'mc-btn small' + (c.supported ? ' green' : ''), type: 'button', textContent: 'Import…' });
    btn.onclick = () => { panel.hidden = !panel.hidden; };
    return h('div', { className: 'found' + (c.supported ? '' : ' unsupported'), title: c.dir },
      h('div', { className: 'found-top' },
        h('div', { className: 'info' },
          h('div', { className: 't' }, c.name, h('span', { className: 'tag src', textContent: c.source })),
          h('div', { className: 'd', textContent: describe(c) })),
        btn),
      c.note ? h('div', { className: 'note', textContent: c.note }) : null,
      panel);
  }

  function show(list) {
    listBox.replaceChildren();
    if (!list.length) {
      listBox.append(h('div', { className: 'empty', textContent: 'Nothing found in the usual places. If you know where an install lives, use “Look in another folder”.' }));
      return;
    }
    list.forEach((c) => listBox.append(row(c)));
  }

  async function open() {
    listBox.replaceChildren(h('div', { className: 'empty', textContent: 'Looking…' }));
    statusEl.textContent = '';
    if (!dlg.open) dlg.showModal();
    show(await api.scanImports());
  }

  $('#btn-find').onclick = open;
  $('#import-close').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  $('#import-folder').onclick = async () => {
    const r = await api.scanImportFolder();
    if (r.canceled) return;
    show(r.list);
  };
  api.on('import:progress', (label) => { statusEl.textContent = label; });

  // The version dropdown on the new-installation form gets a shortcut to the same thing.
  const sel = $('#f-version');
  const addOption = () => { if (!sel.querySelector('[value="__import__"]')) sel.append(h('option', { value: '__import__', textContent: 'Find installs from other launchers…' })); };
  new MutationObserver(addOption).observe(sel, { childList: true });
  addOption();
  sel.addEventListener('change', () => {
    if (sel.value !== '__import__') return;
    sel.selectedIndex = 0;
    sel.dispatchEvent(new Event('change'));
    open();
  });
})();
