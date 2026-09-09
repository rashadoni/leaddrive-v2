/**
 * In-memory typing-indicator store.
 * Per session we track BOTH roles independently (keyed as `${sessionId}:${role}`)
 * so visitor and agent typing don't collide. Each entry has an expiry; lazy GC
 * evicts expired entries; hard LRU cap prevents memory ballooning from spam.
 *
 * NOT shared across processes — for strict correctness in a multi-instance
 * deploy, back this with Redis.
 */

type Role = "visitor" | "agent"

interface TypingState {
  until: number
}

const MAX_ENTRIES = 5000
const map = new Map<string, TypingState>()
let lastGc = Date.now()

function key(sessionId: string, role: Role): string {
  return `${sessionId}:${role}`
}

function gc(now: number) {
  if (now - lastGc < 30_000) return
  lastGc = now
  for (const [k, v] of map) {
    if (v.until < now) map.delete(k)
  }
  // Hard cap: if still too big, drop oldest (Map preserves insertion order).
  while (map.size > MAX_ENTRIES) {
    const first = map.keys().next().value
    if (!first) break
    map.delete(first)
  }
}

export function setTyping(sessionId: string, role: Role, ttlMs = 4000): void {
  const now = Date.now()
  gc(now)
  map.set(key(sessionId, role), { until: now + ttlMs })
}

/**
 * Returns whose state is active RIGHT NOW for this session.
 * If both are active, agent takes priority (caller can choose).
 */
export function getTyping(sessionId: string): { role: Role } | null {
  const now = Date.now()
  const agent = map.get(key(sessionId, "agent"))
  if (agent && agent.until >= now) return { role: "agent" }
  if (agent) map.delete(key(sessionId, "agent"))
  const visitor = map.get(key(sessionId, "visitor"))
  if (visitor && visitor.until >= now) return { role: "visitor" }
  if (visitor) map.delete(key(sessionId, "visitor"))
  return null
}

export function clearTyping(sessionId: string): void {
  map.delete(key(sessionId, "visitor"))
  map.delete(key(sessionId, "agent"))
}
