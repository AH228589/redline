import { signal } from '@preact/signals'
import * as db from './db'
import { analyze, makeTrace } from './analyze'
import type { Activity, Gear, Goal, Route, Segment, SegmentEffort, Settings, Sport, Streams } from './types'
import { matchActivity } from './segments'

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  units: 'metric',
  theme: 'system',
  mapStyle: 'standard',
  weight: 72,
  maxHr: 190,
  restHr: 55,
  lthr: null,
  ftp: null,
  thresholdPace: null,
  voiceCues: true,
  autoPause: true,
  defaultSport: 'run',
}

export const DEFAULT_GOALS: Goal[] = [
  { id: 'g-week', metric: 'distance', period: 'week', group: 'all', target: 30000 },
  { id: 'g-year', metric: 'distance', period: 'year', group: 'all', target: 1000000 },
]

export const ready = signal(false)
export const activities = signal<Activity[]>([])
export const segments = signal<Segment[]>([])
export const efforts = signal<SegmentEffort[]>([])
export const routes = signal<Route[]>([])
export const settings = signal<Settings>(DEFAULT_SETTINGS)
export const goals = signal<Goal[]>(DEFAULT_GOALS)
export const gear = signal<Gear[]>([])
export const toast = signal<{ text: string; id: number } | null>(null)

let toastTimer = 0
export function notify(text: string) {
  clearTimeout(toastTimer)
  toast.value = { text, id: Date.now() }
  toastTimer = window.setTimeout(() => (toast.value = null), 3500)
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replace(/-/g, '').slice(0, 16)

const byStart = (a: Activity, b: Activity) => b.start - a.start

export async function loadAll() {
  const [acts, segs, effs, rts, st, gl, gr] = await Promise.all([
    db.getAll<Activity>('activities'),
    db.getAll<Segment>('segments'),
    db.getAll<SegmentEffort>('efforts'),
    db.getAll<Route>('routes'),
    db.kvGet<Settings>('settings'),
    db.kvGet<Goal[]>('goals'),
    db.kvGet<Gear[]>('gear'),
  ])
  activities.value = acts.sort(byStart)
  segments.value = segs.sort((a, b) => b.createdAt - a.createdAt)
  efforts.value = effs
  routes.value = rts.sort((a, b) => b.createdAt - a.createdAt)
  settings.value = { ...DEFAULT_SETTINGS, ...(st || {}) }
  goals.value = gl || DEFAULT_GOALS
  gear.value = gr || []
  ready.value = true
  db.persist()
}

// ---------- streams cache ----------
const cache = new Map<string, Streams>()
export async function getStreams(id: string): Promise<Streams | null> {
  const hit = cache.get(id)
  if (hit) return hit
  const row = await db.get<{ id: string; streams: Streams }>('streams', id)
  if (!row) return null
  cache.set(id, row.streams)
  if (cache.size > 12) cache.delete(cache.keys().next().value!)
  return row.streams
}

// ---------- activities ----------
export function buildActivity(streams: Streams, sport: Sport, name: string, extra: Partial<Activity> = {}): Activity {
  const summary = analyze(streams, sport, settings.value.weight)
  return {
    id: uid(),
    name,
    sport,
    start: streams.time[0],
    description: '',
    rpe: null,
    gearId: defaultGearFor(sport),
    source: 'import',
    hasGps: !!streams.lat,
    trace: makeTrace(streams),
    summary,
    createdAt: Date.now(),
    ...extra,
  }
}

export function defaultGearFor(sport: Sport) {
  return gear.value.find((g) => !g.retired && g.defaultFor.includes(sport))?.id ?? null
}

/** Activity that already exists at (nearly) the same time, used to skip duplicate imports. */
export function findDuplicate(start: number, distance: number) {
  return activities.value.find((a) => Math.abs(a.start - start) < 90_000 && Math.abs(a.summary.distance - distance) < Math.max(200, distance * 0.05))
}

export async function addActivity(act: Activity, streams: Streams | null, opts: { batch?: boolean } = {}) {
  await db.put('activities', act)
  if (streams) await db.put('streams', { id: act.id, streams })
  if (streams) cache.set(act.id, streams)
  let found: SegmentEffort[] = []
  if (streams && act.hasGps && segments.value.length) {
    found = matchActivity(act, streams, segments.value)
    await db.putMany('efforts', found)
  }
  if (!opts.batch) {
    activities.value = [act, ...activities.value.filter((a) => a.id !== act.id)].sort(byStart)
    if (found.length) efforts.value = [...efforts.value, ...found]
  }
  return { act, efforts: found }
}

/** Apply a batch of added activities to the signals in one update. */
export function commitBatch(acts: Activity[], effs: SegmentEffort[]) {
  if (acts.length) activities.value = [...acts, ...activities.value].sort(byStart)
  if (effs.length) efforts.value = [...efforts.value, ...effs]
}

export async function updateActivity(id: string, patch: Partial<Activity>) {
  const cur = activities.value.find((a) => a.id === id)
  if (!cur) return
  let next: Activity = { ...cur, ...patch }
  if (patch.sport && patch.sport !== cur.sport) {
    const s = await getStreams(id)
    if (s) next = { ...next, summary: analyze(s, patch.sport, settings.value.weight) }
  }
  await db.put('activities', next)
  activities.value = activities.value.map((a) => (a.id === id ? next : a)).sort(byStart)
}

export async function replaceStreams(id: string, streams: Streams) {
  const cur = activities.value.find((a) => a.id === id)
  if (!cur) return
  cache.set(id, streams)
  await db.put('streams', { id, streams })
  const next: Activity = { ...cur, summary: analyze(streams, cur.sport, settings.value.weight), trace: makeTrace(streams) }
  await db.put('activities', next)
  activities.value = activities.value.map((a) => (a.id === id ? next : a))
}

export async function deleteActivity(id: string) {
  const effIds = efforts.value.filter((e) => e.activityId === id).map((e) => e.id)
  await Promise.all([db.del('activities', id), db.del('streams', id), db.delMany('efforts', effIds)])
  cache.delete(id)
  activities.value = activities.value.filter((a) => a.id !== id)
  efforts.value = efforts.value.filter((e) => e.activityId !== id)
}

// ---------- segments ----------
export async function addSegment(seg: Segment, onProgress?: (done: number, total: number) => void) {
  await db.put('segments', seg)
  segments.value = [seg, ...segments.value]
  const found: SegmentEffort[] = []
  const pad = 0.002
  const cands = activities.value.filter(
    (a) => a.hasGps && a.summary.bbox && a.summary.bbox[0] - pad <= seg.bbox[0] && a.summary.bbox[1] - pad <= seg.bbox[1] && a.summary.bbox[2] + pad >= seg.bbox[2] && a.summary.bbox[3] + pad >= seg.bbox[3],
  )
  let i = 0
  for (const a of cands) {
    const s = await getStreams(a.id)
    if (s) found.push(...matchActivity(a, s, [seg]))
    onProgress?.(++i, cands.length)
  }
  await db.putMany('efforts', found)
  efforts.value = [...efforts.value, ...found]
  return found
}

export async function updateSegment(id: string, patch: Partial<Segment>) {
  const next = segments.value.map((s) => (s.id === id ? { ...s, ...patch } : s))
  const seg = next.find((s) => s.id === id)
  if (seg) await db.put('segments', seg)
  segments.value = next
}

export async function deleteSegment(id: string) {
  const effIds = efforts.value.filter((e) => e.segmentId === id).map((e) => e.id)
  await Promise.all([db.del('segments', id), db.delMany('efforts', effIds)])
  segments.value = segments.value.filter((s) => s.id !== id)
  efforts.value = efforts.value.filter((e) => e.segmentId !== id)
}

// ---------- routes ----------
export async function saveRoute(r: Route) {
  await db.put('routes', r)
  routes.value = [r, ...routes.value.filter((x) => x.id !== r.id)].sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteRoute(id: string) {
  await db.del('routes', id)
  routes.value = routes.value.filter((r) => r.id !== id)
}

// ---------- settings, goals, gear ----------
export async function saveSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch }
  await db.kvSet('settings', settings.value)
}

export async function saveGoals(next: Goal[]) {
  goals.value = next
  await db.kvSet('goals', next)
}

export async function saveGear(next: Gear[]) {
  gear.value = next
  await db.kvSet('gear', next)
}

/** Re-run analysis on every activity, e.g. after a weight change or an algorithm update. */
export async function reanalyzeAll(onProgress?: (done: number, total: number) => void) {
  const list = activities.value
  const out: Activity[] = []
  let i = 0
  for (const a of list) {
    const s = await getStreams(a.id)
    out.push(s ? { ...a, summary: analyze(s, a.sport, settings.value.weight), trace: makeTrace(s) } : a)
    onProgress?.(++i, list.length)
    if (i % 20 === 0) await new Promise((r) => setTimeout(r))
  }
  await db.putMany('activities', out)
  activities.value = out.sort(byStart)
}

export async function wipeAll() {
  await Promise.all((['activities', 'streams', 'segments', 'efforts', 'routes', 'kv'] as const).map((s) => db.clear(s)))
  cache.clear()
  await loadAll()
}
