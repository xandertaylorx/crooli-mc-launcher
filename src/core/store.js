const fs = require('fs');
const path = require('path');
const { root } = require('./util');

const DEFAULTS = { username: 'Player', ram: 2048, selected: null, instances: [], servers: [], selectedServer: null };
const file = () => path.join(root(), 'launcher.json');

// Players you can switch between. Offline for now; `type` leaves room for Microsoft accounts later.
// The first one is called 'main' and keeps the skin from before there were several players.
function withAccounts(s) {
  if (!Array.isArray(s.accounts) || !s.accounts.length) s.accounts = [{ id: 'main', name: s.username || 'Player', type: 'offline' }];
  if (!s.accounts.some((a) => a.id === s.account)) s.account = s.accounts[0].id;
  s.username = s.accounts.find((a) => a.id === s.account).name;
  return s;
}
function load() {
  let s; try { s = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { s = { ...DEFAULTS }; }
  return withAccounts(s);
}
function save(s) { fs.writeFileSync(file(), JSON.stringify(s, null, 2)); }

module.exports = { load, save };
