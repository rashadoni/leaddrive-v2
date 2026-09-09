/**
 * Audience payload builder — C3 slice 1.
 *
 * Builds provider-specific custom-audience payloads from a list of
 * CRM contacts. Each provider has its own schema:
 *
 *   facebook → schema: ["EMAIL", "PHONE", "FN", "LN", "ZIP", "COUNTRY"]
 *              row: parallel array of hashed strings (empty string when missing)
 *   google   → schema: ["hashed_email", "hashed_phone_number",
 *                       "hashed_first_name", "hashed_last_name",
 *                       "postal_code", "country_code"]
 *              row: parallel array (postal_code + country_code unhashed)
 *   linkedin → schema: ["sha256Email"] (LinkedIn match accepts email only)
 *              row: single hashed email
 *   tiktok   → schema: ["EMAIL_SHA256", "PHONE_SHA256"] (subset)
 *   twitter  → schema: ["EMAIL_SHA256", "PHONE_SHA256", "TWITTER_ID"]
 *              (TWITTER_ID skipped slice-1; helper sends empty string)
 *
 * Batches default to 10000 members per batch (FB max). Caller pushes
 * each batch as one POST to the provider's audience-members endpoint.
 *
 * Slice-2 will switch to provider-typed SDK calls; this slice produces
 * raw arrays so the dispatcher can choose between SDK + raw HTTP.
 *
 * Pure synchronous.
 */
import { hashPii, normalisePiiValue } from "./pii-hasher"
import {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  type AdProviderType,
  type AudienceBatch,
  type AudienceMember,
  type BuildAudiencePayloadInput,
  type BuildAudiencePayloadResult,
} from "./types"

/* ─── Per-provider schema definitions ─────────────────────────────────── */

interface ProviderSchema {
  fields: readonly string[]
  /** For each schema field, return the value string (or "" if absent). */
  rowBuilder: (m: AudienceMember) => string[]
}

function hashOrEmpty(kind: Parameters<typeof hashPii>[0]["kind"], raw: string | null | undefined): string {
  if (!raw) return ""
  const r = hashPii({ kind, value: raw })
  return r.ok ? r.sha256Hex : ""
}

const PROVIDER_SCHEMAS: Readonly<Record<AdProviderType, ProviderSchema>> = {
  facebook: {
    fields: ["EMAIL", "PHONE", "FN", "LN", "ZIP", "COUNTRY"],
    rowBuilder: (m) => [
      hashOrEmpty("email", m.email),
      hashOrEmpty("phone", m.phone),
      hashOrEmpty("first_name", m.firstName),
      hashOrEmpty("last_name", m.lastName),
      hashOrEmpty("zip", m.zip),
      hashOrEmpty("country", m.country),
    ],
  },
  google: {
    fields: [
      "hashed_email",
      "hashed_phone_number",
      "hashed_first_name",
      "hashed_last_name",
      "postal_code",
      "country_code",
    ],
    rowBuilder: (m) => [
      hashOrEmpty("email", m.email),
      hashOrEmpty("phone", m.phone),
      hashOrEmpty("first_name", m.firstName),
      hashOrEmpty("last_name", m.lastName),
      // Google accepts postal_code + country_code UNHASHED but
      // normalised. Reuse pii-hasher's normaliser — single source of
      // truth (architect-pass-1 close-out: previously duplicated inline).
      m.zip ? (normalisePiiValue("zip", m.zip) ?? "") : "",
      m.country ? (normalisePiiValue("country", m.country) ?? "") : "",
    ],
  },
  linkedin: {
    fields: ["sha256Email"],
    rowBuilder: (m) => [hashOrEmpty("email", m.email)],
  },
  tiktok: {
    fields: ["EMAIL_SHA256", "PHONE_SHA256"],
    rowBuilder: (m) => [hashOrEmpty("email", m.email), hashOrEmpty("phone", m.phone)],
  },
  twitter: {
    fields: ["EMAIL_SHA256", "PHONE_SHA256", "TWITTER_ID"],
    rowBuilder: (m) => [
      hashOrEmpty("email", m.email),
      hashOrEmpty("phone", m.phone),
      "", // slice-1: TWITTER_ID not yet ingested; slice-2 may extend AudienceMember
    ],
  },
}

/* ─── Main entry ──────────────────────────────────────────────────────── */

export function buildAudiencePayload(
  input: BuildAudiencePayloadInput
): BuildAudiencePayloadResult {
  const errors: string[] = []
  const schema = PROVIDER_SCHEMAS[input.providerType]
  if (!schema) {
    errors.push(`unknown providerType "${String(input.providerType)}"`)
    return { ok: false, errors }
  }
  if (typeof input.audienceName !== "string" || input.audienceName.length === 0) {
    errors.push("audienceName must be a non-empty string")
    return { ok: false, errors }
  }
  if (input.audienceName.length > 200) {
    errors.push("audienceName length exceeds 200")
    return { ok: false, errors }
  }
  if (!Array.isArray(input.members)) {
    errors.push("members must be an array")
    return { ok: false, errors }
  }

  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE
  if (typeof batchSize !== "number" || !Number.isInteger(batchSize) || batchSize <= 0) {
    errors.push("batchSize must be a positive integer")
    return { ok: false, errors }
  }
  if (batchSize > MAX_BATCH_SIZE) {
    errors.push(`batchSize ${batchSize} exceeds MAX_BATCH_SIZE ${MAX_BATCH_SIZE}`)
    return { ok: false, errors }
  }

  // Build rows, dropping members with NO match-keys for this provider.
  // Architect-pass-1 close-out: distinguish `unmatchableCount` (legit
  // contacts without PII the provider matches) from `invalidCount`
  // (malformed inputs — caller bug) so slice-2 dispatcher can alarm
  // on the latter without conflating with the former.
  let unmatchableCount = 0
  let invalidCount = 0
  const rows: string[][] = []
  for (const m of input.members) {
    if (!m || typeof m !== "object") {
      invalidCount += 1
      continue
    }
    const row = schema.rowBuilder(m)
    // If every field is empty string, the member contributed no match
    // keys — skip from payload but count.
    if (row.every((v) => v === "")) {
      unmatchableCount += 1
      continue
    }
    rows.push(row)
  }

  // Batch.
  const batches: AudienceBatch[] = []
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push({
      schema: schema.fields,
      data: rows.slice(i, i + batchSize),
    })
  }
  // Emit at least one empty batch if members had ANY content (even if
  // all unmatchable) — caller may want to create an empty audience.
  // Actually slice-1 convention: zero batches if zero rows. Caller
  // can decide whether to create an empty audience or skip.

  return {
    ok: true,
    providerType: input.providerType,
    audienceName: input.audienceName,
    batches,
    unmatchableCount,
    invalidCount,
  }
}
