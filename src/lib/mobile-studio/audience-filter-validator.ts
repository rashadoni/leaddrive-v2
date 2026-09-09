/**
 * Audience filter validator — C2 slice 1.
 *
 * Validates the JSONB `audienceFilter` blob on MobileCampaign. Shape
 * is a small predicate set — slice-2 may extend with attribute
 * predicates / recency / etc., gated by this validator.
 *
 *   {
 *     contactTags?:        string[]
 *     segmentSlugs?:       string[]
 *     channelOptIn?:       'push' | 'in_app' | 'sms'
 *     excludeContactIds?:  string[]
 *   }
 *
 * Defense-in-depth:
 *   • Object.prototype.hasOwnProperty.call on field reads.
 *   • Array bounds (≤ 256 tags, ≤ 64 segments, ≤ 10000 excludes).
 *   • String-length caps per element.
 *   • Forbidden-token guard on identifier-like fields.
 *
 * Pure synchronous. Discriminated-union return.
 */
import {
  MOBILE_CHANNELS,
  type AudienceFilter,
  type MobileChannel,
  type ValidateAudienceFilterInput,
  type ValidateAudienceFilterResult,
} from "./types"

const MAX_TAGS = 256
const MAX_SEGMENTS = 64
const MAX_EXCLUDES = 10_000
const MAX_TAG_CHARS = 128
const MAX_SLUG_CHARS = 64
const MAX_ID_CHARS = 64

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function has(o: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

function validateStringArray(
  raw: unknown,
  fieldName: string,
  maxLength: number,
  maxItemChars: number,
  errors: string[]
): string[] | null {
  if (!Array.isArray(raw)) {
    errors.push(`${fieldName} must be an array`)
    return null
  }
  if (raw.length > maxLength) {
    errors.push(`${fieldName} has ${raw.length} items — exceeds max ${maxLength}`)
    return null
  }
  const result: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]
    if (typeof v !== "string" || v.length === 0) {
      errors.push(`${fieldName}[${i}] must be a non-empty string`)
      return null
    }
    if (v.length > maxItemChars) {
      errors.push(`${fieldName}[${i}] length ${v.length} exceeds ${maxItemChars}`)
      return null
    }
    if (FORBIDDEN_KEYS.has(v)) {
      errors.push(`${fieldName}[${i}] "${v}" is reserved (JS prototype chain)`)
      return null
    }
    result.push(v)
  }
  return result
}

export function validateAudienceFilter(
  input: ValidateAudienceFilterInput
): ValidateAudienceFilterResult {
  const errors: string[] = []
  if (!isPlainObject(input.filter)) {
    return { ok: false, errors: ["filter must be a plain object"] }
  }
  const raw = input.filter
  const out: AudienceFilter = {}

  // Reject any top-level forbidden key — JSONB columns can serialize
  // arbitrary keys. Defense-in-depth.
  for (const k of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(k)) {
      errors.push(`filter top-level key "${k}" is reserved`)
      return { ok: false, errors }
    }
  }

  if (has(raw, "contactTags")) {
    const tags = validateStringArray(raw.contactTags, "filter.contactTags", MAX_TAGS, MAX_TAG_CHARS, errors)
    if (tags === null) return { ok: false, errors }
    out.contactTags = tags
  }

  if (has(raw, "segmentSlugs")) {
    const slugs = validateStringArray(
      raw.segmentSlugs,
      "filter.segmentSlugs",
      MAX_SEGMENTS,
      MAX_SLUG_CHARS,
      errors
    )
    if (slugs === null) return { ok: false, errors }
    // Slug shape — alphanumeric + hyphen + underscore.
    for (let i = 0; i < slugs.length; i++) {
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slugs[i])) {
        errors.push(`filter.segmentSlugs[${i}] "${slugs[i]}" is not a valid slug`)
        return { ok: false, errors }
      }
    }
    out.segmentSlugs = slugs
  }

  if (has(raw, "channelOptIn")) {
    if (typeof raw.channelOptIn !== "string") {
      errors.push("filter.channelOptIn must be a string")
      return { ok: false, errors }
    }
    if (!(MOBILE_CHANNELS as readonly string[]).includes(raw.channelOptIn)) {
      errors.push(
        `filter.channelOptIn "${raw.channelOptIn}" not in ${MOBILE_CHANNELS.join("/")}`
      )
      return { ok: false, errors }
    }
    out.channelOptIn = raw.channelOptIn as MobileChannel
  }

  if (has(raw, "excludeContactIds")) {
    const ids = validateStringArray(
      raw.excludeContactIds,
      "filter.excludeContactIds",
      MAX_EXCLUDES,
      MAX_ID_CHARS,
      errors
    )
    if (ids === null) return { ok: false, errors }
    out.excludeContactIds = ids
  }

  return { ok: true, filter: out }
}
