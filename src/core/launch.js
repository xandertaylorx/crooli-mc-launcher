const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { downloadFile, downloadAll, dirs } = require('./util');
const V = require('./versions');
const { ensureJava } = require('./java');

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
      fs.writeFileSync(path.join(dir, path.basename(e.entryName)), e.getData());
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
  if (inst.loader === 'fabric') vj = V.merge(vanilla, await V.getFabricProfile(inst.mc));

  // client jar
  const jar = path.join(dirs.versions(), inst.mc, `${inst.mc}.jar`);
  stage('Downloading Minecraft…');
  const c = vanilla.downloads.client;
  await downloadFile(c.url, jar, { sha1: c.sha1, size: c.size });

  // libraries
  const libs = V.resolveLibraries(vj);
  await downloadAll(libs.downloads, (d, t) => stage('Downloading libraries…', d, t));
  const nativesDir = path.join(dirs.versions(), vj.id, 'natives');
  if (libs.natives.length) extractNatives(libs.natives, nativesDir);

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

  // java
  stage('Preparing Java…');
  const component = (vj.javaVersion && vj.javaVersion.component) || 'jre-legacy';
  const java = javaOverride || await ensureJava(component, (d, t) => stage('Downloading Java…', d, t));

  // arguments
  const gameDir = path.join(dirs.instances(), inst.id);
  fs.mkdirSync(gameDir, { recursive: true });
  const cp = [...libs.classpath, jar];
  const vars = {
    auth_player_name: account.name,
    auth_uuid: offlineUuid(account.name),
    auth_access_token: '0',
    auth_xuid: '0',
    clientid: '0',
    user_type: 'legacy',
    user_properties: '{}',
    version_name: vj.id,
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
    game = expand(vj.minecraftArguments, vars).split(' ');
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
