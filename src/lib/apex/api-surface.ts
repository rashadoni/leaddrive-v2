/**
 * `crm.*` API surface builder — N3 Phase 5 slice 1.
 *
 * Assembles the global the sandbox sees. The actual repositories are
 * DI'd by the caller — the route plugs in Prisma-backed ones; tests
 * plug in mocks. Logger captures `crm.log` calls into an in-memory
 * buffer the engine drains after the handler returns.
 *
 * The returned object is *frozen at every level* before being handed
 * to the sandbox so handler code can't replace methods to escape the
 * boundary (e.g. `crm.deals.find = () => { /* exfiltrate *\/ }`).
 */
import type {
  CodeContext,
  ContactRepository,
  CrmApiSurface,
  DealRepository,
  SandboxLogger,
} from "./types"

/**
 * Recursively `Object.freeze` a value. Walks plain objects, arrays,
 * and nested arrays (`event.matrix[0][1]` is reachable). Stops at
 * primitives + Dates (already immutable from the sandbox's POV).
 *
 * Throws on Map / Set: those carry their own mutation methods
 * (`.set`/`.add`) that Object.freeze does NOT lock, so silently
 * passing one through would let a handler mutate it. Caller must
 * convert to a plain object/array before placing it on
 * `context.event`.
 *
 * Slice-1 cost: O(n) per execution (clones every property). Slice 2's
 * isolated-vm swap replaces this with a persistent frozen snapshot
 * cached per event type.
 */
function deepFreezeValue(value: unknown): unknown {
  if (value == null) return value
  if (typeof value !== "object") return value
  if (value instanceof Date) return value
  if (value instanceof Map || value instanceof Set) {
    throw new Error(
      "Map/Set values in crm.context.event are not supported (would bypass deep-freeze). Convert to a plain object/array first."
    )
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => deepFreezeValue(item)))
  }
  const cloned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    cloned[k] = deepFreezeValue(v)
  }
  return Object.freeze(cloned)
}

function deepFreeze<T extends Record<string, unknown>>(obj: T): T {
  return deepFreezeValue(obj) as T
}

export function createSandboxLogger(maxLines: number): SandboxLogger {
  const captured: string[] = []
  return {
    log(message: string) {
      if (captured.length >= maxLines) {
        // Hard cap — silently drop further lines. The first overflow
        // line is a marker so the user knows truncation happened.
        if (captured.length === maxLines) {
          captured.push(`[…log output truncated at ${maxLines} lines]`)
        }
        return
      }
      // Coerce to string deterministically — handler may pass anything.
      const line = typeof message === "string" ? message : safeStringify(message)
      captured.push(line)
    },
    get lines() {
      return captured
    },
  }
}

/**
 * Coerce arbitrary handler values into a single-line string suitable
 * for the log column. Objects use JSON; circular refs fall back to
 * String(). Errors include their message + first stack frame.
 */
function safeStringify(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value instanceof Error) {
    const first = (value.stack ?? "").split("\n")[1]?.trim()
    return first ? `${value.message} (${first})` : value.message
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export interface ApiSurfaceInput {
  deals: DealRepository
  contacts: ContactRepository
  logger: SandboxLogger
  context: CodeContext
}

/**
 * Build the frozen `crm` global. Every method is `Object.freeze`d so
 * the handler can call them but can't reassign them. The whole
 * surface is then `Object.freeze`d at the root.
 */
export function buildApiSurface(input: ApiSurfaceInput): CrmApiSurface {
  // Freeze each sub-repository so handlers can't swap methods.
  const dealsFrozen: DealRepository = Object.freeze({
    find: input.deals.find.bind(input.deals),
    create: input.deals.create.bind(input.deals),
    update: input.deals.update.bind(input.deals),
  })
  const contactsFrozen: ContactRepository = Object.freeze({
    find: input.contacts.find.bind(input.contacts),
    create: input.contacts.create.bind(input.contacts),
    update: input.contacts.update.bind(input.contacts),
  })
  // Freeze context (already declared readonly in the type — make it
  // structurally immutable too so the handler can't tamper with it
  // even via property assignment). The `event` payload is
  // *deep*-frozen because slice 2 record-event triggers pass nested
  // record snapshots, and a shallow freeze would let handlers mutate
  // nested fields (e.g. `crm.context.event.deal.stage = "won"`) which
  // would corrupt the event log if the engine later persists it.
  const contextFrozen: CodeContext = Object.freeze({
    organizationId: input.context.organizationId,
    userId: input.context.userId,
    trigger: input.context.trigger,
    event: input.context.event ? deepFreeze(input.context.event) : undefined,
  })

  return Object.freeze({
    deals: dealsFrozen,
    contacts: contactsFrozen,
    log: input.logger.log.bind(input.logger),
    context: contextFrozen,
  })
}
