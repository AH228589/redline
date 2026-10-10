// Pre-download vector map tiles around a route so the map works without signal.
// Only OpenFreeMap tiles are fetched in bulk; their service has no request limits.

export const TILE_CACHE = 'redline-tiles-v1'

function lon2tile(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}
function lat2tile(lat: number, z: number) {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

export function tilesForLine(line: [number, number][], zooms = [8, 9, 10, 11, 12, 13, 14]) {
  const out = new Set<string>()
  for (const z of zooms) {
    for (const [lon, lat] of line) {
      const x = lon2tile(lon, z)
      const y = lat2tile(lat, z)
      // One tile of margin around the line at high zooms.
      const m = z >= 13 ? 1 : 0
      for (let dx = -m; dx <= m; dx++) for (let dy = -m; dy <= m; dy++) out.add(`${z}/${x + dx}/${y + dy}`)
    }
  }
  return [...out]
}

export async function downloadTiles(line: [number, number][], onProgress: (done: number, total: number) => void) {
  const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json()
  const tmpl: string = tj.tiles[0]
  const tiles = tilesForLine(line)
  const cache = await caches.open(TILE_CACHE)
  let done = 0
  const queue = tiles.slice()
  const worker = async () => {
    while (queue.length) {
      const t = queue.pop()!
      const [z, x, y] = t.split('/')
      const url = tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y)
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url)
          if (res.ok) await cache.put(url, res)
        }
      } catch {
        /* skip a failed tile */
      }
      onProgress(++done, tiles.length)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return tiles.length
}
