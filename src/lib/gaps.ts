// GPS gaps: stretches where the phone stopped reporting position (screen locked,
// app in the background, tunnel) and the track jumps in a straight line.
import { haversine } from './geo'
import { routeVia } from './routing'
import { sportGroup } from './sports'
import type { Sport, Streams } from './types'

export interface Gap {
  a: number // last point before the gap
  b: number // first point after it
  dist: number // straight-line metres
  dt: number // seconds
}

const MIN_DT = 25
const MIN_DIST = 120

export function findGaps(s: Streams): Gap[] {
  if (!s.lat || !s.lon) return []
  const out: Gap[] = []
  const traced = (i: number) => (s.est ?? []).some(([a, b]) => i - 1 >= a && i <= b)
  for (let i = 1; i < s.time.length; i++) {
    if (traced(i)) continue
    const dt = (s.time[i] - s.time[i - 1]) / 1000
    if (dt < MIN_DT) continue
    const d = haversine(s.lat[i - 1], s.lon[i - 1], s.lat[i], s.lon[i])
    if (d >= MIN_DIST) out.push({ a: i - 1, b: i, dist: d, dt })
  }
  return out
}

/** Add points so no two are more than ~20 m apart; routed lines have long straight runs. */
function densify(c: [number, number, number][]) {
  const out: [number, number, number][] = [c[0]]
  for (let i = 1; i < c.length; i++) {
    const d = haversine(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0])
    const n = Math.max(1, Math.ceil(d / 20))
    for (let k = 1; k <= n; k++) {
      const f = k / n
      out.push([c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f, c[i - 1][2] + (c[i][2] - c[i - 1][2]) * f])
    }
  }
  return out
}

export function gapProfile(sport: Sport) {
  if (sport === 'trail_run' || sport === 'hike') return 'hiking-mountain'
  if (sport === 'mtb') return 'mtb'
  if (sport === 'gravel' || sport === 'ebike') return 'trekking'
  if (sportGroup(sport) === 'bike') return 'fastbike-lowtraffic'
  return 'hiking-beta'
}

/** Replace each straight-line jump with a path routed along roads and trails. */
export async function fillGaps(s: Streams, sport: Sport): Promise<{ streams: Streams; filled: number; failed: number; added: number }> {
  const gaps = findGaps(s)
  if (!gaps.length || !s.lat || !s.lon) return { streams: s, filled: 0, failed: 0, added: 0 }
  const profile = gapProfile(sport)
  const routed = new Map<number, [number, number, number][]>()
  let failed = 0
  for (const g of gaps) {
    try {
      const leg = await routeVia([[s.lon[g.a], s.lat[g.a]], [s.lon[g.b], s.lat[g.b]]], profile)
      // A path far longer than the jump means the router found something unrelated.
      if (leg.coords.length > 2 && leg.distance < g.dist * 3 + 500) routed.set(g.b, densify(leg.coords).slice(1, -1))
      else failed++
    } catch {
      failed++
    }
  }
  const n = s.time.length
  const out: Streams = { time: [], lat: [], lon: [], ele: s.ele ? [] : null, hr: s.hr ? [] : null, cad: s.cad ? [] : null, pwr: s.pwr ? [] : null, dist: [], est: [...(s.est ?? [])], cadUnit: s.cadUnit, eleSource: s.eleSource }
  const push = (t: number, lat: number, lon: number, ele: number, d: number, hr = NaN, cad = NaN, pwr = NaN) => {
    out.time.push(t)
    out.lat!.push(lat)
    out.lon!.push(lon)
    out.ele?.push(ele)
    out.hr?.push(hr)
    out.cad?.push(cad)
    out.pwr?.push(pwr)
    out.dist.push(d)
  }
  let d = 0
  let added = 0
  for (let i = 0; i < n; i++) {
    const mid = routed.get(i)
    if (mid) {
      // Spread the gap's duration along the routed path by distance.
      const a = i - 1
      const path: [number, number][] = [[s.lon[a], s.lat[a]], ...mid.map((c) => [c[0], c[1]] as [number, number]), [s.lon[i], s.lat[i]]]
      const segLen: number[] = []
      let total = 0
      for (let k = 1; k < path.length; k++) {
        const l = haversine(path[k - 1][1], path[k - 1][0], path[k][1], path[k][0])
        segLen.push(l)
        total += l
      }
      const t0 = s.time[a], t1 = s.time[i]
      const e0 = s.ele ? s.ele[a] : NaN, e1 = s.ele ? s.ele[i] : NaN
      const startIdx = out.time.length - 1
      let run = 0
      for (let k = 0; k < mid.length; k++) {
        run += segLen[k]
        const f = total > 0 ? run / total : 0
        d += segLen[k]
        const ele = isFinite(mid[k][2]) ? mid[k][2] : e0 + (e1 - e0) * f
        push(t0 + (t1 - t0) * f, mid[k][1], mid[k][0], ele, d)
        added++
      }
      d += segLen[segLen.length - 1]
      out.est!.push([startIdx, startIdx + mid.length + 1])
    } else if (i > 0) d += s.dist[i] - s.dist[i - 1]
    push(s.time[i], s.lat[i], s.lon[i], s.ele ? s.ele[i] : NaN, d, s.hr?.[i], s.cad?.[i], s.pwr?.[i])
  }
  // Older estimated ranges shift by the points inserted before them.
  if (s.est?.length) {
    const shift = (idx: number) => {
      let extra = 0
      for (const [b, c] of routed) if (b <= idx) extra += c.length
      return idx + extra
    }
    out.est = [...s.est.map(([x, y]) => [shift(x), shift(y)] as [number, number]), ...out.est!.slice(s.est.length)]
  }
  return { streams: out, filled: routed.size, failed, added }
}
