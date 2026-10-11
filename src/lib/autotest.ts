// Automated recording run used by the simulator/emulator tests in CI.
// Only bundled when the app is built with VITE_AUTOTEST=1; never in releases.
import * as rec from './recorder'
import { go } from './router'
import { activities, addActivity, buildActivity, ready } from './store'

const log = (tag: string, data?: unknown) => console.log(`[AUTOTEST] ${tag}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, ms: number) {
  const end = Date.now() + ms
  while (!cond() && Date.now() < end) await sleep(500)
  return cond()
}

/** Which ways of starting a web worker work in this WebView, and how the map worker file is served. */
async function workerDiagnostics() {
  const out: Record<string, unknown> = { origin: location.origin, href: location.href, secure: isSecureContext }
  const tryWorker = (label: string, make: () => Worker) =>
    new Promise<void>((resolve) => {
      let w: Worker | null = null
      const done = (v: unknown) => {
        out[label] = v
        w?.terminate()
        resolve()
      }
      try {
        w = make()
        w.onmessage = (e) => done(`ok:${e.data}`)
        w.onerror = (e) => done(`error:${(e as ErrorEvent).message || 'unknown'}`)
        setTimeout(() => done('timeout'), 8000)
      } catch (e) {
        done(`throw:${String(e)}`)
      }
    })
  out.sincePageLoadMs = Math.round(performance.now())
  const code = 'self.postMessage("hi")'
  const blob = (type: string) => URL.createObjectURL(new Blob([code], { type }))
  await tryWorker('classicBlob', () => new Worker(blob('text/javascript')))
  await tryWorker('moduleBlob', () => new Worker(blob('text/javascript'), { type: 'module' }))
  await tryWorker('dataUrl', () => new Worker(`data:text/javascript,${encodeURIComponent(code)}`))
  await tryWorker('jsFile', () => new Worker('/worker-probe.js'))
  out.workerType = typeof Worker
  const { default: workerUrl } = await import('maplibre-gl/dist/maplibre-gl-worker.mjs?url')
  out.workerUrl = workerUrl
  try {
    const r = await fetch(workerUrl)
    const text = await r.text()
    out.fetch = { status: r.status, type: r.headers.get('content-type'), bytes: text.length, head: text.slice(0, 60) }
    const big = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
    await tryWorker('mapWorkerBlob', () => new Worker(big, { type: 'module' }))
  } catch (e) {
    out.fetch = `throw:${String(e)}`
  }
  await tryWorker('mapWorkerDirect', () => new Worker(workerUrl, { type: 'module' }))
  log('workers', out)
}

export async function runAutotest() {
  const duration = Number(import.meta.env.VITE_AUTOTEST_SECONDS || 240) * 1000
  await until(() => ready.value, 20000)
  if (import.meta.env.VITE_AUTOTEST_PROBE === '1') {
    // Load the minimal worker probe page on this same origin, in a fresh document.
    log('probe-nav', { origin: location.origin })
    location.href = '/probe.html'
    return
  }
  await workerDiagnostics().catch((e) => log('workers', { error: String(e) }))
  if (import.meta.env.VITE_AUTOTEST_QUICK === '1') {
    // Quick mode: open the record screen, check the map, stop.
    go('/record')
    await sleep(25000)
    const m = (window as unknown as { __map?: { loaded(): boolean; areTilesLoaded(): boolean; isStyleLoaded(): boolean; queryRenderedFeatures(): unknown[]; getZoom(): number } }).__map
    try {
      log('map', m ? { loaded: m.loaded(), style: m.isStyleLoaded(), tiles: m.areTilesLoaded(), features: m.queryRenderedFeatures().length, zoom: +m.getZoom().toFixed(1) } : { none: true })
    } catch (e) {
      log('map', { error: String(e) })
    }
    log('result', { ok: true, quick: true })
    return
  }
  log('boot', { ua: navigator.userAgent, state: rec.live.value.state })
  if (activities.value.some((a) => a.name === 'Autotest run')) {
    log('done already')
    return
  }
  await sleep(1500) // give autoResume a moment
  let t0: number
  if (rec.live.value.state !== 'idle' && rec.live.value.startedAt) {
    // The web layer was restarted mid-run and the recording resumed itself.
    t0 = rec.live.value.startedAt
    log('resumed', { pts: rec.live.value.points, km: +(rec.live.value.distance / 1000).toFixed(3) })
  } else {
    go('/record')
    if (!(await until(() => !!rec.gps.value, 120000))) {
      log('result', { ok: false, reason: 'no GPS fix', error: rec.gpsError.value })
      return
    }
    log('fix', rec.gps.value)
    rec.setSport('run')
    rec.start()
    t0 = Date.now()
    log('started')
  }
  let mapChecked = false
  const timer = setInterval(() => {
    const m = (window as unknown as { __map?: { loaded(): boolean; areTilesLoaded(): boolean; queryRenderedFeatures(): unknown[]; getZoom(): number } }).__map
    if (!mapChecked && m && Date.now() - t0 > 20000 && document.visibilityState === 'visible') {
      mapChecked = true
      try {
        log('map', { loaded: m.loaded(), tiles: m.areTilesLoaded(), features: m.queryRenderedFeatures().length, zoom: +m.getZoom().toFixed(1) })
      } catch (e) {
        log('map', { error: String(e) })
      }
    }
    const L = rec.live.value
    log('tick', { s: Math.round((Date.now() - t0) / 1000), state: L.state, pts: L.points, km: +(L.distance / 1000).toFixed(3), vis: document.visibilityState, cad: L.cadence, ...rec.debugStats })
  }, 5000)
  // Wall-clock wait so a throttled background timer cannot cut the run short.
  while (Date.now() - t0 < duration) await sleep(1000)
  clearInterval(timer)
  rec.pause()
  const s = rec.finish()
  if (!s) {
    log('result', { ok: false, reason: 'no track' })
    return
  }
  let maxGap = 0
  for (let i = 1; i < s.time.length; i++) maxGap = Math.max(maxGap, (s.time[i] - s.time[i - 1]) / 1000)
  const act = buildActivity(s, 'run', 'Autotest run', { source: 'recorded' })
  await addActivity(act, s)
  go(`/activity/${act.id}`)
  log('result', {
    ok: s.time.length > 20 && maxGap < 30,
    points: s.time.length,
    km: +(act.summary.distance / 1000).toFixed(3),
    movingMin: +(act.summary.movingTime / 60).toFixed(1),
    maxGapSec: +maxGap.toFixed(1),
    eleSource: s.eleSource,
    ...rec.debugStats,
  })
}
