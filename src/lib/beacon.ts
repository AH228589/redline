import type Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import { signal } from '@preact/signals'
import { isNative, PUBLIC_URL } from './native'

const loadPeer = () => import('peerjs').then((m) => m.default)

export interface BeaconPoint {
  t: number
  lat: number
  lon: number
  dist: number
  moving: number
}

export type BeaconMsg =
  | { type: 'hello'; name: string; sport: string; started: number; history: BeaconPoint[] }
  | { type: 'pt'; p: BeaconPoint; battery: number | null }
  | { type: 'state'; state: string }
  | { type: 'end' }

const PREFIX = 'redline-bcn-'

let peer: Peer | null = null
const conns = new Set<DataConnection>()
let history: BeaconPoint[] = []
let hello: Omit<Extract<BeaconMsg, { type: 'hello' }>, 'history'> | null = null

export const beaconId = signal<string | null>(null)
export const beaconViewers = signal(0)

// From the app, links must point at the public site, not the app's local origin.
export const beaconLink = (id: string) => (isNative ? `${PUBLIC_URL}#/beacon/${id}` : `${location.origin}${location.pathname}#/beacon/${id}`)

export async function startBeacon(name: string, sport: string, started: number): Promise<string> {
  stopBeacon(false)
  const PeerCtor = await loadPeer()
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('')
  history = []
  hello = { type: 'hello', name, sport, started }
  return new Promise((resolve, reject) => {
    const p = new PeerCtor(PREFIX + id)
    peer = p
    const timer = setTimeout(() => reject(new Error('Could not reach the share service')), 12000)
    p.on('open', () => {
      clearTimeout(timer)
      beaconId.value = id
      resolve(id)
    })
    p.on('error', (e) => {
      clearTimeout(timer)
      if (!beaconId.value) reject(e)
    })
    p.on('disconnected', () => {
      setTimeout(() => {
        if (peer === p && !p.destroyed) p.reconnect()
      }, 1500)
    })
    p.on('connection', (c) => {
      c.on('open', () => {
        conns.add(c)
        beaconViewers.value = conns.size
        c.send({ ...hello!, history } satisfies BeaconMsg)
      })
      c.on('close', () => {
        conns.delete(c)
        beaconViewers.value = conns.size
      })
    })
  })
}

async function battery(): Promise<number | null> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }
    return nav.getBattery ? Math.round((await nav.getBattery()).level * 100) : null
  } catch {
    return null
  }
}

export async function beaconSend(p: BeaconPoint) {
  if (!peer) return
  history.push(p)
  if (history.length > 6000) history = history.filter((_, i) => i % 2 === 0)
  const msg: BeaconMsg = { type: 'pt', p, battery: await battery() }
  for (const c of conns) if (c.open) c.send(msg)
}

export function beaconState(state: string) {
  for (const c of conns) if (c.open) c.send({ type: 'state', state } satisfies BeaconMsg)
}

export function stopBeacon(notifyViewers = true) {
  if (notifyViewers) for (const c of conns) if (c.open) c.send({ type: 'end' } satisfies BeaconMsg)
  const p = peer
  peer = null
  conns.clear()
  beaconViewers.value = 0
  beaconId.value = null
  if (p) setTimeout(() => p.destroy(), 300)
}

/** Viewer side: follow someone's beacon. Returns a stop function. */
export function watchBeacon(id: string, onMsg: (m: BeaconMsg) => void, onStatus: (s: 'connecting' | 'live' | 'offline') => void) {
  let stopped = false
  let retry = 0
  let p: Peer | null = null
  const connect = () => {
    if (!p) return
    if (stopped || p.destroyed) return
    onStatus('connecting')
    const c = p.connect(PREFIX + id, { reliable: true })
    c.on('open', () => onStatus('live'))
    c.on('data', (d) => onMsg(d as BeaconMsg))
    c.on('close', () => {
      onStatus('offline')
      retry = window.setTimeout(connect, 5000)
    })
  }
  loadPeer().then((PeerCtor) => {
    if (stopped) return
    p = new PeerCtor()
    p.on('open', connect)
    p.on('error', (e) => {
      if ((e as { type?: string }).type === 'peer-unavailable') {
        onStatus('offline')
        clearTimeout(retry)
        retry = window.setTimeout(connect, 8000)
      }
    })
  })
  return () => {
    stopped = true
    clearTimeout(retry)
    p?.destroy()
  }
}
