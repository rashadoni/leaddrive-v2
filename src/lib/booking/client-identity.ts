const memory = new Map<string, { fingerprint: string; idempotencyKey: string; recoverySecret: string }>()

/** Persist identity before the first send, so a lost response can be replayed safely. */
export async function bookingRequestIdentity(scope: string, payload: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)))
  const fingerprint = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("")
  const storageKey = `booking-request:${scope}`
  const cached = memory.get(storageKey)
  if (cached?.fingerprint === fingerprint) return { idempotencyKey: cached.idempotencyKey, recoverySecret: cached.recoverySecret }
  try {
    const previous = JSON.parse(sessionStorage.getItem(storageKey) || "null")
    if (previous?.fingerprint === fingerprint && typeof previous.idempotencyKey === "string" && typeof previous.recoverySecret === "string") return { idempotencyKey: previous.idempotencyKey as string, recoverySecret: previous.recoverySecret as string }
  } catch { /* Private browsing can disable storage; the current request still has a random identity. */ }
  const identity = { idempotencyKey: crypto.randomUUID(), recoverySecret: `${crypto.randomUUID()}${crypto.randomUUID()}` }
  if (memory.size >= 100) memory.delete(memory.keys().next().value!)
  memory.set(storageKey, { fingerprint, ...identity })
  try { sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, ...identity })) } catch { /* No form PII is persisted. */ }
  return identity
}

/** A confirmed success ends this intent; a lost/failed response keeps its retry identity. */
export function completeBookingRequest(scope: string) {
  const key = `booking-request:${scope}`
  memory.delete(key)
  try { sessionStorage.removeItem(key) } catch { /* Storage may be unavailable. */ }
}
