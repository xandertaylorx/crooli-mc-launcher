// /downloads: the right installer for this computer, plus every release from GitHub. Needs site.js first.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// Which installer each file is. Names changed between versions, so match loosely.
function filesOf(rel) {
  const all = (rel.assets || []).filter((a) => !/\.(blockmap|yml)$/i.test(a.name))
  return {
    'mac-arm': all.find((a) => /arm64.*\.dmg$/i.test(a.name)),
    'mac-intel': all.find((a) => /(x64|intel).*\.dmg$/i.test(a.name)) || all.find((a) => /\.dmg$/i.test(a.name) && !/arm64/i.test(a.name)),
    windows: all.find((a) => /\.exe$/i.test(a.name)),
  }
}
const LABEL = { 'mac-arm': 'Mac (Apple Silicon)', 'mac-intel': 'Mac (Intel)', windows: 'Windows' }

/* ---------------- which computer is this? ----------------
   Windows is easy. For Macs, browsers don't say the chip outright: Chrome can tell us via client hints,
   and the graphics renderer name gives it away elsewhere. When unsure, assume Apple Silicon. */
async function detectOS() {
  const ua = navigator.userAgent || ''
  if (/Windows/i.test(ua)) return 'windows'
  if (!/Mac/i.test(ua)) return null
  try {
    const hints = await navigator.userAgentData?.getHighEntropyValues(['architecture'])
    if (hints?.architecture) return hints.architecture === 'arm' ? 'mac-arm' : 'mac-intel'
  } catch {}
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''
    if (/Intel|AMD|Radeon/i.test(r)) return 'mac-intel'
  } catch {}
  return 'mac-arm'
}

/* ---------------- release notes: a little markdown ----------------
   Text is escaped before any markup is added, so nothing in a release body can inject HTML. */
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
}
function notes(md) {
  const out = []
  let list = null
  const flush = () => list && (out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`), (list = null))
  for (const raw of (md || '').split(/\r?\n/)) {
    const line = raw.trim()
    const item = line.match(/^[-*] (.*)$/)
    if (item) (list ||= []).push(item[1])
    else if (!line) flush()
    else {
      flush()
      // A line that's only bold text is a heading, like "**Fixed**"
      const head = line.match(/^\*\*(.+)\*\*$/)
      out.push(head ? `<h4>${inline(head[1])}</h4>` : `<p>${inline(line)}</p>`)
    }
  }
  flush()
  return out.join('')
}
// The "Downloads" and "First launch" parts of each body are covered by the page itself.
const trimNotes = (md) => (md || '').split(/\r?\n\*\*(Downloads|First launch)\*\*/)[0]

function fileChip(key, a) {
  return `<a class="file" href="${esc(a.browser_download_url)}"><svg class="ico"><use href="#dl"/></svg><span>${LABEL[key]}</span><small>${fmtSize(a.size)}</small></a>`
}

function releaseRow(rel, i) {
  const v = rel.tag_name.replace(/^v/, '')
  const f = filesOf(rel)
  const chips = Object.entries(f).filter(([, a]) => a).map(([k, a]) => fileChip(k, a)).join('')
  return `
  <li class="rel" id="v${esc(v)}">
    <div class="rel-head">
      <a class="rel-ver" href="#v${esc(v)}">${esc(v)}</a>
      <time datetime="${esc(rel.published_at)}">${fmtDate(rel.published_at)}</time>
      ${i === 0 ? '<span class="tag">Latest</span>' : ''}
    </div>
    <div class="rel-body">${notes(trimNotes(rel.body)) || '<p class="dim">No notes for this version.</p>'}</div>
    <div class="files">${chips || `<a class="file" href="${esc(rel.html_url)}">View on GitHub</a>`}</div>
  </li>`
}

async function main() {
  const osPromise = detectOS()
  let rels = []
  try {
    rels = (await cachedJSON('crooli-launcher.releases', `https://api.github.com/repos/${REPO}/releases?per_page=50`)).filter((r) => !r.draft && !r.prerelease)
  } catch {}
  const os = await osPromise

  // Point out this computer's card.
  if (os) {
    const mine = document.querySelector(`.platform[data-os="${os}"]`)
    mine.classList.add('mine')
    mine.insertAdjacentHTML('afterbegin', '<span class="tag">Your computer</span>')
  }

  if (!rels.length) {
    $('#releases').innerHTML = ''
    $('#rel-note').innerHTML = `Couldn’t reach GitHub just now. <a href="https://github.com/${REPO}/releases">See every release on GitHub</a>.`
    return
  }

  const latest = rels[0]
  const v = latest.tag_name.replace(/^v/, '')
  $('#ver-num').textContent = v
  $('#ver-date').textContent = fmtDate(latest.published_at)
  $('#ver').href = `#v${v}`
  $('#ver').hidden = false

  const f = filesOf(latest)
  document.querySelectorAll('.platform').forEach((card) => {
    const a = f[card.dataset.os]
    const btn = card.querySelector('[data-file]')
    const meta = card.querySelector('[data-meta]')
    if (a) {
      btn.href = a.browser_download_url
      meta.textContent = `Version ${v}, ${fmtSize(a.size)}`
    } else {
      // Windows builds a few minutes after a release goes out.
      btn.href = `#v${v}`
      btn.lastChild.textContent = 'See the release notes'
      meta.textContent = card.dataset.os === 'windows' ? `The ${v} installer is still building. Check back in a few minutes.` : `Not built for ${v}.`
    }
  })

  $('#releases').innerHTML = rels.map(releaseRow).join('')
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }))
}
main()

/* ---------------- copy buttons and the top bar ---------------- */
document.querySelectorAll('[data-copy]').forEach((btn) => {
  const label = btn.querySelector('.lbl')
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($(btn.dataset.copy).textContent)
      label.textContent = 'Copied'
    } catch {
      label.textContent = /Mac/i.test(navigator.userAgent) ? 'Press ⌘C' : 'Press Ctrl+C'
    }
    setTimeout(() => (label.textContent = 'Copy'), 1800)
  })
})
const topbar = $('.topbar')
addEventListener('scroll', () => topbar.classList.toggle('stuck', scrollY > 8), { passive: true })
