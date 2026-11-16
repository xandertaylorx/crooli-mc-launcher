// Settings > Skin: build a skin from colours, load a PNG, or copy a player's, preview it, and save it.
// Everything is drawn on canvases here; main.js only stores the two finished PNGs. Needs app.js first.
(() => {
  const mk = (w = 64, h = 64) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctxOf = (c) => { const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false; return g; };
  const loadImage = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That image couldn’t be read.')); i.src = src; });

  /* ---------- colours ---------- */
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const shade = (hex, pct) => `rgb(${rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * (1 + pct))))).join(',')})`;

  // Fills an unfolded box the way Minecraft lays skins out: top, bottom, then right, front, left, back.
  function box(g, x, y, w, h, d, color) {
    const faces = [[x + d, y, w, d, 0.12], [x + d + w, y, w, d, -0.22], [x, y + d, d, h, -0.08], [x + d, y + d, w, h, 0], [x + d + w, y + d, d, h, -0.08], [x + d + w + d, y + d, w, h, -0.12]];
    for (const [fx, fy, fw, fh, s] of faces) { g.fillStyle = shade(color, s); g.fillRect(fx, fy, fw, fh); }
  }

  // A little character from six colours: head, hair, face, shirt, trousers and shoes.
  function generate(c) {
    const cv = mk(), g = ctxOf(cv);
    box(g, 0, 0, 8, 8, 8, c.tone);
    g.fillStyle = shade(c.hair, 0.1); g.fillRect(8, 0, 8, 8);            // top of the head
    g.fillStyle = c.hair; g.fillRect(0, 8, 8, 3); g.fillRect(16, 8, 8, 3); g.fillRect(24, 8, 8, 6); // sides and back
    g.fillRect(8, 8, 8, 2); g.fillRect(8, 10, 1, 1); g.fillRect(15, 10, 1, 1); // fringe
    g.fillStyle = shade(c.hair, -0.25); g.fillRect(9, 11, 2, 1); g.fillRect(13, 11, 2, 1); // brows
    g.fillStyle = '#f4f4f4'; g.fillRect(9, 12, 1, 1); g.fillRect(14, 12, 1, 1);          // eyes
    g.fillStyle = c.eyes; g.fillRect(10, 12, 1, 1); g.fillRect(13, 12, 1, 1);
    g.fillStyle = shade(c.tone, -0.25); g.fillRect(11, 14, 2, 1);                         // mouth
    box(g, 16, 16, 8, 12, 4, c.shirt);                                                    // body
    for (const [ax, ay] of [[40, 16], [32, 48]]) {                                        // arms: short sleeves
      box(g, ax, ay, 4, 12, 4, c.tone);
      g.fillStyle = c.shirt; g.fillRect(ax, ay + 4, 16, 4); g.fillRect(ax + 4, ay, 4, 4);
    }
    for (const [lx, ly] of [[0, 16], [16, 48]]) {                                         // legs and shoes
      box(g, lx, ly, 4, 12, 4, c.pants);
      g.fillStyle = c.shoes; g.fillRect(lx, ly + 13, 16, 3); g.fillRect(lx + 8, ly + 12, 4, 1);
    }
    return cv;
  }

  /* ---------- turning other files into a 64 by 64 skin ---------- */
  function flipCopy(g, src, sx, sy, w, h, dx, dy) {
    g.save(); g.translate(dx + w, dy); g.scale(-1, 1); g.drawImage(src, sx, sy, w, h, 0, 0, w, h); g.restore();
  }
  // Old 64 by 32 skins have no left arm or leg: the new layout wants them mirrored from the right ones.
  function mirrorLimb(g, src, sx, sy, dx, dy) {
    flipCopy(g, src, sx + 4, sy, 4, 4, dx + 4, dy);       // top
    flipCopy(g, src, sx + 8, sy, 4, 4, dx + 8, dy);       // bottom
    flipCopy(g, src, sx + 8, sy + 4, 4, 12, dx, dy + 4);  // their left side becomes our right side
    flipCopy(g, src, sx, sy + 4, 4, 12, dx + 8, dy + 4);
    flipCopy(g, src, sx + 4, sy + 4, 4, 12, dx + 4, dy + 4); // front
    flipCopy(g, src, sx + 12, sy + 4, 4, 12, dx + 12, dy + 4); // back
  }
  function normalize(img) {
    if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) throw new Error('Skins are 64 by 64 pixels (or the older 64 by 32).');
    const cv = mk(), g = ctxOf(cv);
    g.drawImage(img, 0, 0);
    if (img.height === 32) {
      const copy = mk(); ctxOf(copy).drawImage(cv, 0, 0);
      mirrorLimb(g, copy, 40, 16, 32, 48); // right arm to left arm
      mirrorLimb(g, copy, 0, 16, 16, 48);  // right leg to left leg
    }
    return cv;
  }

  /* ---------- classic (4 px) and slim (3 px) arms ---------- */
  const ARMS = [[40, 16], [40, 32], [32, 48], [48, 48]]; // each arm and sleeve block, 16 by 16 pixels
  // Redraws every arm block with the wide faces resampled to the other width.
  function convertArms(cv, toSlim) {
    const out = mk(), g = ctxOf(out);
    g.drawImage(cv, 0, 0);
    const colsOut = toSlim ? [0, 1, 3] : [0, 1, 1, 2]; // which source column feeds each output column
    for (const [ox, oy] of ARMS) {
      g.clearRect(ox, oy, 16, 16);
      const srcW = toSlim ? 4 : 3, dstW = toSlim ? 3 : 4;
      const from = (x, y, w, h, dx, dy, wide) => {
        if (!wide) return g.drawImage(cv, ox + x, oy + y, w, h, ox + dx, oy + dy, w, h);
        colsOut.forEach((sc, i) => g.drawImage(cv, ox + x + sc, oy + y, 1, h, ox + dx + i, oy + dy, 1, h));
      };
      const A = toSlim ? { top: 4, bottom: 8, right: 0, front: 4, left: 8, back: 12 } : { top: 4, bottom: 7, right: 0, front: 4, left: 7, back: 11 };
      const B = toSlim ? { top: 4, bottom: 7, right: 0, front: 4, left: 7, back: 11 } : { top: 4, bottom: 8, right: 0, front: 4, left: 8, back: 12 };
      from(A.top, 0, srcW, 4, B.top, 0, true); from(A.bottom, 0, srcW, 4, B.bottom, 0, true);
      from(A.right, 4, 4, 12, B.right, 4, false); from(A.left, 4, 4, 12, B.left, 4, false);
      from(A.front, 4, srcW, 12, B.front, 4, true); from(A.back, 4, srcW, 12, B.back, 4, true);
      void dstW;
    }
    return out;
  }

  /* ---------- preview: front and back, drawn flat from the texture ---------- */
  function drawFigure(view, tex, slim) {
    const g = view.getContext('2d'); g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, view.width, view.height);
    const S = 7, aw = slim ? 3 : 4;
    const px = (sx, sy, w, h, dx, dy, ox) => g.drawImage(tex, sx, sy, w, h, ox + dx * S, 16 + dy * S, w * S, h * S);
    const front = (ox) => {
      px(8, 8, 8, 8, 4, 0, ox); px(40, 8, 8, 8, 4, 0, ox);
      px(20, 20, 8, 12, 4, 8, ox); px(20, 36, 8, 12, 4, 8, ox);
      px(44, 20, aw, 12, 4 - aw, 8, ox); px(44, 36, aw, 12, 4 - aw, 8, ox);
      px(36, 52, aw, 12, 12, 8, ox); px(52, 52, aw, 12, 12, 8, ox);
      px(4, 20, 4, 12, 4, 20, ox); px(4, 36, 4, 12, 4, 20, ox);
      px(20, 52, 4, 12, 8, 20, ox); px(4, 52, 4, 12, 8, 20, ox);
    };
    const back = (ox) => {
      px(24, 8, 8, 8, 4, 0, ox); px(56, 8, 8, 8, 4, 0, ox);
      px(32, 20, 8, 12, 4, 8, ox); px(32, 36, 8, 12, 4, 8, ox);
      const bx = slim ? 51 : 52, lx = slim ? 43 : 44, sx = slim ? 59 : 60;
      px(bx, 20, aw, 12, 12, 8, ox); px(bx, 36, aw, 12, 12, 8, ox);
      px(lx, 52, aw, 12, 4 - aw, 8, ox); px(sx, 52, aw, 12, 4 - aw, 8, ox);
      px(12, 20, 4, 12, 8, 20, ox); px(12, 36, 4, 12, 8, 20, ox);
      px(28, 52, 4, 12, 4, 20, ox); px(12, 52, 4, 12, 4, 20, ox);
    };
    front(22); back(154);
  }

  /* ---------- the editor ---------- */
  const view = $('#skin-view');
  let current = null;           // the 64 by 64 canvas being edited
  let model = 'classic';        // arm style of `current`
  let origin = { name: 'My skin' };
  let saved = null;

  const colors = () => ({ tone: $('#sk-tone').value, hair: $('#sk-hair').value, eyes: $('#sk-eyes').value, shirt: $('#sk-shirt').value, pants: $('#sk-pants').value, shoes: $('#sk-shoes').value });
  const show = (cv, m) => { current = cv; model = m; drawFigure(view, cv, m === 'slim'); $('#skin-apply').disabled = false; };

  function status() {
    $('#skin-status').textContent = saved ? `Using “${saved.name}”. It’s added when the game starts.` : 'Using Minecraft’s default skin.';
    $('#skin-reset').hidden = !saved;
  }

  document.querySelectorAll('#skin-tabs .subtab').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#skin-tabs .subtab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.skin-pane').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.skin));
    if (b.dataset.skin === 'build') rebuild();
  }));

  function rebuild() { origin = { name: 'My skin' }; show(generate(colors()), 'classic'); }
  ['tone', 'hair', 'eyes', 'shirt', 'pants', 'shoes'].forEach((k) => $(`#sk-${k}`).addEventListener('input', rebuild));

  async function fromImage(src, m, name) {
    try { const cv = normalize(await loadImage(src)); origin = { name }; show(cv, m); }
    catch (e) { toast(e.message); }
  }
  $('#skin-file').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 200000) return toast('That file is too big for a skin.');
    const r = new FileReader();
    r.onload = () => fromImage(r.result, $('#skin-arms').value, f.name.replace(/\.png$/i, '').slice(0, 40));
    r.readAsDataURL(f);
  };
  $('#skin-arms').onchange = () => { if ($('#skin-file').files[0]) $('#skin-file').onchange({ target: $('#skin-file') }); };
  $('#skin-lookup-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Looking…';
    const r = await api.lookupSkin($('#skin-name').value);
    btn.disabled = false; btn.textContent = 'Copy their skin';
    if (r.error) return toast(r.error);
    await fromImage(r.image, r.model, `${r.name}’s skin`);
    toast(`Copied ${r.name}’s skin. Press Use this skin to keep it.`);
  };

  $('#skin-apply').onclick = async () => {
    if (!current) return;
    const wide = model === 'classic' ? current : convertArms(current, false);
    const slim = model === 'slim' ? current : convertArms(current, true);
    const r = await api.saveSkin({ wide: wide.toDataURL('image/png'), slim: slim.toDataURL('image/png'), name: origin.name, model });
    if (r.error) return toast(r.error);
    saved = { name: origin.name, model };
    status(); toast('Skin saved. You’ll see it next time you start the game.');
  };
  $('#skin-reset').onclick = async () => {
    await api.clearSkin(); saved = null; status(); rebuild(); toast('Back to the default skin.');
  };

  // Start from whatever is saved, or a fresh build.
  (async () => {
    const s = await api.loadSkin();
    if (s) {
      saved = { name: s.name, model: s.model };
      const img = await loadImage(s.model === 'slim' ? s.slim : s.wide);
      const cv = mk(); ctxOf(cv).drawImage(img, 0, 0);
      show(cv, s.model); origin = { name: s.name };
    } else rebuild();
    status();
  })();
})();
