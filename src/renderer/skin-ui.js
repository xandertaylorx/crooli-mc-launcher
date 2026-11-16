// Settings > Skin: load a PNG or copy a player's skin, preview it in 3D, and save it.
// Everything is drawn on canvases here; main.js only stores the two finished PNGs. Needs app.js first.
(() => {
  const mk = (w = 64, h = 64) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctxOf = (c) => { const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false; return g; };
  const loadImage = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That image couldn’t be read.')); i.src = src; });

  /* ---------- colours ---------- */
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const shade = (hex, pct) => `rgb(${rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * (1 + pct))))).join(',')})`;

  // Fills an unfolded box the way Minecraft lays skins out: top, bottom, then right, front, left, back.
  // `color` is one colour, or a function of the row (0 = top) so a sleeve or a boot can change colour part-way down
  // while every face still gets the same light and shade.
  const FACE_LIGHT = [0.12, -0.22, -0.08, 0, -0.08, -0.12]; // top, bottom, right, front, left, back
  function box(g, x, y, w, h, d, color) {
    const at = typeof color === 'function' ? color : () => color;
    const faces = [[x + d, y, w, d], [x + d + w, y, w, d], [x, y + d, d, h], [x + d, y + d, w, h], [x + d + w, y + d, d, h], [x + d + w + d, y + d, w, h]];
    faces.forEach(([fx, fy, fw, fh], i) => {
      const tall = i >= 2; // the four sides have rows from the top of the part down; top and bottom are flat
      for (let r = 0; r < fh; r++) { g.fillStyle = shade(at(tall ? r : (i === 1 ? h : 0)), FACE_LIGHT[i]); g.fillRect(fx, fy + r, fw, 1); }
    });
  }

  // A little character from six colours: head, hair, face, shirt, trousers and shoes.
  function generate(c) {
    const cv = mk(), g = ctxOf(cv);
    // head: hair on top, round the sides and down the back; skin below
    box(g, 0, 0, 8, 8, 8, (r) => c.tone);
    const hairFace = (fx, fy, rows) => { for (let r = 0; r < rows; r++) { g.fillStyle = shade(c.hair, FACE_LIGHT[fx === 24 ? 5 : fx === 16 ? 4 : fx === 0 ? 2 : 3]); g.fillRect(fx, fy + r, 8, 1); } };
    g.fillStyle = shade(c.hair, 0.1); g.fillRect(8, 0, 8, 8);                    // top of the head
    hairFace(0, 8, 4); hairFace(16, 8, 4); hairFace(24, 8, 7);                   // sides and back
    hairFace(8, 8, 2); g.fillStyle = c.hair; g.fillRect(8, 10, 1, 1); g.fillRect(15, 10, 1, 1); // fringe
    g.fillStyle = shade(c.hair, -0.25); g.fillRect(9, 11, 2, 1); g.fillRect(13, 11, 2, 1);      // brows
    g.fillStyle = '#f4f4f4'; g.fillRect(9, 12, 1, 1); g.fillRect(14, 12, 1, 1);                 // eyes
    g.fillStyle = c.eyes; g.fillRect(10, 12, 1, 1); g.fillRect(13, 12, 1, 1);
    g.fillStyle = shade(c.tone, -0.25); g.fillRect(11, 14, 2, 1);                               // mouth
    box(g, 16, 16, 8, 12, 4, c.shirt);                                                          // body
    for (const [ax, ay] of [[40, 16], [32, 48]]) box(g, ax, ay, 4, 12, 4, (r) => (r < 4 ? c.shirt : c.tone)); // arms, short sleeves
    for (const [lx, ly] of [[0, 16], [16, 48]]) box(g, lx, ly, 4, 12, 4, (r) => (r >= 9 ? c.shoes : c.pants)); // legs, shoes
    return cv;
  }

  /* ---------- the base layer is always opaque ----------
     Minecraft forces the base layer of a skin (head, body, arms, legs) to be solid when it loads one; only the outer
     layer (hat, jacket, sleeves, pants) may be see-through. A resource pack isn't given that treatment, so a skin
     with holes in its base layer would show them as see-through limbs in the game. Do the same here. */
  const BASE_LAYER = [[0, 0, 32, 16], [0, 16, 64, 16], [16, 48, 32, 16]]; // x, y, width, height
  function opaqueBase(cv) {
    const g = ctxOf(cv); let changed = false;
    for (const [x, y, w, h] of BASE_LAYER) {
      const im = g.getImageData(x, y, w, h), d = im.data;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) { d[i] = 255; changed = true; }
      g.putImageData(im, x, y);
    }
    return changed;
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
    opaqueBase(cv);
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

  /* ---------- preview: a 3D model you can turn, built from the skin texture ----------
     Each body part is a box of six faces (CSS 3D), each face a small canvas cut from the texture. */
  const S = 8; // screen pixels per skin pixel
  // Where a box's six faces sit in the unfolded skin: top, bottom, right, front, left, back.
  const uvOf = (ox, oy, w, h, d) => ({ top: [ox + d, oy, w, d], bottom: [ox + d + w, oy, w, d], right: [ox, oy + d, d, h], front: [ox + d, oy + d, w, h], left: [ox + d + w, oy + d, d, h], back: [ox + d + w + d, oy + d, w, h] });
  function faceTransforms(w, h, d) {
    const z = (n) => `${n * S}px`;
    return {
      front: [w, h, `translateZ(${z(d / 2)})`], back: [w, h, `rotateY(180deg) translateZ(${z(d / 2)})`],
      right: [d, h, `rotateY(-90deg) translateZ(${z(w / 2)})`], left: [d, h, `rotateY(90deg) translateZ(${z(w / 2)})`],
      top: [w, d, `rotateX(90deg) translateZ(${z(h / 2)})`], bottom: [w, d, `rotateX(-90deg) translateZ(${z(h / 2)})`],
    };
  }
  const LIGHT = { front: 1, back: 0.88, right: 0.9, left: 0.9, top: 1.1, bottom: 0.72 };

  function partsFor(slim) {
    const aw = slim ? 3 : 4;
    // [x, y] is the part's centre, in skin pixels, with the figure's top at y 0 and the middle of the body at x 0
    return [
      { at: [0, 4], size: [8, 8, 8], base: [0, 0], over: [32, 0], grow: 1 },                   // head and hat
      { at: [0, 14], size: [8, 12, 4], base: [16, 16], over: [16, 32], grow: 0.5 },            // body and jacket
      { at: [-(4 + aw / 2), 14], size: [aw, 12, 4], base: [40, 16], over: [40, 32], grow: 0.5 }, // right arm (on the viewer's left)
      { at: [4 + aw / 2, 14], size: [aw, 12, 4], base: [32, 48], over: [48, 48], grow: 0.5 },    // left arm
      { at: [-2, 26], size: [4, 12, 4], base: [0, 16], over: [0, 32], grow: 0.5 },             // right leg
      { at: [2, 26], size: [4, 12, 4], base: [16, 48], over: [0, 48], grow: 0.5 },             // left leg
    ];
  }

  function makeBox(tex, [ox, oy], [w, h, d], [cx, cy], grow) {
    const box = h_('div', 'box');
    box.style.transform = `translate3d(${cx * S}px, ${(cy - 16) * S}px, 0)`;
    const uv = uvOf(ox, oy, w, h, d), tf = faceTransforms(w + grow, h + grow, d + grow);
    for (const face of Object.keys(uv)) {
      const [sx, sy, sw, sh] = uv[face], [fw, fh, t] = tf[face];
      const c = mk(sw, sh); ctxOf(c).drawImage(tex, sx, sy, sw, sh, 0, 0, sw, sh);
      c.className = 'face';
      c.style.width = `${fw * S}px`; c.style.height = `${fh * S}px`;
      c.style.transform = `translate(-50%, -50%) ${t}`;
      c.style.filter = `brightness(${LIGHT[face]})`;
      box.append(c);
    }
    return box;
  }
  const h_ = (tag, cls) => { const e = document.createElement(tag); e.className = cls; return e; };

  function drawFigure(stage, tex, slim) {
    const fig = $('#skin-fig'); fig.replaceChildren();
    for (const p of partsFor(slim)) {
      fig.append(makeBox(tex, p.base, p.size, p.at, 0));           // the skin itself
      fig.append(makeBox(tex, p.over, p.size, p.at, p.grow));      // hat, jacket, sleeves and so on, a touch larger
    }
    turn(spin.angle);
  }

  // Turning: drag to rotate, slow spin until you touch it, double-click to face front again.
  const spin = { angle: -28, dragging: false, auto: !matchMedia('(prefers-reduced-motion: reduce)').matches, x: 0 };
  function turn(a) { spin.angle = a; $('#skin-fig').style.transform = `rotateX(-10deg) rotateY(${a}deg)`; }
  (() => {
    const st = $('#skin-stage');
    st.addEventListener('pointerdown', (e) => { spin.dragging = true; spin.auto = false; spin.x = e.clientX; st.setPointerCapture(e.pointerId); });
    st.addEventListener('pointermove', (e) => { if (!spin.dragging) return; turn(spin.angle + (e.clientX - spin.x) * 0.8); spin.x = e.clientX; });
    const up = () => { spin.dragging = false; };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    st.addEventListener('dblclick', () => { spin.auto = false; turn(0); });
    st.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { spin.auto = false; turn(spin.angle - 15); } if (e.key === 'ArrowRight') { spin.auto = false; turn(spin.angle + 15); } });
    const tick = () => { if (spin.auto && !document.hidden && $('#view-settings').classList.contains('active')) turn(spin.angle + 0.35); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })();

  /* ---------- the editor ---------- */
  const view = $('#skin-stage');
  let current = null;           // the 64 by 64 canvas being edited
  let model = 'classic';        // arm style of `current`
  let origin = { name: 'My skin' };
  let saved = null;

  // The skin builder is gone from the screen; the generator stays to draw the default-looking figure until you pick a skin.
  const colors = () => ({ tone: '#c69c7c', hair: '#4a3220', eyes: '#3f5fbf', shirt: '#3aa6b3', pants: '#3f3fa8', shoes: '#5b5b5b' });
  const show = (cv, m) => { current = cv; model = m; drawFigure(view, cv, m === 'slim'); $('#skin-apply').disabled = false; };

  function status() {
    $('#skin-status').textContent = saved ? `Using “${saved.name}”. It’s added when the game starts.` : 'Using Minecraft’s default skin.';
    $('#skin-reset').hidden = !saved;
  }

  document.querySelectorAll('#skin-tabs .subtab').forEach((b) => (b.onclick = () => {
    document.querySelectorAll('#skin-tabs .subtab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.skin-pane').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.skin));
  }));

  function rebuild() { origin = { name: 'My skin' }; show(generate(colors()), 'classic'); current = null; $('#skin-apply').disabled = true; }

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
    opaqueBase(current);
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

  // Start from whatever is saved for this player, or the default figure. Runs again when you switch player.
  async function loadSaved() {
    const s = await api.loadSkin();
    saved = null;
    if (s) {
      saved = { name: s.name, model: s.model };
      const img = await loadImage(s.model === 'slim' ? s.slim : s.wide);
      const cv = mk(); ctxOf(cv).drawImage(img, 0, 0);
      const fixed = opaqueBase(cv);
      show(cv, s.model); origin = { name: s.name };
      if (fixed) { // a skin saved before this fix had see-through limbs: save it again, solid
        const wide = s.model === 'classic' ? cv : convertArms(cv, false), slimC = s.model === 'slim' ? cv : convertArms(cv, true);
        await api.saveSkin({ wide: wide.toDataURL('image/png'), slim: slimC.toDataURL('image/png'), name: s.name, model: s.model });
      }
    } else rebuild();
    status();
  }
  window.reloadSkin = loadSaved;
  loadSaved();
})();
