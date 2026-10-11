import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { Map as MLMap, Marker, StyleSpecification, LngLatBoundsLike, GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { settings } from '../lib/store'
import { isNative } from '../lib/native'
import type { Settings } from '../lib/types'

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

type ML = typeof import('maplibre-gl')
let mlp: Promise<ML> | null = null
// Point MapLibre at its worker explicitly; bundlers move the file it would look for.
const loadML = () =>
  (mlp ??= Promise.all([import('maplibre-gl'), workerSource()]).then(([ml, url]) => {
    ml.setWorkerUrl(url)
    return ml
  }))

/**
 * The iOS app's file server sends .mjs files as application/octet-stream, which
 * WebKit refuses to run as a module worker. Inside the app, hand MapLibre a blob
 * with the right type instead.
 */
async function workerSource() {
  if (!isNative) return workerUrl
  try {
    const code = await (await fetch(workerUrl)).text()
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  } catch {
    return workerUrl
  }
}

export interface MapLine {
  id: string
  coords: ([number, number] | [number, number, number])[]
  color: string
  width?: number
  opacity?: number
  gradient?: [number, string][]
  casing?: boolean
  dash?: boolean
}

export interface MapPoint {
  id: string
  coord: [number, number]
  kind: 'start' | 'end' | 'dot' | 'me' | 'wp' | 'pin'
  color?: string
  label?: string
  draggable?: boolean
}

interface Props {
  lines?: MapLine[]
  points?: MapPoint[]
  heat?: [number, number][][]
  heatColor?: string
  fitTo?: [number, number][] | null
  fitKey?: string
  follow?: [number, number] | null
  hover?: [number, number] | null
  onClick?: (ll: [number, number]) => void
  onPointDrag?: (id: string, ll: [number, number]) => void
  onPointClick?: (id: string) => void
  terrain?: boolean
  mapStyle?: Settings['mapStyle']
  class?: string
  children?: ComponentChildren
  initialCenter?: [number, number]
  initialZoom?: number
  padding?: number
}

export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#d7263d'
}

const TOPO: StyleSpecification = {
  version: 8,
  sources: {
    topo: {
      type: 'raster',
      tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 17,
      attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; OpenTopoMap (CC-BY-SA)',
    },
  },
  layers: [{ id: 'topo', type: 'raster', source: 'topo' }],
}

export function styleFor(key: Settings['mapStyle']): string | StyleSpecification {
  if (key === 'topo') return TOPO
  if (key === 'dark') return 'https://tiles.openfreemap.org/styles/dark'
  return 'https://tiles.openfreemap.org/styles/liberty'
}

function markerEl(p: MapPoint) {
  const el = document.createElement('div')
  const base = 'border-radius:50%;box-sizing:border-box;'
  if (p.kind === 'me') {
    el.style.cssText = `${base}width:1.1rem;height:1.1rem;background:#2a78d6;border:0.2rem solid #fff;box-shadow:0 0 0 0.35rem rgba(42,120,214,.25),0 0.1rem 0.3rem rgba(0,0,0,.4);`
  } else if (p.kind === 'wp') {
    el.style.cssText = `${base}width:1.15rem;height:1.15rem;background:${p.color || '#fff'};border:0.2rem solid ${cssVar('--accent')};cursor:grab;box-shadow:0 0.1rem 0.3rem rgba(0,0,0,.35);`
  } else if (p.kind === 'pin') {
    el.style.cssText = `${base}width:1.6rem;height:1.6rem;display:grid;place-items:center;background:${p.color || cssVar('--accent')};color:#fff;font:700 0.7rem system-ui;border:0.15rem solid #fff;box-shadow:0 0.1rem 0.4rem rgba(0,0,0,.4);cursor:pointer;`
    el.textContent = p.label || ''
  } else {
    const color = p.color || (p.kind === 'start' ? '#0ca30c' : p.kind === 'end' ? '#0b0b0b' : cssVar('--accent'))
    const size = p.kind === 'dot' ? '0.85rem' : '1rem'
    el.style.cssText = `${base}width:${size};height:${size};background:${color};border:0.18rem solid #fff;box-shadow:0 0.1rem 0.3rem rgba(0,0,0,.35);`
  }
  if (p.label && p.kind !== 'pin') el.title = p.label
  return el
}

export function MapView(props: Props) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const mlRef = useRef<ML | null>(null)
  const readyRef = useRef(false)
  const markers = useRef(new Map<string, { m: Marker; kind: string }>())
  const hoverM = useRef<Marker | null>(null)
  const lineIds = useRef(new Set<string>())
  const propsRef = useRef(props)
  const fittedKey = useRef<string | null>(null)
  const userMoved = useRef(0)
  propsRef.current = props
  const styleKey = props.mapStyle ?? settings.value.mapStyle

  useEffect(() => {
    let dead = false
    loadML().then((ml) => {
      if (dead || !box.current) return
      mlRef.current = ml
      const p = propsRef.current
      const map = new ml.Map({
        container: box.current,
        style: styleFor(styleKey),
        center: p.initialCenter ?? [0, 20],
        zoom: p.initialZoom ?? 1.5,
        attributionControl: { compact: true },
        // Phones report 3x density; 2x looks the same on a map and needs far less GPU memory.
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        dragRotate: true,
        maxPitch: 75,
        // Maps embedded in a scrolling page should not swallow the scroll.
        cooperativeGestures: !(p.class || '').includes('fill'),
      })
      map.addControl(new ml.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right')
      mapRef.current = map
      if (import.meta.env.VITE_AUTOTEST === '1') {
        ;(window as unknown as { __map: unknown }).__map = map
        map.on('error', (e) => console.log(`[AUTOTEST] map-error ${JSON.stringify({ msg: String(e.error?.message ?? e.error) })}`))
      }
      map.on('style.load', () => {
        readyRef.current = true
        lineIds.current.clear()
        sync(true)
      })
      map.on('click', (e) => propsRef.current.onClick?.([e.lngLat.lng, e.lngLat.lat]))
      map.on('dragstart', () => (userMoved.current = Date.now()))
    })
    return () => {
      dead = true
      readyRef.current = false
      mapRef.current?.remove()
      mapRef.current = null
      markers.current.clear()
      hoverM.current = null
    }
  }, [])

  // Swap base style without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    readyRef.current = false
    map.setStyle(styleFor(styleKey))
  }, [styleKey])

  useEffect(() => {
    sync(false)
  })

  // Map updates can race the style loading (fast re-renders, a style swap, a
  // context loss). Never let that throw into the page; retry once the map settles.
  const retrying = useRef(false)
  function sync(styleReloaded: boolean) {
    const map = mapRef.current
    if (!map || !mlRef.current || !readyRef.current) return
    try {
      syncNow(map, mlRef.current, styleReloaded)
    } catch (e) {
      if (import.meta.env.VITE_AUTOTEST === '1') console.log(`[AUTOTEST] map-sync ${String(e)}`)
      if (!retrying.current) {
        retrying.current = true
        map.once('idle', () => {
          retrying.current = false
          sync(true)
        })
      }
    }
  }

  function syncNow(map: MLMap, ml: ML, styleReloaded: boolean) {
    const p = propsRef.current

    // Terrain
    const wantTerrain = !!p.terrain
    if (wantTerrain && !map.getSource('dem')) {
      map.addSource('dem', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
        attribution: 'Terrain: Mapzen, AWS Open Data',
      })
      map.setTerrain({ source: 'dem', exaggeration: 1.5 })
      map.easeTo({ pitch: 60, duration: 800 })
    } else if (!wantTerrain && map.getSource('dem')) {
      map.setTerrain(null)
      map.removeSource('dem')
      map.easeTo({ pitch: 0, duration: 500 })
    }

    // Heatmap
    const heatId = 'heat'
    if (p.heat) {
      const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'MultiLineString' as const, coordinates: p.heat } }
      const src = map.getSource(heatId) as GeoJSONSource | undefined
      if (src) src.setData(data)
      else {
        map.addSource(heatId, { type: 'geojson', data })
        map.addLayer({
          id: 'heat-glow',
          type: 'line',
          source: heatId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': p.heatColor || cssVar('--accent'), 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 6], 'line-opacity': 0.08, 'line-blur': 3 },
        })
        map.addLayer({
          id: 'heat',
          type: 'line',
          source: heatId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': p.heatColor || cssVar('--accent'), 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 2.2], 'line-opacity': 0.35 },
        })
      }
      if (map.getLayer('heat')) {
        map.setPaintProperty('heat', 'line-color', p.heatColor || cssVar('--accent'))
        map.setPaintProperty('heat-glow', 'line-color', p.heatColor || cssVar('--accent'))
      }
    } else if (map.getSource(heatId)) {
      map.removeLayer('heat')
      map.removeLayer('heat-glow')
      map.removeSource(heatId)
    }

    // Lines
    const want = new Set((p.lines || []).map((l) => l.id))
    for (const id of lineIds.current) {
      if (want.has(id)) continue
      for (const suffix of ['-case', '']) if (map.getLayer(`l-${id}${suffix}`)) map.removeLayer(`l-${id}${suffix}`)
      if (map.getSource(`l-${id}`)) map.removeSource(`l-${id}`)
      lineIds.current.delete(id)
    }
    for (const l of p.lines || []) {
      const sid = `l-${l.id}`
      const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: l.coords.length >= 2 ? l.coords.map((c) => [c[0], c[1]]) : [] } }
      const src = map.getSource(sid) as GeoJSONSource | undefined
      if (src) {
        src.setData(data)
        lineIds.current.add(l.id)
      } else {
        map.addSource(sid, { type: 'geojson', data, lineMetrics: true })
        if (l.casing !== false)
          map.addLayer({ id: `${sid}-case`, type: 'line', source: sid, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': (l.width ?? 4) + 3, 'line-opacity': 0.9 } })
        map.addLayer({ id: sid, type: 'line', source: sid, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': l.color, 'line-width': l.width ?? 4 } })
        lineIds.current.add(l.id)
      }
      map.setPaintProperty(sid, 'line-color', l.color)
      map.setPaintProperty(sid, 'line-width', l.width ?? 4)
      map.setPaintProperty(sid, 'line-opacity', l.opacity ?? 1)
      map.setPaintProperty(sid, 'line-dasharray', l.dash ? [1.5, 1.5] : undefined)
      if (l.gradient && l.gradient.length >= 2) {
        map.setPaintProperty(sid, 'line-gradient', ['interpolate', ['linear'], ['line-progress'], ...l.gradient.flat()] as never)
      } else map.setPaintProperty(sid, 'line-gradient', undefined)
    }

    // Markers
    const wantPts = new Map((p.points || []).map((pt) => [pt.id, pt]))
    for (const [id, m] of markers.current) {
      const w = wantPts.get(id)
      if (!w || w.kind !== m.kind || styleReloaded) {
        m.m.remove()
        markers.current.delete(id)
      }
    }
    for (const pt of p.points || []) {
      const have = markers.current.get(pt.id)
      if (have) {
        have.m.setLngLat(pt.coord)
        if (pt.kind === 'pin') have.m.getElement().textContent = pt.label || ''
        continue
      }
      const el = markerEl(pt)
      const m = new ml.Marker({ element: el, draggable: !!pt.draggable }).setLngLat(pt.coord).addTo(map)
      if (pt.draggable) m.on('dragend', () => propsRef.current.onPointDrag?.(pt.id, [m.getLngLat().lng, m.getLngLat().lat]))
      el.addEventListener('click', (e) => {
        if (propsRef.current.onPointClick) {
          e.stopPropagation()
          propsRef.current.onPointClick(pt.id)
        }
      })
      markers.current.set(pt.id, { m, kind: pt.kind })
    }

    // Hover marker
    if (p.hover) {
      if (!hoverM.current) {
        const el = document.createElement('div')
        el.style.cssText = `width:0.9rem;height:0.9rem;border-radius:50%;background:${cssVar('--ink')};border:0.18rem solid ${cssVar('--surface')};box-shadow:0 0 0 0.15rem ${cssVar('--ink')}55;pointer-events:none;`
        hoverM.current = new ml.Marker({ element: el }).setLngLat(p.hover).addTo(map)
      } else hoverM.current.setLngLat(p.hover)
    } else if (hoverM.current) {
      hoverM.current.remove()
      hoverM.current = null
    }

    // Fit
    const key = p.fitKey ?? (p.fitTo ? String(p.fitTo.length) : null)
    if (p.fitTo && p.fitTo.length && key !== fittedKey.current) {
      fittedKey.current = key
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
      for (const [x, y] of p.fitTo) {
        if (x < a) a = x
        if (y < b) b = y
        if (x > c) c = x
        if (y > d) d = y
      }
      const pad = p.padding ?? 40
      if (c - a < 0.0005 && d - b < 0.0005) map.jumpTo({ center: [a, b], zoom: 15 })
      else map.fitBounds([[a, b], [c, d]] as LngLatBoundsLike, { padding: pad, duration: 0, maxZoom: 16 })
    }

    if (p.follow && Date.now() - userMoved.current > 15000) {
      map.easeTo({ center: p.follow, zoom: Math.max(map.getZoom(), 15), duration: 600 })
    }
  }

  return (
    <div class={`map ${props.class || ''}`}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {props.children}
    </div>
  )
}
