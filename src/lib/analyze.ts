import { SPORTS, sportGroup } from './sports'
import { bboxOf, cumulative, haversine, simplifyTo } from './geo'
import type { Sport, Split, Streams, Summary } from './types'
import { BEST_EFFORT_DISTANCES, MILE, POWER_DURATIONS } from './units'

const finite = (v: number) => typeof v === 'number' && isFinite(v)

/** Fill NaN gaps by linear interpolation, holding ends. Returns null if nothing valid. */
export function fillGaps(arr: number[] | null): number[] | null {
  if (!arr) return null
  const n = arr.length
  const out = arr.slice()
  let first = -1
  for (let i = 0; i < n; i++) if (finite(out[i])) { first = i; break }
  if (first < 0) return null
  for (let i = 0; i < first; i++) out[i] = out[first]
  let last = first
  for (let i = first + 1; i < n; i++) {
    if (finite(out[i])) {
      if (i - last > 1) {
        for (let k = last + 1; k < i; k++) out[k] = out[last] + ((out[i] - out[last]) * (k - last)) / (i - last)
      }
      last = i
    }
  }
  for (let i = last + 1; i < n; i++) out[i] = out[last]
  return out
}

/** Centered moving average with a window in samples. */
export function smooth(arr: number[], win: number) {
  const n = arr.length
  if (win <= 1 || n < 3) return arr.slice()
  const half = Math.floor(win / 2)
  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + arr[i]
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n, i + half + 1)
    out[i] = (pre[b] - pre[a]) / (b - a)
  }
  return out
}

/** Smooth elevation by distance so sampling rate does not change the result. */
export function smoothElevation(ele: number[] | null, dist: number[]) {
  const filled = fillGaps(ele)
  if (!filled) return null
  const n = filled.length
  const out = new Array<number>(n)
  const W = 30 // metres either side
  let a = 0, b = 0, sum = 0
  for (let i = 0; i < n; i++) {
    while (b < n && dist[b] <= dist[i] + W) sum += filled[b++]
    while (dist[a] < dist[i] - W) sum -= filled[a++]
    out[i] = sum / (b - a)
  }
  return out
}

export function elevationGain(eleS: number[] | null, threshold = 2) {
  if (!eleS || !eleS.length) return { gain: 0, loss: 0, min: null as number | null, max: null as number | null }
  let gain = 0, loss = 0
  let anchor = eleS[0]
  let min = Infinity, max = -Infinity
  for (const e of eleS) {
    if (e < min) min = e
    if (e > max) max = e
    if (e - anchor >= threshold) { gain += e - anchor; anchor = e }
    else if (anchor - e >= threshold) { loss += anchor - e; anchor = e }
  }
  return { gain, loss, min, max }
}

/** Minetti metabolic cost of running on a grade (J/kg/m). */
export function minetti(g: number) {
  g = Math.max(-0.45, Math.min(0.45, g))
  return 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6
}
export const gapFactor = (g: number) => minetti(g) / 3.6

/** Grade at each point from smoothed elevation over a +-40 m window. */
export function gradeSeries(eleS: number[] | null, dist: number[]) {
  const n = dist.length
  const out = new Array<number>(n).fill(0)
  if (!eleS) return out
  let a = 0, b = 0
  for (let i = 0; i < n; i++) {
    while (a < i && dist[a] < dist[i] - 40) a++
    while (b < n - 1 && dist[b + 1] <= dist[i] + 40) b++
    const dd = dist[b] - dist[a]
    out[i] = dd > 8 ? Math.max(-0.4, Math.min(0.4, (eleS[b] - eleS[a]) / dd)) : i > 0 ? out[i - 1] : 0
  }
  return out
}

/** Which intervals count as moving. moving[i] describes the interval (i-1, i]. */
export function movingMask(s: Streams, sport: Sport) {
  const n = s.time.length
  const thr = SPORTS[sport].movingThreshold
  const mask = new Uint8Array(n)
  const hasDist = s.dist[n - 1] > 0
  for (let i = 1; i < n; i++) {
    const dt = (s.time[i] - s.time[i - 1]) / 1000
    if (dt <= 0) continue
    if (!hasDist || thr === 0) { mask[i] = dt < 300 ? 1 : 0; continue }
    const v = (s.dist[i] - s.dist[i - 1]) / dt
    mask[i] = v >= thr && dt < 300 ? 1 : 0
  }
  // Bridge single stopped samples between moving ones (GPS jitter at low speeds).
  for (let i = 2; i < n; i++) if (!mask[i - 1] && mask[i - 2] && mask[i]) {
    const dt = (s.time[i - 1] - s.time[i - 2]) / 1000
    if (dt < 6) mask[i - 1] = 1
  }
  return mask
}

/** Cumulative moving seconds at each sample. */
export function movingClock(s: Streams, mask: Uint8Array) {
  const out = new Array<number>(s.time.length)
  out[0] = 0
  for (let i = 1; i < s.time.length; i++) out[i] = out[i - 1] + (mask[i] ? (s.time[i] - s.time[i - 1]) / 1000 : 0)
  return out
}

/** Resample a channel to 1 Hz over active time, skipping pauses longer than 10 s. */
export function resample1Hz(time: number[], vals: number[], zeroGaps = true) {
  const out: number[] = []
  for (let i = 1; i < time.length; i++) {
    const dt = (time[i] - time[i - 1]) / 1000
    if (dt <= 0) continue
    if (dt > 10) {
      if (!zeroGaps) continue
      continue
    }
    const a = finite(vals[i - 1]) ? vals[i - 1] : 0
    const b = finite(vals[i]) ? vals[i] : 0
    const steps = Math.max(1, Math.round(dt))
    for (let k = 1; k <= steps; k++) out.push(a + ((b - a) * k) / steps)
  }
  return out
}

function bestAvg(series: number[], win: number) {
  if (series.length < win) return null
  let sum = 0
  for (let i = 0; i < win; i++) sum += series[i]
  let best = sum
  for (let i = win; i < series.length; i++) {
    sum += series[i] - series[i - win]
    if (sum > best) best = sum
  }
  return best / win
}

export function normalizedPower(p1: number[]) {
  if (p1.length < 60) return null
  const roll = smoothTrailing(p1, 30)
  let s = 0
  for (const v of roll) s += v ** 4
  return (s / roll.length) ** 0.25
}

function smoothTrailing(arr: number[], win: number) {
  const out = new Array<number>(arr.length)
  let sum = 0
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i]
    if (i >= win) sum -= arr[i - win]
    out[i] = sum / Math.min(i + 1, win)
  }
  return out
}

/** Fastest elapsed time for each standard distance, interpolated at exact crossings. */
export function bestEfforts(time: number[], dist: number[]) {
  const out: Record<string, number> = {}
  const total = dist[dist.length - 1]
  for (const { m } of BEST_EFFORT_DISTANCES) {
    if (total < m) break
    let best = Infinity
    let j = 0
    for (let i = 0; i < dist.length; i++) {
      const target = dist[i] + m
      if (target > total) break
      if (j < i) j = i
      while (j < dist.length && dist[j] < target) j++
      if (j >= dist.length) break
      const d0 = dist[j - 1], d1 = dist[j]
      const f = d1 > d0 ? (target - d0) / (d1 - d0) : 0
      const tEnd = time[j - 1] + (time[j] - time[j - 1]) * f
      const dt = (tEnd - time[i]) / 1000
      if (dt < best) best = dt
    }
    if (isFinite(best) && best > 0) out[String(m)] = Math.round(best * 10) / 10
  }
  return out
}

function splitsFor(s: Streams, unit: number, mclock: number[], eleS: number[] | null, gapDist: number[] | null): Split[] {
  const out: Split[] = []
  const { dist, time } = s
  const total = dist[dist.length - 1]
  if (total < 50) return out
  const at = (arr: number[], d: number) => {
    let lo = 0, hi = dist.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dist[mid] < d) lo = mid + 1; else hi = mid }
    if (lo === 0) return arr[0]
    const d0 = dist[lo - 1], d1 = dist[lo]
    const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0
    return arr[lo - 1] + (arr[lo] - arr[lo - 1]) * f
  }
  const n = Math.ceil(total / unit - 1e-6)
  let i0 = 0
  for (let k = 0; k < n; k++) {
    const a = k * unit
    const b = Math.min(total, (k + 1) * unit)
    if (b - a < 20 && k > 0) break
    const t = at(mclock, b) - at(mclock, a)
    const elev = eleS ? at(eleS, b) - at(eleS, a) : 0
    let hrSum = 0, hrW = 0
    let i1 = i0
    while (i1 < dist.length && dist[i1] <= b) {
      if (s.hr && i1 > 0 && finite(s.hr[i1])) {
        const w = (time[i1] - time[i1 - 1]) / 1000
        if (w > 0 && w < 30) { hrSum += s.hr[i1] * w; hrW += w }
      }
      i1++
    }
    i0 = i1
    const gap = gapDist && t > 0 ? (at(gapDist, b) - at(gapDist, a)) / t : null
    out.push({ index: k + 1, distance: b - a, time: t, elev, avgHr: hrW ? hrSum / hrW : null, gapSpeed: gap, partial: b - a < unit * 0.98 })
  }
  return out
}

/** Running cadence often arrives per leg; normalise to steps per minute. */
function normaliseCadence(cad: number[] | null, sport: Sport) {
  if (!cad || sportGroup(sport) !== 'foot') return cad
  const vals = cad.filter((v) => finite(v) && v > 0).sort((a, b) => a - b)
  if (!vals.length) return cad
  const med = vals[Math.floor(vals.length / 2)]
  return med < 115 ? cad.map((v) => v * 2) : cad
}

export function analyze(s: Streams, sport: Sport, weight = 72): Summary {
  s.cad = normaliseCadence(s.cad, sport)
  const n = s.time.length
  const group = sportGroup(sport)
  const elapsedTime = n > 1 ? (s.time[n - 1] - s.time[0]) / 1000 : 0
  const mask = movingMask(s, sport)
  const mclock = movingClock(s, mask)
  const movingTime = mclock[n - 1] || elapsedTime
  const distance = s.dist[n - 1] || 0
  const eleS = smoothElevation(s.ele, s.dist)
  const eg = elevationGain(eleS)

  // Max speed over >= 5 s windows to ignore GPS spikes.
  let maxSpeed = 0
  {
    let j = 0
    for (let i = 0; i < n; i++) {
      if (j < i) j = i
      while (j < n && s.time[j] - s.time[i] < 5000) j++
      if (j >= n) break
      const dt = (s.time[j] - s.time[i]) / 1000
      if (dt > 15) continue
      const v = (s.dist[j] - s.dist[i]) / dt
      if (v > maxSpeed) maxSpeed = v
    }
  }

  // Grade-adjusted distance for foot sports.
  let gapDist: number[] | null = null
  if (group === 'foot' && eleS && distance > 0) {
    const grade = gradeSeries(eleS, s.dist)
    gapDist = new Array<number>(n)
    gapDist[0] = 0
    for (let i = 1; i < n; i++) gapDist[i] = gapDist[i - 1] + (mask[i] ? (s.dist[i] - s.dist[i - 1]) * gapFactor(grade[i]) : 0)
  }

  // Time-weighted channel averages over moving intervals.
  const avgOf = (arr: number[] | null, skipZero: boolean) => {
    if (!arr) return null
    let sum = 0, w = 0
    for (let i = 1; i < n; i++) {
      if (!mask[i] || !finite(arr[i]) || (skipZero && arr[i] <= 0)) continue
      const dt = (s.time[i] - s.time[i - 1]) / 1000
      sum += arr[i] * dt
      w += dt
    }
    return w ? sum / w : null
  }
  const maxOf = (arr: number[] | null) => {
    if (!arr) return null
    let m = -Infinity
    for (const v of arr) if (finite(v) && v > m) m = v
    return isFinite(m) ? m : null
  }

  let hrHist: number[] | null = null
  if (s.hr && s.hr.some((v) => finite(v) && v > 0)) {
    hrHist = new Array(231).fill(0)
    for (let i = 1; i < n; i++) {
      const v = s.hr[i]
      const dt = (s.time[i] - s.time[i - 1]) / 1000
      if (!finite(v) || v <= 0 || dt <= 0 || dt > 30) continue
      hrHist[Math.max(0, Math.min(230, Math.round(v)))] += dt
    }
  }

  let np: number | null = null, powerCurve: Record<string, number> | null = null, work: number | null = null
  const avgPower = avgOf(s.pwr, false)
  if (s.pwr && avgPower != null && avgPower > 0) {
    const p1 = resample1Hz(s.time, s.pwr)
    np = normalizedPower(p1)
    work = p1.reduce((a, b) => a + b, 0) / 1000
    powerCurve = {}
    for (const d of POWER_DURATIONS) {
      const v = bestAvg(p1, d)
      if (v != null) powerCurve[String(d)] = Math.round(v)
    }
  }

  const avgSpeed = movingTime > 0 ? distance / movingTime : 0
  const hours = movingTime / 3600
  let calories: number
  if (work) calories = work * 1.0
  else if (group === 'foot') calories = weight * (distance / 1000) * (sport === 'walk' || sport === 'hike' ? 0.55 : 1.0) + (eg.gain / 100) * weight * 0.1
  else if (group === 'bike') {
    const kmh = avgSpeed * 3.6
    const met = kmh < 16 ? 4 : kmh < 19 ? 6 : kmh < 22 ? 8 : kmh < 25 ? 10 : 12
    calories = met * weight * hours * (sport === 'ebike' ? 0.6 : 1)
  } else calories = 6 * weight * hours

  const hasGps = !!(s.lat && s.lon)
  const bbox = hasGps ? bboxOf(s.lon!.map((x, i) => [x, s.lat![i]])) : null

  return {
    distance,
    movingTime,
    elapsedTime,
    elevGain: eg.gain,
    elevLoss: eg.loss,
    elevMin: eg.min,
    elevMax: eg.max,
    avgSpeed,
    maxSpeed,
    gapSpeed: gapDist && movingTime ? gapDist[n - 1] / movingTime : null,
    avgHr: avgOf(s.hr, true),
    maxHr: maxOf(s.hr),
    avgCad: avgOf(s.cad, true),
    avgPower,
    maxPower: maxOf(s.pwr),
    np,
    work,
    calories: Math.round(calories),
    splitsKm: splitsFor(s, 1000, mclock, eleS, gapDist),
    splitsMi: splitsFor(s, MILE, mclock, eleS, gapDist),
    bestEfforts: group === 'foot' && distance > 0 ? bestEfforts(s.time, s.dist) : {},
    powerCurve,
    hrHist,
    bbox,
  }
}

export function makeTrace(s: Streams): [number, number][] {
  if (!s.lat || !s.lon) return []
  return simplifyTo(s.lon, s.lat, 400, 5)
}

export interface RawPoint {
  time: number
  lat?: number
  lon?: number
  ele?: number
  hr?: number
  cad?: number
  pwr?: number
  dist?: number
}

/** Turn loose parsed points into clean streams. */
export function buildStreams(points: RawPoint[]): Streams | null {
  const pts = points.filter((p) => finite(p.time)).sort((a, b) => a.time - b.time)
  // Drop duplicate timestamps, keeping the later richer sample.
  const uniq: RawPoint[] = []
  for (const p of pts) {
    const last = uniq[uniq.length - 1]
    if (last && last.time === p.time) Object.assign(last, Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && finite(v as number))))
    else uniq.push({ ...p })
  }
  if (uniq.length < 2) return null
  const withPos = uniq.filter((p) => finite(p.lat!) && finite(p.lon!) && !(p.lat === 0 && p.lon === 0))
  const hasGps = withPos.length >= 2 && withPos.length >= uniq.length * 0.5
  const use = hasGps ? withPos : uniq
  const ch = (k: keyof RawPoint) => {
    const vals = use.map((p) => (p[k] != null && finite(p[k] as number) ? (p[k] as number) : NaN))
    return vals.some((v) => !isNaN(v)) ? vals : null
  }
  const time = use.map((p) => p.time)
  const lat = hasGps ? use.map((p) => p.lat!) : null
  const lon = hasGps ? use.map((p) => p.lon!) : null
  let dist: number[]
  const devDist = ch('dist')
  const devOk = devDist && devDist.filter((v) => !isNaN(v)).length >= use.length * 0.9
  if (devOk) {
    const filled = fillGaps(devDist)!
    let m = 0
    const base = filled[0]
    dist = filled.map((v) => (m = Math.max(m, v - base)))
  } else if (lat && lon) {
    dist = gpsDistance(lat, lon, time)
  } else {
    dist = new Array(use.length).fill(0)
  }
  const nz = (a: number[] | null) => (a && a.some((v) => finite(v) && v !== 0) ? a : null)
  return { time, lat, lon, ele: ch('ele'), hr: nz(ch('hr')), cad: nz(ch('cad')), pwr: nz(ch('pwr')), dist }
}

/** Cumulative distance that ignores implausible jumps and sub-metre jitter while stationary. */
export function gpsDistance(lat: number[], lon: number[], time: number[]) {
  // A 3-sample average on densely sampled tracks takes the zig-zag out of GPS jitter.
  const n = lat.length
  const sl = lat.slice(), so = lon.slice()
  for (let i = 1; i < n - 1; i++) {
    if (time[i + 1] - time[i - 1] > 4000) continue
    sl[i] = (lat[i - 1] + lat[i] + lat[i + 1]) / 3
    so[i] = (lon[i - 1] + lon[i] + lon[i + 1]) / 3
  }
  lat = sl
  lon = so
  const raw = cumulative(lat, lon)
  const out = new Array<number>(lat.length)
  out[0] = 0
  let d = 0
  for (let i = 1; i < lat.length; i++) {
    const step = raw[i] - raw[i - 1]
    const dt = Math.max(0.001, (time[i] - time[i - 1]) / 1000)
    const v = step / dt
    if (v < 70 || dt > 60) d += step
    out[i] = d
  }
  return out
}

export function distanceBetween(lat: number[], lon: number[], a: number, b: number) {
  let d = 0
  for (let i = a + 1; i <= b; i++) d += haversine(lat[i - 1], lon[i - 1], lat[i], lon[i])
  return d
}
