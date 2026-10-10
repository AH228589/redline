import { bboxOf, bboxOverlap, cumulativeLL, projector, simplifyIdx } from './geo'
import { smoothElevation } from './analyze'
import { sportGroup } from './sports'
import type { Activity, Segment, SegmentEffort, SportGroup, Streams } from './types'

const R_ENDS = 30 // metres around start and finish
const R_PATH = 35 // how far the track may stray from the segment line
const PATH_SHARE = 0.9

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const x = ax + t * dx - px, y = ay + t * dy - py
  return x * x + y * y
}

/** Find every effort on the given segments within one activity. */
export function matchActivity(act: Activity, s: Streams, segs: Segment[]): SegmentEffort[] {
  if (!s.lat || !s.lon || !act.summary.bbox) return []
  const group = sportGroup(act.sport)
  const cands = segs.filter((g) => (g.group === group || group === 'other') && bboxOverlap(g.bbox, act.summary.bbox!, 0.001))
  if (!cands.length) return []
  const n = s.lat.length
  const p = projector(s.lat[Math.floor(n / 2)])
  const xs = new Float64Array(n), ys = new Float64Array(n)
  for (let i = 0; i < n; i++) [xs[i], ys[i]] = p(s.lon[i], s.lat[i])
  const out: SegmentEffort[] = []
  for (const seg of cands) out.push(...matchOne(act, s, seg, xs, ys, p))
  return out
}

function matchOne(act: Activity, s: Streams, seg: Segment, xs: Float64Array, ys: Float64Array, p: ReturnType<typeof projector>): SegmentEffort[] {
  const n = xs.length
  const sp = seg.points.map(([lon, lat]) => p(lon, lat))
  const [sx, sy] = sp[0]
  const [ex, ey] = sp[sp.length - 1]
  const r2 = R_ENDS * R_ENDS
  const d2 = (i: number, x: number, y: number) => (xs[i] - x) ** 2 + (ys[i] - y) ** 2
  // Also accept the line between samples passing the gate (sparse recordings).
  const near = (i: number, x: number, y: number) => d2(i, x, y) < r2 || (i > 0 && segDist2(x, y, xs[i - 1], ys[i - 1], xs[i], ys[i]) < r2)
  const segCum = cumulativeLL(seg.points)
  const samples = sampleLine(sp, segCum, Math.max(15, seg.distance / 60))
  const out: SegmentEffort[] = []
  let i = 0
  while (i < n) {
    if (!near(i, sx, sy)) { i++; continue }
    let st = i
    while (i + 1 < n && near(i + 1, sx, sy)) { i++; if (d2(i, sx, sy) < d2(st, sx, sy)) st = i }
    const minD = seg.distance * 0.85 - 2 * R_ENDS
    const maxD = seg.distance * 1.3 + 200
    let en = -1
    let enBest = Infinity
    for (let j = st + 1; j < n; j++) {
      const trav = s.dist[j] - s.dist[st]
      if (trav > maxD) break
      if (trav < minD) continue
      if (near(j, ex, ey)) {
        const dd = d2(j, ex, ey)
        if (dd < enBest) { enBest = dd; en = j }
      } else if (en >= 0) break
    }
    if (en > st && followsPath(samples, xs, ys, st, en)) {
      let hr = 0, hrW = 0, pw = 0, pwW = 0
      for (let k = st + 1; k <= en; k++) {
        const dt = (s.time[k] - s.time[k - 1]) / 1000
        if (s.hr && isFinite(s.hr[k])) { hr += s.hr[k] * dt; hrW += dt }
        if (s.pwr && isFinite(s.pwr[k])) { pw += s.pwr[k] * dt; pwW += dt }
      }
      out.push({
        id: `${seg.id}-${act.id}-${st}`,
        segmentId: seg.id,
        activityId: act.id,
        start: s.time[st],
        elapsed: (s.time[en] - s.time[st]) / 1000,
        startIdx: st,
        endIdx: en,
        avgHr: hrW ? hr / hrW : null,
        avgPower: pwW ? pw / pwW : null,
      })
      i = en + 1
    } else i = st + 1
  }
  return out
}

function sampleLine(sp: [number, number][], cum: number[], step: number) {
  const out: [number, number][] = []
  const total = cum[cum.length - 1]
  let k = 1
  for (let d = 0; d <= total; d += step) {
    while (k < cum.length - 1 && cum[k] < d) k++
    const f = cum[k] > cum[k - 1] ? (d - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0
    out.push([sp[k - 1][0] + (sp[k][0] - sp[k - 1][0]) * f, sp[k - 1][1] + (sp[k][1] - sp[k - 1][1]) * f])
  }
  return out
}

function followsPath(samples: [number, number][], xs: Float64Array, ys: Float64Array, a: number, b: number) {
  const r2 = R_PATH * R_PATH
  let ok = 0
  for (const [x, y] of samples) {
    for (let k = a + 1; k <= b; k++) {
      if (segDist2(x, y, xs[k - 1], ys[k - 1], xs[k], ys[k]) < r2) { ok++; break }
    }
  }
  return ok >= samples.length * PATH_SHARE
}

/** Build a segment from a slice of an activity. */
export function segmentFromRange(s: Streams, a: number, b: number, name: string, group: SportGroup, id: string): Segment | null {
  if (!s.lat || !s.lon || b - a < 2) return null
  const lon = s.lon.slice(a, b + 1)
  const lat = s.lat.slice(a, b + 1)
  const keep = simplifyIdx(lon, lat, 3)
  const points = keep.map((i) => [lon[i], lat[i]] as [number, number])
  const distance = s.dist[b] - s.dist[a]
  const eleS = smoothElevation(s.ele, s.dist)
  let gain = 0
  let net = 0
  if (eleS) {
    net = eleS[b] - eleS[a]
    for (let i = a + 1; i <= b; i++) if (eleS[i] > eleS[i - 1]) gain += eleS[i] - eleS[i - 1]
  }
  return {
    id,
    name,
    group,
    points,
    distance,
    elevGain: gain,
    avgGrade: distance > 0 ? net / distance : 0,
    bbox: bboxOf(points)!,
    starred: false,
    createdAt: Date.now(),
  }
}

export interface Climb {
  a: number
  b: number
  distance: number
  gain: number
  grade: number
  category: string
}

/** Detect categorised climbs from a track. */
export function detectClimbs(s: Streams): Climb[] {
  const eleS = smoothElevation(s.ele, s.dist)
  if (!eleS || s.dist[s.dist.length - 1] < 500) return []
  // Resample to 25 m bins to keep this cheap and stable.
  const idx: number[] = [0]
  for (let i = 1; i < s.dist.length; i++) if (s.dist[i] - s.dist[idx[idx.length - 1]] >= 25) idx.push(i)
  const e = idx.map((i) => eleS[i])
  const d = idx.map((i) => s.dist[i])
  const out: Climb[] = []
  const consider = (a: number, b: number) => {
    const gain = e[b] - e[a]
    const len = d[b] - d[a]
    if (gain < 25 || len < 300) return
    const grade = gain / len
    if (grade < 0.03) return
    const score = len * grade * 100
    const category = score >= 80000 ? 'HC' : score >= 64000 ? 'Cat 1' : score >= 32000 ? 'Cat 2' : score >= 16000 ? 'Cat 3' : score >= 8000 ? 'Cat 4' : 'Climb'
    out.push({ a: idx[a], b: idx[b], distance: len, gain, grade, category })
  }
  let start = 0, peak = 0
  for (let k = 1; k < e.length; k++) {
    if (e[k] > e[peak]) peak = k
    const climbed = e[peak] - e[start]
    const tol = Math.max(10, climbed * 0.2)
    if (e[peak] - e[k] > tol) {
      consider(start, peak)
      start = k
      peak = k
    } else if (e[k] < e[start]) {
      start = k
      peak = k
    }
  }
  consider(start, peak)
  return out
}

/** Time-at-distance profile of one effort, for racing a ghost live. */
export function effortProfile(s: Streams, e: SegmentEffort) {
  const d0 = s.dist[e.startIdx], t0 = s.time[e.startIdx]
  const dist: number[] = [], time: number[] = []
  for (let i = e.startIdx; i <= e.endIdx; i++) {
    dist.push(s.dist[i] - d0)
    time.push((s.time[i] - t0) / 1000)
  }
  return { dist, time }
}
