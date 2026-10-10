import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from '../components/Icon'
import { Card, Progress, Seg, Sheet, Switch } from '../components/ui'
import { exportBackup, importBackup, storageEstimate } from '../lib/backup'
import { download } from '../lib/importers'
import { HR_ZONES } from '../lib/series'
import { GROUP_LABEL, SPORT_LIST, SPORTS } from '../lib/sports'
import { activities, gear, goals, notify, reanalyzeAll, saveGear, saveGoals, saveSettings, settings, uid, wipeAll } from '../lib/store'
import { detectedMaxHr, estimateFtp, estimateThresholdPace, totals } from '../lib/training'
import type { Gear, Goal, Sport } from '../lib/types'
import { distNum, distUnit, elevUnit, fmtDist, fmtDuration, fmtHours, FOOT, unitLen } from '../lib/units'
import { goalValueFmt } from './Home'

function NumField({ label, value, onSave, suffix, placeholder }: { label: string; value: number | null; onSave: (v: number | null) => void; suffix?: string; placeholder?: string }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  useEffect(() => setV(value == null ? '' : String(value)), [value])
  return (
    <label class="field">
      <span>{label}</span>
      <div class="row">
        <input
          class="input"
          inputMode="decimal"
          value={v}
          placeholder={placeholder}
          onInput={(e) => setV((e.target as HTMLInputElement).value)}
          onBlur={() => {
            const n = parseFloat(v)
            onSave(v.trim() === '' || !isFinite(n) ? null : n)
          }}
        />
        {suffix && <span class="muted small nowrap">{suffix}</span>}
      </div>
    </label>
  )
}

function parsePace(s: string) {
  const m = s.trim().match(/^(\d+):(\d{1,2})$/)
  if (!m) return null
  return +m[1] * 60 + +m[2]
}

export function YouView() {
  const st = settings.value
  const all = activities.value
  const t = totals(all)
  const detected = detectedMaxHr(all)
  const thrEst = estimateThresholdPace(all)
  const ftpEst = estimateFtp(all)
  const unitSec = st.thresholdPace ? (st.thresholdPace * unitLen()) / 1000 : null
  const [pace, setPace] = useState(unitSec ? fmtDuration(unitSec) : '')
  useEffect(() => setPace(unitSec ? fmtDuration(unitSec) : ''), [st.thresholdPace, st.units])
  const [goalSheet, setGoalSheet] = useState(false)
  const [gearSheet, setGearSheet] = useState<Gear | null | 'new'>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    storageEstimate().then(setStorage)
  }, [all.length])

  return (
    <div class="stack">
      <div class="page-head" style={{ marginBottom: 0 }}>
        <div class="row" style={{ gap: '0.9rem' }}>
          <div class="avatar" style={{ width: '3.5rem', height: '3.5rem', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 800, fontSize: '1.4rem' }}>
            {(st.name || 'R').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h1>{st.name || 'Athlete'}</h1>
            <div class="small muted">
              {t.count} activities · {fmtDist(t.distance, 0)} · {fmtHours(t.time)}
            </div>
          </div>
        </div>
        <span class="chip accent">
          <Icon name="star" fill size={0.85} /> Everything unlocked
        </span>
      </div>

      <div class="grid2">
        <Card title="Profile" icon="user">
          <div class="col">
            <label class="field">
              <span>Name</span>
              <input class="input" value={st.name} onBlur={(e) => saveSettings({ name: (e.target as HTMLInputElement).value.trim() })} />
            </label>
            <NumField label="Weight" value={st.weight} suffix="kg" onSave={(v) => v && saveSettings({ weight: v })} />
            <label class="field">
              <span>Default sport</span>
              <select class="input" value={st.defaultSport} onChange={(e) => saveSettings({ defaultSport: (e.target as HTMLSelectElement).value as Sport })}>
                {SPORT_LIST.map((k) => (
                  <option key={k} value={k}>
                    {SPORTS[k].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <Card title="Preferences" icon="settings">
          <div class="col">
            <div class="row between">
              <span>Units</span>
              <Seg value={st.units} onChange={(v) => saveSettings({ units: v })} options={[{ v: 'metric', label: 'Metric' }, { v: 'imperial', label: 'Imperial' }]} />
            </div>
            <div class="row between">
              <span>Theme</span>
              <Seg value={st.theme} onChange={(v) => saveSettings({ theme: v })} options={[{ v: 'system', label: 'Auto' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }]} />
            </div>
            <div class="row between">
              <span>Map</span>
              <Seg value={st.mapStyle} onChange={(v) => saveSettings({ mapStyle: v })} options={[{ v: 'standard', label: 'Standard' }, { v: 'topo', label: 'Topo' }, { v: 'dark', label: 'Dark' }]} />
            </div>
            <div class="row between">
              <span>Voice cues while recording</span>
              <Switch on={st.voiceCues} onChange={(v) => saveSettings({ voiceCues: v })} label="Voice cues" />
            </div>
            <div class="row between">
              <span>Auto-pause</span>
              <Switch on={st.autoPause} onChange={(v) => saveSettings({ autoPause: v })} label="Auto-pause" />
            </div>
          </div>
        </Card>
      </div>

      <Card title="Heart rate, pace and power" icon="heart">
        <div class="grid3">
          <div class="col">
            <NumField label="Max heart rate" value={st.maxHr} suffix="bpm" onSave={(v) => v && saveSettings({ maxHr: Math.round(v) })} />
            {detected && detected !== st.maxHr && (
              <button class="btn sm" onClick={() => saveSettings({ maxHr: detected })}>
                Use {detected} from your data
              </button>
            )}
            <NumField label="Resting heart rate" value={st.restHr} suffix="bpm" onSave={(v) => v && saveSettings({ restHr: Math.round(v) })} />
            <NumField label="Threshold heart rate" value={st.lthr} suffix="bpm" placeholder={`auto ${Math.round(st.maxHr * 0.9)}`} onSave={(v) => saveSettings({ lthr: v ? Math.round(v) : null })} />
          </div>
          <div class="col">
            <label class="field">
              <span>Threshold pace</span>
              <div class="row">
                <input
                  class="input"
                  placeholder={thrEst ? `auto ${fmtDuration((thrEst * unitLen()) / 1000)}` : 'mm:ss'}
                  value={pace}
                  onInput={(e) => setPace((e.target as HTMLInputElement).value)}
                  onBlur={() => {
                    const sec = parsePace(pace)
                    saveSettings({ thresholdPace: sec ? (sec * 1000) / unitLen() : null })
                  }}
                />
                <span class="muted small nowrap">/{distUnit()}</span>
              </div>
            </label>
            {thrEst && (
              <button class="btn sm" onClick={() => saveSettings({ thresholdPace: Math.round(thrEst) })}>
                Use {fmtDuration((thrEst * unitLen()) / 1000)} from your races
              </button>
            )}
            <NumField label="FTP" value={st.ftp} suffix="W" placeholder={ftpEst ? `est. ${ftpEst}` : 'watts'} onSave={(v) => saveSettings({ ftp: v ? Math.round(v) : null })} />
            {ftpEst && ftpEst !== st.ftp && (
              <button class="btn sm" onClick={() => saveSettings({ ftp: ftpEst })}>
                Use {ftpEst} W from your rides
              </button>
            )}
          </div>
          <div>
            <div class="small" style={{ fontWeight: 650, marginBottom: '0.4rem' }}>
              Heart rate zones
            </div>
            <table class="table">
              <tbody>
                {HR_ZONES.map((z, i) => (
                  <tr key={z.name}>
                    <td>
                      Z{i + 1} {z.name}
                    </td>
                    <td class="r">
                      {i === 0 ? `< ${Math.round(z.hi * st.maxHr)}` : i === 4 ? `${Math.round(z.lo * st.maxHr)}+` : `${Math.round(z.lo * st.maxHr)}-${Math.round(z.hi * st.maxHr)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <div class="grid2">
        <Card title="Goals" icon="target" action={<button class="btn sm" onClick={() => setGoalSheet(true)}><Icon name="plus" size={0.9} /> Add</button>}>
          {goals.value.length === 0 && <p class="muted small">No goals set.</p>}
          {goals.value.map((g) => (
            <div class="list-row" key={g.id}>
              <Icon name="target" />
              <div class="grow">
                <div style={{ fontWeight: 650 }}>
                  {goalValueFmt(g.metric, g.target)} {g.metric === 'count' ? 'activities' : ''} per {g.period}
                </div>
                <div class="small muted">{GROUP_LABEL[g.group]}</div>
              </div>
              <button class="btn ghost icon sm" aria-label="Remove goal" onClick={() => saveGoals(goals.value.filter((x) => x.id !== g.id))}>
                <Icon name="trash" size={1} />
              </button>
            </div>
          ))}
        </Card>

        <Card title="Gear" icon="shoe" action={<button class="btn sm" onClick={() => setGearSheet('new')}><Icon name="plus" size={0.9} /> Add</button>}>
          {gear.value.length === 0 && <p class="muted small">Track mileage on shoes and bikes.</p>}
          {gear.value.map((g) => {
            const used = g.startDistance + all.filter((a) => a.gearId === g.id).reduce((s, a) => s + a.summary.distance, 0)
            return (
              <div class="list-row" key={g.id} style={{ cursor: 'pointer', opacity: g.retired ? 0.55 : 1 }} onClick={() => setGearSheet(g)}>
                <Icon name={g.kind === 'bike' ? 'ride' : 'shoe'} />
                <div class="grow">
                  <div style={{ fontWeight: 650 }}>
                    {g.name} {g.retired && <span class="chip">Retired</span>}
                  </div>
                  <div class="small muted">{fmtDist(used, 0)}{g.limit ? ` of ${fmtDist(g.limit, 0)}` : ''}</div>
                  {g.limit && <div style={{ marginTop: '0.35rem' }}><Progress value={used / g.limit} /></div>}
                </div>
              </div>
            )
          })}
        </Card>
      </div>

      <Card title="Your data" icon="file">
        <div class="col">
          <p class="small ink2">
            Everything is stored in this browser on this device. Nothing is uploaded anywhere. Export a backup now and then, and import it to move to another device.
            {storage && ` Using ${(storage.used / 1048576).toFixed(1)} MB.`}
          </p>
          <div class="row wrap">
            <button
              class="btn"
              onClick={async () => {
                const data = await exportBackup()
                download(`redline-backup-${new Date().toISOString().slice(0, 10)}.json.gz`, data as BlobPart, 'application/gzip')
              }}
            >
              <Icon name="download" size={1} /> Export backup
            </button>
            <button class="btn" onClick={() => backupInput.current?.click()}>
              <Icon name="upload" size={1} /> Restore backup
            </button>
            <input
              ref={backupInput}
              type="file"
              accept=".gz,.json,application/gzip,application/json"
              class="hidden"
              onChange={async (e) => {
                const f = (e.target as HTMLInputElement).files?.[0]
                ;(e.target as HTMLInputElement).value = ''
                if (!f) return
                try {
                  const n = await importBackup(f)
                  notify(`Restored ${n} activities`)
                } catch (err) {
                  notify((err as Error).message)
                }
              }}
            />
            <button
              class="btn"
              disabled={busy != null}
              onClick={async () => {
                setBusy(0)
                await reanalyzeAll((d, total) => setBusy(d / total))
                setBusy(null)
                notify('All activities re-analysed')
              }}
            >
              <Icon name="loop" size={1} /> Re-analyse all
            </button>
          </div>
          {busy != null && <Progress value={busy} />}
          <button
            class="btn ghost danger"
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              if (!confirm('Delete ALL activities, routes, segments and settings from this device? Export a backup first if you want to keep them.')) return
              if (!confirm('Really delete everything? This cannot be undone.')) return
              await wipeAll()
              notify('All data deleted')
            }}
          >
            <Icon name="trash" size={1} /> Delete all data
          </button>
        </div>
      </Card>

      {goalSheet && <GoalSheet onClose={() => setGoalSheet(false)} />}
      {gearSheet && <GearSheet g={gearSheet === 'new' ? null : gearSheet} onClose={() => setGearSheet(null)} />}
    </div>
  )
}

function GoalSheet({ onClose }: { onClose: () => void }) {
  const [metric, setMetric] = useState<Goal['metric']>('distance')
  const [period, setPeriod] = useState<Goal['period']>('week')
  const [group, setGroup] = useState<Goal['group']>('all')
  const [target, setTarget] = useState('')
  const unit = metric === 'distance' ? distUnit() : metric === 'time' ? 'hours' : metric === 'elevation' ? elevUnit() : 'activities'
  return (
    <Sheet title="New goal" onClose={onClose}>
      <div class="col">
        <Seg value={metric} onChange={setMetric} options={[{ v: 'distance', label: 'Distance' }, { v: 'time', label: 'Time' }, { v: 'elevation', label: 'Elevation' }, { v: 'count', label: 'Activities' }]} />
        <Seg value={period} onChange={setPeriod} options={[{ v: 'week', label: 'Weekly' }, { v: 'month', label: 'Monthly' }, { v: 'year', label: 'Yearly' }]} />
        <Seg value={group} onChange={setGroup} options={(['all', 'foot', 'bike', 'other'] as const).map((v) => ({ v, label: v === 'all' ? 'All' : GROUP_LABEL[v] }))} />
        <label class="field">
          <span>Target ({unit})</span>
          <input class="input" inputMode="decimal" value={target} onInput={(e) => setTarget((e.target as HTMLInputElement).value)} />
        </label>
        <button
          class="btn primary lg block"
          disabled={!(parseFloat(target) > 0)}
          onClick={async () => {
            const v = parseFloat(target)
            const raw = metric === 'distance' ? v * unitLen() : metric === 'time' ? v * 3600 : metric === 'elevation' ? v * (elevUnit() === 'ft' ? FOOT : 1) : v
            await saveGoals([...goals.value, { id: uid(), metric, period, group, target: raw }])
            onClose()
          }}
        >
          Add goal
        </button>
      </div>
    </Sheet>
  )
}

function GearSheet({ g, onClose }: { g: Gear | null; onClose: () => void }) {
  const [name, setName] = useState(g?.name ?? '')
  const [kind, setKind] = useState<Gear['kind']>(g?.kind ?? 'shoes')
  const [start, setStart] = useState(g ? String(+distNum(g.startDistance).toFixed(1)) : '0')
  const [limit, setLimit] = useState(g?.limit ? String(Math.round(distNum(g.limit))) : '')
  const [defaults, setDefaults] = useState<Sport[]>(g?.defaultFor ?? [])
  const choices = SPORT_LIST.filter((s) => (kind === 'shoes' ? SPORTS[s].group === 'foot' : SPORTS[s].group === 'bike'))
  return (
    <Sheet title={g ? 'Edit gear' : 'Add gear'} onClose={onClose}>
      <div class="col">
        <Seg value={kind} onChange={setKind} options={[{ v: 'shoes', label: 'Shoes' }, { v: 'bike', label: 'Bike' }]} />
        <label class="field">
          <span>Name</span>
          <input class="input" value={name} placeholder={kind === 'shoes' ? 'e.g. Daily trainers' : 'e.g. Road bike'} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <div class="grid2">
          <label class="field">
            <span>Starting distance ({distUnit()})</span>
            <input class="input" inputMode="decimal" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span>Replace after ({distUnit()})</span>
            <input class="input" inputMode="decimal" value={limit} placeholder={kind === 'shoes' ? (distUnit() === 'km' ? '700' : '450') : ''} onInput={(e) => setLimit((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="field">
          <span>Use by default for</span>
          <div class="row wrap">
            {choices.map((s) => (
              <button key={s} class={`btn sm ${defaults.includes(s) ? 'dark' : ''}`} onClick={() => setDefaults(defaults.includes(s) ? defaults.filter((x) => x !== s) : [...defaults, s])}>
                {SPORTS[s].label}
              </button>
            ))}
          </div>
        </div>
        <button
          class="btn primary lg block"
          disabled={!name.trim()}
          onClick={async () => {
            const item: Gear = { id: g?.id ?? uid(), name: name.trim(), kind, startDistance: (parseFloat(start) || 0) * unitLen(), limit: parseFloat(limit) > 0 ? parseFloat(limit) * unitLen() : null, retired: g?.retired ?? false, defaultFor: defaults }
            const others = gear.value.filter((x) => x.id !== item.id).map((x) => ({ ...x, defaultFor: x.defaultFor.filter((s) => !defaults.includes(s)) }))
            await saveGear([...others, item])
            onClose()
          }}
        >
          Save
        </button>
        {g && (
          <div class="row">
            <button
              class="btn"
              onClick={async () => {
                await saveGear(gear.value.map((x) => (x.id === g.id ? { ...x, retired: !x.retired } : x)))
                onClose()
              }}
            >
              {g.retired ? 'Bring back' : 'Retire'}
            </button>
            <button
              class="btn ghost danger"
              onClick={async () => {
                if (!confirm('Remove this gear?')) return
                await saveGear(gear.value.filter((x) => x.id !== g.id))
                onClose()
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
