// Development-only helpers, loaded from main.tsx when import.meta.env.DEV.
import { importFiles } from './importers'
import { onFix } from './recorder'

async function importUrls(urls: string[]) {
  const files = await Promise.all(
    urls.map(async (u) => {
      const r = await fetch(u)
      return new File([await r.blob()], u.split('/').pop()!)
    }),
  )
  return importFiles(files)
}

/** Replay a polyline as GPS fixes, `speed` m/s, compressed `rate` times faster. */
function simulate(line: [number, number][], speed = 3, rate = 10) {
  let i = 0
  let t = Date.now()
  const timer = setInterval(() => {
    if (i >= line.length) return clearInterval(timer)
    const [lon, lat] = line[i]
    if (i > 0) {
      const [plon, plat] = line[i - 1]
      const d = Math.hypot((lon - plon) * 111320 * Math.cos((lat * Math.PI) / 180), (lat - plat) * 110540)
      t += (d / speed) * 1000
    }
    onFix({ lat, lon, acc: 6, alt: 600 + 20 * Math.sin(i / 30), speed, heading: null, t })
    i++
  }, 1000 / rate)
  return () => clearInterval(timer)
}

export function install() {
  ;(window as unknown as { __redline: unknown }).__redline = { importUrls, simulate, onFix }
}
