import { signal } from '@preact/signals'
import { buildStreams, type RawPoint } from './analyze'
import { beaconId, beaconSend, beaconState } from './beacon'
import * as db from './db'
import { cumulativeLL, haversine, nearestOnLine } from './geo'
import { SPORTS, sportGroup } from './sports'
import { activities, efforts, getStreams, segments, settings } from './store'
import { effortProfile } from './segments'
import type { Route, Segment, Sport, Streams } from './types'
import { fmtDuration, unitLen } from './units'
import { interp } from './geo'
import { askNotificationPermission, isNative, motionStart, nativeConnectHr, nativeSpeak, nativeStop, nativeWatch, type MotionEvent } from './native'

export type RecState = 'idle' | 'recording' | 'paused' | 'autopaused'

export interface Fix {
  lat: number
  lon: number
  acc: number
  alt: number | null
  speed: number | null
  heading: number | null
  t: number
}

export interface LiveSegment {
  id: string
  name: string
  distance: number
  progress: number
  elapsed: number
  delta: number | null // seconds vs PR at this point, positive = behind
  pr: number | null
}

export interface SegmentResult {
  name: string
  elapsed: number
  pr: number | null
  isPr: boolean
  at: number
}

export interface LiveStats {
  state: RecState
  sport: Sport
  startedAt: number | null
  elapsed: number
  moving: number
  distance: number
  speed: number
  avgSpeed: number
  ele: number | null
  gain: number
  hr: number | null
  splits: { distance: number; time: number }[]
  segment: LiveSegment | null
  segmentDone: SegmentResult | null
  route: { remaining: number; off: boolean; offBy: number } | null
  points: number
  cadence: number | null
}

const initial = (sport: Sport): LiveStats => ({
  state: 'idle', sport, startedAt: null, elapsed: 0, moving: 0, distance: 0, speed: 0, avgSpeed: 0, ele: null, gain: 0,
  hr: null, splits: [], segment: null, segmentDone: null, route: null, points: 0, cadence: null,
})

export const gps = signal<Fix | null>(null)
export const gpsError = signal<string | null>(null)
export const live = signal<LiveStats>(initial('run'))
export const hrNow = signal<number | null>(null)
export const hrDevice = signal<string | null>(null)
/** Whether the screen is being kept awake: 'on', 'off' (lost, e.g. phone locked) or 'unsupported'. */
export const wakeState = signal<'on' | 'off' | 'unsupported'>('off')
/** Set when the page comes back after GPS was cut off in the background. */
export const bgGap = signal<{ seconds: number; at: number } | null>(null)

// ---------- recording state ----------
let pts: RawPoint[] = []
let dist = 0
let movingMs = 0
let lastTick = 0
let gain = 0
let eleAnchor: number | null = null
// Phone sensors (installed app only).
let cadNow: { v: number; t: number } | null = null
let baroRel: number | null = null // metres relative to where the barometer started
let baroBase: number | null = null // absolute level the barometer track hangs from
let baroResumeBase: number | null = null
let stopMotion: (() => void) | null = null

/** Counters for diagnosing background delivery (shown nowhere, read by tests). */
export const debugStats = { fixes: 0, hiddenFixes: 0, maxLagMs: 0 }

function onMotion(e: MotionEvent) {
  if (e.type === 'steps') {
    if (e.cadence != null && isFinite(e.cadence)) cadNow = { v: e.cadence, t: Date.now() }
    return
  }
  if (baroBase == null) baroBase = baroResumeBase ?? gps.value?.alt ?? 0
  baroRel = e.relativeAltitude
}

async function startSensors() {
  stopMotion?.()
  stopMotion = await motionStart(onMotion)
}
let splits: { distance: number; time: number }[] = []
let lastAccepted: Fix | null = null
let prevFix: Fix | null = null
let watchId: number | null = null
let tickTimer = 0
let saveTimer = 0
let wakeLock: WakeLock | null = null
let slowSince: number | null = null
let route: { r: Route; cum: number[]; total: number; offCount: number; off: boolean } | null = null
let segState: { seg: Segment; startDist: number; startT: number; startIdx: number; pr: number | null; ghost: { dist: number[]; time: number[] } | null; strays: number } | null = null
let segDone: SegmentResult | null = null
let recentSegs = new Map<string, number>() // segment id -> time it last finished, avoids instant re-trigger

export function speak(text: string) {
  if (!settings.value.voiceCues) return
  // The app speaks through the OS so cues still play with the screen locked.
  if (isNative) {
    nativeSpeak(text).catch(() => {})
    return
  }
  if (!('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.05
    speechSynthesis.speak(u)
  } catch {
    /* ignore */
  }
}

const buzz = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p)
  } catch {
    /* ignore */
  }
}

function spokenDuration(sec: number) {
  sec = Math.round(sec)
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return [h && `${h} hour${h > 1 ? 's' : ''}`, m && `${m} minute${m > 1 ? 's' : ''}`, s && `${s} second${s > 1 ? 's' : ''}`].filter(Boolean).join(' ') || '0 seconds'
}

// ---------- GPS ----------
const nativeError = (msg: string) => (gpsError.value = msg)

export function startGps() {
  if (isNative) {
    nativeWatch(live.value.state !== 'idle', onFix, nativeError)
    return
  }
  if (watchId != null) return
  if (!('geolocation' in navigator)) {
    gpsError.value = 'This browser has no GPS access.'
    return
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      gpsError.value = null
      const c = pos.coords
      onFix({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, speed: c.speed, heading: c.heading, t: pos.timestamp || Date.now() })
    },
    (err) => {
      gpsError.value = err.code === 1 ? 'Location permission denied. Allow location for this site to record.' : 'Waiting for GPS signal...'
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  )
}

export function stopGps() {
  if (live.value.state !== 'idle') return
  if (isNative) {
    nativeStop()
    return
  }
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
}

/** Feed a fix (also used by the dev simulator). */
export function onFix(f: Fix) {
  gps.value = f
  gpsError.value = null
  const L = live.value
  if (L.state === 'idle' || L.state === 'paused') return
  debugStats.fixes++
  if (document.visibilityState === 'hidden') debugStats.hiddenFixes++
  debugStats.maxLagMs = Math.max(debugStats.maxLagMs, Date.now() - f.t)
  if (f.acc > 40) return
  const thr = SPORTS[L.sport].movingThreshold || 0.4
  const prev = prevFix
  prevFix = f
  if (lastAccepted) {
    const step = haversine(lastAccepted.lat, lastAccepted.lon, f.lat, f.lon)
    const dt = Math.max(0.5, (f.t - lastAccepted.t) / 1000)
    const v = step / dt
    const maxV = sportGroup(L.sport) === 'bike' ? 30 : 12
    if (v > maxV && dt < 30) return // spike
    // Auto-pause on sustained low speed, judged fix to fix.
    if (settings.value.autoPause && thr > 0) {
      const pdt = prev ? Math.max(0.5, (f.t - prev.t) / 1000) : dt
      const sp = f.speed != null && f.speed >= 0 ? f.speed : prev ? haversine(prev.lat, prev.lon, f.lat, f.lon) / pdt : v
      if (sp < thr * 0.8) {
        slowSince ??= f.t
        if (L.state === 'recording' && f.t - slowSince > 6000) {
          setState('autopaused')
          return
        }
      } else {
        slowSince = null
        if (L.state === 'autopaused' && step > Math.max(6, f.acc * 0.5)) setState('recording')
      }
    }
    if (live.value.state === 'autopaused') return
    // Ignore jitter while standing still.
    if (step < Math.max(1.5, f.acc * 0.25) && dt < 5) return
    dist += step
  }
  lastAccepted = f
  // The barometer is far steadier than GPS altitude, so prefer it when the phone has one.
  const ele = baroRel != null ? (baroBase ?? 0) + baroRel : (f.alt ?? undefined)
  const step = baroRel != null ? 1 : 4
  if (ele != null) {
    if (eleAnchor == null) eleAnchor = ele
    else if (ele - eleAnchor >= step) { gain += ele - eleAnchor; eleAnchor = ele }
    else if (eleAnchor - ele >= step) eleAnchor = ele
  }
  const cad = sportGroup(L.sport) === 'foot' && cadNow && Date.now() - cadNow.t < 15000 ? cadNow.v : undefined
  pts.push({ time: f.t, lat: f.lat, lon: f.lon, ele, hr: hrNow.value ?? undefined, cad, dist })
  checkSplit()
  checkRoute(f)
  checkSegments(f)
  if (beaconId.value) beaconSend({ t: f.t, lat: f.lat, lon: f.lon, dist, moving: movingMs / 1000 })
  refresh()
}

function checkSplit() {
  const unit = unitLen()
  const next = (splits.length + 1) * unit
  if (dist < next) return
  const prevTime = splits.reduce((a, s) => a + s.time, 0)
  const time = movingMs / 1000 - prevTime
  splits.push({ distance: unit, time })
  const n = splits.length
  const u = settings.value.units === 'imperial' ? 'mile' : 'kilometer'
  const avgPace = (movingMs / 1000 / dist) * unit
  const g = sportGroup(live.value.sport)
  if (g === 'bike') speak(`${n} ${u}${n > 1 ? 's' : ''}. Split ${spokenDuration(time)}. Average speed ${((dist / (movingMs / 1000)) * (u === 'mile' ? 2.236936 : 3.6)).toFixed(1)}.`)
  else speak(`${n} ${u}${n > 1 ? 's' : ''}. Split ${spokenDuration(time)}. Average pace ${spokenDuration(avgPace)} per ${u}.`)
  buzz(200)
}

function checkRoute(f: Fix) {
  if (!route) return
  const { dist: off, along } = nearestOnLine([f.lon, f.lat], route.r.geometry, route.cum)
  if (off > 50) route.offCount++
  else route.offCount = 0
  const wasOff = route.off
  route.off = route.offCount >= 3
  if (route.off && !wasOff) { speak('Off route'); buzz([300, 150, 300]) }
  if (!route.off && wasOff) speak('Back on route')
  live.value = { ...live.value, route: { remaining: Math.max(0, route.total - along), off: route.off, offBy: off } }
}

function checkSegments(f: Fix) {
  const here: [number, number] = [f.lon, f.lat]
  if (segState) {
    const s = segState
    const progress = dist - s.startDist
    const seg = s.seg
    const end = seg.points[seg.points.length - 1]
    const toEnd = haversine(f.lat, f.lon, end[1], end[0])
    const away = nearestOnLine(here, seg.points).dist
    s.strays = away > 60 ? s.strays + 1 : 0
    if (s.strays > 4 || progress > seg.distance * 1.5 + 200) {
      segState = null
      return
    }
    if (toEnd < 25 && progress > seg.distance * 0.85 - 50) {
      const elapsed = (f.t - s.startT) / 1000
      const isPr = s.pr == null || elapsed < s.pr
      segDone = { name: seg.name, elapsed, pr: s.pr, isPr, at: Date.now() }
      recentSegs.set(seg.id, Date.now())
      speak(`${seg.name} complete. ${spokenDuration(elapsed)}.${isPr && s.pr != null ? ' New personal record!' : s.pr != null ? ` ${spokenDuration(elapsed - s.pr)} off your record.` : ''}`)
      buzz([200, 100, 200, 100, 400])
      segState = null
    }
    return
  }
  const g = sportGroup(live.value.sport)
  for (const seg of segments.value) {
    if (seg.group !== g) continue
    const st = seg.points[0]
    if (haversine(f.lat, f.lon, st[1], st[0]) > 25) continue
    if (Date.now() - (recentSegs.get(seg.id) || 0) < 120000) continue
    const mine = efforts.value.filter((e) => e.segmentId === seg.id).sort((a, b) => a.elapsed - b.elapsed)
    const pr = mine[0]?.elapsed ?? null
    segState = { seg, startDist: dist, startT: f.t, startIdx: pts.length - 1, pr, ghost: null, strays: 0 }
    speak(`Segment ahead. ${seg.name}.${pr ? ` Your record is ${spokenDuration(pr)}.` : ''}`)
    buzz(150)
    if (mine[0]) {
      const best = mine[0]
      const st0 = segState
      getStreams(best.activityId).then((s) => {
        if (s && segState === st0) st0.ghost = effortProfile(s, best)
      })
    }
    break
  }
}

function setState(state: RecState) {
  live.value = { ...live.value, state }
  if (beaconId.value) beaconState(state)
  if (state === 'autopaused') buzz(100)
}

function refresh() {
  const L = live.value
  const now = Date.now()
  const elapsed = L.startedAt ? (now - L.startedAt) / 1000 : 0
  const moving = movingMs / 1000
  // Current speed from the last ~10 s of points.
  let speed = 0
  if (pts.length > 1 && L.state === 'recording') {
    const last = pts[pts.length - 1]
    let k = pts.length - 2
    while (k > 0 && last.time - pts[k].time < 10000) k--
    const dt = (last.time - pts[k].time) / 1000
    if (dt > 0 && now - last.time < 15000) speed = (last.dist! - pts[k].dist!) / dt
  }
  let segment: LiveSegment | null = null
  if (segState) {
    const progress = Math.max(0, dist - segState.startDist)
    const el = (now - segState.startT) / 1000
    let delta: number | null = null
    if (segState.ghost && segState.ghost.dist.length > 1) delta = el - interp(segState.ghost.dist, segState.ghost.time, progress)
    segment = { id: segState.seg.id, name: segState.seg.name, distance: segState.seg.distance, progress, elapsed: el, delta, pr: segState.pr }
  }
  live.value = {
    ...L,
    elapsed,
    moving,
    distance: dist,
    speed,
    avgSpeed: moving > 0 ? dist / moving : 0,
    ele: baroRel != null ? (baroBase ?? 0) + baroRel : (lastAccepted?.alt ?? null),
    gain,
    hr: hrNow.value,
    splits: splits.slice(),
    segment,
    segmentDone: segDone && now - segDone.at < 20000 ? segDone : null,
    points: pts.length,
    cadence: sportGroup(L.sport) === 'foot' && cadNow && now - cadNow.t < 15000 ? cadNow.v : null,
  }
}

function tick() {
  const now = performance.now()
  if (live.value.state === 'recording') movingMs += now - lastTick
  lastTick = now
  refresh()
}

async function lockScreen() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } }
    if (!nav.wakeLock) {
      wakeState.value = 'unsupported'
      return
    }
    if (document.visibilityState !== 'visible') return
    wakeLock = await nav.wakeLock.request('screen')
    wakeState.value = 'on'
    wakeLock.addEventListener?.('release', () => {
      if (live.value.state !== 'idle') wakeState.value = 'off'
    })
  } catch {
    wakeLock = null
    wakeState.value = 'off'
  }
}

interface WakeLock {
  release: () => Promise<void>
  addEventListener?: (t: 'release', cb: () => void) => void
}

let hiddenAt: number | null = null
document.addEventListener('visibilitychange', () => {
  if (live.value.state === 'idle' || isNative) return
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now()
    return
  }
  lockScreen()
  // Browsers stop location updates while the page is hidden; tell the user what happened.
  if (hiddenAt && Date.now() - hiddenAt > 15000) bgGap.value = { seconds: (Date.now() - hiddenAt) / 1000, at: Date.now() }
  hiddenAt = null
})

// ---------- public controls ----------
export function setSport(sport: Sport) {
  live.value = { ...live.value, sport }
}

export function followRoute(r: Route | null) {
  route = r ? { r, cum: cumulativeLL(r.geometry), total: r.distance, offCount: 0, off: false } : null
  live.value = { ...live.value, route: r ? { remaining: r.distance, off: false, offBy: 0 } : null }
}

export const followedRoute = () => route?.r ?? null

export function start() {
  pts = []
  dist = 0
  movingMs = 0
  gain = 0
  eleAnchor = null
  cadNow = null
  baroRel = null
  baroBase = null
  baroResumeBase = null
  debugStats.fixes = debugStats.hiddenFixes = debugStats.maxLagMs = 0
  splits = []
  lastAccepted = null
  slowSince = null
  segState = null
  segDone = null
  recentSegs = new Map()
  lastTick = performance.now()
  live.value = { ...initial(live.value.sport), state: 'recording', startedAt: Date.now(), route: live.value.route }
  if (gps.value && gps.value.acc <= 40 && Date.now() - gps.value.t < 10000) onFix({ ...gps.value, t: Date.now() })
  clearInterval(tickTimer)
  tickTimer = window.setInterval(tick, 1000)
  clearInterval(saveTimer)
  saveTimer = window.setInterval(persist, 15000)
  if (isNative) {
    // Background mode: the OS keeps delivering fixes while the phone is locked.
    nativeWatch(true, onFix, nativeError)
    askNotificationPermission()
    startSensors()
  } else lockScreen()
  speak('Recording started')
}

export function pause() {
  if (live.value.state === 'idle') return
  tick()
  setState('paused')
  speak('Paused')
}

export function resume() {
  lastTick = performance.now()
  slowSince = null
  lastAccepted = null // do not count the distance covered while paused
  setState('recording')
  speak('Resumed')
}

/** Stop and hand back the track. The caller saves or discards it. */
export function finish(): Streams | null {
  tick()
  clearInterval(tickTimer)
  clearInterval(saveTimer)
  wakeLock?.release().catch(() => {})
  wakeLock = null
  wakeState.value = 'off'
  bgGap.value = null
  if (isNative) nativeWatch(false, onFix, nativeError)
  stopMotion?.()
  stopMotion = null
  const usedBaro = baroRel != null
  const s = pts.length >= 2 ? buildStreams(pts) : null
  if (s) {
    if (isNative) s.cadUnit = 'spm'
    s.eleSource = usedBaro ? 'baro' : 'gps'
  }
  const sport = live.value.sport
  live.value = { ...initial(sport), route: live.value.route }
  db.kvDel('recording')
  return s
}

/** Timer-only activity (no GPS), e.g. gym or treadmill. */
export function timedSummary() {
  return { moving: movingMs / 1000, started: live.value.startedAt ?? Date.now() }
}

async function persist() {
  if (live.value.state === 'idle') return
  await db.kvSet('recording', { pts, dist, movingMs, gain, splits, sport: live.value.sport, startedAt: live.value.startedAt, savedAt: Date.now() })
}

export interface SavedRecording {
  pts: RawPoint[]
  dist: number
  movingMs: number
  gain: number
  splits: { distance: number; time: number }[]
  sport: Sport
  startedAt: number
  savedAt: number
}

export const pendingRecording = () => db.kvGet<SavedRecording>('recording')

/** Resume a recording interrupted by a reload or crash. */
export function restore(r: SavedRecording) {
  pts = r.pts
  dist = r.dist
  movingMs = r.movingMs
  gain = r.gain
  splits = r.splits
  lastAccepted = null
  segState = null
  lastTick = performance.now()
  live.value = { ...initial(r.sport), state: 'paused', startedAt: r.startedAt }
  baroRel = null
  baroBase = null
  // Continue the barometric profile from where the interrupted recording left off.
  baroResumeBase = [...r.pts].reverse().find((p) => p.ele != null)?.ele ?? null
  if (isNative) {
    nativeWatch(true, onFix, nativeError)
    startSensors()
  }
  clearInterval(tickTimer)
  tickTimer = window.setInterval(tick, 1000)
  clearInterval(saveTimer)
  saveTimer = window.setInterval(persist, 15000)
  refresh()
}

/** The live track split where GPS dropped out, plus straight connectors across each gap. */
export function trackParts() {
  const solid: [number, number][][] = [[]]
  const gaps: [number, number][][] = []
  let prev: RawPoint | null = null
  for (const p of pts) {
    if (p.lon == null || p.lat == null) continue
    if (prev && p.time - prev.time > 25000 && haversine(prev.lat!, prev.lon!, p.lat, p.lon) > 120) {
      gaps.push([[prev.lon!, prev.lat!], [p.lon, p.lat]])
      solid.push([])
    }
    solid[solid.length - 1].push([p.lon, p.lat])
    prev = p
  }
  return { solid: solid.filter((l) => l.length > 1), gaps, first: pts.find((p) => p.lon != null) }
}

// ---------- heart rate strap: OS Bluetooth in the app, Web Bluetooth on the website ----------
export async function connectHr() {
  if (isNative) {
    hrDevice.value = await nativeConnectHr(
      (bpm) => (hrNow.value = bpm),
      () => {
        hrDevice.value = null
        hrNow.value = null
      },
    )
    return
  }
  const bt = (navigator as Navigator & { bluetooth?: { requestDevice: (o: unknown) => Promise<BtDevice> } }).bluetooth
  if (!bt) throw new Error('Bluetooth is not available in this browser. Chrome on Android or desktop supports it.')
  const dev = await bt.requestDevice({ filters: [{ services: ['heart_rate'] }] })
  const server = await dev.gatt.connect()
  const svc = await server.getPrimaryService('heart_rate')
  const ch = await svc.getCharacteristic('heart_rate_measurement')
  await ch.startNotifications()
  ch.addEventListener('characteristicvaluechanged', (ev: Event) => {
    const dv = (ev.target as unknown as { value: DataView }).value
    const flags = dv.getUint8(0)
    hrNow.value = flags & 1 ? dv.getUint16(1, true) : dv.getUint8(1)
  })
  dev.addEventListener('gattserverdisconnected', () => {
    hrDevice.value = null
    hrNow.value = null
  })
  hrDevice.value = dev.name || 'Heart rate sensor'
}

interface BtDevice extends EventTarget {
  name?: string
  gatt: { connect: () => Promise<{ getPrimaryService: (s: string) => Promise<{ getCharacteristic: (c: string) => Promise<BtChar> }> }> }
}
interface BtChar extends EventTarget {
  startNotifications: () => Promise<void>
}

export const recordingSummaryText = () => {
  const L = live.value
  return `${(L.distance / 1000).toFixed(2)} km in ${fmtDuration(L.moving)}`
}

/** Last activity of this sport, used to suggest the next sport on the record screen. */
export function lastSport(): Sport {
  return activities.value[0]?.sport ?? settings.value.defaultSport
}
