import { useMemo, useState } from 'preact/hooks'
import { ActivityCard } from '../components/ActivityCard'
import { Columns } from '../components/charts'
import { Icon } from '../components/Icon'
import { Card, Empty, Ring, Seg } from '../components/ui'
import { showImport, showManual } from '../lib/uiState'
import { GROUP_LABEL } from '../lib/sports'
import { activities, goals, settings } from '../lib/store'
import { addDays, fitnessSeries, formLabel, goalProgress, inGroup, totals, weekStart, weekStreak } from '../lib/training'
import type { SportGroup } from '../lib/types'
import { distNum, distUnit, elevNum, elevUnit, fmtDist, fmtElev, fmtHours } from '../lib/units'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function goalValueFmt(metric: string, v: number) {
  if (metric === 'distance') return fmtDist(v, 0)
  if (metric === 'time') return fmtHours(v)
  if (metric === 'elevation') return fmtElev(v)
  return `${Math.round(v)}`
}

export function Home() {
  const all = activities.value
  const [group, setGroup] = useState<SportGroup | 'all'>('all')
  const [limit, setLimit] = useState(15)
  void settings.value.units

  const week = useMemo(() => {
    const ws = weekStart(Date.now())
    const list = all.filter((a) => a.start >= ws && inGroup(a, group))
    const prev = all.filter((a) => a.start >= addDays(ws, -7) && a.start < ws && inGroup(a, group))
    const days = DAYS.map((label, i) => {
      const s = addDays(ws, i)
      const e = addDays(ws, i + 1)
      const d = list.filter((a) => a.start >= s && a.start < e)
      return { key: String(i), label, value: distNum(d.reduce((x, a) => x + a.summary.distance, 0)), highlight: Date.now() >= s && Date.now() < e, tip: d.length ? `${d.length} activit${d.length > 1 ? 'ies' : 'y'}` : 'Rest' }
    })
    return { t: totals(list), prev: totals(prev), days }
  }, [all, group, settings.value.units])

  const fit = useMemo(() => {
    const s = fitnessSeries(all)
    return s[s.length - 1]
  }, [all, settings.value])

  if (!all.length)
    return (
      <div class="card">
        <Empty icon="run" title="Welcome to Redline">
          <p class="ink2" style={{ maxWidth: '28rem' }}>
            Your own training app. Every feature is unlocked and your data stays on this device.
          </p>
          <div class="row wrap" style={{ justifyContent: 'center', marginTop: '0.5rem' }}>
            <a class="btn primary lg" href="#/record">
              <Icon name="record" fill /> Record an activity
            </a>
            <button class="btn lg" onClick={() => (showImport.value = true)}>
              <Icon name="upload" /> Import history
            </button>
          </div>
          <button class="btn ghost sm" onClick={() => (showManual.value = true)}>
            or add one by hand
          </button>
        </Empty>
      </div>
    )

  const delta = week.t.distance - week.prev.distance
  const streak = weekStreak(all)

  return (
    <div class="split-layout">
      <div class="feed">
        {all.slice(0, limit).map((a) => (
          <ActivityCard key={a.id} a={a} />
        ))}
        {limit < all.length && (
          <button class="btn block" onClick={() => setLimit(limit + 20)}>
            Show more
          </button>
        )}
      </div>
      <aside class="stack home-aside" style={{ alignContent: 'start' }}>
        <Card title="This week" action={<Seg value={group} onChange={setGroup} options={(['all', 'foot', 'bike'] as const).map((v) => ({ v, label: v === 'all' ? 'All' : GROUP_LABEL[v] }))} />}>
          <div class="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div class="stat">
              <div class="label">Distance</div>
              <div class="value">
                {distNum(week.t.distance).toFixed(1)}
                <small>{distUnit()}</small>
              </div>
              <div class="sub">
                {delta >= 0 ? '+' : '-'}
                {Math.abs(distNum(delta)).toFixed(1)} vs last week
              </div>
            </div>
            <div class="stat">
              <div class="label">Time</div>
              <div class="value">{fmtHours(week.t.time)}</div>
              <div class="sub">{week.t.count} activities</div>
            </div>
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <Columns items={week.days} height={6.5} yFmt={(v) => `${+v.toFixed(1)}`} />
          </div>
          <div class="small muted">Elevation {Math.round(elevNum(week.t.elev)).toLocaleString()} {elevUnit()}</div>
        </Card>

        {goals.value.length > 0 && (
          <Card title="Goals" icon="target" action={<a class="pill-link" href="#/you">Edit</a>}>
            <div class="col">
              {goals.value.map((g) => {
                const pr = goalProgress(g, all)
                const per = g.period === 'week' ? 'This week' : g.period === 'month' ? 'This month' : 'This year'
                const ahead = pr.value - pr.expected
                return (
                  <div class="row" key={g.id} style={{ gap: '0.9rem' }}>
                    <Ring share={pr.share} label={`${Math.round(pr.share * 100)}%`} />
                    <div class="grow">
                      <div style={{ fontWeight: 650 }}>
                        {goalValueFmt(g.metric, pr.value)} <span class="muted">of {goalValueFmt(g.metric, g.target)}</span>
                      </div>
                      <div class="small ink2">
                        {per} · {GROUP_LABEL[g.group]}
                      </div>
                      <div class="tiny muted">{pr.share >= 1 ? 'Goal reached' : ahead >= 0 ? `${goalValueFmt(g.metric, ahead)} ahead of pace` : `${goalValueFmt(g.metric, -ahead)} behind pace`}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {fit && (
          <a href="#/training" class="card" style={{ display: 'block' }}>
            <div class="card-h">
              <h3>
                <Icon name="training" size={1.1} /> Fitness
              </h3>
              <Icon name="right" size={1} />
            </div>
            <div class="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div class="stat">
                <div class="label">Fitness</div>
                <div class="value">{Math.round(fit.fitness)}</div>
              </div>
              <div class="stat">
                <div class="label">Fatigue</div>
                <div class="value">{Math.round(fit.fatigue)}</div>
              </div>
              <div class="stat">
                <div class="label">Form</div>
                <div class="value">{Math.round(fit.form)}</div>
                <div class="sub">{formLabel(fit.form)}</div>
              </div>
            </div>
          </a>
        )}

        <div class="card row" style={{ gap: '0.9rem' }}>
          <div class="avatar" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <Icon name="flame" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
              {streak} week{streak === 1 ? '' : 's'}
            </div>
            <div class="small muted">Active week streak</div>
          </div>
        </div>
      </aside>
    </div>
  )
}
