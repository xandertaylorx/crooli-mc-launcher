const fs = require('fs');
const path = require('path');
const { root } = require('./util');

const DEFAULTS = { username: 'Player', ram: 2048, selected: null, instances: [], servers: [], selectedServer: null };
const file = () => path.join(root(), 'launcher.json');

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function save(s) { fs.writeFileSync(file(), JSON.stringify(s, null, 2)); }

module.exports = { load, save };
