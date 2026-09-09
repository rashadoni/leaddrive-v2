/**
 * Payload validator — N14 Phase 5 slice 1.
 *
 * Validates an incoming publish payload against the
 * `PlatformEventDefinition.fields` spec. Returns a normalised payload
 * (booleans / numbers / timestamps coerced from strings if needed)
 * on success, list of error messages on failure.
 *
 * Pure synchronous. No I/O. Used by:
 *   - POST /api/v1/platform-events/publish (slice 1 manual path)
 *   - Apex sandbox bridge (slice 2 — when crm.events.publish lands)
 *   - CDC middleware (slice 2 — validates the auto-built payload too)
 */
import {
  MAX_PAYLOAD_BYTES,
  type FieldSpec,
  type FieldType,
  type ValidationResult,
} from "./types"

const MAX_STRING_LENGTH_DEFAULT = 2000

/**
 * Defensive runtime parser for a definition's fields blob. Accepts
 * a JSONB value (typed unknown) and either returns the typed
 * FieldSpec[] or throws. Caller catches and surfaces as 422 / "invalid
 * definition" — we never let a malformed definition produce silently
 * wrong payload validation.
 */
export function parseFieldSpecs(raw: unknown): FieldSpec[] {
  if (!Array.isArray(raw)) {
    throw new Error("fields must be an array")
  }
  if (raw.length === 0) {
    throw new Error("fields must declare at least one field")
  }
  const seen = new Set<string>()
  const out: FieldSpec[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new Error("fields entry must be an object")
    }
    const obj = entry as Record<string, unknown>
    const name = obj.name
    const type = obj.type
    const required = obj.required
    const maxLength = obj.maxLength
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("fields entry missing string `name`")
    }
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
      throw new Error(`fields entry "${name}" — name must be a valid identifier`)
    }
    if (seen.has(name)) {
      throw new Error(`fields entry "${name}" — duplicate`)
    }
    seen.add(name)
    if (
      type !== "string" &&
      type !== "number" &&
      type !== "boolean" &&
      type !== "timestamp" &&
      type !== "json"
    ) {
      throw new Error(`fields entry "${name}" — unknown type "${String(type)}"`)
    }
    if (typeof required !== "boolean") {
      throw new Error(`fields entry "${name}" — required must be boolean`)
    }
    let ml: number | undefined
    if (maxLength !== undefined) {
      if (typeof maxLength !== "number" || !Number.isFinite(maxLength) || maxLength <= 0) {
        throw new Error(`fields entry "${name}" — maxLength must be a positive number`)
      }
      ml = Math.floor(maxLength)
    }
    out.push({ name, type: type as FieldType, required, maxLength: ml })
  }
  return out
}

/**
 * Validate a raw publish payload against a spec. Returns
 * `{ ok: true, payload }` with coerced values on success, or
 * `{ ok: false, errors }` (all errors collected — caller may surface
 * the first or all of them).
 */
export function validatePayload(
  raw: unknown,
  specs: readonly FieldSpec[]
): ValidationResult {
  const errors: string[] = []
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["payload must be an object"] }
  }
  const input = raw as Record<string, unknown>

  // Reject extra fields not declared in the spec — Salesforce-style
  // strict schema. Tenant must redefine to add a new field.
  const allowed = new Set(specs.map(s => s.name))
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      errors.push(`unknown field "${key}"`)
    }
  }

  const normalised: Record<string, unknown> = {}
  for (const spec of specs) {
    const value = input[spec.name]
    // Distinguish 4 cases:
    //   undefined / key-absent → "missing"
    //   null                   → "missing" too — explicit null is
    //                             collapsed with absence. This matches
    //                             Stripe + Segment webhook conventions
    //                             (and is intentionally narrower than
    //                             Salesforce CDC, which emits explicit
    //                             null for cleared fields; slice 2's
    //                             CDC bridge will sentinel-encode that
    //                             case before reaching this validator).
    //   false / 0 / ""         → PRESENT (falsy but valid scalar values
    //                             for boolean / number / string fields).
    //                             A naïve `if (!value)` would drop them.
    //   any other value        → present
    const isMissing = value === undefined || value === null
    if (isMissing) {
      if (spec.required) {
        errors.push(`missing required field "${spec.name}"`)
      }
      // Absent optional fields are omitted from the normalised payload
      // (not stored as `null`) so the JSON column stays tight.
      continue
    }
    const coerced = coerceField(spec, value, errors)
    if (coerced !== undefined) {
      normalised[spec.name] = coerced
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  // Final size guard — even a fully-valid payload that bloats past
  // the column budget is rejected. Slice 2's CDC publisher trims
  // record snapshots before reaching here.
  const serialised = JSON.stringify(normalised)
  if (serialised.length > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      errors: [`payload exceeds ${MAX_PAYLOAD_BYTES} bytes (got ${serialised.length})`],
    }
  }

  return { ok: true, payload: normalised }
}

function coerceField(
  spec: FieldSpec,
  value: unknown,
  errors: string[]
): unknown | undefined {
  switch (spec.type) {
    case "string": {
      if (typeof value !== "string") {
        errors.push(`field "${spec.name}" must be a string`)
        return undefined
      }
      const limit = spec.maxLength ?? MAX_STRING_LENGTH_DEFAULT
      if (value.length > limit) {
        errors.push(`field "${spec.name}" exceeds maxLength ${limit}`)
        return undefined
      }
      return value
    }
    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) return value
      if (typeof value === "string") {
        const n = Number(value.trim())
        if (Number.isFinite(n)) return n
      }
      errors.push(`field "${spec.name}" must be a finite number`)
      return undefined
    }
    case "boolean": {
      if (typeof value === "boolean") return value
      if (value === "true") return true
      if (value === "false") return false
      errors.push(`field "${spec.name}" must be a boolean`)
      return undefined
    }
    case "timestamp": {
      if (value instanceof Date) {
        return value.toISOString()
      }
      if (typeof value === "string") {
        const t = Date.parse(value)
        if (!Number.isNaN(t)) return new Date(t).toISOString()
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return new Date(value).toISOString()
      }
      errors.push(`field "${spec.name}" must be an ISO-8601 string, epoch ms number, or Date`)
      return undefined
    }
    case "json": {
      // Accept anything JSON-representable; reject non-serialisable
      // (functions, undefined-only objects, BigInt, circular).
      //
      // Caveat: JSON.stringify silently drops `undefined` properties +
      // function-typed values inside nested objects. `{a: undefined, b: 1}`
      // round-trips to `{b: 1}`. This matches RFC 8259 (JSON has no
      // `undefined`), and we accept it without warning — callers are
      // expected to either omit undefined keys upstream or convert
      // them to explicit `null`. Slice 2's CDC publisher (planned at
      // `src/lib/platform-events/cdc-emitter.ts`) owns that
      // conversion before reaching this validator; first-party API
      // callers should sanitise upstream of their POST.
      try {
        const serialised = JSON.stringify(value)
        if (serialised === undefined) {
          errors.push(`field "${spec.name}" must be JSON-serialisable`)
          return undefined
        }
        return JSON.parse(serialised)
      } catch (e) {
        errors.push(
          `field "${spec.name}" — JSON serialisation failed: ${e instanceof Error ? e.message : String(e)}`
        )
        return undefined
      }
    }
    default: {
      const exhaustive: never = spec.type
      throw new Error(`Unhandled field type: ${exhaustive}`)
    }
  }
}
