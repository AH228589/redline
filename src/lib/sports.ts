import type { Sport, SportGroup } from './types'

interface SportInfo {
  label: string
  group: SportGroup
  pace: boolean // show pace (min/km) rather than speed
  icon: string // key into icons.tsx
  movingThreshold: number // m/s below which you count as stopped
}

export const SPORTS: Record<Sport, SportInfo> = {
  run: { label: 'Run', group: 'foot', pace: true, icon: 'run', movingThreshold: 0.6 },
  trail_run: { label: 'Trail Run', group: 'foot', pace: true, icon: 'trail', movingThreshold: 0.5 },
  walk: { label: 'Walk', group: 'foot', pace: true, icon: 'walk', movingThreshold: 0.35 },
  hike: { label: 'Hike', group: 'foot', pace: true, icon: 'hike', movingThreshold: 0.3 },
  ride: { label: 'Ride', group: 'bike', pace: false, icon: 'ride', movingThreshold: 1.0 },
  gravel: { label: 'Gravel Ride', group: 'bike', pace: false, icon: 'ride', movingThreshold: 1.0 },
  mtb: { label: 'Mountain Bike', group: 'bike', pace: false, icon: 'mtb', movingThreshold: 0.8 },
  ebike: { label: 'E-Bike Ride', group: 'bike', pace: false, icon: 'ride', movingThreshold: 1.0 },
  swim: { label: 'Swim', group: 'other', pace: true, icon: 'swim', movingThreshold: 0.2 },
  ski: { label: 'Ski', group: 'other', pace: false, icon: 'ski', movingThreshold: 0.8 },
  row: { label: 'Row', group: 'other', pace: true, icon: 'row', movingThreshold: 0.5 },
  workout: { label: 'Workout', group: 'other', pace: false, icon: 'workout', movingThreshold: 0 },
  other: { label: 'Other', group: 'other', pace: false, icon: 'other', movingThreshold: 0.4 },
}

export const SPORT_LIST = Object.keys(SPORTS) as Sport[]

export const GROUP_LABEL: Record<SportGroup | 'all', string> = {
  all: 'All sports',
  foot: 'Run & walk',
  bike: 'Ride',
  other: 'Other',
}

export const sportGroup = (s: Sport): SportGroup => SPORTS[s]?.group ?? 'other'
export const usesPace = (s: Sport) => SPORTS[s]?.pace ?? false

/** Map loose names from files and exports onto our sports. */
export function sportFromText(raw: string | null | undefined): Sport | null {
  if (!raw) return null
  const t = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!t) return null
  if (/trail/.test(t) && /run/.test(t)) return 'trail_run'
  if (/virtual run|treadmill|run|jog/.test(t)) return 'run'
  if (/hik/.test(t)) return 'hike'
  if (/walk/.test(t)) return 'walk'
  if (/e ?bike|e mountain|electric/.test(t)) return 'ebike'
  if (/mountain|mtb/.test(t)) return 'mtb'
  if (/gravel|cyclocross/.test(t)) return 'gravel'
  if (/ride|cycl|bik|velo/.test(t)) return 'ride'
  if (/swim/.test(t)) return 'swim'
  if (/ski|snowboard/.test(t)) return 'ski'
  if (/row|kayak|canoe|paddl/.test(t)) return 'row'
  if (/workout|training|strength|weight|yoga|crossfit|hiit/.test(t)) return 'workout'
  // Garmin / Strava numeric codes seen in GPX <type>
  if (t === '1' || t === '9') return 'run'
  if (t === '2') return 'ride'
  return 'other'
}

export function defaultName(sport: Sport, start: number) {
  const h = new Date(start).getHours()
  const part = h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 14 ? 'Lunch' : h < 18 ? 'Afternoon' : h < 22 ? 'Evening' : 'Night'
  return `${part} ${SPORTS[sport].label}`
}
