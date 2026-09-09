import crypto from "crypto"

// Builds a tracked Reply-To address so inbound replies can be routed back to a
// specific ticket/contact without relying on From/Subject heuristics. The id is
// HMAC-signed with NEXTAUTH_SECRET so a malicious sender can't spoof another
// tenant's ticket id.
//
//   ticket+{id}.{hmac6}@{EMAIL_REPLY_DOMAIN}
//
// Example:
//   buildReplyTo({ kind: "ticket", id: "cmo5..." })
//   → "ticket+cmo5...a1b2c3@leaddrivecrm.org"

const SECRET = process.env.NEXTAUTH_SECRET || "dev-secret"
/** The ONE reply-domain default — sequence-threading mints its Message-IDs on the same host. */
export const EMAIL_REPLY_DOMAIN = process.env.EMAIL_REPLY_DOMAIN || "leaddrivecrm.org"
const DOMAIN = EMAIL_REPLY_DOMAIN

export type ReplyKind = "ticket" | "contact"

export function signReplyId(id: string): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(id)
    .digest("hex")
    .slice(0, 10)
}

export function buildReplyTo(params: { kind: ReplyKind; id: string }): string {
  const sig = signReplyId(params.id)
  return `${params.kind}+${params.id}.${sig}@${DOMAIN}`
}

export type ParsedReplyTo =
  | { ok: true; kind: ReplyKind; id: string }
  | { ok: false; reason: "bad_format" | "bad_hmac" | "wrong_domain" }

// Accepts either a bare "ticket+xxx@domain" or a full "Name <ticket+xxx@domain>".
export function parseReplyTo(address: string): ParsedReplyTo {
  const angle = address.match(/<([^>]+)>/)
  const raw = (angle ? angle[1] : address).trim().toLowerCase()

  const m = raw.match(/^(ticket|contact)\+([^.]+)\.([a-f0-9]{10})@(.+)$/)
  if (!m) return { ok: false, reason: "bad_format" }

  const [, kind, id, hmac, domain] = m
  if (domain !== DOMAIN.toLowerCase()) return { ok: false, reason: "wrong_domain" }
  if (signReplyId(id) !== hmac) return { ok: false, reason: "bad_hmac" }

  return { ok: true, kind: kind as ReplyKind, id }
}

// Given a raw "To:" value that may contain several addresses, returns the first
// address that parses as a valid reply-to token.
export function extractReplyToFromToHeader(toHeader: string): ParsedReplyTo | null {
  const candidates = toHeader.split(/[,;]\s*/)
  for (const c of candidates) {
    const parsed = parseReplyTo(c)
    if (parsed.ok) return parsed
  }
  return null
}
