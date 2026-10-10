import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { MapView, cssVar, type MapPoint } from '../components/MapView'
import { XYChart } from '../components/charts'
import { Icon } from '../components/Icon'
import { Progress, Seg } from '../components/ui'
import { cumulativeLL, type LonLat } from '../lib/geo'
import { download, routeToGpx, safeFile } from '../lib/importers'
import { downloadTiles } from '../lib/offline'
import * as rec from '../lib/recorder'
import { back, go } from '../lib/router'
import { elevStats, generateLoop, joinLegs, PROFILES, routeVia, straightLeg, type Leg } from '../lib/routing'
import { sportGroup } from '../lib/sports'
import { activities, deleteRoute, notify, routes, saveRoute, uid } from '../lib/store'
import type { Route, Sport } from '../lib/types'
import { distNum, distUnit, elevNum, fmtDist, fmtDuration, fmtElev, unitLen } from '../lib/units'

/** Personal time estimate from your recent pace on flat ground plus a climbing allowance. */
export function estimateRouteTime(distance: number, gain: number, sport: Sport) {
  const g = sportGroup(sport)
  const recent = activities.value.filter((a) => sportGroup(a.sport) === g && a.summary.distance > 1000 && a.summary.movingTime > 0).slice(0, 20)
  let speed = g === 'bike' ? 7 : sport === 'hike' || sport === 'walk' ? 1.3 : 2.8
  if (recent.length >= 3) {
    const v = recent.map((a) => (a.summary.distance + a.summary.elevGain * (g === 'bike' ? 8 : 6)) / a.summary.movingTime).sort((x, y) => x - y)
    speed = v[Math.floor(v.length / 2)]
  }
  const flatEq = distance + gain * (g === 'bike' ? 8 : 6)
  return flatEq / speed
}

export function RouteBuilder({ id }: { id: string | null }) {
  const existing = id ? routes.value.find((r) => r.id === id) ?? null : null
  const [name, setName] = useState(existing?.name ?? '')
  const [profile, setProfile] = useState(existing?.profile && existing.profile !== 'imported' ? existing.profile : PROFILES[0].id)
  const [snap, setSnap] = useState(existing?.profile !== 'straight')
  const [wps, setWps] = useState<LonLat[]>(existing?.waypoints ?? [])
  const [legs, setLegs] = useState<Leg[]>(existing ? [{ coords: existing.geometry, distance: existing.distance }] : [])
  const [imported] = useState(existing?.profile === 'imported')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loopKm, setLoopKm] = useState('10')
  const [seed, setSeed] = useState(1)
  const [center, setCenter] = useState<[number, number] | null>(null)
  const [offline, setOffline] = useState<number | null>(null)
  const [fitReq, setFitReq] = useState(0)
  const hover = useSignal<number | null>(null)

  useEffect(() => {
    if (existing) return
    const last = activities.value.find((a) => a.trace.length)
    if (last) setCenter(last.trace[0])
    navigator.geolocation?.getCurrentPosition((p) => setCenter([p.coords.longitude, p.coords.latitude]), () => {}, { timeout: 8000, maximumAge: 300000 })
  }, [])

  // Re-route when the profile or snapping changes, and split saved routes into editable legs.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      if (!existing || imported || wps.length < 2) return
    }
    if (!imported) rebuild(wps)
  }, [profile, snap])

  const sport = PROFILES.find((p) => p.id === profile)?.sport ?? 'run'
  const geometry = useMemo(() => joinLegs(legs), [legs])
  const cum = useMemo(() => cumulativeLL(geometry), [geometry])
  const distance = cum[cum.length - 1] || 0
  const { gain, loss } = elevStats(geometry)
  const hasEle = geometry.some((p) => isFinite(p[2]))

  async function leg(a: LonLat, b: LonLat): Promise<Leg> {
    return snap ? routeVia([a, b], profile) : straightLeg(a, b)
  }

  async function rebuild(points: LonLat[]) {
    setErr(null)
    if (points.length < 2) {
      setLegs([])
      return
    }
    setBusy(true)
    try {
      const out = await Promise.all(points.slice(1).map((p, i) => leg(points[i], p)))
      setLegs(out)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function addPoint(p: LonLat) {
    if (imported) return
    const next = [...wps, p]
    setWps(next)
    if (next.length < 2) return
    setBusy(true)
    setErr(null)
    try {
      const l = await leg(next[next.length - 2], p)
      setLegs((cur) => [...cur.slice(0, next.length - 2), l])
    } catch (e) {
      setErr((e as Error).message)
      setWps(wps)
    } finally {
      setBusy(false)
    }
  }

  const points: MapPoint[] = wps.map((p, i) => ({ id: `wp${i}`, coord: p, kind: 'wp', draggable: !imported, color: i === 0 ? '#0ca30c' : i === wps.length - 1 ? '#0b0b0b' : '#fff' }))
  if (imported && geometry.length) {
    points.push({ id: 'a', coord: [geometry[0][0], geometry[0][1]], kind: 'start' }, { id: 'b', coord: [geometry[geometry.length - 1][0], geometry[geometry.length - 1][1]], kind: 'end' })
  }
  const hv = hover.value
  const hoverLL = hv != null && geometry[hv] ? ([geometry[hv][0], geometry[hv][1]] as [number, number]) : null

  async function save() {
    if (geometry.length < 2) return
    const r: Route = {
      id: existing?.id ?? uid(),
      name: name.trim() || `${fmtDist(distance, 1)} ${sportGroup(sport) === 'bike' ? 'ride' : 'route'}`,
      sport: existing?.sport && imported ? existing.sport : sport,
      profile: imported ? 'imported' : snap ? profile : 'straight',
      waypoints: wps,
      geometry,
      distance,
      elevGain: gain,
      elevLoss: loss,
      createdAt: existing?.createdAt ?? Date.now(),
      offline: existing?.offline ?? false,
    }
    await saveRoute(r)
    notify('Route saved')
    if (!existing) go(`/route/${r.id}`, true)
    return r
  }

  async function loop() {
    const start = wps[0] ?? center
    if (!start) return notify('Tap the map to set a start point first')
    setBusy(true)
    setErr(null)
    try {
      const target = (parseFloat(loopKm) || 5) * unitLen()
      const s2 = seed + 1
      setSeed(s2)
      const res = await generateLoop(start, target, profile, s2 * 7919)
      setWps(res.waypoints)
      const out = await Promise.all(res.waypoints.slice(1).map((p, i) => routeVia([res.waypoints[i], p], profile)))
      setLegs(out)
      setFitReq((n) => n + 1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="builder">
      <div style={{ position: 'relative', minHeight: 0 }}>
        <MapView
          class="fill"
          lines={geometry.length > 1 ? [{ id: 'route', coords: geometry, color: cssVar('--s1'), width: 5 }] : []}
          points={points}
          hover={hoverLL}
          onClick={(ll) => addPoint(ll)}
          onPointDrag={(pid, ll) => {
            const i = +pid.slice(2)
            const next = wps.slice()
            next[i] = ll
            setWps(next)
            rebuild(next)
          }}
          onPointClick={(pid) => {
            if (imported) return
            const i = +pid.slice(2)
            const next = wps.filter((_, k) => k !== i)
            setWps(next)
            rebuild(next)
          }}
          fitTo={existing || fitReq ? geometry.map((c) => [c[0], c[1]] as [number, number]) : center ? [center] : null}
          fitKey={fitReq ? `loop${fitReq}` : existing ? existing.id : center ? 'center' : undefined}
        >
          <div class="map-tools" style={{ left: '0.6rem', right: 'auto' }}>
            <button class="btn icon" onClick={() => back('/maps/routes')} aria-label="Back">
              <Icon name="left" />
            </button>
          </div>
          {busy && (
            <div class="gps-pill" style={{ left: '50%', transform: 'translateX(-50%)' }}>
              <Icon name="loop" size={0.9} class="spin" /> Routing
            </div>
          )}
        </MapView>
      </div>
      <div class="builder-panel">
        <input class="input" placeholder="Route name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} style={{ fontWeight: 650 }} />
        <div class="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div class="stat">
            <div class="label">Distance</div>
            <div class="value">
              {distNum(distance).toFixed(1)}
              <small>{distUnit()}</small>
            </div>
          </div>
          <div class="stat">
            <div class="label">Elevation</div>
            <div class="value">{hasEle ? fmtElev(gain) : '–'}</div>
          </div>
          <div class="stat">
            <div class="label">Est. time</div>
            <div class="value">{distance ? fmtDuration(estimateRouteTime(distance, gain, imported && existing ? existing.sport : sport)) : '–'}</div>
          </div>
        </div>
        {hasEle && geometry.length > 2 && (
          <XYChart
            x={cum.map((m) => distNum(m))}
            series={[{ key: 'e', label: 'Elevation', values: geometry.map((p) => (isFinite(p[2]) ? elevNum(p[2]) : NaN)), color: 'var(--muted)', area: true, areaOpacity: 0.18 }]}
            height={5}
            yFmt={(v) => `${Math.round(v)}`}
            xFmt={(v) => `${+v.toFixed(1)} ${distUnit()}`}
            hover={hover}
            legend={false}
          />
        )}
        {err && <div class="notice" style={{ color: 'var(--critical)' }}>{err}</div>}
        {!imported && (
          <>
            <Seg value={profile} onChange={setProfile} options={PROFILES.map((p) => ({ v: p.id, label: p.label }))} />
            <div class="row wrap">
              <button class="btn sm" disabled={!wps.length} onClick={() => { const n = wps.slice(0, -1); setWps(n); setLegs(legs.slice(0, Math.max(0, n.length - 1))) }}>
                <Icon name="undo" size={0.9} /> Undo
              </button>
              <button class="btn sm" disabled={wps.length < 2} onClick={() => { const n = [...wps, wps[0]]; setWps(n); rebuild(n) }}>
                <Icon name="loop" size={0.9} /> Close loop
              </button>
              <button class="btn sm" disabled={wps.length < 2} onClick={() => { const n = [...wps, ...wps.slice(0, -1).reverse()]; setWps(n); rebuild(n) }}>
                <Icon name="swap" size={0.9} /> Out and back
              </button>
              <button class="btn sm" disabled={wps.length < 2} onClick={() => { const n = wps.slice().reverse(); setWps(n); rebuild(n) }}>
                Reverse
              </button>
              <button class="btn sm ghost" disabled={!wps.length} onClick={() => { setWps([]); setLegs([]) }}>
                Clear
              </button>
            </div>
            <label class="row between small">
              <span>Snap to roads and trails</span>
              <input type="checkbox" checked={snap} onChange={(e) => setSnap((e.target as HTMLInputElement).checked)} />
            </label>
            <div class="card" style={{ background: 'var(--surface-2)', padding: '0.75rem' }}>
              <div class="small" style={{ fontWeight: 650, marginBottom: '0.5rem' }}>
                <Icon name="sparkle" size={0.9} /> Generate a loop {wps[0] ? 'from your first point' : 'from here'}
              </div>
              <div class="row">
                <input class="input" inputMode="decimal" value={loopKm} onInput={(e) => setLoopKm((e.target as HTMLInputElement).value)} style={{ width: '5rem' }} aria-label="Loop distance" />
                <span class="muted">{distUnit()}</span>
                <button class="btn sm primary" disabled={busy} onClick={loop}>
                  <Icon name="shuffle" size={0.9} /> {seed > 1 ? 'Another' : 'Generate'}
                </button>
              </div>
            </div>
            {!wps.length && <p class="small muted">Tap the map to place points. Drag a point to move it, tap it to remove it.</p>}
          </>
        )}
        <div class="row wrap">
          <button class="btn primary" disabled={geometry.length < 2} onClick={save}>
            <Icon name="check" size={1} /> Save
          </button>
          <button class="btn" disabled={geometry.length < 2} onClick={() => download(`${safeFile(name || 'route')}.gpx`, routeToGpx({ name: name || 'Route', geometry } as Route))}>
            <Icon name="download" size={1} /> GPX
          </button>
          <button
            class="btn"
            disabled={geometry.length < 2}
            onClick={async () => {
              const r = await save()
              if (!r) return
              rec.followRoute(r)
              go('/record')
            }}
          >
            <Icon name="record" size={1} /> Go
          </button>
        </div>
        {existing && (
          <div class="col" style={{ gap: '0.5rem' }}>
            <button
              class="btn sm"
              disabled={offline != null}
              onClick={async () => {
                setOffline(0)
                try {
                  const n = await downloadTiles(geometry.map((c) => [c[0], c[1]]), (d, t) => setOffline(d / t))
                  await saveRoute({ ...existing, offline: true })
                  notify(`Saved ${n} map tiles for offline use`)
                } catch {
                  notify('Could not download the map')
                } finally {
                  setOffline(null)
                }
              }}
            >
              <Icon name="download" size={0.9} /> {existing.offline ? 'Refresh offline map' : 'Save map for offline'}
            </button>
            {offline != null && <Progress value={offline} />}
            <button
              class="btn sm ghost danger"
              onClick={async () => {
                if (!confirm('Delete this route?')) return
                await deleteRoute(existing.id)
                go('/maps/routes', true)
              }}
            >
              <Icon name="trash" size={0.9} /> Delete route
            </button>
          </div>
        )}
        <p class="tiny muted">Routing by BRouter, elevation from OpenStreetMap and SRTM data.</p>
      </div>
    </div>
  )
}
