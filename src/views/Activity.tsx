import { useEffect, useMemo, useState } from 'preact/hooks'
import { useSignal, type Signal } from '@preact/signals'
import { MapView, cssVar, type MapLine, type MapPoint } from '../components/MapView'
import { dateTicks, fmtTick, XYChart, ZoneBars, type Series } from '../components/charts'
import { Icon } from '../components/Icon'
import { Card, Empty, Medal, Seg, Sheet, SportIcon, Stat, Progress } from '../components/ui'
import { activityToGpx, download, safeFile } from '../lib/importers'
import { go } from '../lib/router'
import { correctElevation } from '../lib/routing'
import { detectClimbs, segmentFromRange, type Climb } from '../lib/segments'
import { fillGaps, findGaps } from '../lib/gaps'
import { derive, DIVERGE, HEAT_RAMP, HR_ZONES, PACE_ZONES, percentile, POWER_ZONES, rampColor, ZONE_RAMP, zoneTimes, type Derived } from '../lib/series'
import { SPORT_LIST, SPORTS, sportGroup, usesPace } from '../lib/sports'
import { activities, addSegment, deleteActivity, efforts, gear, getStreams, notify, replaceStreams, segments, settings, uid, updateActivity } from '../lib/store'
import { activityLoad, bestPowerCurve, effortRanks, loadLabel, matchedActivities, segmentRank, thresholdSpeed } from '../lib/training'
import type { Activity, Sport, Streams } from '../lib/types'
import {
  distNum, distUnit, elevNum, elevUnit, fmtDate, fmtDist, fmtDuration, fmtDurShort, fmtElev, fmtPace, fmtPaceOrSpeed, fmtShortDist, fmtSpeed, fmtTime, paceOrSpeedLabel, speedNum, speedUnit, unitLen, POWER_DURATIONS,
} from '../lib/units'

export function ActivityView({ id }: { id: string }) {
  const a = activities.value.find((x) => x.id === id)
  const [s, setS] = useState<Streams | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setS(undefined)
    getStreams(id).then((v) => live && setS(v))
    return () => {
      live = false
    }
  }, [id, a?.summary])
  if (!a)
    return (
      <Empty icon="info" title="Activity not found">
        <a class="btn" href="#/">
          Back home
        </a>
      </Empty>
    )
  return <ActivityBody key={a.id} a={a} s={s ?? null} loading={s === undefined} />
}

type ColorBy = 'none' | 'pace' | 'hr' | 'elev' | 'grade'

function ActivityBody({ a, s, loading }: { a: Activity; s: Streams | null; loading: boolean }) {
  const all = activities.value
  const sum = a.summary
  const d = useMemo(() => (s ? derive(s, a.sport) : null), [s, a.sport])
  const hover = useSignal<number | null>(null)
  const [sel, setSel] = useState<[number, number] | null>(null)
  const [focus, setFocus] = useState<{ a: number; b: number } | null>(null)
  const [xMode, setXMode] = useState<'dist' | 'time'>('dist')
  const [colorBy, setColorBy] = useState<ColorBy>('none')
  const [terrain, setTerrain] = useState(false)
  const [editing, setEditing] = useState(false)
  const [segSheet, setSegSheet] = useState<{ a: number; b: number; name: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const coords = useMemo<[number, number][]>(() => (s?.lat && s.lon ? s.lon.map((x, i) => [x, s.lat![i]]) : a.trace), [s, a.trace])
  const hasMap = coords.length > 1
  const load = activityLoad(a, all)
  const ranks = useMemo(() => effortRanks(a, all), [a, all])
  const myEfforts = efforts.value
    .filter((e) => e.activityId === a.id)
    .map((e) => ({ e, seg: segments.value.find((g) => g.id === e.segmentId), rank: segmentRank(e, efforts.value), pr: efforts.value.filter((o) => o.segmentId === e.segmentId).reduce((m, o) => Math.min(m, o.elapsed), Infinity) }))
    .filter((x) => x.seg)
    .sort((x, y) => x.e.startIdx - y.e.startIdx)
  const climbs = useMemo(() => (s ? detectClimbs(s) : []), [s])
  const gaps = useMemo(() => (s ? findGaps(s) : []), [s])
  const matched = useMemo(() => matchedActivities(a, all), [a, all])

  // Gradient colouring of the route line.
  const gradient = useMemo(() => {
    if (!d || colorBy === 'none' || !s?.lat) return null
    const vals = colorBy === 'pace' ? d.speed : colorBy === 'hr' ? d.hr : colorBy === 'elev' ? d.ele : d.grade
    if (!vals) return null
    const total = d.dist[d.n - 1] || 1
    let lo: number, hi: number
    if (colorBy === 'grade') { lo = -0.12; hi = 0.12 } else { lo = percentile(vals, 0.05); hi = percentile(vals, 0.95) }
    const ramp = colorBy === 'grade' ? DIVERGE : HEAT_RAMP
    const stops: [number, string][] = []
    let last = -1
    let prevC = rampColor(ramp, 0.5)
    const step = Math.max(1, Math.floor(d.n / 180))
    for (let i = 0; i < d.n; i += step) {
      const p = d.dist[i] / total
      if (p <= last + 1e-6) continue
      const v = vals[i]
      const c = isFinite(v) ? rampColor(ramp, (v - lo) / (hi - lo || 1)) : prevC
      prevC = c
      stops.push([p, c])
      last = p
    }
    if (last < 1) stops.push([1, prevC])
    return { stops, lo, hi, ramp }
  }, [d, colorBy, s])

  const lines: MapLine[] = []
  if (hasMap) {
    lines.push({ id: 'main', coords, color: cssVar('--accent'), width: 4, gradient: gradient?.stops })
    if (focus) lines.push({ id: 'focus', coords: coords.slice(focus.a, focus.b + 1), color: cssVar('--s1'), width: 6 })
    if (sel) lines.push({ id: 'sel', coords: coords.slice(sel[0], sel[1] + 1), color: '#0b0b0b', width: 6 })
    // Stretches traced along roads after a GPS dropout get a dashed white centre line.
    ;(s?.est ?? []).forEach(([i, j], k) => lines.push({ id: `est${k}`, coords: coords.slice(i, j + 1), color: '#ffffff', width: 2, dash: true, casing: false, opacity: 0.9 }))
    gaps.forEach((g, k) => lines.push({ id: `gap${k}`, coords: [coords[g.a], coords[g.b]], color: '#ffffff', width: 2, dash: true, casing: false, opacity: 0.9 }))
  }
  const points: MapPoint[] = hasMap
    ? [
        { id: 'start', coord: coords[0], kind: 'start' },
        { id: 'end', coord: coords[coords.length - 1], kind: 'end' },
      ]
    : []
  const hv = hover.value
  const hoverLL = hv != null && s?.lat && s.lon && hv < s.lat.length ? ([s.lon[hv], s.lat[hv]] as [number, number]) : null

  async function fixGaps() {
    if (!s) return
    setBusy('Tracing gaps along roads and trails...')
    try {
      const r = await fillGaps(s, a.sport)
      if (r.filled) await replaceStreams(a.id, r.streams)
      notify(r.filled ? `Filled ${r.filled} gap${r.filled > 1 ? 's' : ''} along roads${r.failed ? `, ${r.failed} could not be routed` : ''}` : 'No route found for the gaps')
    } catch (e) {
      notify((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function fixElevation() {
    if (!s) return
    setBusy('Fetching terrain elevation...')
    try {
      const ele = await correctElevation(s)
      await replaceStreams(a.id, { ...s, ele })
      notify('Elevation corrected from terrain data')
    } catch (e) {
      notify((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function crop() {
    if (!s || !sel) return
    if (!confirm('Crop this activity to the selected range? The rest of the track is removed.')) return
    const [i, j] = sel
    const cut = <T,>(arr: T[] | null) => (arr ? arr.slice(i, j + 1) : null)
    const base = s.dist[i]
    await replaceStreams(a.id, { time: cut(s.time)!, lat: cut(s.lat), lon: cut(s.lon), ele: cut(s.ele), hr: cut(s.hr), cad: cut(s.cad), pwr: cut(s.pwr), dist: cut(s.dist)!.map((v) => v - base) })
    await updateActivity(a.id, { start: s.time[i] })
    setSel(null)
    notify('Activity cropped')
  }

  return (
    <div class="stack">
      <div class="page-head">
        <div class="row" style={{ gap: '0.75rem', alignItems: 'flex-start' }}>
          <button class="btn icon" onClick={() => history.length > 1 ? history.back() : go('/')} aria-label="Back">
            <Icon name="left" />
          </button>
          <div>
            <div class="row small muted">
              <SportIcon sport={a.sport} size={1} /> {SPORTS[a.sport].label} · {fmtDate(a.start)} at {fmtTime(a.start)}
            </div>
            <h1 style={{ marginTop: '0.2rem' }}>{a.name}</h1>
            {a.description && <p class="ink2" style={{ marginTop: '0.35rem', whiteSpace: 'pre-wrap' }}>{a.description}</p>}
          </div>
        </div>
        <div class="row">
          <button class="btn sm" onClick={() => setEditing(true)}>
            <Icon name="edit" size={1} /> Edit
          </button>
          {s?.lat && (
            <button class="btn sm" onClick={() => download(`${safeFile(a.name)}.gpx`, activityToGpx(a, s))}>
              <Icon name="download" size={1} /> GPX
            </button>
          )}
        </div>
      </div>

      <Highlights a={a} ranks={ranks} segs={myEfforts.filter((x) => x.rank <= 3).map((x) => ({ name: x.seg!.name, rank: x.rank }))} />

      {gaps.length > 0 && (
        <div class="notice" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon name="info" />
          <div class="grow">
            GPS dropped out {gaps.length === 1 ? 'once' : `${gaps.length} times`} on this activity ({fmtDist(gaps.reduce((t, g) => t + g.dist, 0))} drawn as a straight dashed line), usually because the phone screen was locked.
          </div>
          <button class="btn sm primary" disabled={!!busy} onClick={fixGaps}>
            <Icon name="route" size={0.9} /> Trace along roads
          </button>
        </div>
      )}

      <div class="split-layout">
        <div class="stack">
          {hasMap && (
            <MapView
              lines={lines}
              points={points}
              hover={hoverLL}
              fitTo={focus ? coords.slice(focus.a, focus.b + 1) : coords}
              fitKey={`${a.id}-${focus ? `${focus.a}-${focus.b}` : 'all'}`}
              terrain={terrain}
              class="tall"
            >
              <div class="map-tools">
                <button class={`btn sm ${terrain ? 'dark' : ''}`} onClick={() => setTerrain(!terrain)} title="3D terrain">
                  <Icon name="cube" size={1} /> 3D
                </button>
                {focus && (
                  <button class="btn sm" onClick={() => setFocus(null)}>
                    <Icon name="x" size={1} /> Full route
                  </button>
                )}
              </div>
              {gradient && (
                <div class="map-legend">
                  <div style={{ fontWeight: 650 }}>{colorBy === 'pace' ? paceOrSpeedLabel(a.sport) : colorBy === 'hr' ? 'Heart rate' : colorBy === 'elev' ? 'Elevation' : 'Grade'}</div>
                  <div class="legend-ramp" style={{ background: `linear-gradient(90deg, ${gradient.ramp.join(',')})` }} />
                  <div class="row between tiny muted num">
                    <span>{legendFmt(colorBy, gradient.lo, a.sport)}</span>
                    <span>{legendFmt(colorBy, gradient.hi, a.sport)}</span>
                  </div>
                </div>
              )}
            </MapView>
          )}
          {hasMap && d && (
            <div class="row wrap">
              <span class="small muted">Color route by</span>
              <Seg
                value={colorBy}
                onChange={setColorBy}
                options={[
                  { v: 'none', label: 'None' },
                  { v: 'pace', label: paceOrSpeedLabel(a.sport) },
                  ...(d.hr ? [{ v: 'hr' as const, label: 'Heart rate' }] : []),
                  ...(d.ele ? [{ v: 'elev' as const, label: 'Elevation' }, { v: 'grade' as const, label: 'Grade' }] : []),
                ]}
              />
            </div>
          )}

          <div class="mobile-only">
            <SummaryCard a={a} load={load} />
          </div>
          {loading && <div class="card muted">Loading track...</div>}
          {d && s && s.dist[d.n - 1] > 0 && (
            <Analysis a={a} s={s} d={d} hover={hover} xMode={xMode} setXMode={setXMode} sel={sel} setSel={setSel} onCreateSegment={(i, j) => setSegSheet({ a: i, b: j, name: '' })} onCrop={crop} />
          )}

          {(usesPace(a.sport) ? sum.splitsKm.length : 0) > 0 && <Splits a={a} />}
          {myEfforts.length > 0 && (
            <Card title="Segments" icon="segment">
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th />
                      <th>Name</th>
                      <th class="r">Time</th>
                      <th class="r">{paceOrSpeedLabel(a.sport)}</th>
                      <th class="r">vs PR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myEfforts.map(({ e, seg, rank, pr }) => (
                      <tr key={e.id} class="click" onClick={() => setFocus({ a: e.startIdx, b: e.endIdx })}>
                        <td style={{ width: '1.5rem' }}>
                          <Medal rank={rank} />
                        </td>
                        <td>
                          <a href={`#/segment/${seg!.id}`} onClick={(ev) => ev.stopPropagation()} style={{ fontWeight: 650 }}>
                            {seg!.name}
                          </a>
                          <div class="tiny muted">
                            {fmtShortDist(seg!.distance)} · {(seg!.avgGrade * 100).toFixed(1)}%
                          </div>
                        </td>
                        <td class="r">{fmtDuration(e.elapsed)}</td>
                        <td class="r">{fmtPaceOrSpeed(a.sport, seg!.distance / e.elapsed)}</td>
                        <td class="r muted">{e.elapsed <= pr ? 'PR' : `+${fmtDuration(e.elapsed - pr)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {climbs.length > 0 && s && (
            <Card title="Climbs" icon="mountain">
              {climbs.map((c, k) => (
                <ClimbRow key={k} c={c} s={s} sport={a.sport} onFocus={() => setFocus({ a: c.a, b: c.b })} onSegment={() => setSegSheet({ a: c.a, b: c.b, name: `${a.name} climb ${k + 1}` })} />
              ))}
            </Card>
          )}
          {matched.length > 0 && <Matched a={a} list={matched} />}
        </div>

        <div class="stack">
          <div class="desktop-only">
            <SummaryCard a={a} load={load} />
          </div>
          {ranks.length > 0 && (
            <Card title="Best efforts" icon="trophy">
              <table class="table">
                <tbody>
                  {ranks.map((r) => (
                    <tr key={r.m}>
                      <td style={{ width: '1.5rem' }}>
                        <Medal rank={r.rank} />
                      </td>
                      <td>{r.label}</td>
                      <td class="r">{fmtDuration(r.time)}</td>
                      <td class="r muted">{fmtPace(r.m / r.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {d && s && <Zones a={a} s={s} d={d} />}
          {sum.powerCurve && <PowerCurveCard a={a} />}

          <Card title="Tools" icon="settings">
            <div class="col" style={{ gap: '0.5rem' }}>
              {gaps.length > 0 && (
                <button class="btn block" disabled={!!busy} onClick={fixGaps}>
                  <Icon name="route" size={1} /> Trace {gaps.length} GPS gap{gaps.length > 1 ? 's' : ''} along roads
                </button>
              )}
              {s?.lat && (
                <button class="btn block" disabled={!!busy} onClick={fixElevation}>
                  <Icon name="mountain" size={1} /> Correct elevation from terrain
                </button>
              )}
              {busy && <div class="small muted">{busy}</div>}
              <button
                class="btn block danger"
                onClick={async () => {
                  if (!confirm('Delete this activity? This cannot be undone.')) return
                  await deleteActivity(a.id)
                  notify('Activity deleted')
                  go('/', true)
                }}
              >
                <Icon name="trash" size={1} /> Delete activity
              </button>
            </div>
          </Card>
        </div>
      </div>

      {editing && <EditSheet a={a} onClose={() => setEditing(false)} />}
      {segSheet && s && <SegmentSheet a={a} s={s} range={segSheet} onClose={() => setSegSheet(null)} />}
    </div>
  )
}

function SummaryCard({ a, load }: { a: Activity; load: { load: number; method: string } }) {
  const sum = a.summary
  const st = settings.value
  const foot = sportGroup(a.sport) === 'foot'
  return (
    <Card>
      <div class="stats big" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {sum.distance > 0 && <Stat label="Distance" value={distNum(sum.distance).toFixed(2)} unit={distUnit()} />}
        <Stat label="Moving time" value={fmtDuration(sum.movingTime)} />
        {sum.distance > 0 && <Stat label={usesPace(a.sport) ? 'Avg pace' : 'Avg speed'} value={usesPace(a.sport) ? fmtPace(sum.avgSpeed, false) : fmtSpeed(sum.avgSpeed, false)} unit={usesPace(a.sport) ? `/${distUnit()}` : speedUnit()} />}
        <Stat label="Elevation" value={Math.round(elevNum(sum.elevGain)).toLocaleString()} unit={elevUnit()} />
      </div>
      <div class="row" style={{ marginTop: '1rem', gap: '0.75rem' }}>
        <div class="avatar" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <Icon name="flame" />
        </div>
        <div class="grow">
          <div style={{ fontWeight: 700 }}>
            {Math.round(load.load)} <span class="ink2">{loadLabel(load.load)}</span>
          </div>
          <div class="tiny muted">Training load from {load.method}</div>
        </div>
      </div>
      <dl class="kv" style={{ marginTop: '1rem' }}>
        <dt>Elapsed time</dt>
        <dd>{fmtDuration(sum.elapsedTime)}</dd>
        {sum.gapSpeed && (
          <>
            <dt>Grade adjusted pace</dt>
            <dd>{fmtPace(sum.gapSpeed)}</dd>
          </>
        )}
        {sum.maxSpeed > 0 && (
          <>
            <dt>{usesPace(a.sport) ? 'Best pace' : 'Max speed'}</dt>
            <dd>{fmtPaceOrSpeed(a.sport, sum.maxSpeed)}</dd>
          </>
        )}
        {sum.avgHr && (
          <>
            <dt>Avg heart rate</dt>
            <dd>{Math.round(sum.avgHr)} bpm</dd>
            <dt>Max heart rate</dt>
            <dd>{Math.round(sum.maxHr!)} bpm</dd>
          </>
        )}
        {sum.avgCad && (
          <>
            <dt>Cadence</dt>
            <dd>
              {Math.round(sum.avgCad)} {foot ? 'spm' : 'rpm'}
            </dd>
          </>
        )}
        {sum.avgPower && (
          <>
            <dt>Avg power</dt>
            <dd>{Math.round(sum.avgPower)} W</dd>
          </>
        )}
        {sum.np && (
          <>
            <dt>Weighted power</dt>
            <dd>{Math.round(sum.np)} W</dd>
          </>
        )}
        {sum.np && st.ftp && (
          <>
            <dt>Intensity</dt>
            <dd>{(sum.np / st.ftp).toFixed(2)}</dd>
          </>
        )}
        {sum.work && (
          <>
            <dt>Total work</dt>
            <dd>{Math.round(sum.work)} kJ</dd>
          </>
        )}
        {sum.elevMax != null && (
          <>
            <dt>Elevation range</dt>
            <dd>
              {fmtElev(sum.elevMin)} to {fmtElev(sum.elevMax)}
            </dd>
          </>
        )}
        <dt>Calories</dt>
        <dd>{sum.calories.toLocaleString()}</dd>
        {a.rpe && (
          <>
            <dt>Perceived effort</dt>
            <dd>{a.rpe} / 10</dd>
          </>
        )}
        {a.gearId && (
          <>
            <dt>Gear</dt>
            <dd>{gear.value.find((g) => g.id === a.gearId)?.name ?? '–'}</dd>
          </>
        )}
      </dl>
    </Card>
  )
}

function legendFmt(c: ColorBy, v: number, sport: Sport) {
  if (c === 'pace') return fmtPaceOrSpeed(sport, v)
  if (c === 'hr') return `${Math.round(v)} bpm`
  if (c === 'elev') return fmtElev(v)
  return `${Math.round(v * 100)}%`
}

function Highlights({ a, ranks, segs }: { a: Activity; ranks: { label: string; rank: number }[]; segs: { name: string; rank: number }[] }) {
  const all = activities.value
  const items: { icon: string; text: string; rank?: number }[] = []
  for (const r of ranks.filter((x) => x.rank <= 3).slice(0, 4)) items.push({ icon: 'trophy', rank: r.rank, text: `${r.rank === 1 ? 'Fastest' : r.rank === 2 ? '2nd fastest' : '3rd fastest'} ${r.label} ever` })
  for (const sg of segs.slice(0, 3)) items.push({ icon: 'segment', rank: sg.rank, text: sg.rank === 1 ? `PR on ${sg.name}` : `${sg.rank === 2 ? '2nd' : '3rd'} best on ${sg.name}` })
  const same = all.filter((b) => b.id !== a.id && b.sport === a.sport && b.start < a.start)
  if (same.length >= 3 && a.summary.distance > 0) {
    const longer = same.filter((b) => b.summary.distance >= a.summary.distance)
    if (!longer.length) items.push({ icon: 'flag', text: `Your longest ${SPORTS[a.sport].label.toLowerCase()} yet` })
    else {
      const last = longer[0]
      const days = Math.round((a.start - last.start) / 86400000)
      if (days >= 21) items.push({ icon: 'flag', text: `Longest ${SPORTS[a.sport].label.toLowerCase()} in ${days} days` })
    }
  }
  if (same.length >= 3 && a.summary.elevGain > 50 && !same.some((b) => b.summary.elevGain >= a.summary.elevGain)) items.push({ icon: 'mountain', text: 'Most climbing yet' })
  if (!items.length) return null
  return (
    <div class="badges" style={{ marginTop: 0 }}>
      {items.map((it, k) => (
        <span class="chip" key={k} style={{ padding: '0.35rem 0.7rem', fontSize: '0.8125rem' }}>
          {it.rank ? <Medal rank={it.rank} /> : <Icon name={it.icon} size={0.95} />}
          {it.text}
        </span>
      ))}
    </div>
  )
}

function Analysis(p: {
  a: Activity
  s: Streams
  d: Derived
  hover: Signal<number | null>
  xMode: 'dist' | 'time'
  setXMode: (m: 'dist' | 'time') => void
  sel: [number, number] | null
  setSel: (r: [number, number] | null) => void
  onCreateSegment: (a: number, b: number) => void
  onCrop: () => void
}) {
  const { a, s, d } = p
  const pace = usesPace(a.sport)
  const units = settings.value.units
  const x = useMemo(() => (p.xMode === 'dist' ? d.dist.map((m) => distNum(m)) : d.t), [d, p.xMode, units])
  const xFmt = (v: number) => (p.xMode === 'dist' ? `${+v.toFixed(1)} ${distUnit()}` : fmtDuration(v))
  const U = unitLen()

  const speedSeries = useMemo(() => {
    if (pace) {
      const vals = d.speed.map((v) => (isFinite(v) ? U / v : NaN))
      const out: Series[] = [{ key: 'pace', label: 'Pace', values: vals, color: 'var(--s1)' }]
      if (d.gap) out.push({ key: 'gap', label: 'Grade adjusted', values: d.gap.map((v) => (isFinite(v) ? U / v : NaN)), color: 'var(--s2)' })
      return out
    }
    return [{ key: 'speed', label: 'Speed', values: d.speed.map((v) => (isFinite(v) ? speedNum(v) : NaN)), color: 'var(--s1)', area: true }]
  }, [d, pace, units])
  const paceBounds = useMemo(() => {
    if (!pace) return null
    const v = speedSeries.flatMap((x) => x.values)
    const lo = percentile(v, 0.01)
    const hi = percentile(v, 0.96)
    const span = Math.max(30, hi - lo)
    const step = [15, 30, 60, 120, 300, 600].find((st) => span / st <= 4) ?? 600
    return { lo: Math.max(0, lo - span * 0.1), hi: hi + span * 0.15, step }
  }, [speedSeries])

  const eleSeries = useMemo(() => (d.ele ? [{ key: 'ele', label: 'Elevation', values: d.ele.map(elevNum), color: 'var(--muted)', area: true, areaOpacity: 0.18 }] : null), [d, units])

  const at = p.hover.value
  const sel = p.sel
  let selStats = null
  if (sel) {
    const [i, j] = sel
    const dist = s.dist[j] - s.dist[i]
    const mv = d.t[j] - d.t[i]
    let gain = 0
    if (d.ele) for (let k = i + 1; k <= j; k++) if (d.ele[k] > d.ele[k - 1]) gain += d.ele[k] - d.ele[k - 1]
    const avg = (arr: number[] | null) => {
      if (!arr) return null
      let sm = 0, w = 0
      for (let k = i + 1; k <= j; k++) if (isFinite(arr[k]) && d.mask[k]) { const dt = (s.time[k] - s.time[k - 1]) / 1000; sm += arr[k] * dt; w += dt }
      return w ? sm / w : null
    }
    selStats = { dist, mv, gain, hr: avg(d.hr), pwr: avg(d.pwr), speed: mv > 0 ? dist / mv : 0 }
  }

  return (
    <Card
      title="Analysis"
      icon="training"
      action={<Seg value={p.xMode} onChange={p.setXMode} options={[{ v: 'dist', label: 'Distance' }, { v: 'time', label: 'Time' }]} />}
    >
      <div class="row wrap small" style={{ minHeight: '1.6rem', gap: '0.25rem 1rem', marginBottom: '0.5rem' }}>
        {at != null ? (
          <>
            <span>
              <b>{fmtDist(d.dist[at])}</b>
            </span>
            <span class="ink2">{fmtDuration(d.t[at])}</span>
            {isFinite(d.speed[at]) && <span>{fmtPaceOrSpeed(a.sport, d.speed[at])}</span>}
            {d.ele && <span class="ink2">{fmtElev(d.ele[at])}</span>}
            {d.ele && <span class="ink2">{Math.round(d.grade[at] * 100)}%</span>}
            {d.hr && <span>{Math.round(d.hr[at])} bpm</span>}
            {d.pwr && <span>{Math.round(d.pwr[at])} W</span>}
          </>
        ) : (
          <span class="muted">Hover or drag across a chart to inspect a section</span>
        )}
      </div>
      {sel && selStats && (
        <div class="notice" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <div class="grow">
            <b>Selection</b>: {fmtDist(selStats.dist)} in {fmtDuration(selStats.mv)} · {fmtPaceOrSpeed(a.sport, selStats.speed)}
            {selStats.gain > 3 && ` · ${fmtElev(selStats.gain)} up`}
            {selStats.hr && ` · ${Math.round(selStats.hr)} bpm`}
            {selStats.pwr && ` · ${Math.round(selStats.pwr)} W`}
          </div>
          <div class="row wrap">
            {s.lat && (
              <button class="btn sm primary" onClick={() => p.onCreateSegment(sel[0], sel[1])}>
                <Icon name="segment" size={0.9} /> Make segment
              </button>
            )}
            <button class="btn sm" onClick={p.onCrop}>
              Crop to this
            </button>
            <button class="btn sm ghost" onClick={() => p.setSel(null)}>
              Clear
            </button>
          </div>
        </div>
      )}
      <div class="col" style={{ gap: '1rem' }}>
        {eleSeries && (
          <ChartBlock title="Elevation" sub={fmtElev(a.summary.elevGain) + ' gain'}>
            <XYChart x={x} series={eleSeries} height={6.5} yFmt={(v) => `${Math.round(v)}`} xFmt={xFmt} hover={p.hover} selection={sel} onSelect={p.setSel} tip={(i) => <span class="v">{fmtElev(d.ele![i])}</span>} legend={false} />
          </ChartBlock>
        )}
        <ChartBlock title={pace ? 'Pace' : 'Speed'} sub={pace ? `avg ${fmtPace(a.summary.avgSpeed)}` : `avg ${fmtSpeed(a.summary.avgSpeed)}`}>
          <XYChart
            x={x}
            series={speedSeries}
            height={8}
            invert={pace}
            yMin={paceBounds?.lo}
            yMax={paceBounds?.hi}
            yStep={paceBounds?.step}
            yFmt={(v) => (pace ? fmtDuration(v) : `${Math.round(v)}`)}
            xFmt={xFmt}
            hover={p.hover}
            selection={sel}
            onSelect={p.setSel}
            refLines={pace ? [{ y: U / a.summary.avgSpeed, label: 'avg' }] : [{ y: speedNum(a.summary.avgSpeed), label: 'avg' }]}
          />
        </ChartBlock>
        {d.hr && (
          <ChartBlock title="Heart rate" sub={a.summary.avgHr ? `avg ${Math.round(a.summary.avgHr)} bpm` : ''}>
            <XYChart x={x} series={[{ key: 'hr', label: 'Heart rate', values: d.hr, color: 'var(--s8)' }]} height={6.5} yFmt={(v) => `${Math.round(v)}`} xFmt={xFmt} hover={p.hover} selection={sel} onSelect={p.setSel} tip={(i) => <span class="v">{Math.round(d.hr![i])} bpm</span>} />
          </ChartBlock>
        )}
        {d.cad && (
          <ChartBlock title="Cadence" sub={a.summary.avgCad ? `avg ${Math.round(a.summary.avgCad)}` : ''}>
            <XYChart x={x} series={[{ key: 'cad', label: 'Cadence', values: d.cad, color: 'var(--s5)' }]} height={5.5} yFmt={(v) => `${Math.round(v)}`} xFmt={xFmt} hover={p.hover} selection={sel} onSelect={p.setSel} tip={(i) => <span class="v">{Math.round(d.cad![i])}</span>} />
          </ChartBlock>
        )}
        {d.pwr && (
          <ChartBlock title="Power" sub={a.summary.avgPower ? `avg ${Math.round(a.summary.avgPower)} W` : ''}>
            <XYChart x={x} series={[{ key: 'pwr', label: 'Power', values: d.pwr, color: 'var(--s7)', area: true }]} height={6.5} zeroBase yFmt={(v) => `${Math.round(v)}`} xFmt={xFmt} hover={p.hover} selection={sel} onSelect={p.setSel} tip={(i) => <span class="v">{Math.round(d.pwr![i])} W</span>} />
          </ChartBlock>
        )}
      </div>
    </Card>
  )
}

function ChartBlock({ title, sub, children }: { title: string; sub?: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <div class="chart-title">
        <b>{title}</b>
        {sub && <span class="tiny muted">{sub}</span>}
      </div>
      {children}
    </div>
  )
}

function Splits({ a }: { a: Activity }) {
  const imperial = settings.value.units === 'imperial'
  const splits = imperial ? a.summary.splitsMi : a.summary.splitsKm
  const speeds = splits.map((sp) => (sp.time > 0 ? sp.distance / sp.time : 0))
  const max = Math.max(...speeds)
  const min = Math.min(...speeds.filter((v) => v > 0))
  const hasHr = splits.some((sp) => sp.avgHr)
  const hasGap = splits.some((sp) => sp.gapSpeed)
  return (
    <Card title="Splits" icon="flag">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{distUnit().toUpperCase()}</th>
              <th>Pace</th>
              <th />
              {hasGap && <th class="r">GAP</th>}
              <th class="r">Elev</th>
              {hasHr && <th class="r">HR</th>}
            </tr>
          </thead>
          <tbody>
            {splits.map((sp, k) => {
              const v = speeds[k]
              const f = max > min ? 0.25 + (0.75 * (v - min)) / (max - min) : 1
              return (
                <tr key={sp.index}>
                  <td>{sp.partial ? (distNum(sp.distance)).toFixed(2) : sp.index}</td>
                  <td class="nowrap">{fmtPace(v, false)}</td>
                  <td class="bar-cell" style={{ width: '40%' }}>
                    <div class="bar" style={{ width: `${f * 100}%` }} />
                  </td>
                  {hasGap && <td class="r muted">{sp.gapSpeed ? fmtPace(sp.gapSpeed, false) : '–'}</td>}
                  <td class="r">{Math.round(elevNum(sp.elev)) > 0 ? '+' : ''}{Math.round(elevNum(sp.elev))}</td>
                  {hasHr && <td class="r">{sp.avgHr ? Math.round(sp.avgHr) : '–'}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ClimbRow({ c, s, sport, onFocus, onSegment }: { c: Climb; s: Streams; sport: Sport; onFocus: () => void; onSegment: () => void }) {
  const time = (s.time[c.b] - s.time[c.a]) / 1000
  const vam = time > 0 ? (c.gain / time) * 3600 : 0
  return (
    <div class="list-row">
      <span class="chip accent">{c.category}</span>
      <div class="grow" style={{ cursor: 'pointer' }} onClick={onFocus}>
        <div style={{ fontWeight: 650 }}>
          {fmtShortDist(c.distance)} at {(c.grade * 100).toFixed(1)}%
        </div>
        <div class="small muted">
          {fmtElev(c.gain)} up · {fmtDuration(time)}
          {sportGroup(sport) === 'bike' ? ` · ${Math.round(vam)} m/h VAM` : ` · ${fmtPaceOrSpeed(sport, c.distance / time)}`}
        </div>
      </div>
      <button class="btn sm" onClick={onSegment}>
        Make segment
      </button>
    </div>
  )
}

function Zones({ a, s, d }: { a: Activity; s: Streams; d: Derived }) {
  const st = settings.value
  const all = activities.value
  const tabs: { v: 'hr' | 'pace' | 'power'; label: string }[] = []
  if (d.hr) tabs.push({ v: 'hr', label: 'Heart rate' })
  if (sportGroup(a.sport) === 'foot' && d.speed.some(isFinite)) tabs.push({ v: 'pace', label: 'Pace' })
  if (d.pwr && st.ftp) tabs.push({ v: 'power', label: 'Power' })
  const [tab, setTab] = useState(tabs[0]?.v)
  if (!tabs.length || !tab) return null
  let rows: { label: string; sub?: string; value: number; color: string }[] = []
  if (tab === 'hr') {
    const t = zoneTimes(d, s, d.hr, st.maxHr, HR_ZONES)
    rows = HR_ZONES.map((z, i) => ({ label: `Z${i + 1} ${z.name}`, sub: `${Math.round(z.lo * st.maxHr)}${z.hi < 2 ? `-${Math.round(z.hi * st.maxHr)}` : '+'} bpm`, value: t[i], color: ZONE_RAMP[i] }))
  } else if (tab === 'pace') {
    const thr = thresholdSpeed(st, all)
    const t = zoneTimes(d, s, d.gap ?? d.speed, thr, PACE_ZONES)
    rows = PACE_ZONES.map((z, i) => ({ label: `Z${i + 1} ${z.name}`, sub: z.hi > 50 ? `< ${fmtPace(thr * z.lo, false)}` : `${fmtPace(thr * z.hi, false)}-${z.lo ? fmtPace(thr * z.lo, false) : ''}`, value: t[i], color: ZONE_RAMP[i] }))
  } else {
    const t = zoneTimes(d, s, d.pwr, st.ftp!, POWER_ZONES)
    rows = POWER_ZONES.map((z, i) => ({ label: `Z${i + 1} ${z.name}`, sub: `${Math.round(z.lo * st.ftp!)}${z.hi < 50 ? `-${Math.round(z.hi * st.ftp!)}` : '+'} W`, value: t[i], color: ZONE_RAMP[i] }))
  }
  return (
    <Card title="Zones" icon="gauge" action={tabs.length > 1 ? <Seg value={tab} onChange={setTab} options={tabs} /> : undefined}>
      <ZoneBars rows={rows} fmt={(v) => fmtDuration(v)} />
      <div class="tiny muted" style={{ marginTop: '0.5rem' }}>
        {tab === 'hr' ? `Based on max heart rate ${st.maxHr}.` : tab === 'pace' ? `Based on threshold pace ${fmtPace(thresholdSpeed(st, all))}.` : `Based on FTP ${st.ftp} W.`} Change it under You.
      </div>
    </Card>
  )
}

function PowerCurveCard({ a }: { a: Activity }) {
  const best = bestPowerCurve(activities.value, Date.now() - 365 * 86400000)
  const durs = POWER_DURATIONS.filter((x) => a.summary.powerCurve?.[String(x)] || best[String(x)])
  const series: Series[] = [
    { key: 'this', label: 'This ride', values: durs.map((x) => a.summary.powerCurve?.[String(x)] ?? NaN), color: 'var(--s1)' },
    { key: 'best', label: 'Best, last 12 months', values: durs.map((x) => best[String(x)]?.w ?? NaN), color: 'var(--s2)' },
  ]
  return (
    <Card title="Power curve" icon="zap">
      <XYChart x={durs} series={series} logX xTicks={[5, 60, 300, 1200, 3600].filter((t) => t <= durs[durs.length - 1])} height={8} yFmt={(v) => `${Math.round(v)}`} xFmt={fmtDurShort} zeroBase />
    </Card>
  )
}

function Matched({ a, list }: { a: Activity; list: Activity[] }) {
  const rows = [a, ...list].sort((x, y) => x.start - y.start)
  const ranked = rows.slice().sort((x, y) => x.summary.movingTime - y.summary.movingTime)
  const pos = ranked.findIndex((x) => x.id === a.id) + 1
  return (
    <Card title="Matched activities" icon="loop">
      <p class="small ink2" style={{ marginBottom: '0.75rem' }}>
        You have done this route {rows.length} times. This was your {pos === 1 ? 'fastest' : `${ordinal(pos)} fastest`}.
      </p>
      {rows.length >= 3 && (
        <XYChart
          x={rows.map((r) => r.start)}
          series={[{ key: 't', label: 'Moving time', values: rows.map((r) => r.summary.movingTime), color: 'var(--s1)' }]}
          height={6}
          yFmt={(v) => fmtDuration(v)}
          xFmt={(v) => fmtTick(v, rows[rows.length - 1].start - rows[0].start)}
          xTicks={dateTicks(rows[0].start, rows[rows.length - 1].start, 5)}
          tip={(i) => (
            <>
              <div class="k">{fmtDate(rows[i].start)}</div>
              <div class="v">{fmtDuration(rows[i].summary.movingTime)}</div>
            </>
          )}
        />
      )}
      <table class="table" style={{ marginTop: '0.5rem' }}>
        <tbody>
          {rows.slice().reverse().slice(0, 8).map((r) => (
            <tr key={r.id} class="click" onClick={() => go(`/activity/${r.id}`)} style={r.id === a.id ? { fontWeight: 700 } : undefined}>
              <td>{fmtDate(r.start, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
              <td class="r">{fmtDuration(r.summary.movingTime)}</td>
              <td class="r muted">{fmtPaceOrSpeed(r.sport, r.summary.avgSpeed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4] || 'th'}`

function EditSheet({ a, onClose }: { a: Activity; onClose: () => void }) {
  const [name, setName] = useState(a.name)
  const [sport, setSport] = useState<Sport>(a.sport)
  const [desc, setDesc] = useState(a.description)
  const [rpe, setRpe] = useState(a.rpe ?? 0)
  const [gearId, setGearId] = useState(a.gearId ?? '')
  return (
    <Sheet title="Edit activity" onClose={onClose}>
      <div class="col">
        <label class="field">
          <span>Title</span>
          <input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>Sport</span>
          <select class="input" value={sport} onChange={(e) => setSport((e.target as HTMLSelectElement).value as Sport)}>
            {SPORT_LIST.map((k) => (
              <option key={k} value={k}>
                {SPORTS[k].label}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Description</span>
          <textarea class="input" value={desc} onInput={(e) => setDesc((e.target as HTMLTextAreaElement).value)} />
        </label>
        <label class="field">
          <span>Perceived effort: {rpe ? `${rpe} / 10` : 'not set'}</span>
          <input type="range" min={0} max={10} value={rpe} onInput={(e) => setRpe(+(e.target as HTMLInputElement).value)} />
        </label>
        {gear.value.length > 0 && (
          <label class="field">
            <span>Gear</span>
            <select class="input" value={gearId} onChange={(e) => setGearId((e.target as HTMLSelectElement).value)}>
              <option value="">None</option>
              {gear.value.filter((g) => !g.retired || g.id === a.gearId).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          class="btn primary lg block"
          onClick={async () => {
            await updateActivity(a.id, { name: name.trim() || a.name, sport, description: desc, rpe: rpe || null, gearId: gearId || null })
            notify('Saved')
            onClose()
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  )
}

function SegmentSheet({ a, s, range, onClose }: { a: Activity; s: Streams; range: { a: number; b: number; name: string }; onClose: () => void }) {
  const [name, setName] = useState(range.name)
  const [prog, setProg] = useState<number | null>(null)
  const dist = s.dist[range.b] - s.dist[range.a]
  return (
    <Sheet title="New segment" onClose={onClose}>
      <div class="col">
        <p class="small ink2">
          {fmtShortDist(dist)} from {fmtDist(s.dist[range.a])} to {fmtDist(s.dist[range.b])}. Every past and future activity that covers it gets matched, and you will hear it live while recording.
        </p>
        <label class="field">
          <span>Name</span>
          <input class="input" value={name} placeholder="e.g. Park hill sprint" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        {prog != null && <Progress value={prog} />}
        <button
          class="btn primary lg block"
          disabled={!name.trim() || prog != null || dist < 100}
          onClick={async () => {
            const seg = segmentFromRange(s, range.a, range.b, name.trim(), sportGroup(a.sport), uid())
            if (!seg) return notify('Need a GPS track for segments')
            setProg(0)
            const found = await addSegment(seg, (d2, t) => setProg(t ? d2 / t : 1))
            notify(`Segment created with ${found.length} effort${found.length === 1 ? '' : 's'}`)
            onClose()
            go(`/segment/${seg.id}`)
          }}
        >
          {dist < 100 ? 'Select at least 100 m' : 'Create segment'}
        </button>
      </div>
    </Sheet>
  )
}
