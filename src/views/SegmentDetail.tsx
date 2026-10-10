import { useState } from 'preact/hooks'
import { MapView, cssVar } from '../components/MapView'
import { dateTicks, fmtTick, XYChart } from '../components/charts'
import { Icon } from '../components/Icon'
import { Card, Empty, Medal, Stat } from '../components/ui'
import { back, go } from '../lib/router'
import { GROUP_LABEL } from '../lib/sports'
import { activities, deleteSegment, efforts, notify, segments, settings, updateSegment } from '../lib/store'
import { fmtDate, fmtDuration, fmtElev, fmtPaceOrSpeed, fmtShortDist } from '../lib/units'

export function SegmentView({ id }: { id: string }) {
  const seg = segments.value.find((s) => s.id === id)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(seg?.name ?? '')
  void settings.value.units
  if (!seg)
    return (
      <Empty icon="segment" title="Segment not found">
        <a class="btn" href="#/maps/segments">
          All segments
        </a>
      </Empty>
    )
  const acts = new Map(activities.value.map((a) => [a.id, a]))
  const list = efforts.value.filter((e) => e.segmentId === id && acts.has(e.activityId))
  const ranked = list.slice().sort((a, b) => a.elapsed - b.elapsed)
  const byDate = list.slice().sort((a, b) => a.start - b.start)
  const pr = ranked[0]
  const recent = list.filter((e) => e.start > Date.now() - 90 * 86400000).length
  const sportOf = (aid: string) => acts.get(aid)!.sport

  return (
    <div class="stack">
      <div class="page-head">
        <div class="row" style={{ gap: '0.75rem' }}>
          <button class="btn icon" onClick={() => back('/maps/segments')} aria-label="Back">
            <Icon name="left" />
          </button>
          <div>
            <div class="small muted">{GROUP_LABEL[seg.group]} segment</div>
            {renaming ? (
              <form
                class="row"
                onSubmit={async (e) => {
                  e.preventDefault()
                  await updateSegment(seg.id, { name: name.trim() || seg.name })
                  setRenaming(false)
                }}
              >
                <input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus />
                <button class="btn sm primary">Save</button>
              </form>
            ) : (
              <h1>{seg.name}</h1>
            )}
          </div>
        </div>
        <div class="row">
          <button class="btn sm" onClick={() => updateSegment(seg.id, { starred: !seg.starred })}>
            <Icon name="star" size={1} fill={seg.starred} style={seg.starred ? { color: 'var(--gold)' } : undefined} /> {seg.starred ? 'Starred' : 'Star'}
          </button>
          <button class="btn sm" onClick={() => setRenaming(true)}>
            <Icon name="edit" size={1} />
          </button>
        </div>
      </div>

      <div class="split-layout">
        <div class="stack">
          <MapView
            lines={[{ id: 'seg', coords: seg.points, color: cssVar('--accent'), width: 5 }]}
            points={[
              { id: 's', coord: seg.points[0], kind: 'start' },
              { id: 'e', coord: seg.points[seg.points.length - 1], kind: 'end' },
            ]}
            fitTo={seg.points}
            fitKey={seg.id}
          />
          {byDate.length >= 2 && (
            <Card title="Your efforts over time" icon="training">
              <XYChart
                x={byDate.map((e) => e.start)}
                series={[{ key: 't', label: 'Time', values: byDate.map((e) => e.elapsed), color: 'var(--s1)' }]}
                height={7}
                invert
                yFmt={(v) => fmtDuration(v)}
                xFmt={(v) => fmtTick(v, byDate[byDate.length - 1].start - byDate[0].start)}
                xTicks={dateTicks(byDate[0].start, byDate[byDate.length - 1].start, 5)}
                tip={(i) => (
                  <>
                    <div class="k">{fmtDate(byDate[i].start)}</div>
                    <div class="v">{fmtDuration(byDate[i].elapsed)}</div>
                  </>
                )}
                refLines={pr ? [{ y: pr.elapsed, label: 'PR' }] : []}
              />
              <p class="tiny muted" style={{ marginTop: '0.4rem' }}>Faster times sit higher.</p>
            </Card>
          )}
        </div>
        <div class="stack">
          <Card>
            <div class="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Stat label="Distance" value={fmtShortDist(seg.distance)} />
              <Stat label="Avg grade" value={`${(seg.avgGrade * 100).toFixed(1)}%`} />
              <Stat label="Elevation gain" value={fmtElev(seg.elevGain)} />
              <Stat label="Efforts" value={list.length} sub={`${recent} in the last 90 days`} />
            </div>
          </Card>
          {pr && (
            <Card title="Personal record" icon="trophy">
              <div class="hero-num">{fmtDuration(pr.elapsed)}</div>
              <div class="small ink2" style={{ marginTop: '0.4rem' }}>
                {fmtPaceOrSpeed(sportOf(pr.activityId), seg.distance / pr.elapsed)} · {fmtDate(pr.start)}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card title="Leaderboard" icon="trophy" class="flush" style={{ padding: '1rem 0 0' }}>
        {ranked.length === 0 ? (
          <p class="muted" style={{ padding: '0 1rem 1rem' }}>No efforts yet. Record or import an activity that covers this segment.</p>
        ) : (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: '1rem' }}>Rank</th>
                  <th>Date</th>
                  <th class="r">Time</th>
                  <th class="r">Pace</th>
                  <th class="r">HR</th>
                  <th class="r" style={{ paddingRight: '1rem' }}>
                    Power
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((e, i) => (
                  <tr key={e.id} class="click" onClick={() => go(`/activity/${e.activityId}`)}>
                    <td style={{ paddingLeft: '1rem' }}>{i < 3 ? <Medal rank={i + 1} /> : i + 1}</td>
                    <td>
                      {fmtDate(e.start, { month: 'short', day: 'numeric', year: 'numeric' })}
                      <div class="tiny muted">{acts.get(e.activityId)!.name}</div>
                    </td>
                    <td class="r">{fmtDuration(e.elapsed)}</td>
                    <td class="r">{fmtPaceOrSpeed(sportOf(e.activityId), seg.distance / e.elapsed)}</td>
                    <td class="r">{e.avgHr ? Math.round(e.avgHr) : '–'}</td>
                    <td class="r" style={{ paddingRight: '1rem' }}>
                      {e.avgPower ? `${Math.round(e.avgPower)} W` : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <button
        class="btn ghost danger"
        style={{ justifySelf: 'start' }}
        onClick={async () => {
          if (!confirm('Delete this segment and all its efforts?')) return
          await deleteSegment(seg.id)
          notify('Segment deleted')
          go('/maps/segments', true)
        }}
      >
        <Icon name="trash" size={1} /> Delete segment
      </button>
    </div>
  )
}
