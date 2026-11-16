const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { downloadFile, downloadAll, dirs, track, checkCancel } = require('./util');
const V = require('./versions');
const loaders = require('./loaders');
const { ensureJava } = require('./java');
const skin = require('./skin');

let manifestCache = null;
async function manifest() { return manifestCache || (manifestCache = await V.listVersions()); }

// Same UUID the game itself derives for offline players
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function expand(str, vars) { return str.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }

function flattenArgs(list, vars) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') out.push(expand(a, vars));
    else if (V.rulesAllow(a.rules)) [].concat(a.value).forEach(v => out.push(expand(v, vars)));
  }
  return out;
}

function extractNatives(natives, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const n of natives) {
    const zip = new AdmZip(n.file);
    for (const e of zip.getEntries()) {
      if (e.isDirectory || e.entryName.startsWith('META-INF')) continue;
      if (n.exclude.some(x => e.entryName.startsWith(x))) continue;
      const out = path.join(dir, path.basename(e.entryName));
      fs.writeFileSync(out, e.getData());
      track(out);
    }
  }
}

/**
 * Download everything needed and start the game.
 * inst: {id, name, mc, loader, ram}   account: {name}   emit(type, payload)
 */
async function launch(inst, account, emit, { javaOverride } = {}) {
  const stage = (label, done, total) => emit('progress', { label, done, total });

  stage('Reading version info…');
  const entries = await manifest();
  const vanilla = await V.getVersionJson(inst.mc, entries);
  let vj = vanilla;

  // client jar
  const jar = path.join(dirs.versions(), inst.mc, `${inst.mc}.jar`);
  checkCancel();
  stage('Downloading Minecraft…');
  const c = vanilla.downloads.client;
  await downloadFile(c.url, jar, { sha1: c.sha1, size: c.size });

  // java (the NeoForge and Forge installers need it too, so it comes before the loader)
  checkCancel();
  stage('Preparing Java…');
  const component = (vanilla.javaVersion && vanilla.javaVersion.component) || 'jre-legacy';
  const java = javaOverride || await ensureJava(component, (d, t) => stage('Downloading Java…', d, t));

  if (loaders.MODDED.includes(inst.loader)) {
    stage(`Setting up ${loaders.NAMES[inst.loader]}…`);
    vj = V.merge(vanilla, await loaders.profileFor(inst.loader, inst.mc, { java, jar, onLine: (line) => { if (/^Considering library|Downloading library|Extracting|Processor|Running|Task:/.test(line)) stage(`Setting up ${loaders.NAMES[inst.loader]}…`); } }));
  }

  // libraries
  const libs = V.resolveLibraries(vj);
  await downloadAll(libs.downloads, (d, t) => stage('Downloading libraries…', d, t));
  const nativesDir = path.join(dirs.versions(), vj.id, 'natives');
  if (libs.natives.length) extractNatives(libs.natives, nativesDir);

  checkCancel();
  // assets
  stage('Checking assets…');
  const assets = await V.ensureAssets(vj, (d, t) => stage('Downloading assets…', d, t));

  // logging config (patches the log4j exploit on older versions)
  let logArg = null;
  const lc = vj.logging && vj.logging.client;
  if (lc && lc.file) {
    const f = path.join(dirs.assets(), 'log_configs', lc.file.id);
    await downloadFile(lc.file.url, f, { sha1: lc.file.sha1 });
    logArg = lc.argument.replace('${path}', f);
  }

  checkCancel();
  // arguments
  const gameDir = path.join(dirs.instances(), inst.id);
  fs.mkdirSync(gameDir, { recursive: true });
  // Minecraft shows "Unable to read or access folder where game worlds are saved" if there is no saves folder yet,
  // which is the case in a brand new installation. Create the folders it expects.
  for (const d of ['saves', 'resourcepacks', 'shaderpacks', 'screenshots']) fs.mkdirSync(path.join(gameDir, d), { recursive: true });
  if (loaders.MODDED.includes(inst.loader)) fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true });
  // Put the player's skin in place (or take it out), right before the game reads its settings.
  try { skin.apply(gameDir, jar, inst.mc, account.id); } catch (e) { emit('log', `Couldn't set up the skin: ${e.message}`); }
  const cp = [...libs.classpath, jar];
  const vars = {
    auth_player_name: account.name,
    auth_uuid: offlineUuid(account.name),
    auth_access_token: '0',
    auth_xuid: '0',
    clientid: '0',
    user_type: 'legacy',
    user_properties: '{}',
    // Forge and NeoForge expect the plain Minecraft version here: they use it to leave the vanilla client jar off their module path.
    version_name: (inst.loader === 'forge' || inst.loader === 'neoforge') ? inst.mc : vj.id,
    version_type: vj.type || 'release',
    game_directory: gameDir,
    assets_root: assets.assetsRoot,
    game_assets: assets.assetsRoot,
    assets_index_name: vj.assetIndex.id,
    natives_directory: nativesDir,
    launcher_name: 'CrooliLauncher',
    launcher_version: '0.1.0',
    classpath: cp.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: dirs.libraries(),
  };

  let jvm, game;
  if (vj.arguments) {
    jvm = flattenArgs(vj.arguments.jvm, vars);
    game = flattenArgs(vj.arguments.game, vars);
  } else {
    jvm = ['-Djava.library.path=' + nativesDir, '-cp', vars.classpath];
    // Split the template into words first, then fill each one in, so a folder with a space in its name ("Application Support",
    // "John Smith") stays one argument instead of being cut in two.
    game = vj.minecraftArguments.split(' ').filter(Boolean).map((w) => expand(w, vars));
  }
  const ram = inst.ram || 2048;
  const extra = [`-Xmx${ram}M`, `-Xms${Math.min(512, ram)}M`];
  if (process.platform === 'darwin' && !jvm.includes('-XstartOnFirstThread') && cp.some(p => /lwjgl[\\/]3\./.test(p))) extra.push('-XstartOnFirstThread');
  if (logArg) extra.push(logArg);

  const args = [...extra, ...jvm, vj.mainClass, ...game];
  emit('log', `> ${java} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ').replace(vars.classpath, '<classpath>')}`);
  stage('Starting game…');

  const child = spawn(java, args, { cwd: gameDir });
  const pipe = d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => emit('log', l));
  child.stdout.on('data', pipe);
  child.stderr.on('data', pipe);
  return child;
}

module.exports = { launch, manifest, offlineUuid };
