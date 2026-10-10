import { fillGaps, gapFactor, gradeSeries, movingClock, movingMask, smooth, smoothElevation } from './analyze'
import { SPORTS, sportGroup } from './sports'
import type { Settings, Sport, Streams } from './types'

export interface Derived {
  n: number
  t: number[] // moving seconds
  elapsed: number[]
  dist: number[]
  ele: number[] | null
  grade: number[]
  speed: number[] // m/s, NaN when stopped
  gap: number[] | null
  hr: number[] | null
  cad: number[] | null
  pwr: number[] | null
  mask: Uint8Array
}

/** Smoothed per-sample series for charts and zone maths. */
export function derive(s: Streams, sport: Sport): Derived {
  const n = s.time.length
  const mask = movingMask(s, sport)
  const t = movingClock(s, mask)
  const elapsed = s.time.map((x) => (x - s.time[0]) / 1000)
  const ele = smoothElevation(s.ele, s.dist)
  const grade = gradeSeries(ele, s.dist)
  const thr = SPORTS[sport].movingThreshold
  // Speed over a +-10 s window, then a second pass so pace reads like a trend, not GPS noise.
  const raw = new Array<number>(n)
  let a = 0, b = 0
  for (let i = 0; i < n; i++) {
    while (a < i && s.time[i] - s.time[a] > 10000) a++
    while (b < n - 1 && s.time[b + 1] - s.time[i] <= 10000) b++
    const dt = (s.time[b] - s.time[a]) / 1000
    raw[i] = dt > 0 ? (s.dist[b] - s.dist[a]) / dt : 0
  }
  const sm1 = smooth(raw, 15)
  const speed = sm1.map((v, i) => (!mask[i] && i > 0 ? NaN : v < Math.max(0.3, thr * 0.6) ? NaN : v))
  const foot = sportGroup(sport) === 'foot'
  // Smooth the grade adjustment the same way as speed so terrain noise does not whip the line around.
  const factor = foot && ele ? smooth(grade.map(gapFactor), 15) : null
  const gap = factor ? speed.map((v, i) => (isFinite(v) ? v * factor[i] : NaN)) : null
  const sm = (arr: number[] | null, w: number) => {
    const f = fillGaps(arr)
    return f ? smooth(f, w) : null
  }
  return { n, t, elapsed, dist: s.dist, ele, grade, speed, gap, hr: sm(s.hr, 5), cad: sm(s.cad, 5), pwr: sm(s.pwr, 7), mask }
}

export const HR_ZONES = [
  { name: 'Endurance', lo: 0, hi: 0.65 },
  { name: 'Moderate', lo: 0.65, hi: 0.81 },
  { name: 'Tempo', lo: 0.81, hi: 0.89 },
  { name: 'Threshold', lo: 0.89, hi: 0.97 },
  { name: 'Anaerobic', lo: 0.97, hi: 9 },
]

// Pace zones as share of threshold speed.
export const PACE_ZONES = [
  { name: 'Recovery', lo: 0, hi: 1 / 1.29 },
  { name: 'Endurance', lo: 1 / 1.29, hi: 1 / 1.14 },
  { name: 'Tempo', lo: 1 / 1.14, hi: 1 / 1.06 },
  { name: 'Threshold', lo: 1 / 1.06, hi: 1 / 0.99 },
  { name: 'VO2 max', lo: 1 / 0.99, hi: 1 / 0.9 },
  { name: 'Anaerobic', lo: 1 / 0.9, hi: 99 },
]

export const POWER_ZONES = [
  { name: 'Active recovery', lo: 0, hi: 0.55 },
  { name: 'Endurance', lo: 0.55, hi: 0.75 },
  { name: 'Tempo', lo: 0.75, hi: 0.9 },
  { name: 'Threshold', lo: 0.9, hi: 1.05 },
  { name: 'VO2 max', lo: 1.05, hi: 1.2 },
  { name: 'Anaerobic', lo: 1.2, hi: 1.5 },
  { name: 'Neuromuscular', lo: 1.5, hi: 99 },
]

// Ordinal ramp, light to dark, for ordered zones.
export const ZONE_RAMP = ['#86b6ef', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#104281', '#0d366b']

export function zoneTimes(d: Derived, s: Streams, values: number[] | null, ref: number, zones: { lo: number; hi: number }[]) {
  const out = zones.map(() => 0)
  if (!values || !ref) return out
  for (let i = 1; i < d.n; i++) {
    if (!d.mask[i]) continue
    const v = values[i]
    if (!isFinite(v)) continue
    const dt = (s.time[i] - s.time[i - 1]) / 1000
    if (dt <= 0 || dt > 30) continue
    const r = v / ref
    const z = zones.findIndex((zz) => r >= zz.lo && r < zz.hi)
    if (z >= 0) out[z] += dt
  }
  return out
}

export function zoneBounds(st: Settings) {
  return HR_ZONES.map((z) => [Math.round(z.lo * st.maxHr), Math.round(Math.min(1, z.hi) * st.maxHr)])
}

/** Value at percentile p (0..1) of finite numbers. */
export function percentile(arr: number[], p: number) {
  const v = arr.filter((x) => isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return NaN
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))]
}

export const HEAT_RAMP = ['#fde68a', '#fbbf24', '#f97316', '#dc2626', '#7f1d1d']
export const DIVERGE = ['#1c5cab', '#5598e7', '#c3c2b7', '#e66767', '#b42323']

export function rampColor(ramp: string[], f: number) {
  f = Math.max(0, Math.min(1, f))
  const x = f * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(x))
  const k = x - i
  const a = hex(ramp[i]), b = hex(ramp[i + 1])
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
