// Works out, in plain words, why Minecraft stopped. Reads the newest crash report written since the game started
// and the last lines of the game's output, and matches them against the common causes.
const fs = require('fs');
const path = require('path');

function newestReport(gameDir, since) {
  const dir = path.join(gameDir, 'crash-reports');
  try {
    const fresh = fs.readdirSync(dir).filter((f) => /\.txt$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).filter((x) => x.t >= since - 2000).sort((a, b) => b.t - a.t);
    return fresh[0] ? path.join(dir, fresh[0].f) : null;
  } catch { return null; }
}

const gb = (mb) => (mb < 1024 ? `${mb} MB` : `${Math.round((mb / 1024) * 10) / 10} GB`.replace('.0 GB', ' GB'));

// text: crash report + output. inst: the installation. Returns { title, why, actions, culprit }.
function diagnose(text, inst) {
  const t = text || '';
  const actions = [];
  const has = (re) => re.test(t);
  let culprit = null;
  const sus = t.match(/Suspected Mods?:\s*\n?\s*([^\n(]+?)\s*\(([\w.-]+)\)/i);
  const mixin = t.match(/Mixin apply (?:for mod|failed)[^\n]*?\b([a-z][\w-]{1,40})\b[^\n]*failed|\[([a-z][\w-]{1,40})\.mixins\.json/i);
  if (sus && !['minecraft', 'java', 'fabricloader', 'fabric-api'].includes(sus[2])) culprit = { id: sus[2], name: sus[1].trim() };
  else if (mixin) { const id = (mixin[1] || mixin[2] || '').toLowerCase(); if (id && !['minecraft', 'fabric'].includes(id)) culprit = { id, name: id }; }

  if (has(/java\.lang\.OutOfMemoryError|GC overhead limit|Could not reserve enough space/)) {
    const next = Math.min(16384, Math.max(4096, (inst.ram || 2048) + 2048));
    actions.push({ kind: 'ram', value: next, label: `Give it ${gb(next)} of memory` });
    return { title: 'Minecraft ran out of memory', why: `It had ${gb(inst.ram || 2048)} and needed more. Mods and shaders use a lot of it, and so does a large view distance.`, actions, culprit: null };
  }
  if (has(/UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime|class file version/)) {
    actions.push({ kind: 'java', label: 'Use the Java the launcher provides' });
    return { title: 'The wrong version of Java was used', why: 'This game version needs a newer Java than the one it was started with. This usually happens when a custom Java path is set in Settings.', actions, culprit: null };
  }
  if (has(/Incompatible mods found|Mod resolution failed|Could not resolve (?:all )?dependencies|Mod .* requires/i)) {
    actions.push({ kind: 'mods', label: 'Open the mods' });
    return { title: 'Some mods don’t work together', why: 'Fabric refused to start because of how the installed mods depend on each other. Updating them or removing the one that doesn’t fit usually fixes it.', actions, culprit: null };
  }
  if (has(/GLFW error|Pixel format not accelerated|OpenGL|GLX|WGL|EGL|No OpenGL context|Failed to create window/i) && !has(/Caused by: java\.lang\.(?:NullPointer|Illegal)/)) {
    return { title: 'The graphics driver stopped the game', why: 'Minecraft couldn’t set up its graphics. Updating your graphics driver is the usual fix. If you just added a shader pack or a rendering mod such as Sodium or Iris, turn it off and try again.', actions: [{ kind: 'mods', label: 'Open the mods' }], culprit };
  }
  if (has(/Mixin apply (?:for mod|failed)|Mixin transformation|InvalidInjectionException|MixinTransformerError|MixinApplyError/) || (culprit && has(/Exception/))) {
    if (culprit) actions.push({ kind: 'disable', modId: culprit.id, label: `Turn off ${culprit.name}` });
    actions.push({ kind: 'mods', label: 'Open the mods' });
    return { title: culprit ? `${culprit.name} broke the game` : 'A mod broke the game', why: culprit ? `${culprit.name} crashed while loading, often because it isn’t built for this version of Minecraft or clashes with another mod. Turn it off and see if the game starts.` : 'A mod crashed while loading, often because it isn’t built for this version of Minecraft or clashes with another mod.', actions, culprit };
  }
  if (has(/Failed to (?:load|read) (?:world|level)|Unable to (?:read|load) world|corrupt/i)) {
    return { title: 'A world couldn’t be loaded', why: 'Minecraft hit a problem reading a world. Restore a backup if you have one, or open the folder and move that world out.', actions: [{ kind: 'folder', label: 'Open the folder' }], culprit: null };
  }
  const desc = t.match(/Description:\s*(.+)/);
  const cause = [...t.matchAll(/Caused by:\s*([^\n]+)/g)].pop();
  const exc = t.match(/^\s*(?:Exception in thread[^\n]*?|[\w.$]+(?:Exception|Error)):?[^\n]*/m);
  if (culprit) actions.push({ kind: 'disable', modId: culprit.id, label: `Turn off ${culprit.name}` });
  actions.push({ kind: 'mods', label: 'Open the mods' });
  return { title: 'Minecraft stopped unexpectedly', why: (desc ? `It reported: ${desc[1].trim()}.` : 'It closed with an error.') + (cause ? ` The underlying cause: ${cause[1].trim().slice(0, 160)}.` : exc ? ` ${exc[0].trim().slice(0, 160)}` : '') + ' If it keeps happening, copy the details and ask for help.', actions, culprit };
}

module.exports = { newestReport, diagnose };
