import { distLL, nearestOnLine } from './geo'
import { sportGroup } from './sports'
import { settings } from './store'
import type { Activity, Goal, SegmentEffort, Settings, SportGroup } from './types'
import { BEST_EFFORT_DISTANCES } from './units'

const DAY = 86400000

export const dayStart = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
export const weekStart = (t: number) => {
  const d = new Date(dayStart(t))
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime()
}
export const monthStart = (t: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}
export const yearStart = (t: number) => new Date(new Date(t).getFullYear(), 0, 1).getTime()
export const addDays = (t: number, n: number) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

export const inGroup = (a: Activity, g: SportGroup | 'all') => g === 'all' || sportGroup(a.sport) === g

// ---------- training load ----------
export type LoadMethod = 'power' | 'heart rate' | 'pace' | 'perceived effort' | 'duration'

const trimpK = (hrr: number) => hrr * 0.64 * Math.exp(1.92 * hrr)

export function lthrOf(st: Settings) {
  return st.lthr ?? Math.round(st.maxHr * 0.9)
}

export function thresholdSpeed(st: Settings, acts: Activity[]) {
  if (st.thresholdPace) return 1000 / st.thresholdPace
  const est = estimateThresholdPace(acts)
  return est ? 1000 / est : 3.3
}

let thrCache: { acts: Activity[]; v: number | null } | null = null

export function activityLoad(a: Activity, acts: Activity[], st: Settings = settings.value): { load: number; method: LoadMethod } {
  const s = a.summary
  const hours = s.movingTime / 3600
  const g = sportGroup(a.sport)
  if (s.np && st.ftp && g === 'bike') {
    const IF = s.np / st.ftp
    return { load: hours * IF * IF * 100, method: 'power' }
  }
  if (s.hrHist && st.maxHr > st.restHr) {
    const span = st.maxHr - st.restHr
    let trimp = 0
    for (let bpm = 0; bpm < s.hrHist.length; bpm++) {
      const sec = s.hrHist[bpm]
      if (!sec) continue
      trimp += (sec / 60) * trimpK(Math.max(0, Math.min(1, (bpm - st.restHr) / span)))
    }
    const ref = 60 * trimpK(Math.max(0, Math.min(1, (lthrOf(st) - st.restHr) / span)))
    if (trimp > 0 && ref > 0) return { load: (trimp / ref) * 100, method: 'heart rate' }
  }
  if (g === 'foot' && s.distance > 0 && a.sport !== 'walk' && a.sport !== 'hike') {
    if (!thrCache || thrCache.acts !== acts) thrCache = { acts, v: null }
    if (thrCache.v == null) thrCache.v = thresholdSpeed(st, acts)
    const IF = Math.min(1.3, (s.gapSpeed ?? s.avgSpeed) / thrCache.v)
    return { load: hours * IF * IF * 100, method: 'pace' }
  }
  if (a.rpe) return { load: (s.movingTime / 60) * a.rpe * 0.2, method: 'perceived effort' }
  const base = g === 'bike' ? 0.5 : a.sport === 'walk' ? 0.35 : a.sport === 'hike' ? 0.6 : 0.65
  return { load: (s.movingTime / 60) * base, method: 'duration' }
}

export function loadLabel(load: number) {
  if (load < 25) return 'Light'
  if (load < 60) return 'Moderate'
  if (load < 100) return 'Hard'
  if (load < 150) return 'Very hard'
  return 'Extreme'
}

export interface FitnessDay {
  day: number
  load: number
  fitness: number
  fatigue: number
  form: number
}

export function fitnessSeries(acts: Activity[], st: Settings = settings.value): FitnessDay[] {
  if (!acts.length) return []
  const byDay = new Map<number, number>()
  for (const a of acts) {
    const d = dayStart(a.start)
    byDay.set(d, (byDay.get(d) || 0) + activityLoad(a, acts, st).load)
  }
  const first = dayStart(Math.min(...acts.map((a) => a.start)))
  const today = dayStart(Date.now())
  const out: FitnessDay[] = []
  let ctl = 0, atl = 0
  const kc = 1 - Math.exp(-1 / 42)
  const ka = 1 - Math.exp(-1 / 7)
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const load = byDay.get(d) || 0
    const form = ctl - atl
    ctl += (load - ctl) * kc
    atl += (load - atl) * ka
    out.push({ day: d, load, fitness: ctl, fatigue: atl, form })
  }
  return out
}

export function formLabel(form: number) {
  if (form > 15) return 'Detraining'
  if (form > 5) return 'Fresh'
  if (form > -10) return 'Neutral'
  if (form > -30) return 'Productive'
  return 'Overreaching'
}

// ---------- aggregates ----------
export interface Totals {
  count: number
  distance: number
  time: number
  elev: number
}

export function totals(acts: Activity[]): Totals {
  const t = { count: 0, distance: 0, time: 0, elev: 0 }
  for (const a of acts) {
    t.count++
    t.distance += a.summary.distance
    t.time += a.summary.movingTime
    t.elev += a.summary.elevGain
  }
  return t
}

export function periodStart(period: Goal['period'], t = Date.now()) {
  return period === 'week' ? weekStart(t) : period === 'month' ? monthStart(t) : yearStart(t)
}

export function periodEnd(period: Goal['period'], t = Date.now()) {
  const s = new Date(periodStart(period, t))
  if (period === 'week') return addDays(s.getTime(), 7)
  if (period === 'month') return new Date(s.getFullYear(), s.getMonth() + 1, 1).getTime()
  return new Date(s.getFullYear() + 1, 0, 1).getTime()
}

export function goalProgress(g: Goal, acts: Activity[]) {
  const from = periodStart(g.period)
  const to = periodEnd(g.period)
  const t = totals(acts.filter((a) => a.start >= from && a.start < to && inGroup(a, g.group)))
  const value = g.metric === 'distance' ? t.distance : g.metric === 'time' ? t.time : g.metric === 'elevation' ? t.elev : t.count
  const elapsedShare = Math.min(1, (Date.now() - from) / (to - from))
  return { value, share: g.target ? value / g.target : 0, expected: elapsedShare * g.target, from, to }
}

export function weeklyBuckets(acts: Activity[], weeks: number) {
  const thisWeek = weekStart(Date.now())
  const out: { start: number; t: Totals; acts: Activity[] }[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const s = addDays(thisWeek, -7 * i)
    const e = addDays(s, 7)
    const list = acts.filter((a) => a.start >= s && a.start < e)
    out.push({ start: s, t: totals(list), acts: list })
  }
  return out
}

export function monthlyBuckets(acts: Activity[], months: number) {
  const now = new Date()
  const out: { start: number; t: Totals }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const s = new Date(now.getFullYear(), now.getMonth() - i, 1).getTime()
    const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime()
    out.push({ start: s, t: totals(acts.filter((a) => a.start >= s && a.start < e)) })
  }
  return out
}

/** Cumulative distance by day of year for a given year. */
export function cumulativeYear(acts: Activity[], year: number, metric: 'distance' | 'time' | 'elev') {
  const s = new Date(year, 0, 1).getTime()
  const days = Math.round((new Date(year + 1, 0, 1).getTime() - s) / DAY)
  const daily = new Array(days).fill(0)
  for (const a of acts) {
    if (new Date(a.start).getFullYear() !== year) continue
    const idx = Math.floor((dayStart(a.start) - s) / DAY + 0.01)
    daily[Math.max(0, Math.min(days - 1, idx))] += metric === 'distance' ? a.summary.distance : metric === 'time' ? a.summary.movingTime : a.summary.elevGain
  }
  let c = 0
  return daily.map((v) => (c += v))
}

export function weekStreak(acts: Activity[]) {
  let w = weekStart(Date.now())
  const weeks = new Set(acts.map((a) => weekStart(a.start)))
  let n = 0
  if (!weeks.has(w)) w = addDays(w, -7)
  while (weeks.has(w)) { n++; w = addDays(w, -7) }
  return n
}

// ---------- records ----------
export interface BestRow {
  m: number
  label: string
  time: number
  activityId: string
  start: number
}

/** Top efforts for each standard distance, optionally only before a moment. */
export function bestEffortTable(acts: Activity[], opts: { since?: number; before?: number; top?: number } = {}) {
  const out = new Map<number, BestRow[]>()
  for (const { m, label } of BEST_EFFORT_DISTANCES) {
    const rows: BestRow[] = []
    for (const a of acts) {
      if (opts.since && a.start < opts.since) continue
      if (opts.before && a.start >= opts.before) continue
      const t = a.summary.bestEfforts?.[String(m)]
      if (t) rows.push({ m, label, time: t, activityId: a.id, start: a.start })
    }
    rows.sort((x, y) => x.time - y.time)
    if (rows.length) out.set(m, rows.slice(0, opts.top ?? 3))
  }
  return out
}

/** Rank (1-based) this activity's efforts held when they were set; only top 3 are reported. */
export function effortRanks(a: Activity, acts: Activity[]) {
  const out: { m: number; label: string; time: number; rank: number }[] = []
  for (const { m, label } of BEST_EFFORT_DISTANCES) {
    const t = a.summary.bestEfforts?.[String(m)]
    if (!t) continue
    let better = 0
    for (const b of acts) {
      if (b.id === a.id || b.start > a.start) continue
      const bt = b.summary.bestEfforts?.[String(m)]
      if (bt && bt < t) better++
    }
    out.push({ m, label, time: t, rank: better + 1 })
  }
  return out
}

export function segmentRank(e: SegmentEffort, all: SegmentEffort[]) {
  let better = 0
  for (const o of all) if (o.segmentId === e.segmentId && o.id !== e.id && o.start <= e.start && o.elapsed < e.elapsed) better++
  return better + 1
}

export function riegel(t1: number, d1: number, d2: number) {
  return t1 * (d2 / d1) ** 1.06
}

export function racePredictions(acts: Activity[]) {
  const since = Date.now() - 120 * DAY
  const recent = bestEffortTable(acts.filter((a) => sportGroup(a.sport) === 'foot'), { since, top: 1 })
  const efforts = [...recent.values()].map((r) => r[0]).filter((r) => r.m >= 1600)
  if (!efforts.length) return []
  const targets = [
    { m: 5000, label: '5K' },
    { m: 10000, label: '10K' },
    { m: 21097.5, label: 'Half Marathon' },
    { m: 42195, label: 'Marathon' },
  ]
  return targets.map((t) => {
    const src = efforts.slice().sort((a, b) => Math.abs(Math.log(a.m / t.m)) - Math.abs(Math.log(b.m / t.m)))[0]
    return { ...t, time: riegel(src.time, src.m, t.m), from: src }
  })
}

/** Seconds per km you could hold for about an hour, from recent best efforts. */
export function estimateThresholdPace(acts: Activity[]) {
  const since = Date.now() - 180 * DAY
  const table = bestEffortTable(acts.filter((a) => sportGroup(a.sport) === 'foot'), { since, top: 1 })
  const pref = [10000, 5000, 15000, 21097.5, 3218.688]
  for (const m of pref) {
    const row = table.get(m)?.[0]
    if (row) {
      const d = m * (3600 / row.time) ** (1 / 1.06)
      return 3600 / (d / 1000)
    }
  }
  return null
}

export function estimateFtp(acts: Activity[]) {
  const since = Date.now() - 180 * DAY
  let best = 0
  for (const a of acts) if (a.start >= since && a.summary.powerCurve?.['1200']) best = Math.max(best, a.summary.powerCurve['1200'])
  return best ? Math.round(best * 0.95) : null
}

export function detectedMaxHr(acts: Activity[]) {
  const vals = acts.map((a) => a.summary.maxHr).filter((v): v is number => !!v && v < 225).sort((a, b) => b - a)
  return vals.length ? Math.round(vals[Math.min(1, vals.length - 1)]) : null
}

export function bestPowerCurve(acts: Activity[], since = 0) {
  const out: Record<string, { w: number; id: string }> = {}
  for (const a of acts) {
    if (a.start < since || !a.summary.powerCurve) continue
    for (const [d, w] of Object.entries(a.summary.powerCurve)) if (!out[d] || w > out[d].w) out[d] = { w, id: a.id }
  }
  return out
}

// ---------- matched activities ----------
export function matchedActivities(a: Activity, acts: Activity[]) {
  if (a.trace.length < 4) return []
  const g = sportGroup(a.sport)
  const start = a.trace[0], end = a.trace[a.trace.length - 1]
  const samples: [number, number][] = []
  const step = Math.max(1, Math.floor(a.trace.length / 24))
  for (let i = 0; i < a.trace.length; i += step) samples.push(a.trace[i])
  return acts.filter((b) => {
    if (b.id === a.id || sportGroup(b.sport) !== g || b.trace.length < 4) return false
    if (Math.abs(b.summary.distance - a.summary.distance) > a.summary.distance * 0.08) return false
    if (distLL(b.trace[0], start) > 250 || distLL(b.trace[b.trace.length - 1], end) > 250) return false
    let ok = 0
    for (const p of samples) if (nearestOnLine(p, b.trace).dist < 80) ok++
    return ok >= samples.length * 0.85
  })
}
