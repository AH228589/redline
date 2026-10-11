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

export async function runAutotest() {
  const duration = Number(import.meta.env.VITE_AUTOTEST_SECONDS || 240) * 1000
  await until(() => ready.value, 20000)
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
    ok: s.time.length > 20 && maxGap < 20,
    points: s.time.length,
    km: +(act.summary.distance / 1000).toFixed(3),
    movingMin: +(act.summary.movingTime / 60).toFixed(1),
    maxGapSec: +maxGap.toFixed(1),
    eleSource: s.eleSource,
    ...rec.debugStats,
  })
}
