// Skins for offline accounts. An offline player has no Mojang skin, so the game shows its default skin
// (Steve, Alex and so on). We swap those textures with the player's chosen skin through a resource pack, and
// turn that pack on in the instance's options.txt right before the game starts.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { root, getJson } = require('./util');
const packs = require('./packs');

const PACK_NAME = 'crooli-skin.zip';
const NAMES = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'];
const skinDir = () => path.join(root(), 'skin');
const files = () => ({ wide: path.join(skinDir(), 'classic.png'), slim: path.join(skinDir(), 'slim.png'), meta: path.join(skinDir(), 'skin.json') });

// The resource pack format number lives in the game jar. Its shape changed over the years.
function packFormat(jarPath) {
  try {
    const pv = JSON.parse(new AdmZip(jarPath).readAsText('version.json')).pack_version;
    if (typeof pv === 'number') return { major: pv };
    if (pv && pv.resource_major != null) return { major: pv.resource_major, minor: pv.resource_minor || 0, modern: true };
    if (pv && pv.resource != null) return { major: pv.resource };
  } catch {}
  return null;
}

function mcmeta(fmt) {
  const f = fmt || { major: 15 };
  const pack = { description: 'Crooli MC Launcher skin', pack_format: f.major };
  if (f.modern) { pack.min_format = f.major; pack.max_format = f.major; } else pack.supported_formats = { min_inclusive: Math.min(f.major, 4), max_inclusive: f.major + 50 };
  return JSON.stringify({ pack });
}

function buildPack(wide, slim, fmt) {
  const z = new AdmZip();
  z.addFile('pack.mcmeta', Buffer.from(mcmeta(fmt)));
  const base = 'assets/minecraft/textures/entity';
  for (const n of NAMES) {
    z.addFile(`${base}/player/wide/${n}.png`, wide);
    z.addFile(`${base}/player/slim/${n}.png`, slim);
  }
  // Before 1.20.2 the two default skins were these files.
  z.addFile(`${base}/steve.png`, wide);
  z.addFile(`${base}/alex.png`, slim);
  return z;
}

// Called right before the game starts. With a saved skin, installs and enables the pack; without one,
// removes it so the default skins come back.
function apply(instDir, jarPath, mc) {
  const dest = path.join(packs.dirFor(instDir, 'resourcepack'), PACK_NAME);
  const f = files();
  if (fs.existsSync(f.wide) && fs.existsSync(f.slim)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    buildPack(fs.readFileSync(f.wide), fs.readFileSync(f.slim), packFormat(jarPath)).writeZip(dest);
    packs.setResourcePack(instDir, PACK_NAME, true, mc);
    return true;
  }
  if (fs.existsSync(dest)) { fs.rmSync(dest, { force: true }); packs.setResourcePack(instDir, PACK_NAME, false, mc); }
  return false;
}

/* ---------- saved skin ---------- */
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const fromDataUrl = (u) => Buffer.from(String(u).replace(/^data:image\/png;base64,/, ''), 'base64');

function load() {
  const f = files();
  if (!fs.existsSync(f.wide) || !fs.existsSync(f.slim)) return null;
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(f.meta, 'utf8')); } catch {}
  return { ...meta, wide: dataUrl(fs.readFileSync(f.wide)), slim: dataUrl(fs.readFileSync(f.slim)) };
}
function save({ wide, slim, name, model }) {
  const f = files();
  const a = fromDataUrl(wide), b = fromDataUrl(slim);
  // A real PNG starts with these 8 bytes; refuse anything else so junk never lands in a resource pack.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!a.subarray(0, 8).equals(png) || !b.subarray(0, 8).equals(png) || a.length > 200000 || b.length > 200000) throw new Error('That isn’t a valid skin image.');
  fs.mkdirSync(skinDir(), { recursive: true });
  fs.writeFileSync(f.wide, a); fs.writeFileSync(f.slim, b);
  fs.writeFileSync(f.meta, JSON.stringify({ name: String(name || 'My skin').slice(0, 40), model: model === 'slim' ? 'slim' : 'classic' }));
}
function clear() { fs.rmSync(skinDir(), { recursive: true, force: true }); }

// Fetch a player's current skin from Mojang by name, so someone can start from a skin they already have.
async function lookup(name) {
  if (!/^\w{3,16}$/.test(name)) throw new Error('Player names are 3 to 16 letters, numbers or underscores.');
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
  if (res.status === 404 || res.status === 204) throw new Error(`No Minecraft player is called ${name}.`);
  if (res.status === 429) throw new Error('Mojang is limiting how fast skins can be looked up. Wait a minute and try again.');
  if (!res.ok) throw new Error(`Mojang didn’t answer (error ${res.status}). Try again in a moment.`);
  const { id, name: exact } = await res.json();
  let profile;
  try { profile = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`); }
  catch (e) { throw new Error(/429/.test(e.message) ? 'Mojang is limiting how fast skins can be looked up. Wait a minute and try again.' : 'Couldn’t get that player’s skin from Mojang. Try again in a moment.'); }
  const tex = JSON.parse(Buffer.from(profile.properties.find((p) => p.name === 'textures').value, 'base64').toString()).textures.SKIN;
  if (!tex) throw new Error(`${exact} is using a default skin, so there’s nothing to copy.`);
  // Mojang hands out these addresses as http://. Only ever fetch from its texture host, and always over https.
  let url;
  try { url = new URL(tex.url); } catch { throw new Error('Mojang sent a skin address that can’t be read.'); }
  if (url.hostname !== 'textures.minecraft.net') throw new Error('Mojang sent a skin from an unexpected place, so it wasn’t downloaded.');
  url.protocol = 'https:';
  const img = await fetch(url.href);
  if (!img.ok) throw new Error('Couldn’t download that skin from Mojang. Try again in a moment.');
  return { name: exact, model: tex.metadata && tex.metadata.model === 'slim' ? 'slim' : 'classic', image: dataUrl(Buffer.from(await img.arrayBuffer())) };
}

module.exports = { apply, load, save, clear, lookup, packFormat, buildPack, PACK_NAME };
