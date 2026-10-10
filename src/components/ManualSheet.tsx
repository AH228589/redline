import { useState } from 'preact/hooks'
import { Sheet } from './ui'
import { buildManual } from '../lib/importers'
import { defaultName, SPORT_LIST, SPORTS } from '../lib/sports'
import { addActivity, notify, settings } from '../lib/store'
import { go } from '../lib/router'
import type { Sport } from '../lib/types'
import { distUnit, elevUnit, FOOT, unitLen } from '../lib/units'

const pad = (n: number) => String(n).padStart(2, '0')
const localInput = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ManualSheet({ onClose }: { onClose: () => void }) {
  const [sport, setSport] = useState<Sport>(settings.value.defaultSport)
  const [name, setName] = useState('')
  const [when, setWhen] = useState(localInput(Date.now() - 3600_000))
  const [h, setH] = useState('0')
  const [m, setM] = useState('45')
  const [s, setS] = useState('0')
  const [dist, setDist] = useState('')
  const [elev, setElev] = useState('')
  const [rpe, setRpe] = useState(5)
  const [desc, setDesc] = useState('')

  async function save() {
    const time = (+h || 0) * 3600 + (+m || 0) * 60 + (+s || 0)
    if (time <= 0) return notify('Add a duration')
    const start = new Date(when).getTime()
    const act = buildManual({
      sport,
      name: name.trim() || defaultName(sport, start),
      start,
      time,
      distance: (parseFloat(dist) || 0) * unitLen(),
      gain: (parseFloat(elev) || 0) * (elevUnit() === 'ft' ? FOOT : 1),
      rpe,
      description: desc,
    })
    await addActivity(act, null)
    notify('Activity saved')
    onClose()
    go(`/activity/${act.id}`)
  }

  return (
    <Sheet title="Manual entry" onClose={onClose}>
      <div class="col">
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
          <span>Title</span>
          <input class="input" value={name} placeholder={defaultName(sport, new Date(when).getTime())} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>Start</span>
          <input class="input" type="datetime-local" value={when} onInput={(e) => setWhen((e.target as HTMLInputElement).value)} />
        </label>
        <div class="field">
          <span>Duration</span>
          <div class="row">
            <input class="input" inputMode="numeric" aria-label="Hours" value={h} onInput={(e) => setH((e.target as HTMLInputElement).value)} />
            <span class="muted">h</span>
            <input class="input" inputMode="numeric" aria-label="Minutes" value={m} onInput={(e) => setM((e.target as HTMLInputElement).value)} />
            <span class="muted">m</span>
            <input class="input" inputMode="numeric" aria-label="Seconds" value={s} onInput={(e) => setS((e.target as HTMLInputElement).value)} />
            <span class="muted">s</span>
          </div>
        </div>
        <div class="grid2">
          <label class="field">
            <span>Distance ({distUnit()})</span>
            <input class="input" inputMode="decimal" value={dist} placeholder="0" onInput={(e) => setDist((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span>Elevation ({elevUnit()})</span>
            <input class="input" inputMode="numeric" value={elev} placeholder="0" onInput={(e) => setElev((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <label class="field">
          <span>
            How hard was it? <b>{rpe}</b> / 10
          </span>
          <input type="range" min={1} max={10} value={rpe} onInput={(e) => setRpe(+(e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea class="input" value={desc} onInput={(e) => setDesc((e.target as HTMLTextAreaElement).value)} />
        </label>
        <button class="btn primary lg block" onClick={save}>
          Save activity
        </button>
      </div>
    </Sheet>
  )
}
