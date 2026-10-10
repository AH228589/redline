const DB_NAME = 'redline'
const VERSION = 1

export type StoreName = 'activities' | 'streams' | 'segments' | 'efforts' | 'routes' | 'kv'

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of ['activities', 'streams', 'segments', 'routes'] as const) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('efforts')) {
        const e = db.createObjectStore('efforts', { keyPath: 'id' })
        e.createIndex('activityId', 'activityId')
        e.createIndex('segmentId', 'segmentId')
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open()
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open()
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>
}

export async function getAllKeys(store: StoreName): Promise<string[]> {
  const db = await open()
  return wrap(db.transaction(store).objectStore(store).getAllKeys()) as Promise<string[]>
}

export async function put(store: StoreName, value: unknown) {
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value)
  return done(tx)
}

export async function putMany(store: StoreName, values: unknown[]) {
  if (!values.length) return
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  const os = tx.objectStore(store)
  for (const v of values) os.put(v)
  return done(tx)
}

export async function del(store: StoreName, key: string) {
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  return done(tx)
}

export async function delMany(store: StoreName, keys: string[]) {
  if (!keys.length) return
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  const os = tx.objectStore(store)
  for (const k of keys) os.delete(k)
  return done(tx)
}

export async function clear(store: StoreName) {
  const db = await open()
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).clear()
  return done(tx)
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await get<{ key: string; value: T }>('kv', key)
  return row?.value
}

export async function kvSet(key: string, value: unknown) {
  return put('kv', { key, value })
}

export async function kvDel(key: string) {
  return del('kv', key)
}

export async function persist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist()
  } catch {
    /* not supported */
  }
}
