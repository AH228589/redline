const R = 6371008.8
const RAD = Math.PI / 180

export type LonLat = [number, number]

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export const distLL = (a: LonLat, b: LonLat) => haversine(a[1], a[0], b[1], b[0])

export function cumulative(lat: number[], lon: number[]) {
  const out = new Array<number>(lat.length)
  let d = 0
  out[0] = 0
  for (let i = 1; i < lat.length; i++) {
    d += haversine(lat[i - 1], lon[i - 1], lat[i], lon[i])
    out[i] = d
  }
  return out
}

export function lineLength(pts: LonLat[] | [number, number, number][]) {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0])
  return d
}

/** Local equirectangular projection to metres around a reference latitude. */
export function projector(refLat: number) {
  const kx = Math.cos(refLat * RAD) * R * RAD
  const ky = R * RAD
  return (lon: number, lat: number): [number, number] => [lon * kx, lat * ky]
}

/** Squared distance in metres from point p to segment ab, all projected. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

/** Douglas-Peucker on lon/lat pairs, tolerance in metres. Returns kept indices. */
export function simplifyIdx(lon: number[], lat: number[], tol: number): number[] {
  const n = lon.length
  if (n <= 2) return Array.from({ length: n }, (_, i) => i)
  const p = projector(lat[Math.floor(n / 2)])
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const [x, y] = p(lon[i], lat[i])
    xs[i] = x
    ys[i] = y
  }
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const tol2 = tol * tol
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let max = -1
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(xs[i], ys[i], xs[a], ys[a], xs[b], ys[b])
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (max > tol2 && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

export function simplifyTo(lon: number[], lat: number[], maxPts: number, startTol = 4): LonLat[] {
  let tol = startTol
  let idx = simplifyIdx(lon, lat, tol)
  while (idx.length > maxPts && tol < 500) {
    tol *= 1.6
    idx = simplifyIdx(lon, lat, tol)
  }
  return idx.map((i) => [round6(lon[i]), round6(lat[i])])
}

export const round6 = (v: number) => Math.round(v * 1e6) / 1e6

export function bboxOf(pts: { length: number; [i: number]: readonly number[] | number[] }): [number, number, number, number] | null {
  if (!pts.length) return null
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]
    if (x < a) a = x
    if (y < b) b = y
    if (x > c) c = x
    if (y > d) d = y
  }
  return [a, b, c, d]
}

export function bboxOverlap(a: [number, number, number, number], b: [number, number, number, number], padDeg = 0) {
  return a[0] - padDeg <= b[2] && b[0] - padDeg <= a[2] && a[1] - padDeg <= b[3] && b[1] - padDeg <= a[3]
}

/** Minimum distance in metres from a point to a polyline, plus the along-line distance at the nearest spot. */
export function nearestOnLine(pt: LonLat, line: LonLat[] | [number, number, number][], cum?: number[]) {
  const p = projector(pt[1])
  const [px, py] = p(pt[0], pt[1])
  let best = Infinity
  let along = 0
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = p(line[i - 1][0], line[i - 1][1])
    const [bx, by] = p(line[i][0], line[i][1])
    const d2 = segDist2(px, py, ax, ay, bx, by)
    if (d2 < best) {
      best = d2
      if (cum) {
        const dx = bx - ax, dy = by - ay
        const len2 = dx * dx + dy * dy
        let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
        t = Math.max(0, Math.min(1, t))
        along = cum[i - 1] + t * (cum[i] - cum[i - 1])
      }
    }
  }
  return { dist: Math.sqrt(best), along }
}

export function cumulativeLL(line: LonLat[] | [number, number, number][]) {
  const out = [0]
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1][1], line[i - 1][0], line[i][1], line[i][0]))
  return out
}

export function destination(pt: LonLat, bearingDeg: number, meters: number): LonLat {
  const br = bearingDeg * RAD
  const lat1 = pt[1] * RAD
  const lon1 = pt[0] * RAD
  const dr = meters / R
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br))
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2))
  return [lon2 / RAD, lat2 / RAD]
}

/** Interpolate a value array at a fractional position between index i and i+1. */
export function lerpAt(arr: number[], i: number, f: number) {
  if (i >= arr.length - 1) return arr[arr.length - 1]
  return arr[i] + (arr[i + 1] - arr[i]) * f
}

/** First index j with sorted[j] >= v (binary search). */
export function lowerBound(sorted: number[], v: number) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Value of ys at x = v via linear interpolation over increasing xs. */
export function interp(xs: number[], ys: number[], v: number) {
  const n = xs.length
  if (!n) return NaN
  if (v <= xs[0]) return ys[0]
  if (v >= xs[n - 1]) return ys[n - 1]
  const j = lowerBound(xs, v)
  const x0 = xs[j - 1], x1 = xs[j]
  const f = x1 > x0 ? (v - x0) / (x1 - x0) : 0
  return ys[j - 1] + (ys[j] - ys[j - 1]) * f
}
