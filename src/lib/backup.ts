import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate'
import * as db from './db'
import { loadAll } from './store'

export async function exportBackup(): Promise<Uint8Array> {
  const [activities, streams, segments, efforts, routes, kv] = await Promise.all([
    db.getAll('activities'),
    db.getAll('streams'),
    db.getAll('segments'),
    db.getAll('efforts'),
    db.getAll('routes'),
    db.getAll<{ key: string; value: unknown }>('kv'),
  ])
  const data = {
    app: 'redline',
    version: 1,
    exportedAt: new Date().toISOString(),
    activities,
    streams,
    segments,
    efforts,
    routes,
    kv: kv.filter((r) => r.key !== 'recording'),
  }
  // NaN is not valid JSON; encode it explicitly.
  const json = JSON.stringify(data, (_k, v) => (typeof v === 'number' && isNaN(v) ? '__NaN' : v))
  return gzipSync(strToU8(json), { level: 6 })
}

export async function importBackup(file: File) {
  let bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes)
  const data = JSON.parse(strFromU8(bytes), (_k, v) => (v === '__NaN' ? NaN : v))
  if (data.app !== 'redline') throw new Error('Not a Redline backup')
  await db.putMany('activities', data.activities || [])
  await db.putMany('streams', data.streams || [])
  await db.putMany('segments', data.segments || [])
  await db.putMany('efforts', data.efforts || [])
  await db.putMany('routes', data.routes || [])
  await db.putMany('kv', data.kv || [])
  await loadAll()
  return (data.activities || []).length as number
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null
  } catch {
    return null
  }
}
