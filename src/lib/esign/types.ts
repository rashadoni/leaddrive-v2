/**
 * E-Signature types — M6 Phase 6 Block C slice 1.
 *
 * Salesforce E-Sign / DocuSign analogue. Shared shape between five
 * pure helpers:
 *   1. state-machine         — envelope + signer status transitions
 *   2. token-issuer          — HMAC signing-link tokens
 *   3. signature-validator   — submitted-signature payload checks
 *   4. audit-event-builder   — append-only event record constructor
 *   5. (re-exported)         — typed I/O for slice-2 caller code
 *
 * Pure — no Prisma imports.
 */

/* ─── Envelope status ─────────────────────────────────────────────────── */

/**
 * Envelope lifecycle. State-machine helper enforces transitions.
 *
 *   created      — drafted in CRM, not yet sent
 *   sent         — emails dispatched to signers
 *   in_progress  — first signer viewed or signed
 *   completed    — all `role=signer` parties signed
 *   declined     — any signer declined
 *   voided       — sender cancelled (any pre-terminal state)
 *   expired      — `expiresAt` elapsed; cron-driven (slice 2)
 */
export const ENVELOPE_STATUSES = [
  "created",
  "sent",
  "in_progress",
  "completed",
  "declined",
  "voided",
  "expired",
] as const

export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number]

/**
 * Envelope transition table. Terminal: completed / declined / voided / expired.
 *
 *   created → sent | voided
 *   sent → in_progress | voided | expired | declined
 *     (declined directly from sent is allowed because a signer can
 *      decline before opening the link if they hit the email's
 *      "decline" CTA — slice 2 wires that path.)
 *   in_progress → completed | declined | voided | expired
 *   completed / declined / voided / expired → []
 */
export const ENVELOPE_TRANSITIONS: Readonly<
  Record<EnvelopeStatus, readonly EnvelopeStatus[]>
> = {
  created: ["sent", "voided"],
  sent: ["in_progress", "voided", "expired", "declined"],
  in_progress: ["completed", "declined", "voided", "expired"],
  completed: [],
  declined: [],
  voided: [],
  expired: [],
}

/* ─── Signer status ───────────────────────────────────────────────────── */

/**
 * Signer lifecycle (per-row). Independent of envelope status but
 * envelope-completion math reads ALL signer rows.
 *
 *   pending → sent (envelope.sent triggers per-signer dispatch)
 *   sent → viewed (signer opened /sign/[token] in browser)
 *   sent | viewed → signed | declined | expired
 *   signed | declined | expired → []
 */
export const SIGNER_STATUSES = [
  "pending",
  "sent",
  "viewed",
  "signed",
  "declined",
  "expired",
] as const

export type SignerStatus = (typeof SIGNER_STATUSES)[number]

export const SIGNER_TRANSITIONS: Readonly<
  Record<SignerStatus, readonly SignerStatus[]>
> = {
  pending: ["sent"],
  sent: ["viewed", "signed", "declined", "expired"],
  viewed: ["signed", "declined", "expired"],
  signed: [],
  declined: [],
  expired: [],
}

/* ─── Signer role ─────────────────────────────────────────────────────── */

export const SIGNER_ROLES = ["signer", "cc", "copy"] as const
export type SignerRole = (typeof SIGNER_ROLES)[number]

/* ─── Signature method + payload shapes ───────────────────────────────── */

export const SIGNATURE_METHODS = ["drawn", "typed", "uploaded"] as const
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number]

/**
 * Method-specific payload shapes. Validator helper checks the
 * presented payload against the declared method.
 */
export interface DrawnSignaturePayload {
  /** SVG path data; validator enforces a reasonable length cap (anti-DoS). */
  svgPath: string
  widthPx: number
  heightPx: number
}

export interface TypedSignaturePayload {
  typedName: string
  /** Font slug — e.g. "dancing-script", "great-vibes". UI-side allowlist. */
  font: string
}

export interface UploadedSignaturePayload {
  /** Reference to a previously-uploaded file blob (slice-2 storage). */
  fileRefId: string
}

export type SignaturePayload =
  | DrawnSignaturePayload
  | TypedSignaturePayload
  | UploadedSignaturePayload

/* ─── Token issuer ────────────────────────────────────────────────────── */

/**
 * Token-payload claims. Slice 2 adds `jti` (per-issuance nonce) so that
 * re-issuing with the same {eid, sid, exp} produces a different token +
 * hash → old links die on rotation. `jti` is optional for backward-compat
 * with pre-nonce tokens already in circulation; verifyToken accepts both.
 */
export interface TokenClaims {
  /** Envelope id. */
  eid: string
  /** Signer id. */
  sid: string
  /** Unix seconds. */
  exp: number
  /**
   * FIX 1: Per-issuance random nonce (16-byte hex). Makes every issueToken
   * call produce a unique payload → unique HMAC → unique tokenHash stored in DB.
   * Absence is allowed (backward-compat with pre-nonce tokens in flight).
   */
  jti?: string
}

export interface IssueTokenInput {
  claims: TokenClaims
  /**
   * Server-side secret. Slice-2 caller injects from env (`ESIGN_SECRET`).
   * Helper is pure: same input → same output. Test fixtures use a
   * deterministic test secret.
   */
  secret: string
}

export interface IssueTokenResult {
  /** Plaintext token — emailed to signer in /sign/[token] link. */
  token: string
  /** HMAC hash stored in `esign_signers.tokenHash` — verifier compares with constant-time. */
  tokenHash: string
}

export interface VerifyTokenInput {
  token: string
  secret: string
  /** Caller-supplied now() for testability. Defaults to actual now if not provided. */
  asOfUnix?: number
}

export type VerifyTokenResult =
  | { ok: true; claims: TokenClaims; tokenHash: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "invalid_payload" }

/* ─── Signature validator ─────────────────────────────────────────────── */

export interface ValidateSignatureInput {
  method: SignatureMethod
  payload: unknown
  /**
   * Max sizes — defended against blob DoS. Slice-2 caller can tune
   * via tenant config; defaults from `DEFAULT_SIGNATURE_LIMITS`.
   */
  limits?: Partial<SignatureLimits>
}

export interface SignatureLimits {
  /** Max characters in svgPath (drawn). */
  maxSvgPathChars: number
  /** Max chars in typedName. */
  maxTypedNameChars: number
  /** Pixel-dimension bounds. */
  maxWidthPx: number
  maxHeightPx: number
  /** Min/max font slug length. */
  maxFontSlugChars: number
}

export const DEFAULT_SIGNATURE_LIMITS: Readonly<SignatureLimits> = {
  maxSvgPathChars: 50_000,
  maxTypedNameChars: 200,
  maxWidthPx: 4000,
  maxHeightPx: 2000,
  maxFontSlugChars: 64,
}

export type ValidateSignatureResult =
  | { ok: true; payload: SignaturePayload }
  | { ok: false; errors: string[] }

/* ─── Audit event constructor ─────────────────────────────────────────── */

export const AUDIT_EVENT_TYPES = [
  "envelope_created",
  "envelope_sent",
  "envelope_voided",
  "envelope_declined",
  "envelope_expired",
  "envelope_completed",
  "signer_invited",
  "signer_viewed",
  "signer_signed",
  "signer_declined",
  "signer_expired",
  "token_issued",
  "token_verified_ok",
  "token_verified_failed",
] as const

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

export const AUDIT_ACTOR_TYPES = ["user", "signer", "system"] as const
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number]

export interface BuildAuditEventInput {
  organizationId: string
  envelopeId: string
  /** Required for signer_* events; null for envelope_* and system events. */
  signerId?: string | null
  eventType: AuditEventType
  actorType: AuditActorType
  /** Required for actorType='user'|'signer'; null/undefined for 'system'. */
  actorId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  /** Per-event payload — caller supplies. Stored as JSONB. */
  metadata?: Readonly<Record<string, unknown>>
  /** Caller-supplied timestamp for testability. */
  at: Date
}

export interface AuditEventRecord {
  organizationId: string
  envelopeId: string
  signerId: string | null
  eventType: AuditEventType
  actorType: AuditActorType
  actorId: string | null
  ipAddress: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
  createdAt: Date
}

export type BuildAuditEventResult =
  | { ok: true; record: AuditEventRecord }
  | { ok: false; error: string }
