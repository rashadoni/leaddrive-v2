/**
 * Identity-key normalization — G1 Phase 6 Block B slice 1.
 *
 * Given a source record's raw email / phone / name fields, produce
 * canonical lookup keys for the UnifiedProfile match path. The
 * merger uses normalized fields exclusively; display fields are
 * preserved separately.
 *
 * Rules:
 *   • email: lowercased + trimmed. Empty / null → null. RFC-822
 *     validation is INTENTIONALLY weak (regex requires `@` + non-
 *     empty local + domain with a `.` — that's it). Strict
 *     validation belongs at the form-input layer; this helper
 *     normalizes whatever made it past upstream filters.
 *
 *     ⚠️ XSS-REFLECTOR HAZARD for slice-2: the weak regex accepts
 *     `<script>@x.y` and similar injection strings. Slice-2
 *     `GET /api/v1/unified-profiles` JSON response + the 360-view UI
 *     MUST HTML-escape `emailNormalized` + `displayEmail` on render.
 *     JSON-encoding (auto-escaping `<`/`>`) is sufficient at the API;
 *     React's default text rendering covers the UI — but any
 *     `dangerouslySetInnerHTML` path that touches these fields is a CVE.
 *   • phone: E.164 detection — `+<country><number>` digits only.
 *     If input starts with `+`, accept as E.164 after digit-strip.
 *     If input has no `+` AND a `defaultCountry` hint is supplied,
 *     prepend the country's calling code (slice-1 supports a small
 *     hardcoded map; slice-2 may plug `libphonenumber-js`).
 *     Invalid / unparseable → null.
 *   • name: lowercased + collapsed whitespace + trimmed. Empty → null.
 *
 * Pure synchronous.
 */
import type { NormalizeIdentityInput, NormalizedIdentity } from "./types"

// `<` / `>` excluded from every part: defense-in-depth against an XSS-reflector
// since CDP ingests email from untrusted public Lead / WebChat forms (the weak
// RFC check otherwise admits `<script>@x.y`). Display/API layers already escape,
// but rejecting at normalize keeps the stored key clean regardless of downstream.
const EMAIL_REGEX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/**
 * Slice-1 country-code map for phone normalization fallback. Slice-2
 * should swap to `libphonenumber-js` for full coverage; this is a
 * pragmatic starter for our actual tenant footprint (AZ-headquartered
 * + EU/US prospects).
 */
const COUNTRY_DIAL_CODES: Readonly<Record<string, string>> = {
  AZ: "+994",
  RU: "+7",
  US: "+1",
  GB: "+44",
  DE: "+49",
  FR: "+33",
  TR: "+90",
  UA: "+380",
  PL: "+48",
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null
  if (trimmed.length > 254) return null // RFC 3696 hard limit
  if (!EMAIL_REGEX.test(trimmed)) return null
  return trimmed
}

function normalizePhone(
  raw: string | null | undefined,
  defaultCountry?: string
): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  // Already-E.164: starts with `+`, rest digits only.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/[\s()\-.]/g, "")
    if (!/^[0-9]+$/.test(digits)) return null
    if (digits.length < 7 || digits.length > 15) return null // E.164 length 1..15
    return `+${digits}`
  }

  // Local-format with country hint.
  if (defaultCountry) {
    const dialCode = COUNTRY_DIAL_CODES[defaultCountry.toUpperCase()]
    if (!dialCode) return null
    // Strip non-digit punctuation, also strip a SINGLE leading zero
    // (the trunk prefix — common in local formats: "050 123 45 67"
    // in AZ → "501234567" + "+994"). Architect note: a `.replace(/^0+/, "")`
    // would over-strip on inputs like "0050..." (malformed) AND on
    // future locales (post-slice-1 libphonenumber-js adoption) where
    // significant digits can follow the trunk prefix.
    const digits = trimmed.replace(/[\s()\-.]/g, "").replace(/^0/, "")
    if (!/^[0-9]+$/.test(digits)) return null
    if (digits.length < 6 || digits.length > 14) return null
    return `${dialCode}${digits}`
  }

  // No `+` prefix AND no country hint → cannot safely normalize.
  // Returning null is safer than guessing — guessing would land
  // a US "5551234567" as `+5551234567` which is country 555 (invalid).
  return null
}

function normalizeName(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const collapsed = raw.trim().replace(/\s+/g, " ").toLowerCase()
  if (collapsed.length === 0) return null
  if (collapsed.length > 256) return null // pragmatic cap
  return collapsed
}

export function normalizeIdentity(input: NormalizeIdentityInput): NormalizedIdentity {
  const emailNormalized = normalizeEmail(input.email)
  const phoneNormalized = normalizePhone(input.phone, input.defaultCountry)
  const nameNormalized = normalizeName(input.name)
  return {
    emailNormalized,
    phoneNormalized,
    nameNormalized,
    hasMatchableKey: emailNormalized !== null || phoneNormalized !== null,
  }
}

/**
 * Test-only export — slice-2 dev/test code may want to reach in for
 * the country map. Production callers should use `normalizeIdentity`.
 * @internal
 */
export const COUNTRY_DIAL_CODES_INTERNAL = COUNTRY_DIAL_CODES
