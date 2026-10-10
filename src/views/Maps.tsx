import { useMemo, useState } from 'preact/hooks'
import { MapView } from '../components/MapView'
import { Icon } from '../components/Icon'
import { Card, Empty, Seg, TraceSvg } from '../components/ui'
import { GROUP_LABEL, sportGroup } from '../lib/sports'
import { activities, efforts, routes, segments, settings } from '../lib/store'
import type { Settings, SportGroup } from '../lib/types'
import { fmtDist, fmtDuration, fmtElev, fmtShortDist } from '../lib/units'
import { estimateRouteTime } from './RouteBuilder'

type Tab = 'heatmap' | 'routes' | 'segments'

export function MapsView({ tab }: { tab: Tab }) {
  return (
    <div>
      <div class="tabs">
        <a href="#/maps/heatmap" class={tab === 'heatmap' ? 'on' : ''}>
          Heatmap
        </a>
        <a href="#/maps/routes" class={tab === 'routes' ? 'on' : ''}>
          Routes
        </a>
        <a href="#/maps/segments" class={tab === 'segments' ? 'on' : ''}>
          Segments
        </a>
      </div>
      {tab === 'routes' ? <RoutesList /> : tab === 'segments' ? <SegmentsList /> : <Heatmap />}
    </div>
  )
}

function Heatmap() {
  const [group, setGroup] = useState<SportGroup | 'all'>('all')
  const [period, setPeriod] = useState<'all' | 'year' | '90'>('all')
  const [style, setStyle] = useState<Settings['mapStyle']>('dark')
  const all = activities.value
  const list = useMemo(() => {
    const now = new Date()
    const since = period === 'year' ? new Date(now.getFullYear(), 0, 1).getTime() : period === '90' ? Date.now() - 90 * 86400000 : 0
    return all.filter((a) => a.trace.length > 1 && a.start >= since && (group === 'all' || sportGroup(a.sport) === group))
  }, [all, group, period])

  // Frame the area you train in most, not every trip you ever took.
  const fit = useMemo(() => {
    if (!list.length) return null
    const starts = list.map((a) => a.trace[0])
    const med = (k: 0 | 1) => starts.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(starts.length / 2)]
    const c: [number, number] = [med(0), med(1)]
    const near = list.filter((a) => Math.abs(a.trace[0][0] - c[0]) < 0.6 && Math.abs(a.trace[0][1] - c[1]) < 0.4)
    return near.flatMap((a) => a.trace)
  }, [list])

  const dist = list.reduce((s, a) => s + a.summary.distance, 0)
  if (!all.some((a) => a.trace.length > 1))
    return (
      <Card>
        <Empty icon="map" title="Your heatmap lives here">
          <p class="ink2">Every route you record or import is drawn on one map so you can see where you train.</p>
        </Empty>
      </Card>
    )
  return (
    <div class="stack">
      <div class="row wrap between">
        <div class="row wrap">
          <Seg value={group} onChange={setGroup} options={(['all', 'foot', 'bike', 'other'] as const).map((v) => ({ v, label: v === 'all' ? 'All' : GROUP_LABEL[v] }))} />
          <Seg value={period} onChange={setPeriod} options={[{ v: 'all', label: 'All time' }, { v: 'year', label: 'This year' }, { v: '90', label: '90 days' }]} />
        </div>
        <Seg value={style} onChange={setStyle} options={[{ v: 'dark', label: 'Dark' }, { v: 'standard', label: 'Light' }, { v: 'topo', label: 'Topo' }]} />
      </div>
      <MapView heat={list.map((a) => a.trace)} fitTo={fit} fitKey={`${group}-${period}`} mapStyle={style} class="tall" heatColor={style === 'dark' ? '#ff5a3c' : undefined} />
      <div class="small muted">
        {list.length} activities · {fmtDist(dist, 0)}
      </div>
    </div>
  )
}

function RoutesList() {
  const list = routes.value
  void settings.value.units
  return (
    <div class="stack">
      <div class="page-head" style={{ marginBottom: 0 }}>
        <p class="ink2 small">Plan routes that snap to roads and trails, generate loops, export to your watch.</p>
        <a class="btn primary" href="#/route/new">
          <Icon name="plus" size={1} /> New route
        </a>
      </div>
      {!list.length ? (
        <Card>
          <Empty icon="route" title="No routes yet">
            <p class="ink2">Build one on the map or import a GPX course file.</p>
          </Empty>
        </Card>
      ) : (
        <div class="grid3">
          {list.map((r) => (
            <a key={r.id} href={`#/route/${r.id}`} class="card act-card">
              <div class="trace-box" style={{ marginTop: 0 }}>
                <TraceSvg trace={r.geometry.map((c) => [c[0], c[1]] as [number, number])} color="var(--s1)" />
              </div>
              <div style={{ fontWeight: 700, marginTop: '0.75rem' }}>{r.name}</div>
              <div class="small ink2">
                {fmtDist(r.distance)} · {fmtElev(r.elevGain)} up · ~{fmtDuration(estimateRouteTime(r.distance, r.elevGain, r.sport))}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function SegmentsList() {
  const list = segments.value.slice().sort((a, b) => Number(b.starred) - Number(a.starred) || b.createdAt - a.createdAt)
  const effs = efforts.value
  void settings.value.units
  return (
    <div class="stack">
      <div class="notice">
        <Icon name="info" />
        <div>
          Make a segment from any activity: drag across a chart in its Analysis section, or tap <b>Make segment</b> on a detected climb. Past activities are matched right away and new ones as you record.
        </div>
      </div>
      {!list.length ? (
        <Card>
          <Empty icon="segment" title="No segments yet" />
        </Card>
      ) : (
        <Card class="flush">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: '1rem' }}>Segment</th>
                  <th class="r">Efforts</th>
                  <th class="r" style={{ paddingRight: '1rem' }}>
                    Best
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const mine = effs.filter((e) => e.segmentId === s.id)
                  const best = mine.reduce((m, e) => Math.min(m, e.elapsed), Infinity)
                  return (
                    <tr key={s.id} class="click" onClick={() => (location.hash = `/segment/${s.id}`)}>
                      <td style={{ paddingLeft: '1rem' }}>
                        <div class="row" style={{ gap: '0.4rem' }}>
                          {s.starred && <Icon name="star" fill size={0.9} style={{ color: 'var(--gold)' }} />}
                          <b>{s.name}</b>
                        </div>
                        <div class="tiny muted">
                          {GROUP_LABEL[s.group]} · {fmtShortDist(s.distance)} · {(s.avgGrade * 100).toFixed(1)}%
                        </div>
                      </td>
                      <td class="r">{mine.length}</td>
                      <td class="r" style={{ paddingRight: '1rem' }}>
                        {isFinite(best) ? fmtDuration(best) : '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
