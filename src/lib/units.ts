import { settings } from './store'
import { usesPace } from './sports'
import type { Sport } from './types'

export const MILE = 1609.344
export const FOOT = 0.3048

const imperial = () => settings.value.units === 'imperial'

export const distUnit = () => (imperial() ? 'mi' : 'km')
export const elevUnit = () => (imperial() ? 'ft' : 'm')
export const unitLen = () => (imperial() ? MILE : 1000)

export function distNum(m: number) {
  return m / unitLen()
}

export function fmtDist(m: number, digits = 2) {
  const v = distNum(m)
  const d = v >= 100 ? 0 : v >= 10 ? Math.min(digits, 1) : digits
  return `${v.toFixed(d)} ${distUnit()}`
}

/** Short distance labels for best efforts and segments. */
export function fmtShortDist(m: number) {
  if (imperial()) {
    if (m < MILE * 0.5) return `${Math.round(m / FOOT).toLocaleString()} ft`
    return `${(m / MILE).toFixed(2)} mi`
  }
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(2)} km`
}

export function fmtElev(m: number | null | undefined) {
  if (m == null || !isFinite(m)) return '–'
  return imperial() ? `${Math.round(m / FOOT).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`
}

export const elevNum = (m: number) => (imperial() ? m / FOOT : m)

export function fmtDuration(sec: number, alwaysHours = false) {
  if (!isFinite(sec) || sec < 0) return '–'
  sec = Math.round(sec)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = h || alwaysHours ? String(m).padStart(2, '0') : String(m)
  return h || alwaysHours ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

export function fmtHours(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

/** Seconds per unit distance. */
export function paceSec(speed: number) {
  if (!speed || speed <= 0) return Infinity
  return unitLen() / speed
}

export function fmtPace(speed: number | null | undefined, withUnit = true) {
  if (!speed || speed < 0.05) return '–'
  const s = paceSec(speed)
  if (s > 60 * 60) return '–'
  return `${fmtDuration(s)}${withUnit ? ` /${distUnit()}` : ''}`
}

export function speedNum(speed: number) {
  return imperial() ? speed * 2.236936 : speed * 3.6
}

export function fmtSpeed(speed: number | null | undefined, withUnit = true) {
  if (speed == null || !isFinite(speed)) return '–'
  return `${speedNum(speed).toFixed(1)}${withUnit ? (imperial() ? ' mph' : ' km/h') : ''}`
}

export const speedUnit = () => (imperial() ? 'mph' : 'km/h')
export const paceUnit = () => `/${distUnit()}`

export function fmtPaceOrSpeed(sport: Sport, speed: number | null | undefined, withUnit = true) {
  return usesPace(sport) ? fmtPace(speed, withUnit) : fmtSpeed(speed, withUnit)
}

export const paceOrSpeedLabel = (sport: Sport) => (usesPace(sport) ? 'Pace' : 'Speed')

export function fmtDate(t: number, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Date(t).toLocaleDateString(undefined, opts)
}

export function fmtTime(t: number) {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function fmtRelDay(t: number) {
  const d = new Date(t)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(today) - start(d)) / 86400000)
  if (diff === 0) return `Today at ${fmtTime(t)}`
  if (diff === 1) return `Yesterday at ${fmtTime(t)}`
  if (diff < 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })} at ${fmtTime(t)}`
  return `${fmtDate(t)} at ${fmtTime(t)}`
}

export function fmtNum(v: number, digits = 0) {
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

/** Compact number for stat tiles: 1,284 / 12.9K. */
export function compact(v: number) {
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}K`
  return Math.round(v).toLocaleString()
}

export const BEST_EFFORT_DISTANCES: { m: number; label: string }[] = [
  { m: 400, label: '400m' },
  { m: 804.672, label: '1/2 mile' },
  { m: 1000, label: '1K' },
  { m: 1609.344, label: '1 mile' },
  { m: 3218.688, label: '2 mile' },
  { m: 5000, label: '5K' },
  { m: 10000, label: '10K' },
  { m: 15000, label: '15K' },
  { m: 16093.44, label: '10 mile' },
  { m: 20000, label: '20K' },
  { m: 21097.5, label: 'Half Marathon' },
  { m: 30000, label: '30K' },
  { m: 42195, label: 'Marathon' },
  { m: 50000, label: '50K' },
]

export const POWER_DURATIONS = [1, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400, 7200]

export function fmtDurShort(sec: number) {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${+(sec / 3600).toFixed(1)}h`
}
