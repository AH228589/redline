import type { ComponentChildren } from 'preact'
import type { Signal } from '@preact/signals'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { lowerBound } from '../lib/geo'

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((e) => setW(Math.floor(e[0].contentRect.width)))
    ro.observe(ref.current)
    setW(Math.floor(ref.current.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function niceTicks(min: number, max: number, count = 4, step?: number) {
  if (!isFinite(min) || !isFinite(max)) return []
  if (max === min) return [min]
  const span = max - min
  if (!step) {
    const raw = span / count
    const mag = 10 ** Math.floor(Math.log10(raw))
    const f = raw / mag
    step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
  }
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

/** Calendar-aligned ticks for a time axis in epoch ms: months, or weeks for short spans. */
export function dateTicks(min: number, max: number, maxCount = 6) {
  const out: number[] = []
  const span = max - min
  const DAY = 86400000
  if (span <= 45 * DAY) {
    const d = new Date(min)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7)) // next Monday
    const step = Math.max(1, Math.ceil(span / DAY / 7 / maxCount)) * 7
    for (let t = d.getTime(); t <= max; t = new Date(new Date(t).setDate(new Date(t).getDate() + step)).getTime()) out.push(t)
    return out
  }
  const months = span / (30.4 * DAY)
  const step = [1, 2, 3, 6, 12].find((m) => months / m <= maxCount) ?? 12
  const d = new Date(min)
  let y = d.getFullYear(), m = d.getMonth() + 1
  if (m > 11) { m = 0; y++ }
  m = Math.ceil(m / step) * step
  for (;;) {
    const t = new Date(y + Math.floor(m / 12), m % 12, 1).getTime()
    if (t > max) break
    out.push(t)
    m += step
  }
  return out
}

export const fmtTick = (t: number, span: number) =>
  new Date(t).toLocaleDateString(undefined, span > 300 * 86400000 ? { month: 'short', year: '2-digit' } : span > 45 * 86400000 ? { month: 'short' } : { month: 'short', day: 'numeric' })

export interface Series {
  key: string
  label: string
  values: number[]
  color: string
  area?: boolean
  areaOpacity?: number
  width?: number
}

interface XYProps {
  x: number[]
  series: Series[]
  height?: number // rem
  yFmt: (v: number) => string
  xFmt: (v: number) => string
  tip?: (i: number) => ComponentChildren
  invert?: boolean
  yMin?: number
  yMax?: number
  yStep?: number
  zeroBase?: boolean
  logX?: boolean
  hover?: Signal<number | null>
  selection?: [number, number] | null
  onSelect?: (r: [number, number] | null) => void
  bands?: { from: number; to: number; label: string; color: string }[]
  refLines?: { y: number; label: string }[]
  xTicks?: number[]
  legend?: boolean
  bars?: boolean
  ariaLabel?: string
}

const ML = 44
const MR = 8
const MT = 8
const MB = 20

let clipSeq = 0

export function XYChart(p: XYProps) {
  const [ref, w] = useWidth()
  const clipId = useMemo(() => `clip${++clipSeq}`, [])
  const H = (p.height ?? 9) * remPx()
  const [localHover, setLocalHover] = useState<number | null>(null)
  const hoverIdx = p.hover ? p.hover.value : localHover
  const setHover = (i: number | null) => (p.hover ? (p.hover.value = i) : setLocalHover(i))
  const drag = useRef<{ start: number } | null>(null)
  const [dragSel, setDragSel] = useState<[number, number] | null>(null)

  const geo = useMemo(() => {
    const n = p.x.length
    if (!w || n < 2) return null
    const tx = (v: number) => (p.logX ? Math.log(Math.max(v, 1e-9)) : v)
    const x0 = tx(p.x[0]), x1 = tx(p.x[n - 1])
    let lo = Infinity, hi = -Infinity
    for (const s of p.series) for (const v of s.values) if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v }
    if (!isFinite(lo)) { lo = 0; hi = 1 }
    if (p.zeroBase || p.bars) lo = Math.min(0, lo)
    if (p.yMin != null) lo = p.yMin
    if (p.yMax != null) hi = p.yMax
    if (hi === lo) { hi += 1; lo -= p.zeroBase ? 0 : 1 }
    const pad = (hi - lo) * 0.06
    if (p.yMin == null && !(p.zeroBase || p.bars) ) lo -= pad
    if (p.yMax == null) hi += pad
    const pw = w - ML - MR
    const ph = H - MT - MB
    const sx = (v: number) => ML + ((tx(v) - x0) / (x1 - x0 || 1)) * pw
    const sy = (v: number) => (p.invert ? MT + ((v - lo) / (hi - lo)) * ph : MT + ph - ((v - lo) / (hi - lo)) * ph)
    // Bucket long series down to roughly one point per pixel column.
    const cols = Math.max(50, Math.floor(pw))
    const big = n > cols * 1.5
    const baseV = p.invert ? hi : lo < 0 && hi > 0 ? 0 : lo
    const base = sy(baseV).toFixed(1)
    const paths = p.series.map((s) => {
      const pts: [number, number][] = []
      if (big) {
        let col = -1, sum = 0, cnt = 0, xs = 0
        const flush = () => {
          if (col < 0) return
          pts.push([xs, cnt ? sy(sum / cnt) : NaN])
          sum = 0
          cnt = 0
        }
        for (let i = 0; i < n; i++) {
          const X = sx(p.x[i])
          const c = Math.floor(((X - ML) / pw) * cols)
          if (c !== col) { flush(); col = c; xs = X }
          const v = s.values[i]
          if (isFinite(v)) { sum += v; cnt++ }
        }
        flush()
      } else for (let i = 0; i < n; i++) pts.push([sx(p.x[i]), isFinite(s.values[i]) ? sy(s.values[i]) : NaN])
      let d = '', area = ''
      let run: [number, number][] = []
      const endRun = () => {
        if (run.length) {
          const seg = run.map((q, k) => `${k ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('')
          d += seg
          if (s.area) area += `${seg}L${run[run.length - 1][0].toFixed(1)} ${base}L${run[0][0].toFixed(1)} ${base}Z`
        }
        run = []
      }
      for (const q of pts) {
        if (isNaN(q[1])) endRun()
        else run.push(q)
      }
      endRun()
      return { d, area }
    })
    const yt = niceTicks(lo, hi, Math.max(2, Math.round(ph / 36)), p.yStep)
    let xt = p.xTicks ?? niceTicks(p.x[0], p.x[n - 1], Math.max(2, Math.floor(pw / 90)))
    if (p.logX && !p.xTicks) xt = []
    return { sx, sy, pw, ph, yt, xt, paths, lo, hi, n }
  }, [w, H, p.x, p.series, p.invert, p.yMin, p.yMax, p.zeroBase, p.logX, p.bands, p.xTicks, p.yStep, p.bars])

  const idxAt = (clientX: number, el: Element) => {
    if (!geo) return null
    const r = el.getBoundingClientRect()
    const X = clientX - r.left
    if (X < ML - 4 || X > w - MR + 4) return null
    const f = Math.max(0, Math.min(1, (X - ML) / geo.pw))
    const n = p.x.length
    if (p.logX) {
      const lx0 = Math.log(p.x[0]), lx1 = Math.log(p.x[n - 1])
      const v = Math.exp(lx0 + f * (lx1 - lx0))
      let best = 0
      for (let i = 1; i < n; i++) if (Math.abs(Math.log(p.x[i]) - Math.log(v)) < Math.abs(Math.log(p.x[best]) - Math.log(v))) best = i
      return best
    }
    const v = p.x[0] + f * (p.x[n - 1] - p.x[0])
    const j = Math.min(n - 1, lowerBound(p.x, v))
    return j > 0 && Math.abs(p.x[j - 1] - v) < Math.abs(p.x[j] - v) ? j - 1 : j
  }

  const sel = dragSel ?? p.selection ?? null
  const hi = hoverIdx != null && hoverIdx < p.x.length ? hoverIdx : null

  let tipLeft = 0
  if (geo && hi != null) tipLeft = geo.sx(p.x[hi])

  return (
    <div class="chart" ref={ref} aria-label={p.ariaLabel} role="img">
      {(p.legend ?? p.series.length > 1) && (
        <div class="legend" style={{ marginBottom: '0.35rem' }}>
          {p.series.map((s) => (
            <span key={s.key}>
              <i class="key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {geo && (
        <svg
          height={H}
          width={w}
          onPointerMove={(e) => {
            const i = idxAt(e.clientX, e.currentTarget)
            setHover(i)
            if (drag.current && i != null) setDragSel([Math.min(drag.current.start, i), Math.max(drag.current.start, i)])
          }}
          onPointerLeave={() => !drag.current && setHover(null)}
          onPointerDown={(e) => {
            if (!p.onSelect) return
            const i = idxAt(e.clientX, e.currentTarget)
            if (i == null) return
            drag.current = { start: i }
            setDragSel(null)
            ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          }}
          onPointerUp={() => {
            if (!drag.current) return
            drag.current = null
            if (dragSel && dragSel[1] - dragSel[0] >= 2) p.onSelect?.(dragSel)
            else p.onSelect?.(null)
            setDragSel(null)
          }}
        >
          {(p.bands || []).map((b) => {
            const y1 = geo.sy(Math.min(b.to, geo.hi)), y2 = geo.sy(Math.max(b.from, geo.lo))
            const top = Math.min(y1, y2), hgt = Math.abs(y2 - y1)
            if (hgt <= 0) return null
            return (
              <g key={b.label}>
                <rect x={ML} y={top} width={geo.pw} height={hgt} fill={b.color} />
                <text x={w - MR - 4} y={top + 12} text-anchor="end" class="tick">{b.label}</text>
              </g>
            )
          })}
          {geo.yt.map((t) => (
            <g key={t}>
              <line class="grid" x1={ML} x2={w - MR} y1={geo.sy(t)} y2={geo.sy(t)} />
              <text class="tick" x={ML - 6} y={geo.sy(t) + 4} text-anchor="end">{p.yFmt(t)}</text>
            </g>
          ))}
          <line class="baseline" x1={ML} x2={w - MR} y1={MT + geo.ph} y2={MT + geo.ph} />
          {geo.xt.map((t, k) => {
            const X = geo.sx(t)
            if (X < ML - 1 || X > w - MR + 1) return null
            return (
              <text key={k} class="tick" x={X} y={H - 4} text-anchor={X < ML + 20 ? 'start' : X > w - MR - 20 ? 'end' : 'middle'}>
                {p.xFmt(t)}
              </text>
            )
          })}
          <defs>
            <clipPath id={clipId}>
              <rect x={ML - 2} y={MT - 2} width={geo.pw + 4} height={geo.ph + 4} />
            </clipPath>
          </defs>
          <g clip-path={`url(#${clipId})`}>
          {p.bars
            ? p.series.slice(0, 1).map((s) => {
                const bw = Math.max(1, Math.min(24, geo.pw / geo.n - 2))
                return (
                  <g key={s.key}>
                    {s.values.map((v, i) => {
                      if (!v || !isFinite(v)) return null
                      const X = geo.sx(p.x[i]) - bw / 2
                      const y = geo.sy(v), y0 = geo.sy(0)
                      const r = Math.min(4, bw / 2, Math.abs(y0 - y))
                      return <path key={i} d={roundTop(X, y, bw, y0 - y, r)} fill={s.color} opacity={hi === i ? 1 : 0.85} />
                    })}
                  </g>
                )
              })
            : geo.paths.map((path, k) => {
                const s = p.series[k]
                return (
                  <g key={s.key}>
                    {s.area && path.area && <path d={path.area} fill={s.color} opacity={s.areaOpacity ?? 0.1} />}
                    <path d={path.d} fill="none" stroke={s.color} stroke-width={s.width ?? 2} stroke-linejoin="round" stroke-linecap="round" />
                  </g>
                )
              })}
          </g>
          {(p.refLines || []).map((r) => (
            <g key={r.label}>
              <line x1={ML} x2={w - MR} y1={geo.sy(r.y)} y2={geo.sy(r.y)} stroke="var(--ink-2)" stroke-width={1} opacity={0.6} />
              <text x={ML + 4} y={geo.sy(r.y) - 4} class="tick">{r.label}</text>
            </g>
          ))}
          {sel && (
            <rect class="sel" x={geo.sx(p.x[sel[0]])} y={MT} width={Math.max(1, geo.sx(p.x[sel[1]]) - geo.sx(p.x[sel[0]]))} height={geo.ph} />
          )}
          {hi != null && (
            <g>
              <line class="xhair" x1={tipLeft} x2={tipLeft} y1={MT} y2={MT + geo.ph} />
              {!p.bars &&
                p.series.map((s) =>
                  isFinite(s.values[hi]) ? <circle key={s.key} cx={tipLeft} cy={geo.sy(s.values[hi])} r={4} fill={s.color} stroke="var(--surface)" stroke-width={2} /> : null,
                )}
            </g>
          )}
        </svg>
      )}
      {geo && hi != null && (
        <div class="tip" style={{ left: `${Math.min(Math.max(0, tipLeft + 10), Math.max(0, w - 150))}px`, top: '0.25rem' }}>
          {p.tip ? (
            p.tip(hi)
          ) : (
            <>
              <div class="k">{p.xFmt(p.x[hi])}</div>
              {p.series.map((s) => (
                <div key={s.key}>
                  <i class="key" style={{ background: s.color }} />
                  <span class="v">{isFinite(s.values[hi]) ? p.yFmt(s.values[hi]) : '–'}</span>
                  {p.series.length > 1 && <span class="k"> {s.label}</span>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return ''
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`
}

export interface Col {
  key: string
  label: string
  value: number
  tip?: ComponentChildren
  highlight?: boolean
}

/** Vertical columns from a shared baseline. */
export function Columns({ items, height = 8, yFmt, color = 'var(--s1)', dim = 'var(--s1)', onPick, labelEvery = 1 }: { items: Col[]; height?: number; yFmt: (v: number) => string; color?: string; dim?: string; onPick?: (key: string) => void; labelEvery?: number }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const H = height * remPx()
  const max = Math.max(1e-9, ...items.map((i) => i.value))
  const yt = niceTicks(0, max, 3)
  const top = Math.max(max, yt[yt.length - 1] ?? max)
  const pw = w - ML - MR
  const ph = H - MT - MB
  const band = items.length ? pw / items.length : 0
  const bw = Math.max(2, Math.min(24, band - 2))
  const sy = (v: number) => MT + ph - (v / top) * ph
  return (
    <div class="chart" ref={ref}>
      {w > 0 && (
        <svg height={H} width={w} onPointerLeave={() => setHover(null)}>
          {yt.map((t) => (
            <g key={t}>
              <line class="grid" x1={ML} x2={w - MR} y1={sy(t)} y2={sy(t)} />
              <text class="tick" x={ML - 6} y={sy(t) + 4} text-anchor="end">{yFmt(t)}</text>
            </g>
          ))}
          <line class="baseline" x1={ML} x2={w - MR} y1={MT + ph} y2={MT + ph} />
          {items.map((it, i) => {
            const cx = ML + band * i + band / 2
            const y = sy(it.value)
            const h = MT + ph - y
            return (
              <g key={it.key} onPointerEnter={() => setHover(i)} onClick={() => onPick?.(it.key)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
                <rect x={ML + band * i} y={MT} width={band} height={ph + MB} fill="transparent" />
                {h > 0 && <path d={roundTop(cx - bw / 2, y, bw, h, Math.min(4, bw / 2, h))} fill={it.highlight ? color : dim} opacity={hover === i ? 1 : it.highlight ? 1 : 0.55} />}
                {i % labelEvery === 0 && (
                  <text class="tick" x={cx} y={H - 4} text-anchor="middle">{it.label}</text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hover != null && items[hover] && (
        <div class="tip" style={{ left: `${Math.min(Math.max(0, ML + band * hover + band / 2 + 8), Math.max(0, w - 150))}px` }}>
          {items[hover].tip ?? (
            <>
              <div class="k">{items[hover].label}</div>
              <div class="v">{yFmt(items[hover].value)}</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Horizontal distribution rows, e.g. time in zones. */
export function ZoneBars({ rows, fmt }: { rows: { label: string; sub?: string; value: number; color: string }[]; fmt: (v: number) => string }) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div>
      {rows.map((r) => (
        <div class="zone-row" key={r.label}>
          <div>
            <div style={{ fontWeight: 650 }}>{r.label}</div>
            {r.sub && <div class="tiny muted num">{r.sub}</div>}
          </div>
          <div class="track" title={fmt(r.value)}>
            <i style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
          <div class="num" style={{ textAlign: 'right' }}>
            {Math.round((r.value / total) * 100)}%
          </div>
        </div>
      ))}
    </div>
  )
}
