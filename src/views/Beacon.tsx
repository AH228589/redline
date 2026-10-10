import { useEffect, useState } from 'preact/hooks'
import { MapView, cssVar } from '../components/MapView'
import { Icon, Logo } from '../components/Icon'
import { watchBeacon, type BeaconPoint } from '../lib/beacon'
import { fmtDist, fmtDuration, fmtTime } from '../lib/units'

export function BeaconView({ id }: { id: string }) {
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [who, setWho] = useState<{ name: string; sport: string; started: number } | null>(null)
  const [pts, setPts] = useState<BeaconPoint[]>([])
  const [battery, setBattery] = useState<number | null>(null)
  const [state, setState] = useState<string>('recording')
  const [ended, setEnded] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    const stop = watchBeacon(
      id,
      (m) => {
        if (m.type === 'hello') {
          setWho({ name: m.name, sport: m.sport, started: m.started })
          setPts(m.history)
        } else if (m.type === 'pt') {
          setPts((p) => [...p, m.p])
          if (m.battery != null) setBattery(m.battery)
        } else if (m.type === 'state') setState(m.state)
        else if (m.type === 'end') setEnded(true)
      },
      setStatus,
    )
    const t = setInterval(() => tick((n) => n + 1), 5000)
    return () => {
      stop()
      clearInterval(t)
    }
  }, [id])

  const last = pts[pts.length - 1]
  const line = pts.map((p) => [p.lon, p.lat] as [number, number])
  const ago = last ? Math.round((Date.now() - last.t) / 1000) : null

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateRows: '1fr auto' }}>
      <div style={{ position: 'relative' }}>
        <MapView
          class="fill"
          lines={line.length > 1 ? [{ id: 't', coords: line, color: cssVar('--accent'), width: 5 }] : []}
          points={last ? [{ id: 'me', coord: [last.lon, last.lat], kind: 'me' }, { id: 's', coord: line[0], kind: 'start' }] : []}
          follow={last ? [last.lon, last.lat] : null}
          fitTo={line.length ? line : null}
          fitKey={line.length ? 'first' : undefined}
        >
          <div class="gps-pill">
            <span class="brand-mark" style={{ width: '1.3rem', height: '1.3rem' }}>
              <Logo size={0.8} />
            </span>
            Live tracking
          </div>
        </MapView>
      </div>
      <div class="rec-panel">
        {!who && status !== 'live' ? (
          <div class="row" style={{ justifyContent: 'center' }}>
            <Icon name="loop" class="spin" /> {status === 'offline' ? 'Waiting for the athlete to come online...' : 'Connecting...'}
          </div>
        ) : (
          <>
            <div class="row between">
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{who?.name ?? 'Athlete'}</div>
                <div class="small muted">
                  {who?.sport} {who ? `· started ${fmtTime(who.started)}` : ''}
                </div>
              </div>
              <span class="chip" style={{ color: ended ? 'var(--muted)' : status === 'live' ? 'var(--good-ink)' : 'var(--critical)' }}>
                <span class="gps-dot" style={{ background: ended ? 'var(--muted)' : status === 'live' ? 'var(--good)' : 'var(--critical)' }} />
                {ended ? 'Finished' : status === 'live' ? (state === 'recording' ? 'Moving' : state === 'autopaused' ? 'Stopped' : 'Paused') : 'Signal lost'}
              </span>
            </div>
            <div class="rec-stats">
              <div>
                <div class="value">{last ? fmtDist(last.dist, 1) : '–'}</div>
                <div class="label">Distance</div>
              </div>
              <div>
                <div class="value">{last ? fmtDuration(last.moving) : '–'}</div>
                <div class="label">Moving</div>
              </div>
              <div>
                <div class="value">{battery != null ? `${battery}%` : '–'}</div>
                <div class="label">Battery</div>
              </div>
            </div>
            {ago != null && <div class="tiny muted" style={{ textAlign: 'center' }}>Last update {ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago</div>}
          </>
        )}
      </div>
    </div>
  )
}
