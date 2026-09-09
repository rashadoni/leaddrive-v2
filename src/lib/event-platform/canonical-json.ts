import { createHash } from "node:crypto"

/** JSON value accepted by event envelopes and command hashes. */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

/**
 * Deterministic JSON for command/effect idempotency hashes.
 *
 * Object keys are recursively sorted. Undefined object properties are omitted
 * exactly like JSON.stringify; undefined array entries become null. Non-finite
 * numbers and cyclic structures fail closed instead of producing an unstable
 * key. Domain-event integrity hashes are independently computed by PostgreSQL
 * from jsonb in the insert trigger.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>(), false))
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")
}

function normalize(value: unknown, seen: Set<object>, inArray: boolean): CanonicalJsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON rejects non-finite numbers")
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === "bigint") return value.toString()
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return inArray ? null : undefined
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("canonical JSON rejects invalid dates")
    return value.toISOString()
  }
  if (typeof value !== "object") throw new TypeError("unsupported canonical JSON value")
  if (seen.has(value)) throw new TypeError("canonical JSON rejects cyclic values")

  // Prisma.Decimal and other safe value objects expose a primitive JSON value.
  const toJson = (value as { toJSON?: () => unknown }).toJSON
  if (!Array.isArray(value) && typeof toJson === "function") {
    const converted = toJson.call(value)
    if (converted !== value) return normalize(converted, seen, inArray)
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalize(entry, seen, true) ?? null)
    }

    const result: Record<string, CanonicalJsonValue> = {}
    for (const key of Object.keys(value).sort()) {
      const normalized = normalize((value as Record<string, unknown>)[key], seen, false)
      if (normalized !== undefined) result[key] = normalized
    }
    return result
  } finally {
    seen.delete(value)
  }
}
