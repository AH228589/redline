import { gunzipSync, unzipSync } from 'fflate'
import { buildStreams, type RawPoint } from './analyze'
import { lineLength } from './geo'
import { defaultName, sportFromText } from './sports'
import { activities, addActivity, buildActivity, commitBatch, findDuplicate, saveRoute, settings, uid } from './store'
import type { Activity, Route, SegmentEffort, Sport, Streams, Summary } from './types'

export type Parsed =
  | { kind: 'activity'; streams: Streams; sport: Sport | null; name: string | null; description?: string }
  | { kind: 'route'; name: string; points: [number, number, number][] }

const num = (s: string | null | undefined) => (s == null || s === '' ? undefined : Number(s))

function kids(el: Element, name: string): Element[] {
  const out: Element[] = []
  for (const c of Array.from(el.children)) if (c.localName === name) out.push(c)
  return out
}
const kid = (el: Element | undefined, name: string) => (el ? kids(el, name)[0] : undefined)
const text = (el: Element | undefined, name: string) => kid(el, name)?.textContent?.trim()
const deep = (el: Element, name: string) => el.getElementsByTagNameNS('*', name)[0] ?? el.getElementsByTagName(name)[0]

function parseXml(src: string) {
  const doc = new DOMParser().parseFromString(src.replace(/^﻿/, '').trim(), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not valid XML')
  return doc
}

export function parseGpx(src: string): Parsed[] {
  const doc = parseXml(src)
  const out: Parsed[] = []
  const metaName = text(kid(doc.documentElement, 'metadata'), 'name')
  for (const trk of Array.from(doc.getElementsByTagNameNS('*', 'trk'))) {
    const name = text(trk, 'name') || metaName || null
    const type = text(trk, 'type')
    const pts: RawPoint[] = []
    const shape: [number, number, number][] = []
    for (const seg of kids(trk, 'trkseg')) {
      for (const p of kids(seg, 'trkpt')) {
        const lat = num(p.getAttribute('lat'))!
        const lon = num(p.getAttribute('lon'))!
        const ele = num(text(p, 'ele'))
        const t = text(p, 'time')
        const ext = kid(p, 'extensions')
        const pick = (n: string) => (ext ? num(deep(ext, n)?.textContent?.trim()) : undefined)
        shape.push([lon, lat, ele ?? NaN])
        if (t) pts.push({ time: Date.parse(t), lat, lon, ele, hr: pick('hr'), cad: pick('cad'), pwr: pick('power') ?? pick('PowerInWatts') })
      }
    }
    if (pts.length >= 2) {
      const streams = buildStreams(pts)
      if (streams) out.push({ kind: 'activity', streams, sport: sportFromText(type), name })
    } else if (shape.length >= 2) out.push({ kind: 'route', name: name || 'Imported route', points: shape })
  }
  for (const rte of Array.from(doc.getElementsByTagNameNS('*', 'rte'))) {
    const pts = kids(rte, 'rtept').map((p) => [num(p.getAttribute('lon'))!, num(p.getAttribute('lat'))!, num(text(p, 'ele')) ?? NaN] as [number, number, number])
    if (pts.length >= 2) out.push({ kind: 'route', name: text(rte, 'name') || metaName || 'Imported route', points: pts })
  }
  return out
}

export function parseTcx(src: string): Parsed[] {
  const doc = parseXml(src)
  const out: Parsed[] = []
  for (const act of Array.from(doc.getElementsByTagNameNS('*', 'Activity'))) {
    const pts: RawPoint[] = []
    for (const tp of Array.from(act.getElementsByTagNameNS('*', 'Trackpoint'))) {
      const pos = kid(tp, 'Position')
      const ext = kid(tp, 'Extensions')
      const x = (n: string) => (ext ? num(deep(ext, n)?.textContent?.trim()) : undefined)
      pts.push({
        time: Date.parse(text(tp, 'Time') || ''),
        lat: num(text(pos, 'LatitudeDegrees')),
        lon: num(text(pos, 'LongitudeDegrees')),
        ele: num(text(tp, 'AltitudeMeters')),
        dist: num(text(tp, 'DistanceMeters')),
        hr: num(text(kid(tp, 'HeartRateBpm'), 'Value')),
        cad: num(text(tp, 'Cadence')) ?? x('RunCadence'),
        pwr: x('Watts'),
      })
    }
    const streams = buildStreams(pts)
    if (streams) out.push({ kind: 'activity', streams, sport: sportFromText(act.getAttribute('Sport')), name: text(act, 'Notes') || null })
  }
  for (const c of Array.from(doc.getElementsByTagNameNS('*', 'Course'))) {
    const pts: [number, number, number][] = []
    for (const tp of Array.from(c.getElementsByTagNameNS('*', 'Trackpoint'))) {
      const pos = kid(tp, 'Position')
      const lat = num(text(pos, 'LatitudeDegrees')), lon = num(text(pos, 'LongitudeDegrees'))
      if (lat != null && lon != null) pts.push([lon, lat, num(text(tp, 'AltitudeMeters')) ?? NaN])
    }
    if (pts.length >= 2) out.push({ kind: 'route', name: text(c, 'Name') || 'Imported course', points: pts })
  }
  return out
}

const SEMI = 180 / 2 ** 31

export async function parseFit(bytes: Uint8Array): Promise<Parsed[]> {
  const { Decoder, Stream } = await import('@garmin/fitsdk')
  const stream = Stream.fromByteArray(bytes)
  const decoder = new Decoder(stream)
  if (!decoder.isFIT()) throw new Error('Not a FIT file')
  const { messages } = decoder.read()
  // The SDK types are generated per message; we only read a handful of plain fields.
  const m = messages as unknown as Record<string, Record<string, unknown>[] | undefined>
  const recs = m.recordMesgs || []
  const sess = (m.sessionMesgs || [])[0]
  const fileType = (m.fileIdMesgs || [])[0]?.type
  const sportTxt = sess ? `${sess.subSport ?? ''} ${sess.sport ?? ''}` : String(((m.sportMesgs || [])[0]?.sport) ?? '')
  const pts: RawPoint[] = recs.map((r) => {
    const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : undefined)
    const ts = r.timestamp instanceof Date ? r.timestamp.getTime() : NaN
    const lat = n('positionLat'), lon = n('positionLong')
    const cad = n('cadence')
    return {
      time: ts,
      lat: lat != null ? lat * SEMI : undefined,
      lon: lon != null ? lon * SEMI : undefined,
      ele: n('enhancedAltitude') ?? n('altitude'),
      hr: n('heartRate'),
      cad: cad != null ? cad + (n('fractionalCadence') ?? 0) : undefined,
      pwr: n('power'),
      dist: n('distance'),
    }
  })
  if (fileType === 'course') {
    const shape = pts.filter((p) => p.lat != null && p.lon != null).map((p) => [p.lon!, p.lat!, p.ele ?? NaN] as [number, number, number])
    const name = String(((m.courseMesgs || [])[0]?.name) ?? 'Imported course')
    return shape.length >= 2 ? [{ kind: 'route', name, points: shape }] : []
  }
  const streams = buildStreams(pts)
  return streams ? [{ kind: 'activity', streams, sport: sportFromText(sportTxt), name: null }] : []
}

// ---------- Strava bulk export ----------
export function parseCsv(src: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else q = false
      } else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

interface CsvMeta {
  name: string
  type: string
  description: string
  date: number
  elapsed: number
  distance: number
  file: string
}

function readActivitiesCsv(src: string): CsvMeta[] {
  const rows = parseCsv(src)
  if (rows.length < 2) return []
  const head = rows[0].map((h) => h.trim().toLowerCase())
  const col = (name: string, nth = 0) => {
    let seen = 0
    for (let i = 0; i < head.length; i++) if (head[i] === name && seen++ === nth) return i
    return -1
  }
  const iName = col('activity name'), iType = col('activity type'), iDesc = col('activity description'), iDate = col('activity date')
  const iElapsed = col('elapsed time'), iDistKm = col('distance'), iDistM = col('distance', 1), iFile = col('filename')
  return rows.slice(1).filter((r) => r.length > 3).map((r) => {
    const rawDate = r[iDate] || ''
    let date = Date.parse(`${rawDate} UTC`)
    if (isNaN(date)) date = Date.parse(rawDate)
    const distM = iDistM >= 0 ? Number(r[iDistM]) : NaN
    const distKm = Number((r[iDistKm] || '').replace(/,/g, ''))
    return {
      name: r[iName] || '',
      type: r[iType] || '',
      description: r[iDesc] || '',
      date,
      elapsed: Number(r[iElapsed]) || 0,
      distance: isFinite(distM) && distM > 0 ? distM : isFinite(distKm) ? distKm * 1000 : 0,
      file: (r[iFile] || '').trim().toLowerCase(),
    }
  })
}

// ---------- manual activities ----------
export function emptySummary(distance: number, time: number, gain: number): Summary {
  return {
    distance, movingTime: time, elapsedTime: time, elevGain: gain, elevLoss: gain, elevMin: null, elevMax: null,
    avgSpeed: time > 0 ? distance / time : 0, maxSpeed: 0, gapSpeed: null, avgHr: null, maxHr: null, avgCad: null,
    avgPower: null, maxPower: null, np: null, work: null, calories: 0, splitsKm: [], splitsMi: [], bestEfforts: {},
    powerCurve: null, hrHist: null, bbox: null,
  }
}

export function buildManual(o: { sport: Sport; name: string; start: number; time: number; distance: number; gain: number; rpe: number | null; description?: string }): Activity {
  const s = emptySummary(o.distance, o.time, o.gain)
  const kg = settings.value.weight
  s.calories = Math.round(o.distance > 0 ? kg * (o.distance / 1000) * 0.9 : 6 * kg * (o.time / 3600))
  return {
    id: uid(), name: o.name, sport: o.sport, start: o.start, description: o.description || '', rpe: o.rpe, gearId: null,
    source: 'manual', hasGps: false, trace: [], summary: s, createdAt: Date.now(),
  }
}

// ---------- entry point ----------
export interface ImportResult {
  added: number
  skipped: number
  routes: number
  failed: string[]
}

interface Item { name: string; bytes: Uint8Array }

function guessSport(st: Streams): Sport {
  const n = st.time.length
  const dur = (st.time[n - 1] - st.time[0]) / 1000
  const v = dur > 0 ? st.dist[n - 1] / dur : 0
  if (st.pwr) return 'ride'
  return v > 4.2 ? 'ride' : v > 1.9 ? 'run' : v > 0.3 ? 'walk' : settings.value.defaultSport
}

async function parseItem(item: Item): Promise<Parsed[]> {
  const lower = item.name.toLowerCase()
  if (lower.endsWith('.gz')) return parseItem({ name: item.name.slice(0, -3), bytes: gunzipSync(item.bytes) })
  if (lower.endsWith('.fit')) return parseFit(item.bytes)
  const txt = new TextDecoder().decode(item.bytes)
  if (lower.endsWith('.gpx')) return parseGpx(txt)
  if (lower.endsWith('.tcx')) return parseTcx(txt)
  throw new Error('Unsupported file type')
}

export async function importFiles(files: File[], onProgress?: (done: number, total: number, label: string) => void): Promise<ImportResult> {
  const res: ImportResult = { added: 0, skipped: 0, routes: 0, failed: [] }
  const items: Item[] = []
  let csv: CsvMeta[] = []
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    if (f.name.toLowerCase().endsWith('.zip')) {
      onProgress?.(0, 1, 'Unpacking archive')
      const zipped = unzipSync(bytes, { filter: (z) => /\.(gpx|tcx|fit)(\.gz)?$/i.test(z.name) || /(^|\/)activities\.csv$/i.test(z.name) })
      for (const [name, data] of Object.entries(zipped)) {
        if (/activities\.csv$/i.test(name)) csv = readActivitiesCsv(new TextDecoder().decode(data))
        else items.push({ name, bytes: data })
      }
    } else items.push({ name: f.name, bytes })
  }
  const metaByFile = new Map(csv.filter((c) => c.file).map((c) => [c.file.split('/').pop()!, c]))
  const added: Activity[] = []
  const effs: SegmentEffort[] = []
  const known = () => [...added, ...activities.value]
  const isDup = (start: number, dist: number) =>
    !!findDuplicate(start, dist) || added.some((a) => Math.abs(a.start - start) < 90_000 && Math.abs(a.summary.distance - dist) < Math.max(200, dist * 0.05))

  let done = 0
  const total = items.length + csv.filter((c) => !c.file).length
  for (const item of items) {
    onProgress?.(done, total, item.name.split('/').pop()!)
    try {
      const meta = metaByFile.get(item.name.toLowerCase().split('/').pop()!)
      for (const p of await parseItem(item)) {
        if (p.kind === 'route') {
          const pts = p.points
          let gain = 0, loss = 0
          for (let i = 1; i < pts.length; i++) {
            const d = pts[i][2] - pts[i - 1][2]
            if (d > 0) gain += d
            else if (d < 0) loss -= d
          }
          const r: Route = {
            id: uid(), name: p.name, sport: settings.value.defaultSport, profile: 'imported', waypoints: [pts[0].slice(0, 2) as [number, number], pts[pts.length - 1].slice(0, 2) as [number, number]],
            geometry: pts, distance: lineLength(pts), elevGain: isFinite(gain) ? gain : 0, elevLoss: isFinite(loss) ? loss : 0, createdAt: Date.now(), offline: false,
          }
          await saveRoute(r)
          res.routes++
          continue
        }
        const st = p.streams
        const sport = sportFromText(meta?.type) ?? p.sport ?? guessSport(st)
        const dist = st.dist[st.dist.length - 1]
        if (isDup(st.time[0], dist)) { res.skipped++; continue }
        const name = meta?.name || p.name || defaultName(sport, st.time[0])
        const source = item.name.toLowerCase().replace(/\.gz$/, '').split('.').pop() || 'file'
        const act = buildActivity(st, sport, name, { description: meta?.description || '', source })
        const r = await addActivity(act, st, { batch: true })
        added.push(act)
        effs.push(...r.efforts)
        res.added++
      }
    } catch (e) {
      console.warn('import failed', item.name, e)
      res.failed.push(item.name.split('/').pop()!)
    }
    done++
    if (done % 3 === 0) {
      commitBatch(added.splice(0), effs.splice(0))
      await new Promise((r) => setTimeout(r))
    }
  }
  // Activities in the export with no file (manual entries) still count toward training history.
  for (const c of csv.filter((c) => !c.file && isFinite(c.date) && c.elapsed > 0)) {
    const sport = sportFromText(c.type) ?? 'other'
    if (known().some((a) => Math.abs(a.start - c.date) < 90_000)) { res.skipped++; done++; continue }
    const act = buildManual({ sport, name: c.name || defaultName(sport, c.date), start: c.date, time: c.elapsed, distance: c.distance, gain: 0, rpe: null, description: c.description })
    await addActivity(act, null, { batch: true })
    added.push(act)
    res.added++
    done++
  }
  commitBatch(added, effs)
  onProgress?.(total, total, 'Done')
  return res
}

// ---------- export ----------
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)

export function activityToGpx(a: Activity, s: Streams) {
  const pts: string[] = []
  for (let i = 0; i < s.time.length; i++) {
    if (!s.lat || !s.lon) break
    const ext: string[] = []
    if (s.hr && isFinite(s.hr[i])) ext.push(`<gpxtpx:hr>${Math.round(s.hr[i])}</gpxtpx:hr>`)
    if (s.cad && isFinite(s.cad[i])) ext.push(`<gpxtpx:cad>${Math.round(s.cad[i])}</gpxtpx:cad>`)
    const pw = s.pwr && isFinite(s.pwr[i]) ? `<power>${Math.round(s.pwr[i])}</power>` : ''
    pts.push(
      `<trkpt lat="${s.lat[i].toFixed(7)}" lon="${s.lon[i].toFixed(7)}">${s.ele && isFinite(s.ele[i]) ? `<ele>${s.ele[i].toFixed(1)}</ele>` : ''}<time>${new Date(s.time[i]).toISOString()}</time>${ext.length || pw ? `<extensions>${pw}${ext.length ? `<gpxtpx:TrackPointExtension>${ext.join('')}</gpxtpx:TrackPointExtension>` : ''}</extensions>` : ''}</trkpt>`,
    )
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Redline" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<metadata><name>${esc(a.name)}</name><time>${new Date(a.start).toISOString()}</time></metadata>
<trk><name>${esc(a.name)}</name><type>${a.sport}</type><trkseg>
${pts.join('\n')}
</trkseg></trk></gpx>`
}

export function routeToGpx(r: Route) {
  const pts = r.geometry.map(([lon, lat, ele]) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${isFinite(ele) ? `<ele>${ele.toFixed(1)}</ele>` : ''}</trkpt>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Redline" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(r.name)}</name></metadata>
<trk><name>${esc(r.name)}</name><trkseg>
${pts.join('\n')}
</trkseg></trk></gpx>`
}

export function download(name: string, data: BlobPart, type = 'application/gpx+xml') {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const safeFile = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'redline'
