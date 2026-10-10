import { memo } from 'preact/compat'
import { Icon } from './Icon'
import { SportIcon, TraceSvg } from './ui'
import { SPORTS, sportGroup, usesPace } from '../lib/sports'
import { activities, efforts, settings } from '../lib/store'
import { activityLoad, effortRanks, loadLabel, segmentRank } from '../lib/training'
import type { Activity } from '../lib/types'
import { fmtDist, fmtDuration, fmtElev, fmtPace, fmtRelDay, fmtSpeed } from '../lib/units'

export const ActivityCard = memo(function ActivityCard({ a }: { a: Activity }) {
  const s = a.summary
  const all = activities.value
  void settings.value.units
  const prs = sportGroup(a.sport) === 'foot' ? effortRanks(a, all).filter((r) => r.rank === 1).length : 0
  const mine = efforts.value.filter((e) => e.activityId === a.id)
  const segPrs = mine.filter((e) => segmentRank(e, efforts.value) === 1).length
  const load = activityLoad(a, all)
  return (
    <a href={`#/activity/${a.id}`} class="card act-card">
      <div class="act-head">
        <div class="avatar">
          <SportIcon sport={a.sport} />
        </div>
        <div class="grow">
          <div style={{ fontWeight: 650 }}>{SPORTS[a.sport].label}</div>
          <div class="small muted">{fmtRelDay(a.start)}</div>
        </div>
        <span class="chip" title={`Training load from ${load.method}`}>
          <Icon name="flame" size={0.85} /> {Math.round(load.load)}
          <span class="muted">{loadLabel(load.load)}</span>
        </span>
      </div>
      <div class="act-title">{a.name}</div>
      <div class="stats">
        {s.distance > 0 && (
          <div class="stat">
            <div class="label">Distance</div>
            <div class="value">{fmtDist(s.distance)}</div>
          </div>
        )}
        {s.distance > 0 && (
          <div class="stat">
            <div class="label">{usesPace(a.sport) ? 'Pace' : 'Speed'}</div>
            <div class="value">{usesPace(a.sport) ? fmtPace(s.avgSpeed) : fmtSpeed(s.avgSpeed)}</div>
          </div>
        )}
        <div class="stat">
          <div class="label">Time</div>
          <div class="value">{fmtDuration(s.movingTime)}</div>
        </div>
        {s.elevGain > 15 && (
          <div class="stat">
            <div class="label">Elevation</div>
            <div class="value">{fmtElev(s.elevGain)}</div>
          </div>
        )}
      </div>
      {a.trace.length > 1 && (
        <div class="trace-box">
          <TraceSvg trace={a.trace} />
        </div>
      )}
      {(prs > 0 || segPrs > 0 || mine.length > 0) && (
        <div class="badges">
          {prs > 0 && (
            <span class="chip">
              <span class="medal r1" style={{ width: '1rem', height: '1rem', fontSize: '0.5rem' }}>PR</span>
              {prs} best effort{prs > 1 ? 's' : ''}
            </span>
          )}
          {segPrs > 0 && (
            <span class="chip">
              <Icon name="trophy" size={0.85} /> {segPrs} segment PR{segPrs > 1 ? 's' : ''}
            </span>
          )}
          {mine.length > 0 && (
            <span class="chip">
              <Icon name="segment" size={0.85} /> {mine.length} segment{mine.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </a>
  )
})
