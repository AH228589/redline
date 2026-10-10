import { destination, distLL, type LonLat } from './geo'
import type { Sport, Streams } from './types'

export const PROFILES: { id: string; label: string; sport: Sport }[] = [
  { id: 'hiking-beta', label: 'Run / walk', sport: 'run' },
  { id: 'hiking-mountain', label: 'Trail / hike', sport: 'trail_run' },
  { id: 'fastbike-lowtraffic', label: 'Road bike', sport: 'ride' },
  { id: 'trekking', label: 'Gravel / touring', sport: 'gravel' },
  { id: 'mtb', label: 'Mountain bike', sport: 'mtb' },
]

export interface Leg {
  coords: [number, number, number][]
  distance: number
}

const legCache = new Map<string, Leg>()

/** Route through all points in one request. Returns lon/lat/ele triples. */
export async function routeVia(points: LonLat[], profile: string, signal?: AbortSignal): Promise<Leg> {
  const lonlats = points.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join('|')
  const key = `${profile}:${lonlats}`
  const hit = legCache.get(key)
  if (hit) return hit
  const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 160)
    throw new Error(/not mapped|no track|target island|position not/i.test(msg) ? 'No path found there. Try a point on a road or trail.' : `Routing failed (${res.status})`)
  }
  const gj = await res.json()
  const f = gj.features?.[0]
  if (!f) throw new Error('No route returned')
  const coords = (f.geometry.coordinates as number[][]).map((c) => [c[0], c[1], c[2] ?? NaN] as [number, number, number])
  const leg = { coords, distance: Number(f.properties?.['track-length']) || 0 }
  legCache.set(key, leg)
  if (legCache.size > 200) legCache.delete(legCache.keys().next().value!)
  return leg
}

/** Join per-waypoint legs into one line, dropping duplicate joints. */
export function joinLegs(legs: Leg[]): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const l of legs) {
    for (let i = 0; i < l.coords.length; i++) {
      if (i === 0 && out.length) continue
      out.push(l.coords[i])
    }
  }
  return out
}

export function elevStats(line: [number, number, number][]) {
  let gain = 0, loss = 0
  // Light smoothing so DEM stair-steps do not inflate the totals.
  let anchor = line.find((p) => isFinite(p[2]))?.[2]
  if (anchor == null) return { gain: 0, loss: 0 }
  for (const p of line) {
    if (!isFinite(p[2])) continue
    const d = p[2] - anchor
    if (d >= 2) { gain += d; anchor = p[2] } else if (d <= -2) { loss -= d; anchor = p[2] }
  }
  return { gain, loss }
}

/** Generate a loop of roughly the target length starting and ending at `start`. */
export async function generateLoop(start: LonLat, target: number, profile: string, seed: number): Promise<{ waypoints: LonLat[]; leg: Leg }> {
  const rand = mulberry(seed)
  const heading = rand() * 360
  let radius = target / (2 * Math.PI) * 0.9
  let best: { waypoints: LonLat[]; leg: Leg } | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const center = destination(start, heading, radius)
    const back = (heading + 180) % 360
    const spread = 70 + rand() * 30
    const wps: LonLat[] = [start]
    for (const k of [-1, 0, 1]) wps.push(destination(center, back + 180 + k * spread, radius * (0.85 + rand() * 0.3)))
    wps.push(start)
    try {
      const leg = await routeVia(wps, profile)
      const cand = { waypoints: wps, leg }
      if (!best || Math.abs(leg.distance - target) < Math.abs(best.leg.distance - target)) best = cand
      const ratio = leg.distance / target
      if (ratio > 0.92 && ratio < 1.08) break
      radius *= Math.max(0.5, Math.min(1.6, 1 / ratio))
    } catch (e) {
      if (attempt === 3 && !best) throw e
      radius *= 0.85
    }
  }
  if (!best) throw new Error('Could not build a loop here')
  return best
}

function mulberry(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Replace noisy GPS altitude with terrain elevation from Open-Meteo (90 m DEM). */
export async function correctElevation(s: Streams): Promise<number[]> {
  if (!s.lat || !s.lon) throw new Error('No GPS track')
  const n = s.lat.length
  // Sample about every 30 m, max 1000 points (10 requests).
  const idx: number[] = [0]
  for (let i = 1; i < n; i++) if (s.dist[i] - s.dist[idx[idx.length - 1]] >= 30) idx.push(i)
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1)
  let use = idx
  if (use.length > 1000) {
    const step = use.length / 1000
    use = Array.from({ length: 1000 }, (_, k) => idx[Math.floor(k * step)])
    use[use.length - 1] = n - 1
  }
  const elev: number[] = []
  for (let k = 0; k < use.length; k += 100) {
    const chunk = use.slice(k, k + 100)
    const lat = chunk.map((i) => s.lat![i].toFixed(5)).join(',')
    const lon = chunk.map((i) => s.lon![i].toFixed(5)).join(',')
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`)
    if (!res.ok) throw new Error('Elevation service unavailable')
    const j = await res.json()
    elev.push(...(j.elevation as number[]))
  }
  // Interpolate back onto every sample by distance.
  const out = new Array<number>(n)
  let k = 0
  for (let i = 0; i < n; i++) {
    while (k < use.length - 2 && s.dist[use[k + 1]] < s.dist[i]) k++
    const d0 = s.dist[use[k]], d1 = s.dist[use[k + 1]] ?? d0
    const f = d1 > d0 ? Math.max(0, Math.min(1, (s.dist[i] - d0) / (d1 - d0))) : 0
    out[i] = elev[k] + ((elev[k + 1] ?? elev[k]) - elev[k]) * f
  }
  return out
}

export async function elevationFor(points: LonLat[]): Promise<number[]> {
  const out: number[] = []
  for (let k = 0; k < points.length; k += 100) {
    const chunk = points.slice(k, k + 100)
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${chunk.map((p) => p[1].toFixed(5)).join(',')}&longitude=${chunk.map((p) => p[0].toFixed(5)).join(',')}`)
    if (!res.ok) throw new Error('Elevation service unavailable')
    out.push(...(await res.json()).elevation)
  }
  return out
}

export function straightLeg(a: LonLat, b: LonLat): Leg {
  return { coords: [[a[0], a[1], NaN], [b[0], b[1], NaN]], distance: distLL(a, b) }
}
