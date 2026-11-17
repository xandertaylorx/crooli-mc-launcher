// The website's browse page: mods, shaders and resource packs live from Modrinth, and worlds from worlds.json.
// (wrapped so it doesn't clash with the helpers in site.js)
;(() => {
const API = 'https://api.modrinth.com/v2'
const $ = (s) => document.querySelector(s)
const nf = new Intl.NumberFormat(undefined, { notation: 'compact' })
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props)
  kids.flat().filter((k) => k != null && k !== false).forEach((k) => e.append(k))
  return e
}

const SORTS = {
  modrinth: [['relevance', 'Best match'], ['downloads', 'Most downloaded'], ['follows', 'Most followed'], ['newest', 'Newest'], ['updated', 'Recently updated']],
  world: [['downloads', 'Most downloaded'], ['updated', 'Newest'], ['name', 'Name, A to Z'], ['size', 'Smallest first'], ['stars', 'Most starred'], ['mc', 'Newest Minecraft version']],
}
const NOTES = {
  mod: 'Live from Modrinth. In the launcher, installing a mod also adds the mods it needs and checks that your set still works together.',
  shader: 'Live from Modrinth. Shader packs run through Iris, which the launcher installs for you the first time.',
  resourcepack: 'Live from Modrinth. The launcher turns a pack on when it installs it.',
  world: 'Open-licensed worlds from GitHub, each checked: a real Java world, with its size and checksum. The launcher downloads one straight into an installation.',
}
const TYPE_PATH = { mod: 'mod', shader: 'shader', resourcepack: 'resourcepack' }
const PAGE = 24

const state = { kind: new URLSearchParams(location.search).get('kind') || 'mod', offset: 0, total: 0, worlds: null, seq: 0 }
if (!['mod', 'shader', 'resourcepack', 'world'].includes(state.kind)) state.kind = 'mod'

const verNum = (v) => { const p = String(v).split(/[.-]/).map((x) => parseInt(x, 10)); return (p[0] || 0) * 1e6 + (p[1] || 0) * 1e3 + (p[2] || 0) }
const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 1.05e7 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

async function loadVersions() {
  try {
    const res = await fetch(`${API}/tag/game_version`)
    const list = (await res.json()).filter((v) => v.version_type === 'release').sort((a, b) => new Date(b.date) - new Date(a.date))
    const sel = $('#m-version')
    list.forEach((v) => sel.append(el('option', { value: v.version, textContent: v.version })))
  } catch {}
}

function setKind(kind) {
  state.kind = kind
  document.querySelectorAll('#kinds button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)))
  $('#m-q').placeholder = kind === 'world' ? 'Search worlds' : `Search ${kind === 'mod' ? 'mods' : kind === 'shader' ? 'shaders' : 'resource packs'}`
  $('#m-loader-wrap').hidden = kind !== 'mod'
  $('#m-show-wrap').hidden = kind !== 'world'
  const sort = $('#m-sort'), list = kind === 'world' ? SORTS.world : SORTS.modrinth
  sort.replaceChildren(...list.map(([v, t]) => el('option', { value: v, textContent: t })))
  $('#m-note').textContent = NOTES[kind]
  const u = new URL(location); u.searchParams.set('kind', kind); history.replaceState(null, '', u)
  run(true)
}

async function run(reset) {
  const seq = ++state.seq, box = $('#results'), more = $('#more')
  if (reset) { state.offset = 0; box.replaceChildren(el('p', { className: 'mempty', textContent: 'Loading…' })); more.hidden = true }
  try {
    const items = state.kind === 'world' ? await worldPage(reset) : await modrinthPage()
    if (seq !== state.seq) return
    if (reset) box.replaceChildren()
    if (reset && !items.length) box.append(el('p', { className: 'mempty', textContent: 'Nothing matches that. Try another word, version or loader.' }))
    items.forEach((c) => box.append(c))
    more.hidden = state.offset >= state.total
  } catch (e) {
    if (seq !== state.seq) return
    box.replaceChildren(el('p', { className: 'mempty', textContent: state.kind === 'world' ? 'Couldn’t load the worlds list.' : 'Couldn’t reach Modrinth. Check your connection and try again.' }))
  }
}

async function modrinthPage() {
  const version = $('#m-version').value, loader = $('#m-loader').value, q = $('#m-q').value.trim()
  const facets = [[`project_type:${state.kind}`]]
  if (state.kind === 'mod' && loader) facets.push((loader === 'quilt' ? ['quilt', 'fabric'] : [loader]).map((l) => `categories:${l}`))
  if (version) facets.push([`versions:${version}`])
  const url = `${API}/search?query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=${PAGE}&offset=${state.offset}&index=${$('#m-sort').value}`
  const r = await (await fetch(url)).json()
  state.total = r.total_hits; state.offset += r.hits.length
  return r.hits.map((h) => card({
    icon: h.icon_url, title: h.title, by: h.author, text: h.description,
    meta: [`${nf.format(h.downloads)} downloads`, `${nf.format(h.follows)} followers`], tags: h.display_categories.slice(0, 3),
    action: el('a', { className: 'btn ghost small', href: `https://modrinth.com/${TYPE_PATH[state.kind]}/${h.slug}`, target: '_blank', rel: 'noopener', textContent: 'View on Modrinth' }),
  }))
}

async function worldPage(reset) {
  if (!state.worlds) state.worlds = (await (await fetch('/worlds.json')).json()).worlds
  const q = $('#m-q').value.trim().toLowerCase(), version = $('#m-version').value, show = $('#m-show').value, sort = $('#m-sort').value
  let list = state.worlds.filter((w) => (!q || `${w.name} ${w.author} ${w.description}`.toLowerCase().includes(q)) && (!version || show === 'all' || verNum(w.mc) <= verNum(version)))
  const by = { downloads: (a, b) => b.downloads - a.downloads, updated: (a, b) => String(b.updated).localeCompare(String(a.updated)), name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => a.size - b.size, stars: (a, b) => b.stars - a.stars, mc: (a, b) => verNum(b.mc) - verNum(a.mc) }
  list.sort(by[sort] || by.downloads)
  state.total = list.length
  const page = list.slice(state.offset, state.offset + PAGE)
  state.offset += page.length
  return page.map((w) => card({
    icon: w.icon ? '/' + w.icon : null, title: w.name, by: w.author, text: w.description || 'A Minecraft world.',
    meta: [w.mcKnown ? `Minecraft ${w.mc}` : 'Before 1.9', sizeText(w.size), `${nf.format(w.downloads)} downloads`], tags: [w.license],
    action: el('div', { className: 'mactions' }, el('a', { className: 'btn dark small', href: w.url, rel: 'noopener', textContent: 'Download zip' }), el('a', { className: 'ulink', href: w.source, target: '_blank', rel: 'noopener', textContent: 'Source' })),
  }))
}

function card({ icon, title, by, text, meta, tags, action }) {
  return el('article', { className: 'mcard' },
    el('div', { className: 'mhead' },
      icon ? el('img', { src: icon, alt: '', loading: 'lazy', width: 56, height: 56 }) : el('div', { className: 'mph', 'aria-hidden': 'true' }),
      el('div', { className: 'mtitle' }, el('h3', { textContent: title }), el('p', { className: 'mby', textContent: `by ${by}` }))),
    el('p', { className: 'mtext', textContent: text }),
    el('p', { className: 'mmeta', textContent: meta.filter(Boolean).join(' · ') }),
    tags && tags.length ? el('div', { className: 'mtags' }, tags.map((t) => el('span', { className: 'tag src', textContent: t }))) : null,
    el('div', { className: 'mfoot' }, action))
}

let timer
$('#mbar').addEventListener('submit', (e) => { e.preventDefault(); run(true) })
$('#m-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(true), 320) })
for (const id of ['#m-version', '#m-loader', '#m-sort', '#m-show']) $(id).addEventListener('change', () => run(true))
$('#more').addEventListener('click', () => run(false))
document.querySelectorAll('#kinds button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)))
const topbar = document.querySelector('.topbar')
addEventListener('scroll', () => topbar.classList.toggle('stuck', scrollY > 8), { passive: true })
loadVersions().then(() => setKind(state.kind))
})()
