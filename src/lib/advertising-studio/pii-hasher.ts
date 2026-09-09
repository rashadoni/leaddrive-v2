/**
 * PII hasher — C3 Phase 6 Block G second slice.
 *
 * Normalises and SHA-256 hashes contact identifiers per FB Custom
 * Audiences + Google Customer Match requirements. Both providers
 * accept the same hash format (lowercase, trimmed, SHA-256 hex)
 * for emails / phones / names / postal codes.
 *
 * Normalisation rules:
 *   email      — trim + lowercase
 *   phone      — strip ALL non-digit, prefix "+" if missing country code
 *                (caller responsibility: pass E.164-friendly input)
 *   first_name — trim + lowercase + strip diacritics + strip non-letters
 *   last_name  — same as first_name
 *   zip        — trim + lowercase; FB/Google require US 5-digit, others
 *                country-specific (slice-2 may add per-country branches)
 *   country    — trim + lowercase (ISO-3166-1 alpha-2)
 *
 * Pure synchronous. Uses Node `crypto.createHash` — no deps.
 */
import { createHash } from "crypto"
import type { HashPiiInput, HashPiiResult, PiiKind } from "./types"

const SUPPORTED_KINDS: ReadonlySet<PiiKind> = new Set<PiiKind>([
  "email",
  "phone",
  "first_name",
  "last_name",
  "zip",
  "country",
])

/* ─── Normalisation ───────────────────────────────────────────────────── */

function normaliseEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null
  // Loose RFC sanity — must contain '@' and a dot in the domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null
  return trimmed
}

function normalisePhone(raw: string): string | null {
  // Strip all non-digit and non-plus.
  const stripped = raw.replace(/[^\d+]/g, "")
  if (stripped.length === 0) return null
  // If raw starts with +, preserve it; otherwise require at least 7
  // digits (loose; caller should pass full E.164).
  const digits = stripped.replace(/\+/g, "")
  if (digits.length < 7) return null
  // FB / Google expect "+" prefix; auto-prefix if missing.
  if (stripped.startsWith("+")) return stripped
  return `+${digits}`
}

/**
 * Strip Unicode diacritics via NFD decomposition + combining-mark drop.
 * Then strip anything that isn't an ASCII letter.
 */
function normaliseName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null
  // NFD splits "é" into "e" + combining-acute. The U+0300..036F range
  // is "Combining Diacritical Marks" — strip them.
  const decomposed = trimmed.normalize("NFD")
  // U+0300..U+036F = Unicode "Combining Diacritical Marks" block.
  // Explicit codepoint range (not raw chars) — readable in grep / IDE.
  const stripped = decomposed.replace(/[\u0300-\u036F]/g, "")
  const lettersOnly = stripped.replace(/[^a-z]/g, "")
  if (lettersOnly.length === 0) return null
  return lettersOnly
}

function normaliseZip(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null
  // Strip spaces (UK postcodes like "SW1A 1AA" hash without space per FB).
  return trimmed.replace(/\s+/g, "")
}

function normaliseCountry(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.length === 0) return null
  // ISO 3166-1 alpha-2 exact shape (lowercased).
  if (!/^[a-z]{2}$/.test(trimmed)) return null
  return trimmed
}

function normalise(kind: PiiKind, raw: string): string | null {
  switch (kind) {
    case "email":
      return normaliseEmail(raw)
    case "phone":
      return normalisePhone(raw)
    case "first_name":
    case "last_name":
      return normaliseName(raw)
    case "zip":
      return normaliseZip(raw)
    case "country":
      return normaliseCountry(raw)
  }
}

/**
 * Export the kind-aware normaliser so callers (e.g. audience-payload-
 * builder Google path that wants normalised-but-unhashed postal_code +
 * country_code) reuse one source of truth. Architect-pass-1 close-out:
 * prevents drift when slice-2 tightens UK-postcode or country-code
 * rules — only one branch to update.
 *
 * Returns the normalised string or null if invalid.
 *
 * ASCII-only-letter limitation: `first_name` + `last_name` strip all
 * non-`[a-z]` AFTER NFD diacritic-collapse. Cyrillic/Chinese/Arabic
 * names that don't NFD-decompose to Latin are silently dropped (null
 * return → unmatchable). FB/Google docs accept transliterated input,
 * so caller is expected to pre-transliterate non-Latin scripts.
 */
export function normalisePiiValue(kind: PiiKind, raw: string): string | null {
  return normalise(kind, raw)
}

/* ─── Main entry ──────────────────────────────────────────────────────── */

export function hashPii(input: HashPiiInput): HashPiiResult {
  if (!SUPPORTED_KINDS.has(input.kind)) {
    return { ok: false, error: `unknown PII kind "${String(input.kind)}"` }
  }
  if (typeof input.value !== "string") {
    return { ok: false, error: "value must be a string" }
  }
  const normalised = normalise(input.kind, input.value)
  if (normalised === null) {
    return {
      ok: false,
      error: `value cannot be normalised for kind "${input.kind}" (empty / invalid format)`,
    }
  }
  const hex = createHash("sha256").update(normalised, "utf8").digest("hex")
  return { ok: true, sha256Hex: hex }
}
