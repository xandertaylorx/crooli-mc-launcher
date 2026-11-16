// Home page: reveals, the top bar, release info, copy button and the time-of-day picker. Needs site.js first.

/* ---------------- headlines rise line by line ---------------- */
document.querySelectorAll('.display, .h2').forEach((h) => {
  const lines = [[]]
  for (const node of [...h.childNodes]) {
    if (node.nodeName === 'BR') lines.push([])
    else lines[lines.length - 1].push(node)
  }
  h.textContent = ''
  lines.forEach((nodes, i) => {
    const line = document.createElement('span')
    const inner = document.createElement('span')
    line.className = 'line'
    inner.className = 'line-in'
    inner.style.setProperty('--i', i)
    inner.append(...nodes)
    line.append(inner)
    h.append(line)
  })
  h.classList.add('split-lines')
})
setTimeout(() => $('.intro .display')?.classList.add('in'), 60)

/* ---------------- reveal on scroll ---------------- */
const clipped = '.step-art'
const revealables = document.querySelectorAll(`${clipped}, .split-lines:not(.intro .display), .facts, .step-text, .included > :not(.h2), .get > :not(.display)`)
const rio = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('in')
      rio.unobserve(e.target)
    }
  },
  { rootMargin: '0px 0px -8% 0px' },
)
revealables.forEach((el) => {
  el.classList.add('reveal')
  if (el.matches(clipped)) el.classList.add('clip')
  rio.observe(el)
})
// The observer only reports on rendered frames; this makes sure anything on screen appears regardless.
function revealVisible() {
  const pending = document.querySelectorAll('.reveal:not(.in)')
  for (const el of pending) {
    const r = el.getBoundingClientRect()
    if (r.top < innerHeight && r.bottom > 0) el.classList.add('in')
  }
  return pending.length
}
const revealTimer = setInterval(() => revealVisible() || clearInterval(revealTimer), 700)

/* ---------------- top bar frosts once the page scrolls ---------------- */
const topbar = $('.topbar')
const onScroll = () => {
  topbar.classList.toggle('stuck', scrollY > 8)
  revealVisible()
}
addEventListener('scroll', onScroll, { passive: true })
onScroll()

/* ---------------- downloads ----------------
   Picks the installer for the visitor's system from the latest GitHub release. With no release yet,
   the button points at the repository and the note explains running from source. */
const ua = navigator.userAgent || ''
const isMac = /Mac/i.test(ua)
const isWin = /Windows/i.test(ua)
const osName = isMac ? 'macOS' : isWin ? 'Windows' : null

function showRelease(rel) {
  const files = rel.assets || []
  const dmg = files.find((a) => /arm64.*\.dmg$/i.test(a.name)) || files.find((a) => /\.dmg$/i.test(a.name))
  const exe = files.find((a) => /\.exe$/i.test(a.name))
  const mine = isMac ? dmg : isWin ? exe : null
  const version = rel.tag_name.replace(/^v/, '')
  const dl = $('#dl-main')
  if (mine) {
    dl.href = mine.browser_download_url
    dl.firstChild.textContent = `Download for ${osName} `
    $('#dl-size').textContent = fmtSize(mine.size)
    $('#hero-dl').textContent = `Download for ${osName}`
    $('#platform-note').textContent = `Version ${version}. Other systems are under All downloads.`
  } else {
    dl.href = rel.html_url
  }
}
function noRelease() {
  const dl = $('#dl-main')
  dl.href = 'https://github.com/xandertaylorx/crooli-mc-launcher'
  dl.firstChild.textContent = 'Get it on GitHub '
  $('#platform-note').innerHTML = 'There are no installers yet. Until the first release, run it from source with <a href="https://nodejs.org">Node.js</a>: paste the line above into a terminal.'
}
cachedJSON('crooli-launcher.release', `https://api.github.com/repos/${REPO}/releases/latest`).then(showRelease).catch(noRelease)
cachedJSON('crooli-launcher.repo', `https://api.github.com/repos/${REPO}`)
  .then((r) => r.stargazers_count >= 10 && ($('#stars').textContent = ` ★ ${short(r.stargazers_count)}`))
  .catch(() => {})

/* ---------------- copy button ---------------- */
document.querySelectorAll('[data-copy]').forEach((btn) => {
  const label = btn.querySelector('.lbl') || btn
  const original = label.textContent
  btn.addEventListener('click', async () => {
    const target = $(btn.dataset.copy)
    try {
      await navigator.clipboard.writeText(target.textContent)
      label.textContent = 'Copied'
    } catch {
      const range = document.createRange()
      range.selectNodeContents(target)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
      label.textContent = isMac ? 'Press ⌘C' : 'Press Ctrl+C'
    }
    setTimeout(() => (label.textContent = original), 1800)
  })
})

/* ---------------- day, dusk, night ----------------
   Starts on the visitor's own time of day, the way the launcher does. */
const skyImg = $('.sky-shot img')
const skyBtns = [...document.querySelectorAll('.seg button')]
function setSky(time, animate = true) {
  skyBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.time === time)))
  const src = skyImg.dataset[time]
  if (skyImg.getAttribute('src') === src) return
  if (!animate || reduceMotion) return void (skyImg.src = src)
  const next = new Image()
  next.src = src
  next.decode().catch(() => {}).then(() => {
    skyImg.classList.add('fade')
    setTimeout(() => {
      skyImg.src = src
      skyImg.classList.remove('fade')
    }, 200)
  })
}
skyBtns.forEach((b) => b.addEventListener('click', () => setSky(b.dataset.time)))
const hr = new Date().getHours()
setSky(hr < 5 || hr >= 21 ? 'night' : hr >= 18 ? 'dusk' : 'day', false)

/* ---------------- screenshots tilt toward the pointer ---------------- */
if (!reduceMotion && matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('.step-art').forEach((art) => {
    const win = art.querySelector('.shot')
    art.addEventListener('pointermove', (e) => {
      const r = art.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      win.style.transform = `perspective(1600px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)`
    })
    art.addEventListener('pointerleave', () => (win.style.transform = ''))
  })
}
