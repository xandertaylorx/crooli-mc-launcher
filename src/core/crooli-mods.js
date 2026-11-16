// The mods and shader packs on https://xandertaylorx.github.io/minecraft-mods/. The page is read live, so a new
// mod added there shows up in the launcher without a launcher update. The page is built from one card per mod
// (its own comment says "To add a mod, copy a card"), which is what this reads.
const fs = require('fs');
const path = require('path');
const { downloadFile, UA } = require('./util');
const packs = require('./packs');
const modrinth = require('./modrinth');

const BASE = 'https://xandertaylorx.github.io/minecraft-mods/';
const TTL = 5 * 60 * 1000;
let cache = null;

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const abs = (u) => new URL(u, BASE).href;

function parse(html) {
  const out = [];
  for (const m of html.matchAll(/<article class="card[^"]*">([\s\S]*?)<\/article>/g)) {
    const b = m[1];
    const dl = (b.match(/href="(downloads\/[^"]+\.(?:jar|zip))"/) || [])[1];
    if (!dl) continue;
    const download = abs(dl);
    // Only ever fetch files from the downloads folder of that site, whatever the page says.
    if (!download.startsWith(BASE + 'downloads/')) continue;
    const file = decodeURIComponent(path.basename(new URL(download).pathname));
    if (file !== path.basename(file) || !/^[\w.+\- ]+\.(jar|zip)$/.test(file)) continue;
    const tags = [...b.matchAll(/<span class="tag([^"]*)">([^<]*)<\/span>/g)].map((t) => ({ cls: t[1].trim(), text: decode(t[2]) }));
    const mcTag = tags.find((t) => /^MC\s/.test(t.text));
    const slug = (b.match(/href="mods\/([\w-]+)\/"/) || [])[1] || file.replace(/-\d.*$/, '');
    const icon = (b.match(/<img class="icon" src="([^"]+)"/) || [])[1];
    const desc = (b.match(/<h3>[\s\S]*?<\/h3>\s*<p>([\s\S]*?)<\/p>/) || [])[1];
    out.push({
      id: slug,
      name: decode((b.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || slug),
      description: decode(desc || ''),
      version: (tags.find((t) => /status-live/.test(t.cls)) || {}).text || '',
      loader: (tags.find((t) => /\bloader\b/.test(t.cls)) || {}).text || 'Fabric',
      mc: mcTag ? mcTag.text.replace(/^MC\s+/, '') : null,
      category: (tags.filter((t) => !/status-live|loader/.test(t.cls) && !/^MC\s/.test(t.text)).pop() || {}).text || '',
      icon: icon ? abs(icon) : null,
      page: abs(`mods/${slug}/`),
      download, file,
      kind: file.endsWith('.zip') ? 'shader' : 'mod',
    });
  }
  return out;
}

async function list() {
  if (cache && Date.now() - cache.at < TTL) return cache.mods;
  const res = await fetch(BASE, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`The mods page answered ${res.status}.`);
  const mods = parse(await res.text());
  if (!mods.length) throw new Error('Couldn’t find any mods on the page.');
  cache = { at: Date.now(), mods };
  return mods;
}

// Installs one mod (or the shader pack) into an installation. Mods get Fabric API alongside, since they all need it,
// and an older copy of the same mod is removed so two versions never load together.
async function install(instDir, inst, modId) {
  const m = (await list()).find((x) => x.id === modId);
  if (!m) throw new Error('That mod isn’t on the page any more.');
  if (!['fabric', 'quilt'].includes(inst.loader)) throw new Error('These need a Fabric or Quilt installation. Make one on the Installations tab.');
  if (m.mc && m.mc !== inst.mc) throw new Error(`${m.name} is built for Minecraft ${m.mc}, and this installation is ${inst.mc}.`);
  const dir = packs.dirFor(instDir, m.kind);
  fs.mkdirSync(dir, { recursive: true });
  const stem = m.file.replace(/-\d[\w.+-]*\.(jar|zip)$/, '');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (f !== m.file && f.startsWith(stem + '-') && /\.(jar|zip)(\.disabled)?$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  }
  await downloadFile(m.download, path.join(dir, m.file));
  const notes = [];
  if (m.kind === 'mod') {
    try { await modrinth.install(instDir, 'fabric-api', inst.mc, inst.loader, 'mod'); } catch { notes.push('Couldn’t add Fabric API. Install it from the Mods tab.'); }
  } else {
    const hasIris = packs.list(instDir, 'mod').some((f) => /iris/i.test(f.file) && f.enabled);
    if (!hasIris) notes.push('Shader packs need Iris. The Shaders tab can install it.');
  }
  return { file: m.file, kind: m.kind, notes };
}

module.exports = { list, install, parse };
