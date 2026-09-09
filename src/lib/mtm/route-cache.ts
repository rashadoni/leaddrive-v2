/**
 * G (Creatio 10X roadmap — MTM Offline PWA) — route read-cache.
 *
 * Caches the field agent's day-route (fetched while online) in IndexedDB so it
 * stays viewable in a dead zone — the roadmap's "кэш данных маршрута дня …
 * просмотр маршрута offline". Read-only: never mutates server state, so there is
 * no data-integrity risk (writes go through the offline outbox + sync engine).
 *
 * Uses its OWN IndexedDB (separate from the outbox DB) so the two libraries never
 * fight over store creation / DB version. Browser-only; a no-op under SSR.
 */

const DB_NAME = "leaddrive-mtm-route-cache"
const STORE = "routes"

export interface CachedRoute<T = unknown> {
  data: T
  cachedAt: string
}

/** Stable cache key for an agent's route on a given day. */
export function routeCacheKey(agentId: string, date: string): string {
  return `${agentId}::${date}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveRouteCache<T>(key: string, data: T): Promise<void> {
  if (typeof indexedDB === "undefined") return
  try {
    const db = await openDb()
    const entry: CachedRoute<T> = { data, cachedAt: new Date().toISOString() }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(entry, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // best-effort — a failed cache write just means no offline copy this time
  }
}

export async function loadRouteCache<T>(key: string): Promise<CachedRoute<T> | null> {
  if (typeof indexedDB === "undefined") return null
  try {
    const db = await openDb()
    return await new Promise<CachedRoute<T> | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => {
        const v = req.result
        resolve(v && typeof v === "object" && "data" in v ? (v as CachedRoute<T>) : null)
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}
