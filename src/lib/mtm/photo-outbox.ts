/**
 * G (Creatio 10X roadmap — MTM Offline PWA) — offline photo outbox.
 *
 * A visit photo captured in a dead zone is stored as a Blob in IndexedDB and
 * uploaded (multipart) to /api/v1/mtm/photos when connectivity returns. IndexedDB
 * stores Blobs natively, so the binary survives a reload/app-restart. Its own DB,
 * separate from the mutation outbox + route cache; browser-only (no-op under SSR).
 */

const DB_NAME = "leaddrive-mtm-photo-outbox"
const STORE = "photos"

export interface QueuedPhoto {
  id: string
  blob: Blob
  agentId: string
  visitId: string
  filename: string
  queuedAt: string
}

function uuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
    })
  )
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Queue a photo Blob for later upload. Returns its client id. */
export async function enqueuePhoto(p: Omit<QueuedPhoto, "id" | "queuedAt">): Promise<string> {
  const entry: QueuedPhoto = { ...p, id: uuid(), queuedAt: new Date().toISOString() }
  if (typeof indexedDB === "undefined") return entry.id
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // best-effort
  }
  return entry.id
}

export async function listPhotos(): Promise<QueuedPhoto[]> {
  if (typeof indexedDB === "undefined") return []
  try {
    const db = await openDb()
    return await new Promise<QueuedPhoto[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as QueuedPhoto[]) : [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function removePhoto(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // best-effort
  }
}

export async function countPhotos(): Promise<number> {
  return (await listPhotos()).length
}
