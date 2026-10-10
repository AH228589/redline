import { useMemo, useState } from 'preact/hooks'
import { Columns, dateTicks, fmtTick, XYChart, type Col } from '../components/charts'
import { Icon } from '../components/Icon'
import { Card, Empty, Medal, Seg, Stat } from '../components/ui'
import { go } from '../lib/router'
import { GROUP_LABEL, sportGroup } from '../lib/sports'
import { activities, settings } from '../lib/store'
import {
  addDays, bestEffortTable, bestPowerCurve, cumulativeYear, detectedMaxHr, estimateFtp, estimateThresholdPace, fitnessSeries, formLabel, inGroup, monthlyBuckets, racePredictions, totals, weekStart, weeklyBuckets,
} from '../lib/training'
import type { Activity, SportGroup } from '../lib/types'
import { BEST_EFFORT_DISTANCES, distNum, distUnit, elevNum, elevUnit, fmtDate, fmtDist, fmtDuration, fmtDurShort, fmtElev, fmtHours, fmtPace, POWER_DURATIONS } from '../lib/units'

type Tab = 'fitness' | 'progress' | 'log' | 'records'

export function TrainingView({ tab }: { tab: Tab }) {
  const all = activities.value
  return (
    <div>
      <div class="tabs">
        {(
          [
            ['fitness', 'Fitness'],
            ['progress', 'Progress'],
            ['log', 'Training log'],
            ['records', 'Records'],
          ] as const
        ).map(([k, l]) => (
          <a key={k} href={`#/training/${k}`} class={tab === k ? 'on' : ''}>
            {l}
          </a>
        ))}
      </div>
      {!all.length ? (
        <Card>
          <Empty icon="training" title="Nothing to analyse yet">
            <p class="ink2">Record or import a few activities and your fitness, progress and records show up here.</p>
          </Empty>
        </Card>
      ) : tab === 'progress' ? (
        <Progress />
      ) : tab === 'log' ? (
        <Log />
      ) : tab === 'records' ? (
        <Records />
      ) : (
        <Fitness />
      )}
    </div>
  )
}

function Fitness() {
  const all = activities.value
  const [range, setRange] = useState<'90' | '180' | '365' | 'all'>('180')
  const series = useMemo(() => fitnessSeries(all), [all, settings.value])
  const view = useMemo(() => (range === 'all' ? series : series.slice(-Number(range))), [series, range])
  const today = series[series.length - 1]
  const week = series.slice(-7).reduce((a, d) => a + d.load, 0)
  const prevWeek = series.slice(-14, -7).reduce((a, d) => a + d.load, 0)
  if (!today) return null
  const x = view.map((d) => d.day)
  const span = x[x.length - 1] - x[0]
  const xFmt = (v: number) => fmtTick(v, span)
  const xTicks = dateTicks(x[0], x[x.length - 1], 6)
  return (
    <div class="stack">
      <div class="row between wrap">
        <p class="small ink2" style={{ maxWidth: '40rem' }}>
          Fitness is your training load averaged over 6 weeks, fatigue over 1 week. Form is the gap between them: negative means you are building, positive means you are fresh.
        </p>
        <Seg value={range} onChange={setRange} options={[{ v: '90', label: '3 mo' }, { v: '180', label: '6 mo' }, { v: '365', label: '1 yr' }, { v: 'all', label: 'All' }]} />
      </div>
      <div class="card">
        <div class="stats big" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}>
          <Stat label="Fitness" value={Math.round(today.fitness)} sub={`${today.fitness >= (series[series.length - 29]?.fitness ?? 0) ? '+' : ''}${Math.round(today.fitness - (series[series.length - 29]?.fitness ?? 0))} in 4 weeks`} />
          <Stat label="Fatigue" value={Math.round(today.fatigue)} />
          <Stat label="Form" value={Math.round(today.form)} sub={formLabel(today.form)} />
          <Stat label="Load this week" value={Math.round(week)} sub={`${Math.round(prevWeek)} the week before`} />
        </div>
      </div>
      <Card title="Fitness and fatigue">
        <XYChart
          x={x}
          series={[
            { key: 'fit', label: 'Fitness', values: view.map((d) => d.fitness), color: 'var(--s1)', area: true },
            { key: 'fat', label: 'Fatigue', values: view.map((d) => d.fatigue), color: 'var(--s2)' },
          ]}
          height={11}
          zeroBase
          yFmt={(v) => `${Math.round(v)}`}
          xFmt={xFmt}
          xTicks={xTicks}
        />
      </Card>
      <Card title="Form">
        <XYChart
          x={x}
          series={[{ key: 'form', label: 'Form', values: view.map((d) => d.form), color: 'var(--ink-2)' }]}
          height={8}
          yMin={Math.min(-40, ...view.map((d) => d.form - 5))}
          yMax={Math.max(20, ...view.map((d) => d.form + 5))}
          yFmt={(v) => `${Math.round(v)}`}
          xFmt={xFmt}
          xTicks={xTicks}
          bands={[
            { from: 5, to: 60, label: 'Fresh', color: 'var(--s1-wash)' },
            { from: -30, to: -10, label: 'Productive', color: 'rgba(12,163,12,0.10)' },
            { from: -120, to: -30, label: 'Overreaching', color: 'rgba(208,59,59,0.10)' },
          ]}
          tip={(i) => (
            <>
              <div class="k">{fmtDate(view[i].day)}</div>
              <div class="v">
                {Math.round(view[i].form)} {formLabel(view[i].form)}
              </div>
            </>
          )}
        />
      </Card>
      <Card title="Daily training load">
        <XYChart
          x={x}
          bars
          series={[{ key: 'load', label: 'Load', values: view.map((d) => d.load), color: 'var(--accent)' }]}
          height={7}
          yFmt={(v) => `${Math.round(v)}`}
          xFmt={xFmt}
          xTicks={xTicks}
          tip={(i) => {
            const day = view[i].day
            const acts = all.filter((a) => a.start >= day && a.start < addDays(day, 1))
            return (
              <>
                <div class="k">{fmtDate(day)}</div>
                <div class="v">{Math.round(view[i].load)} load</div>
                {acts.map((a) => (
                  <div key={a.id} class="k">
                    {a.name}
                  </div>
                ))}
              </>
            )
          }}
        />
      </Card>
      <p class="tiny muted">
        Load uses power when you have an FTP set, otherwise heart rate, otherwise pace against your threshold, otherwise perceived effort or duration. Set your numbers under You for better accuracy.
      </p>
    </div>
  )
}

type Metric = 'distance' | 'time' | 'elev' | 'count'

function metricOf(t: ReturnType<typeof totals>, m: Metric) {
  return m === 'distance' ? distNum(t.distance) : m === 'time' ? t.time / 3600 : m === 'elev' ? elevNum(t.elev) : t.count
}
const metricLabel = (m: Metric) => (m === 'distance' ? distUnit() : m === 'time' ? 'hours' : m === 'elev' ? elevUnit() : 'activities')

function Progress() {
  const all = activities.value
  const [group, setGroup] = useState<SportGroup | 'all'>('all')
  const [metric, setMetric] = useState<Metric>('distance')
  const [span, setSpan] = useState<'12w' | '52w' | '12m'>('12w')
  void settings.value.units
  const list = useMemo(() => all.filter((a) => inGroup(a, group)), [all, group])
  const items: Col[] = useMemo(() => {
    if (span === '12m')
      return monthlyBuckets(list, 12).map((b, i, arr) => ({
        key: String(b.start),
        label: fmtDate(b.start, { month: 'narrow' }),
        value: metricOf(b.t, metric),
        highlight: i === arr.length - 1,
        tip: (
          <>
            <div class="k">{fmtDate(b.start, { month: 'long', year: 'numeric' })}</div>
            <div class="v">
              {fmtMetric(b.t, metric)} · {b.t.count} activities
            </div>
          </>
        ),
      }))
    return weeklyBuckets(list, span === '12w' ? 12 : 52).map((b, i, arr) => ({
      key: String(b.start),
      label: fmtDate(b.start, { month: 'short', day: 'numeric' }),
      value: metricOf(b.t, metric),
      highlight: i === arr.length - 1,
      tip: (
        <>
          <div class="k">Week of {fmtDate(b.start, { month: 'short', day: 'numeric' })}</div>
          <div class="v">
            {fmtMetric(b.t, metric)} · {b.t.count} activities
          </div>
        </>
      ),
    }))
  }, [list, metric, span, settings.value.units])

  const year = new Date().getFullYear()
  const m2 = metric === 'count' ? 'distance' : metric
  const thisY = useMemo(() => cumulativeYear(list, year, m2), [list, metric])
  const lastY = useMemo(() => cumulativeYear(list, year - 1, m2), [list, metric])
  const doy = Math.floor((Date.now() - new Date(year, 0, 1).getTime()) / 86400000)
  const conv = (v: number) => (m2 === 'distance' ? distNum(v) : m2 === 'time' ? v / 3600 : elevNum(v))
  const days = Array.from({ length: lastY.length }, (_, i) => i)
  const ytd = totals(list.filter((a) => new Date(a.start).getFullYear() === year))
  const lytd = totals(list.filter((a) => a.start >= new Date(year - 1, 0, 1).getTime() && a.start < addDays(new Date(year - 1, 0, 1).getTime(), doy + 1)))
  const allT = totals(list)
  const avg = items.length ? items.reduce((a, b) => a + b.value, 0) / items.length : 0

  return (
    <div class="stack">
      <div class="row wrap">
        <Seg value={group} onChange={setGroup} options={(['all', 'foot', 'bike', 'other'] as const).map((v) => ({ v, label: v === 'all' ? 'All' : GROUP_LABEL[v] }))} />
        <Seg value={metric} onChange={setMetric} options={[{ v: 'distance', label: 'Distance' }, { v: 'time', label: 'Time' }, { v: 'elev', label: 'Elevation' }, { v: 'count', label: 'Count' }]} />
        <Seg value={span} onChange={setSpan} options={[{ v: '12w', label: '12 weeks' }, { v: '52w', label: '52 weeks' }, { v: '12m', label: '12 months' }]} />
      </div>
      <Card title={`${span === '12m' ? 'Monthly' : 'Weekly'} ${metric === 'count' ? 'activities' : metric === 'elev' ? 'elevation' : metric}`} action={<span class="small muted">avg {avg.toFixed(metric === 'count' ? 1 : 1)} {metricLabel(metric)}</span>}>
        <Columns items={items} height={10} yFmt={(v) => `${+v.toFixed(1)}`} labelEvery={span === '52w' ? 6 : span === '12m' ? 1 : 2} color="var(--accent)" dim="var(--s1)" onPick={span === '12m' ? undefined : (k) => go(`/training/log?w=${k}`)} />
      </Card>
      <div class="grid2">
        <Card title={`${year} vs ${year - 1}`}>
          <XYChart
            x={days}
            series={[
              { key: 'ly', label: String(year - 1), values: lastY.map(conv), color: 'var(--s2)' },
              { key: 'ty', label: String(year), values: thisY.slice(0, doy + 1).map(conv).concat(new Array(Math.max(0, lastY.length - doy - 1)).fill(NaN)), color: 'var(--s1)' },
            ]}
            height={9}
            zeroBase
            yFmt={(v) => `${Math.round(v)}`}
            xFmt={(v) => fmtDate(new Date(year, 0, 1 + v).getTime(), { month: 'short' })}
            xTicks={[0, 90, 181, 273]}
          />
          <p class="small ink2" style={{ marginTop: '0.5rem' }}>
            {fmtMetric(ytd, m2)} so far this year, {fmtMetric(lytd, m2)} by this date last year.
          </p>
        </Card>
        <Card title="Totals">
          <table class="table">
            <thead>
              <tr>
                <th />
                <th class="r">This year</th>
                <th class="r">All time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Activities</td>
                <td class="r">{ytd.count}</td>
                <td class="r">{allT.count}</td>
              </tr>
              <tr>
                <td>Distance</td>
                <td class="r">{fmtDist(ytd.distance, 0)}</td>
                <td class="r">{fmtDist(allT.distance, 0)}</td>
              </tr>
              <tr>
                <td>Time</td>
                <td class="r">{fmtHours(ytd.time)}</td>
                <td class="r">{fmtHours(allT.time)}</td>
              </tr>
              <tr>
                <td>Elevation</td>
                <td class="r">{fmtElev(ytd.elev)}</td>
                <td class="r">{fmtElev(allT.elev)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}

function fmtMetric(t: ReturnType<typeof totals>, m: Metric) {
  return m === 'distance' ? fmtDist(t.distance, 1) : m === 'time' ? fmtHours(t.time) : m === 'elev' ? fmtElev(t.elev) : `${t.count}`
}

const GROUP_COLOR: Record<SportGroup, string> = { foot: 'var(--s1)', bike: 'var(--s2)', other: 'var(--s3)' }

function Log() {
  const all = activities.value
  const [weeks, setWeeks] = useState(12)
  void settings.value.units
  const thisWeek = weekStart(Date.now())
  const maxDur = Math.max(1, ...all.slice(0, 300).map((a) => a.summary.movingTime))
  const rows = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * i))
  return (
    <div class="stack">
      <div class="legend">
        {(Object.keys(GROUP_COLOR) as SportGroup[]).map((g) => (
          <span key={g}>
            <i class="dotkey" style={{ background: GROUP_COLOR[g] }} />
            {GROUP_LABEL[g]}
          </span>
        ))}
        <span class="muted">Circle size shows duration</span>
      </div>
      <div class="card" style={{ padding: '0.5rem 1rem' }}>
        <div class="cal">
          <div class="h" />
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} class="h">
              {d.slice(0, 1)}
            </div>
          ))}
          <div class="h tot">Total</div>
          {rows.map((ws) => {
            const wk = all.filter((a) => a.start >= ws && a.start < addDays(ws, 7))
            const t = totals(wk)
            return [
              <div key={`w${ws}`} class="wk">
                {fmtDate(ws, { month: 'short', day: 'numeric' })}
              </div>,
              ...Array.from({ length: 7 }, (_, d) => {
                const day = addDays(ws, d)
                const acts = wk.filter((a) => a.start >= day && a.start < addDays(day, 1))
                return (
                  <div key={`${ws}-${d}`} style={{ position: 'relative' }}>
                    {acts.length > 0 && <Bubble acts={acts} maxDur={maxDur} />}
                  </div>
                )
              }),
              <div key={`t${ws}`} class="tot">
                <div style={{ textAlign: 'right' }}>
                  {t.count ? fmtDist(t.distance, 1) : ''}
                  <div class="tiny muted">{t.count ? fmtHours(t.time) : ''}</div>
                </div>
              </div>,
            ]
          })}
        </div>
      </div>
      <button class="btn" onClick={() => setWeeks(weeks + 12)}>
        Show earlier weeks
      </button>
    </div>
  )
}

function Bubble({ acts, maxDur }: { acts: Activity[]; maxDur: number }) {
  const dur = acts.reduce((s, a) => s + a.summary.movingTime, 0)
  const size = 0.7 + 1.5 * Math.sqrt(Math.min(1, dur / maxDur))
  const main = acts.slice().sort((a, b) => b.summary.movingTime - a.summary.movingTime)[0]
  return (
    <span
      class="bub"
      title={acts.map((a) => `${a.name}: ${fmtDuration(a.summary.movingTime)}`).join('\n')}
      onClick={() => go(`/activity/${main.id}`)}
      style={{ width: `${size}rem`, height: `${size}rem`, background: GROUP_COLOR[sportGroup(main.sport)], boxShadow: acts.length > 1 ? '0 0 0 0.15rem var(--surface), 0 0 0 0.28rem var(--axis)' : undefined }}
    />
  )
}

function Records() {
  const all = activities.value
  void settings.value.units
  const year = new Date(new Date().getFullYear(), 0, 1).getTime()
  const foot = all.filter((a) => sportGroup(a.sport) === 'foot')
  const best = useMemo(() => bestEffortTable(foot, { top: 3 }), [all])
  const bestYear = useMemo(() => bestEffortTable(foot, { since: year, top: 1 }), [all])
  const preds = useMemo(() => racePredictions(all), [all])
  const thr = estimateThresholdPace(all)
  const ftp = estimateFtp(all)
  const maxHr = detectedMaxHr(all)
  const pc = bestPowerCurve(all)
  const pc90 = bestPowerCurve(all, Date.now() - 90 * 86400000)
  const durs = POWER_DURATIONS.filter((d) => pc[String(d)])
  const longest = (g: SportGroup) => all.filter((a) => sportGroup(a.sport) === g).sort((a, b) => b.summary.distance - a.summary.distance)[0]
  const climb = all.slice().sort((a, b) => b.summary.elevGain - a.summary.elevGain)[0]
  return (
    <div class="stack">
      {best.size > 0 && (
        <Card title="Best efforts" icon="trophy" class="flush" style={{ padding: '1rem 0 0' }}>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: '1rem' }}>Distance</th>
                  <th>All time</th>
                  <th class="r">Pace</th>
                  <th class="r" style={{ paddingRight: '1rem' }}>
                    This year
                  </th>
                </tr>
              </thead>
              <tbody>
                {BEST_EFFORT_DISTANCES.filter((d) => best.has(d.m)).map((d) => {
                  const rows = best.get(d.m)!
                  const y = bestYear.get(d.m)?.[0]
                  return (
                    <tr key={d.m} class="click" onClick={() => go(`/activity/${rows[0].activityId}`)}>
                      <td style={{ paddingLeft: '1rem', fontWeight: 650 }}>{d.label}</td>
                      <td>
                        <div class="row" style={{ gap: '0.4rem' }}>
                          <Medal rank={1} /> <b>{fmtDuration(rows[0].time)}</b>
                        </div>
                        <div class="tiny muted">{fmtDate(rows[0].start, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      </td>
                      <td class="r">{fmtPace(d.m / rows[0].time)}</td>
                      <td class="r" style={{ paddingRight: '1rem' }}>
                        {y ? fmtDuration(y.time) : '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div class="grid2">
        {preds.length > 0 && (
          <Card title="Race predictions" icon="flag">
            <table class="table">
              <tbody>
                {preds.map((p) => (
                  <tr key={p.m}>
                    <td style={{ fontWeight: 650 }}>{p.label}</td>
                    <td class="r">{fmtDuration(p.time)}</td>
                    <td class="r muted">{fmtPace(p.m / p.time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="tiny muted" style={{ marginTop: '0.5rem' }}>
              From your best efforts in the last 4 months (Riegel formula). Longer races assume matching endurance training.
            </p>
          </Card>
        )}
        <Card title="Your numbers" icon="gauge">
          <dl class="kv">
            <dt>Threshold pace (estimated)</dt>
            <dd>{thr ? fmtPace(1000 / thr) : 'Need a recent 5K or 10K effort'}</dd>
            <dt>FTP (estimated)</dt>
            <dd>{ftp ? `${ftp} W` : 'Need rides with power'}</dd>
            <dt>Highest heart rate seen</dt>
            <dd>{maxHr ? `${maxHr} bpm` : '–'}</dd>
            {(['foot', 'bike'] as const).map((g) => {
              const a = longest(g)
              return a ? (
                <>
                  <dt>Longest {g === 'foot' ? 'run or walk' : 'ride'}</dt>
                  <dd>
                    <a href={`#/activity/${a.id}`}>{fmtDist(a.summary.distance)}</a>
                  </dd>
                </>
              ) : null
            })}
            {climb && climb.summary.elevGain > 0 && (
              <>
                <dt>Biggest climb day</dt>
                <dd>
                  <a href={`#/activity/${climb.id}`}>{fmtElev(climb.summary.elevGain)}</a>
                </dd>
              </>
            )}
          </dl>
          <a class="pill-link" href="#/you" style={{ marginTop: '0.75rem' }}>
            Use these in your zones <Icon name="right" size={0.9} />
          </a>
        </Card>
      </div>
      {durs.length > 2 && (
        <Card title="Power curve" icon="zap">
          <XYChart
            x={durs}
            logX
            xTicks={[5, 60, 300, 1200, 3600].filter((t) => t <= durs[durs.length - 1])}
            series={[
              { key: 'all', label: 'All time', values: durs.map((d) => pc[String(d)]?.w ?? NaN), color: 'var(--s1)' },
              { key: '90', label: 'Last 90 days', values: durs.map((d) => pc90[String(d)]?.w ?? NaN), color: 'var(--s2)' },
            ]}
            height={9}
            zeroBase
            yFmt={(v) => `${Math.round(v)}`}
            xFmt={fmtDurShort}
          />
        </Card>
      )}
    </div>
  )
}
