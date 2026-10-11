export type Sport =
  | 'run'
  | 'trail_run'
  | 'walk'
  | 'hike'
  | 'ride'
  | 'gravel'
  | 'mtb'
  | 'ebike'
  | 'swim'
  | 'ski'
  | 'row'
  | 'workout'
  | 'other'

export type SportGroup = 'foot' | 'bike' | 'other'

/** Struct-of-arrays track. Missing samples inside a present channel are NaN. */
export interface Streams {
  time: number[] // epoch ms
  lat: number[] | null
  lon: number[] | null
  ele: number[] | null
  hr: number[] | null
  cad: number[] | null
  pwr: number[] | null
  dist: number[] // cumulative metres
  est?: [number, number][] | null // index ranges filled in by routing, not measured
  cadUnit?: 'spm' // cadence already in steps per minute (phone recordings)
  eleSource?: 'gps' | 'baro' // where recorded elevation came from
}

export interface Split {
  index: number
  distance: number // metres covered in this split
  time: number // moving seconds
  elev: number // net elevation change, metres
  avgHr: number | null
  gapSpeed: number | null
  partial: boolean
}

export interface Summary {
  distance: number
  movingTime: number
  elapsedTime: number
  elevGain: number
  elevLoss: number
  elevMin: number | null
  elevMax: number | null
  avgSpeed: number
  maxSpeed: number
  gapSpeed: number | null
  avgHr: number | null
  maxHr: number | null
  avgCad: number | null
  avgPower: number | null
  maxPower: number | null
  np: number | null
  work: number | null // kJ
  calories: number
  splitsKm: Split[]
  splitsMi: Split[]
  bestEfforts: Record<string, number> // metres -> seconds
  powerCurve: Record<string, number> | null // seconds -> watts
  hrHist: number[] | null // seconds spent at each bpm, index = bpm
  bbox: [number, number, number, number] | null // minLon, minLat, maxLon, maxLat
}

export interface Activity {
  id: string
  name: string
  sport: Sport
  start: number
  description: string
  rpe: number | null
  gearId: string | null
  source: string
  hasGps: boolean
  trace: [number, number][] // simplified [lon, lat]
  summary: Summary
  createdAt: number
}

export interface Segment {
  id: string
  name: string
  group: SportGroup
  points: [number, number][]
  distance: number
  elevGain: number
  avgGrade: number
  bbox: [number, number, number, number]
  starred: boolean
  createdAt: number
}

export interface SegmentEffort {
  id: string
  segmentId: string
  activityId: string
  start: number
  elapsed: number
  startIdx: number
  endIdx: number
  avgHr: number | null
  avgPower: number | null
}

export interface Route {
  id: string
  name: string
  sport: Sport
  profile: string
  waypoints: [number, number][]
  geometry: [number, number, number][] // lon, lat, ele (NaN if unknown)
  distance: number
  elevGain: number
  elevLoss: number
  createdAt: number
  offline: boolean
}

export interface Settings {
  name: string
  units: 'metric' | 'imperial'
  theme: 'system' | 'light' | 'dark'
  mapStyle: 'standard' | 'topo' | 'dark'
  weight: number
  maxHr: number
  restHr: number
  lthr: number | null
  ftp: number | null
  thresholdPace: number | null // seconds per km
  voiceCues: boolean
  autoPause: boolean
  defaultSport: Sport
}

export interface Goal {
  id: string
  metric: 'distance' | 'time' | 'elevation' | 'count'
  period: 'week' | 'month' | 'year'
  group: SportGroup | 'all'
  target: number
}

export interface Gear {
  id: string
  name: string
  kind: 'shoes' | 'bike'
  startDistance: number
  limit: number | null
  retired: boolean
  defaultFor: Sport[]
}
