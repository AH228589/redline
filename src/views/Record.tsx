import { useEffect, useRef, useState } from 'preact/hooks'
import { MapView, cssVar, type MapLine, type MapPoint } from '../components/MapView'
import { Icon } from '../components/Icon'
import { Sheet, SportIcon, Switch } from '../components/ui'
import { beaconId, beaconLink, beaconViewers, startBeacon, stopBeacon } from '../lib/beacon'
import { buildManual } from '../lib/importers'
import * as rec from '../lib/recorder'
import { back, go } from '../lib/router'
import { alignToTerrain, correctElevation } from '../lib/routing'
import { isNative, nativePlatform, openAppSettings } from '../lib/native'
import { GetAppNotice } from '../components/GetApp'
import { fillGaps, findGaps } from '../lib/gaps'
import { defaultName, SPORT_LIST, SPORTS, usesPace } from '../lib/sports'
import { addActivity, buildActivity, gear, notify, replaceStreams, routes, settings, saveSettings } from '../lib/store'
import type { Route, Sport, Streams } from '../lib/types'
import { distNum, distUnit, fmtDist, fmtDuration, fmtElev, fmtPace, fmtSpeed, speedUnit } from '../lib/units'

let sportPicked = false

export function RecordView() {
  const L = rec.live.value
  const fix = rec.gps.value
  const [wantBeacon, setWantBeacon] = useState(false)
  const [pickRoute, setPickRoute] = useState(false)
  const [pickSport, setPickSport] = useState(false)
  const [finished, setFinished] = useState<{ streams: Streams | null; moving: number; started: number } | null>(null)
  const [pending, setPending] = useState<rec.SavedRecording | null>(null)
  const [, force] = useState(0)

  useEffect(() => {
    rec.startGps()
    if (L.state === 'idle' && !sportPicked) {
      rec.setSport(rec.lastSport())
      sportPicked = true
    }
    rec.pendingRecording().then((r) => r && rec.live.value.state === 'idle' && setPending(r))
    return () => rec.stopGps()
  }, [])

  // Redraw the track once a second while recording.
  useEffect(() => {
    if (L.state === 'idle') return
    const t = setInterval(() => force((n) => n + 1), 2000)
    return () => clearInterval(t)
  }, [L.state])

  const recording = L.state !== 'idle'
  const route = rec.followedRoute()
  const parts = recording ? rec.trackParts() : { solid: [], gaps: [], first: undefined }
  const here: [number, number] | null = fix ? [fix.lon, fix.lat] : null
  const lines: MapLine[] = []
  if (route) lines.push({ id: 'route', coords: route.geometry, color: cssVar('--s1'), width: 5, opacity: 0.75 })
  parts.solid.forEach((l, i) => lines.push({ id: `track${i}`, coords: l, color: cssVar('--accent'), width: 5 }))
  parts.gaps.forEach((l, i) => lines.push({ id: `gap${i}`, coords: l, color: cssVar('--accent'), width: 3, dash: true, casing: false, opacity: 0.7 }))
  const points: MapPoint[] = []
  if (here) points.push({ id: 'me', coord: here, kind: 'me' })
  if (parts.first) points.push({ id: 'start', coord: [parts.first.lon!, parts.first.lat!], kind: 'start' })
  const [pocket, setPocket] = useState(false)
  // Drop the map while the app is in the background: it frees GPU memory, which
  // makes the OS much less likely to kill the app mid-run. Recording is unaffected.
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  const gapNote = rec.bgGap.value

  const acc = fix?.acc ?? null
  const fresh = !!fix && Date.now() - fix.t < 30000
  const gpsOk = fresh && acc! <= 25
  const gpsWeak = fresh && acc! <= 50
  const noGps = L.sport === 'workout'
  const pace = usesPace(L.sport)

  async function begin() {
    if (wantBeacon) {
      try {
        const id = await startBeacon(settings.value.name || 'Redline athlete', SPORTS[L.sport].label, Date.now())
        await shareLink(id)
      } catch (e) {
        notify(`Live sharing unavailable: ${(e as Error).message}`)
      }
    }
    rec.start()
  }

  function enterPocket() {
    // Fullscreen must be requested straight from the tap.
    document.documentElement.requestFullscreen?.().catch(() => {})
    setPocket(true)
  }

  function end() {
    const started = rec.live.value.startedAt ?? Date.now()
    const { moving } = rec.timedSummary()
    const streams = rec.finish()
    if (beaconId.value) stopBeacon()
    setFinished({ streams, moving, started })
  }

  return (
    <div class="rec-screen">
      <div class="rec-map">
        {!visible ? null : !noGps || recording ? (
          <MapView lines={lines} points={points} follow={here} initialCenter={here ?? undefined} initialZoom={here ? 15 : 2} class="fill" fitTo={!recording && route ? route.geometry.map((c) => [c[0], c[1]] as [number, number]) : null} fitKey={route?.id}>
            <div class="gps-pill">
              {!recording && (
                <button class="btn ghost icon sm" style={{ padding: '0.1rem', marginLeft: '-0.3rem' }} onClick={() => back('/')} aria-label="Close">
                  <Icon name="x" size={1} />
                </button>
              )}
              <span class="gps-dot" style={{ background: gpsOk ? 'var(--good)' : gpsWeak ? 'var(--warning)' : 'var(--critical)' }} />
              {fresh ? (gpsOk ? `GPS ±${Math.round(acc!)} m` : `Weak GPS ±${Math.round(acc!)} m`) : rec.gpsError.value ? 'No GPS' : 'Finding GPS'}
              {rec.hrNow.value != null && (
                <span class="row" style={{ gap: '0.2rem', marginLeft: '0.3rem' }}>
                  <Icon name="heart" size={0.85} style={{ color: 'var(--s8)' }} fill /> {rec.hrNow.value}
                </span>
              )}
              {beaconId.value && (
                <span class="row" style={{ gap: '0.2rem', marginLeft: '0.3rem' }} title="Live location sharing">
                  <Icon name="wifi" size={0.9} /> {beaconViewers.value}
                </span>
              )}
            </div>
            {L.segment && (
              <div class="live-banner">
                <div class="row between">
                  <div>
                    <div class="tiny muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live segment</div>
                    <div style={{ fontWeight: 700 }}>{L.segment.name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div class="num" style={{ fontWeight: 700, fontSize: '1.3rem' }}>{fmtDuration(L.segment.elapsed)}</div>
                    {L.segment.delta != null && (
                      <div class="small num" style={{ fontWeight: 700, color: L.segment.delta <= 0 ? 'var(--good-ink)' : 'var(--critical)' }}>
                        {L.segment.delta <= 0 ? '▲ ahead ' : '▼ behind '}
                        {fmtDuration(Math.abs(L.segment.delta))}
                      </div>
                    )}
                  </div>
                </div>
                <div class="progress" style={{ marginTop: '0.5rem' }}>
                  <i style={{ width: `${Math.min(100, (L.segment.progress / L.segment.distance) * 100)}%` }} />
                </div>
              </div>
            )}
            {!L.segment && L.segmentDone && (
              <div class="live-banner">
                <div class="row">
                  <Icon name="trophy" />
                  <div class="grow">
                    <b>{L.segmentDone.name}</b> {fmtDuration(L.segmentDone.elapsed)}
                    <div class="small ink2">
                      {L.segmentDone.isPr ? (L.segmentDone.pr ? 'New personal record!' : 'First effort recorded') : `${fmtDuration(L.segmentDone.elapsed - (L.segmentDone.pr ?? 0))} off your record`}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!L.segment && !L.segmentDone && L.route?.off && recording && (
              <div class="live-banner" style={{ background: 'var(--critical)', color: '#fff' }}>
                <b>Off route</b> by {Math.round(L.route.offBy)} m
              </div>
            )}
          </MapView>
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <Icon name="workout" size={3} />
              <p>Timer only, no GPS needed</p>
              <button class="btn sm" style={{ marginTop: '0.75rem' }} onClick={() => back('/')}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      <div class="rec-panel">
        {pending && !recording && (
          <div class="notice">
            <Icon name="info" />
            <div class="grow">
              An unfinished recording from {new Date(pending.startedAt).toLocaleString()} was found.
              <div class="row" style={{ marginTop: '0.5rem' }}>
                <button
                  class="btn sm primary"
                  onClick={() => {
                    rec.restore(pending)
                    setPending(null)
                  }}
                >
                  Resume it
                </button>
                <button
                  class="btn sm"
                  onClick={() => {
                    rec.restore(pending)
                    setPending(null)
                    end()
                  }}
                >
                  Save it
                </button>
                <button
                  class="btn sm ghost"
                  onClick={() => {
                    rec.restore(pending)
                    rec.finish()
                    setPending(null)
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}

        {recording ? (
          <>
            {gapNote && (
              <div class="notice" style={{ background: 'var(--accent-soft)', color: 'var(--ink)' }}>
                <Icon name="info" />
                <div class="grow">
                  Location stopped for {fmtDuration(gapNote.seconds)} while the screen was off. That stretch will be traced along roads when you save. Next time use <b>Pocket mode</b> instead of locking the phone.
                </div>
                <button class="btn ghost icon sm" aria-label="Dismiss" onClick={() => (rec.bgGap.value = null)}>
                  <Icon name="x" size={1} />
                </button>
              </div>
            )}
            {!gapNote && !isNative && rec.wakeState.value !== 'on' && !noGps && (
              <div class="notice">
                <Icon name="info" />
                <div>This browser may let the screen turn off, which stops GPS. Use Pocket mode, or set your phone's auto-lock to Never while recording.</div>
              </div>
            )}
            {L.state !== 'recording' && <div class="state-pill">{L.state === 'autopaused' ? 'Auto-paused' : 'Paused'}</div>}
            <div class="rec-stats">
              <div class="main-stat">
                <div class="value">{fmtDuration(L.moving)}</div>
                <div class="label">Time</div>
              </div>
              {!noGps && (
                <>
                  <div>
                    <div class="value">{distNum(L.distance).toFixed(2)}</div>
                    <div class="label">{distUnit()}</div>
                  </div>
                  <div>
                    <div class="value">{pace ? fmtPace(L.speed, false) : fmtSpeed(L.speed, false)}</div>
                    <div class="label">{pace ? `Pace /${distUnit()}` : speedUnit()}</div>
                  </div>
                  <div>
                    <div class="value">{L.hr ?? (pace ? fmtPace(L.avgSpeed, false) : fmtSpeed(L.avgSpeed, false))}</div>
                    <div class="label">{L.hr != null ? 'bpm' : pace ? 'Avg pace' : 'Avg speed'}</div>
                  </div>
                </>
              )}
            </div>
            {!noGps && (L.cadence != null || L.gain >= 1 || (L.hr != null && L.state !== 'idle')) && (
              <div class="row small ink2" style={{ justifyContent: 'center', gap: '1.25rem' }}>
                {L.cadence != null && (
                  <span>
                    <b class="num">{Math.round(L.cadence)}</b> spm
                  </span>
                )}
                {L.gain >= 1 && (
                  <span>
                    <b class="num">+{fmtElev(L.gain)}</b>
                  </span>
                )}
                {L.hr != null && L.cadence != null && (
                  <span>
                    <b class="num">{L.hr}</b> bpm
                  </span>
                )}
              </div>
            )}
            {L.route && !L.route.off && <div class="small ink2" style={{ textAlign: 'center' }}>{fmtDist(L.route.remaining)} to go on {route?.name}</div>}
            <div class="rec-controls">
              {!noGps && !isNative && (
                <button class="round-btn small" onClick={enterPocket} aria-label="Pocket mode" title="Pocket mode">
                  <Icon name="eye" size={1.3} />
                </button>
              )}
              {L.state === 'recording' || L.state === 'autopaused' ? (
                <button class="round-btn secondary" onClick={rec.pause} aria-label="Pause">
                  <Icon name="pause" size={1.75} fill />
                </button>
              ) : (
                <>
                  <button class="round-btn" onClick={rec.resume} aria-label="Resume">
                    <Icon name="play" size={1.75} fill />
                  </button>
                  <button class="round-btn secondary" onClick={end} aria-label="Finish">
                    <Icon name="stop" size={1.5} fill />
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div class="row between">
              <button class="btn" onClick={() => setPickSport(true)}>
                <SportIcon sport={L.sport} /> {SPORTS[L.sport].label}
              </button>
              <button class="btn" onClick={() => setPickRoute(true)}>
                <Icon name="route" /> {route ? route.name : 'Route'}
              </button>
            </div>
            <div class="row between">
              <button
                class={`btn sm ${rec.hrDevice.value ? 'dark' : ''}`}
                onClick={() =>
                  rec.connectHr().catch((e) => {
                    if ((e as Error).name !== 'NotFoundError') notify((e as Error).message)
                  })
                }
              >
                <Icon name="heart" size={1} /> {rec.hrDevice.value ?? 'Heart rate'}
              </button>
              <label class="row small" style={{ gap: '0.5rem' }}>
                Share live location
                <Switch on={wantBeacon} onChange={setWantBeacon} label="Share live location" />
              </label>
            </div>
            <div class="rec-controls">
              <button class="round-btn" style={{ width: '5.5rem', height: '5.5rem' }} onClick={begin} disabled={!noGps && !gpsWeak} aria-label="Start">
                <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>START</span>
              </button>
            </div>
            {!noGps && !gpsWeak && <div class="small muted" style={{ textAlign: 'center' }}>{rec.gpsError.value ?? 'Waiting for a GPS fix. Head outside with a clear view of the sky.'}</div>}
            {!noGps && isNative && (
              <div class="notice">
                <Icon name="check" />
                <div>You can lock your phone and put it away. Recording keeps going in the background{nativePlatform === 'android' ? ' with a notification' : ''}.</div>
              </div>
            )}
            {!noGps && <GetAppNotice />}
            {isNative && rec.gpsError.value && (
              <button class="btn sm" style={{ alignSelf: 'center' }} onClick={() => openAppSettings()}>
                Open location settings
              </button>
            )}
          </>
        )}
      </div>

      {pickSport && (
        <Sheet title="Choose sport" onClose={() => setPickSport(false)}>
          <div class="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {SPORT_LIST.map((s) => (
              <button
                key={s}
                class={`btn ${s === L.sport ? 'dark' : ''}`}
                style={{ justifyContent: 'flex-start', borderRadius: 'var(--radius-sm)' }}
                onClick={() => {
                  rec.setSport(s)
                  setPickSport(false)
                }}
              >
                <SportIcon sport={s} /> {SPORTS[s].label}
              </button>
            ))}
          </div>
          <label class="row between" style={{ marginTop: '1.25rem' }}>
            <span>Voice cues every {distUnit()}</span>
            <Switch on={settings.value.voiceCues} onChange={(v) => saveSettings({ voiceCues: v })} label="Voice cues" />
          </label>
          <label class="row between" style={{ marginTop: '0.75rem' }}>
            <span>Auto-pause when stopped</span>
            <Switch on={settings.value.autoPause} onChange={(v) => saveSettings({ autoPause: v })} label="Auto-pause" />
          </label>
        </Sheet>
      )}

      {pickRoute && (
        <Sheet title="Follow a route" onClose={() => setPickRoute(false)}>
          {routes.value.length === 0 ? (
            <div class="col">
              <p class="ink2">No saved routes yet.</p>
              <a class="btn primary" href="#/route/new">
                Build a route
              </a>
            </div>
          ) : (
            <div>
              {route && (
                <button
                  class="btn block"
                  style={{ marginBottom: '0.75rem' }}
                  onClick={() => {
                    rec.followRoute(null)
                    setPickRoute(false)
                  }}
                >
                  Stop following {route.name}
                </button>
              )}
              {routes.value.map((r: Route) => (
                <button
                  key={r.id}
                  class="list-row"
                  style={{ width: '100%', background: 'none', border: 0, borderBottom: '0.0625rem solid var(--line)', textAlign: 'left' }}
                  onClick={() => {
                    rec.followRoute(r)
                    setPickRoute(false)
                  }}
                >
                  <Icon name="route" />
                  <div class="grow">
                    <div style={{ fontWeight: 650 }}>{r.name}</div>
                    <div class="small muted">{fmtDist(r.distance)}</div>
                  </div>
                  {route?.id === r.id && <Icon name="check" />}
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {pocket && recording && <PocketMode onExit={() => setPocket(false)} />}

      {finished && <SaveSheet data={finished} sport={L.sport} onDone={() => setFinished(null)} />}
    </div>
  )
}

/** Black, touch-proof screen for the pocket. The page stays visible, so GPS keeps flowing. */
function PocketMode({ onExit }: { onExit: () => void }) {
  const L = rec.live.value
  const [hold, setHold] = useState(0)
  const timer = useRef(0)
  useEffect(
    () => () => {
      clearInterval(timer.current)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    },
    [],
  )
  const startHold = () => {
    const t0 = performance.now()
    clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      const f = (performance.now() - t0) / 1000
      setHold(Math.min(1, f))
      if (f >= 1) {
        clearInterval(timer.current)
        onExit()
      }
    }, 30)
  }
  const stopHold = () => {
    clearInterval(timer.current)
    setHold(0)
  }
  const pace = usesPace(L.sport)
  return (
    <div class="pocket" onContextMenu={(e) => e.preventDefault()}>
      <div class="pocket-stats">
        <div class="pocket-time">{fmtDuration(L.moving)}</div>
        <div>
          {fmtDist(L.distance)} · {pace ? fmtPace(L.speed) : fmtSpeed(L.speed)}
        </div>
        <div class="pocket-state">{L.state === 'recording' ? 'Recording' : L.state === 'autopaused' ? 'Auto-paused' : 'Paused'}</div>
      </div>
      <button class="pocket-unlock" onPointerDown={startHold} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} aria-label="Hold to unlock">
        <svg viewBox="0 0 100 100" class="pocket-ring">
          <circle cx="50" cy="50" r="44" fill="none" stroke="#262626" stroke-width="6" />
          <circle cx="50" cy="50" r="44" fill="none" stroke="#777" stroke-width="6" stroke-dasharray={`${276.5 * hold} 276.5`} transform="rotate(-90 50 50)" />
        </svg>
        <Icon name="x" size={1.4} />
      </button>
      <div class="pocket-hint">Hold to unlock</div>
    </div>
  )
}

async function shareLink(id: string) {
  const url = beaconLink(id)
  try {
    if (navigator.share) await navigator.share({ title: 'Follow my activity live', url })
    else {
      await navigator.clipboard.writeText(url)
      notify('Live link copied to clipboard')
    }
  } catch {
    try {
      await navigator.clipboard.writeText(url)
      notify('Live link copied to clipboard')
    } catch {
      notify(url)
    }
  }
}

function SaveSheet({ data, sport: initialSport, onDone }: { data: { streams: Streams | null; moving: number; started: number }; sport: Sport; onDone: () => void }) {
  const [sport, setSport] = useState<Sport>(initialSport)
  const [name, setName] = useState(defaultName(initialSport, data.started))
  const [desc, setDesc] = useState('')
  const [rpe, setRpe] = useState(0)
  const [gearId, setGearId] = useState(gear.value.find((g) => !g.retired && g.defaultFor.includes(initialSport))?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const s = data.streams
  const gapCount = s ? findGaps(s).length : 0

  async function save() {
    setSaving(true)
    let id: string
    let s = data.streams
    // Trace any stretch where the phone stopped reporting location along roads.
    if (s?.lat && findGaps(s).length && navigator.onLine) {
      setStatus('Tracing GPS gaps along roads...')
      try {
        const r = await fillGaps(s, sport)
        s = r.streams
        if (r.filled) notify(`Filled ${r.filled} GPS gap${r.filled > 1 ? 's' : ''} along roads`)
      } catch {
        /* keep the straight line */
      }
    }
    if (s && s.dist[s.dist.length - 1] > 20) {
      const act = buildActivity(s, sport, name.trim() || defaultName(sport, data.started), { description: desc, rpe: rpe || null, gearId: gearId || null, source: 'recorded' })
      await addActivity(act, s)
      id = act.id
      // Phone altitude is noisy; swap in terrain elevation when online.
      const done = s
      // GPS altitude is replaced by terrain data; barometer data is only shifted onto it.
      if (done.lat && navigator.onLine)
        (done.eleSource === 'baro' ? alignToTerrain(done) : correctElevation(done))
          .then((ele) => replaceStreams(id, { ...done, ele }))
          .catch(() => {})
    } else {
      const act = buildManual({ sport, name: name.trim() || defaultName(sport, data.started), start: data.started, time: data.moving, distance: s ? s.dist[s.dist.length - 1] : 0, gain: 0, rpe: rpe || null, description: desc })
      await addActivity(act, null)
      id = act.id
    }
    notify('Activity saved')
    onDone()
    go(`/activity/${id}`, true)
  }

  return (
    <Sheet
      title="Save activity"
      onClose={() => {
        if (confirm('Discard this activity?')) onDone()
      }}
    >
      <div class="col">
        <div class="stats">
          <div class="stat">
            <div class="label">Time</div>
            <div class="value">{fmtDuration(data.moving)}</div>
          </div>
          {s && (
            <div class="stat">
              <div class="label">Distance</div>
              <div class="value">{fmtDist(s.dist[s.dist.length - 1])}</div>
            </div>
          )}
        </div>
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
          <span>How did it go?</span>
          <textarea class="input" value={desc} onInput={(e) => setDesc((e.target as HTMLTextAreaElement).value)} />
        </label>
        <label class="field">
          <span>Perceived effort: {rpe ? `${rpe} / 10` : 'not set'}</span>
          <input type="range" min={0} max={10} value={rpe} onInput={(e) => setRpe(+(e.target as HTMLInputElement).value)} />
        </label>
        {gear.value.some((g) => !g.retired) && (
          <label class="field">
            <span>Gear</span>
            <select class="input" value={gearId} onChange={(e) => setGearId((e.target as HTMLSelectElement).value)}>
              <option value="">None</option>
              {gear.value.filter((g) => !g.retired).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {gapCount > 0 && !status && (
          <div class="notice">
            <Icon name="route" />
            <div>
              GPS dropped out {gapCount === 1 ? 'once' : `${gapCount} times`}. {gapCount === 1 ? 'That stretch' : 'Those stretches'} will be traced along roads and trails when you save, instead of a straight line.
            </div>
          </div>
        )}
        {status && <div class="small muted">{status}</div>}
        <button class="btn primary lg block" disabled={saving} onClick={save}>
          Save activity
        </button>
        <button
          class="btn ghost block danger"
          onClick={() => {
            if (confirm('Discard this activity?')) onDone()
          }}
        >
          Discard
        </button>
      </div>
    </Sheet>
  )
}
