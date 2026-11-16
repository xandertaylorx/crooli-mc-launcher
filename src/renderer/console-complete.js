// Tab-completion for the server console: commands, their sub-commands, and player names.
// Each command lists what comes after it, one entry per word. A string starting with $ is a kind of thing to fill in.
(() => {
  const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'];
  const ITEMS = ['diamond', 'diamond_sword', 'diamond_pickaxe', 'diamond_axe', 'diamond_shovel', 'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
    'netherite_ingot', 'netherite_sword', 'netherite_pickaxe', 'iron_ingot', 'gold_ingot', 'emerald', 'coal', 'torch', 'cooked_beef', 'bread', 'golden_apple', 'enchanted_golden_apple',
    'elytra', 'firework_rocket', 'ender_pearl', 'bow', 'arrow', 'shield', 'totem_of_undying', 'tnt', 'oak_log', 'cobblestone', 'stone', 'dirt', 'obsidian', 'chest', 'crafting_table',
    'furnace', 'bed', 'water_bucket', 'lava_bucket', 'compass', 'map', 'name_tag', 'saddle', 'command_block', 'barrier'];
  const EFFECTS = ['speed', 'slowness', 'haste', 'strength', 'jump_boost', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'night_vision',
    'saturation', 'absorption', 'health_boost', 'luck', 'slow_falling', 'levitation', 'glowing'];
  const ENTITIES = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'pig', 'cow', 'sheep', 'chicken', 'horse', 'wolf', 'cat', 'villager', 'iron_golem', 'bat', 'bee', 'fox', 'panda', 'lightning_bolt', 'tnt'];
  const RULES = ['keepInventory', 'doDaylightCycle', 'doMobSpawning', 'mobGriefing', 'doFireTick', 'doWeatherCycle', 'pvp', 'naturalRegeneration', 'showDeathMessages', 'doInsomnia',
    'doImmediateRespawn', 'fallDamage', 'fireDamage', 'drowningDamage', 'announceAdvancements', 'commandBlockOutput', 'playersSleepingPercentage', 'randomTickSpeed', 'spawnRadius', 'doEntityDrops', 'doMobLoot', 'doTileDrops'];
  const BOOL = ['true', 'false'];
  const ENCHANTS = ['sharpness', 'protection', 'efficiency', 'unbreaking', 'fortune', 'looting', 'mending', 'silk_touch', 'power', 'infinity', 'fire_aspect', 'knockback', 'thorns', 'feather_falling'];

  // '$player' fills in a name or @a/@p/@r/@s/@e. A nested array is a choice, followed by more words for that choice.
  const TREE = {
    advancement: [['grant', 'revoke'], '$player', ['everything', 'only', 'from', 'through', 'until']],
    ban: ['$player'], 'ban-ip': [], banlist: [['players', 'ips']],
    clear: ['$player', '$item'],
    defaultgamemode: [GAMEMODES],
    deop: ['$player'],
    difficulty: [['peaceful', 'easy', 'normal', 'hard']],
    effect: [['give', 'clear'], '$player', '$effect'],
    enchant: ['$player', ENCHANTS],
    experience: [['add', 'set', 'query'], '$player'], xp: [['add', 'set', 'query'], '$player'],
    gamemode: [GAMEMODES, '$player'],
    gamerule: [RULES, BOOL],
    give: ['$player', '$item'],
    help: [], kick: ['$player'], kill: ['$player'], list: [['uuids']],
    me: [], msg: ['$player'], tell: ['$player'], w: ['$player'],
    op: ['$player'], pardon: ['$player'], 'pardon-ip': [],
    publish: [], reload: [], say: [], seed: [], stop: [],
    'save-all': [['flush']], 'save-off': [], 'save-on': [],
    setblock: [], setworldspawn: [], spawnpoint: ['$player'],
    summon: ['$entity'],
    tag: ['$player', ['add', 'remove', 'list']],
    teleport: ['$player', '$player'], tp: ['$player', '$player'],
    time: [['set', 'add', 'query'], ['day', 'night', 'noon', 'midnight', 'sunrise', 'sunset']],
    title: ['$player', ['title', 'subtitle', 'actionbar', 'clear', 'reset', 'times']],
    weather: [['clear', 'rain', 'thunder']],
    whitelist: [['add', 'remove', 'list', 'on', 'off', 'reload'], '$player'],
    worldborder: [['set', 'add', 'center', 'get', 'damage', 'warning']],
  };
  // later words depend on an earlier choice
  const SPECIAL = {
    'whitelist add': ['$player'], 'whitelist remove': ['$whitelisted'], 'whitelist list': [], 'whitelist on': [], 'whitelist off': [], 'whitelist reload': [],
    'time set': [['day', 'night', 'noon', 'midnight', 'sunrise', 'sunset']], 'time add': [], 'time query': [['daytime', 'gametime', 'day']],
    'effect clear': ['$player', '$effect'], 'effect give': ['$player', '$effect'],
    'worldborder damage': [['amount', 'buffer']], 'worldborder warning': [['distance', 'time']],
    'gamerule': [RULES, BOOL],
  };
  const SELECTORS = ['@a', '@p', '@r', '@s', '@e'];

  // text: everything typed. ctx: { players: [...], whitelist: [...] }. Returns { start, options } where start is
  // where the word being typed begins.
  function suggest(text, ctx = {}) {
    const raw = text.replace(/^\//, ''), lead = text.length - raw.length;
    const parts = raw.split(/\s+/);
    const cur = parts.pop() || '';
    const start = lead + raw.length - cur.length;
    const lower = cur.toLowerCase();
    let pool;
    if (!parts.length) pool = Object.keys(TREE).sort();
    else {
      const cmd = parts[0].toLowerCase();
      const spec = TREE[cmd];
      if (!spec) return { start, options: [] };
      let want;
      const two = SPECIAL[`${cmd} ${(parts[1] || '').toLowerCase()}`];
      if (parts.length >= 2 && two) want = two[parts.length - 2];
      else want = spec[parts.length - 1];
      if (want == null) return { start, options: [] };
      pool = Array.isArray(want) ? want : kind(want, ctx);
    }
    const opts = pool.filter((o) => o.toLowerCase().startsWith(lower) && o.toLowerCase() !== lower);
    // also match in the middle of a word for item names (netherite_ingot for "ingot")
    if (lower.length >= 3) for (const o of pool) if (!opts.includes(o) && o.toLowerCase().includes(lower) && o.toLowerCase() !== lower) opts.push(o);
    return { start, options: opts.slice(0, 40) };
  }
  function kind(k, ctx) {
    if (k === '$player') return [...new Set([...(ctx.players || []), ...(ctx.whitelist || []), ...SELECTORS])];
    if (k === '$whitelisted') return ctx.whitelist || [];
    if (k === '$item') return ITEMS;
    if (k === '$effect') return EFFECTS;
    if (k === '$entity') return ENTITIES;
    return [];
  }
  window.cmdSuggest = suggest;
})();
