import type { ComponentChildren, JSX } from 'preact'
import { useEffect } from 'preact/hooks'
import { Icon } from './Icon'
import { SPORTS } from '../lib/sports'
import type { Sport } from '../lib/types'

export function Seg<T extends string>({ value, options, onChange, class: cls }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; class?: string }) {
  return (
    <div class={`seg ${cls || ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.v} role="tab" aria-selected={o.v === value} class={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button class={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
}

export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', k)
      document.body.style.overflow = prev
    }
  }, [])
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" style={wide ? { maxWidth: '44rem' } : undefined} role="dialog" aria-label={title}>
        <div class="row between" style={{ marginBottom: '1rem' }}>
          <h2>{title}</h2>
          <button class="btn ghost icon" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Stat({ label, value, unit, sub }: { label: string; value: ComponentChildren; unit?: string; sub?: ComponentChildren }) {
  return (
    <div class="stat">
      <div class="label">{label}</div>
      <div class="value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {sub && <div class="sub">{sub}</div>}
    </div>
  )
}

export function Medal({ rank }: { rank: number }) {
  if (rank > 3) return null
  return (
    <span class={`medal r${rank}`} title={rank === 1 ? 'Personal record' : rank === 2 ? '2nd best' : '3rd best'}>
      {rank === 1 ? 'PR' : rank}
    </span>
  )
}

export function SportIcon({ sport, size = 1.25 }: { sport: Sport; size?: number }) {
  return <Icon name={SPORTS[sport]?.icon ?? 'other'} size={size} />
}

/** Lightweight route preview, no map tiles needed. */
export function TraceSvg({ trace, color = 'var(--accent)', w = 480, h = 200 }: { trace: [number, number][]; color?: string; w?: number; h?: number }) {
  if (trace.length < 2) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const k = Math.cos(((trace[0][1]) * Math.PI) / 180)
  const pts = trace.map(([lon, lat]) => {
    const x = lon * k
    const y = -lat
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    return [x, y]
  })
  const pad = 14
  const sx = (w - pad * 2) / Math.max(1e-9, maxX - minX)
  const sy = (h - pad * 2) / Math.max(1e-9, maxY - minY)
  const s = Math.min(sx, sy)
  const ox = (w - (maxX - minX) * s) / 2
  const oy = (h - (maxY - minY) * s) / 2
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${((x - minX) * s + ox).toFixed(1)} ${((y - minY) * s + oy).toFixed(1)}`).join('')
  const [sx0, sy0] = [(pts[0][0] - minX) * s + ox, (pts[0][1] - minY) * s + oy]
  const last = pts[pts.length - 1]
  const [ex, ey] = [(last[0] - minX) * s + ox, (last[1] - minY) * s + oy]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      <path d={d} fill="none" stroke="var(--surface)" stroke-width={7} stroke-linejoin="round" stroke-linecap="round" />
      <path d={d} fill="none" stroke={color} stroke-width={3} stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={sx0} cy={sy0} r={5} fill="var(--good)" stroke="var(--surface)" stroke-width={2} />
      <circle cx={ex} cy={ey} r={5} fill="var(--ink)" stroke="var(--surface)" stroke-width={2} />
    </svg>
  )
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="icon-big">
        <Icon name={icon} size={1.75} />
      </div>
      <h2>{title}</h2>
      {children}
    </div>
  )
}

export function Progress({ value }: { value: number }) {
  return (
    <div class="progress">
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

export function Card({ title, icon, action, children, class: cls, style }: { title?: ComponentChildren; icon?: string; action?: ComponentChildren; children: ComponentChildren; class?: string; style?: JSX.CSSProperties }) {
  return (
    <section class={`card ${cls || ''}`} style={style}>
      {(title || action) && (
        <div class="card-h">
          <h3>
            {icon && <Icon name={icon} size={1.1} />}
            {title}
          </h3>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Ring({ share, size = 4.5, label, sub }: { share: number; size?: number; label: ComponentChildren; sub?: ComponentChildren }) {
  const r = 42
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, share))
  return (
    <div style={{ position: 'relative', width: `${size}rem`, height: `${size}rem`, flex: 'none' }}>
      <svg viewBox="0 0 100 100" class="ring" width="100%" height="100%">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--s1-wash)" stroke-width="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={share >= 1 ? 'var(--good)' : 'var(--s1)'} stroke-width="9" stroke-linecap="round" stroke-dasharray={`${c * v} ${c}`} transform="rotate(-90 50 50)" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', lineHeight: 1.1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{label}</div>
          {sub && <div class="tiny muted">{sub}</div>}
        </div>
      </div>
    </div>
  )
}
