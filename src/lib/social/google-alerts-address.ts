import crypto from "crypto"
import { EMAIL_REPLY_DOMAIN } from "@/lib/email-reply-address"

const ADDRESS_PREFIX = "google-alerts"
const SIGNATURE_LENGTH = 10

function secret(): string {
  return process.env.NEXTAUTH_SECRET || "dev-secret"
}

function signatureForOrganization(organizationId: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`google-alerts:${organizationId}`)
    .digest("hex")
    .slice(0, SIGNATURE_LENGTH)
}

export function buildGoogleAlertsAddress(organizationId: string): string {
  return `${ADDRESS_PREFIX}+${organizationId}.${signatureForOrganization(organizationId)}@${EMAIL_REPLY_DOMAIN}`
}

export type ParsedGoogleAlertsAddress =
  | { ok: true; organizationId: string }
  | { ok: false; reason: "bad_format" | "bad_hmac" | "wrong_domain" }

export function parseGoogleAlertsAddress(address: string): ParsedGoogleAlertsAddress {
  const angle = address.match(/<([^>]+)>/)
  const raw = (angle ? angle[1] : address).trim().toLowerCase()
  const match = raw.match(/^google-alerts\+([^.@\s]+)\.([a-f0-9]{10})@([^>\s]+)$/)
  if (!match) return { ok: false, reason: "bad_format" }

  const [, organizationId, suppliedSignature, domain] = match
  if (domain !== EMAIL_REPLY_DOMAIN.toLowerCase()) {
    return { ok: false, reason: "wrong_domain" }
  }

  const expected = Buffer.from(signatureForOrganization(organizationId), "utf8")
  const supplied = Buffer.from(suppliedSignature, "utf8")
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return { ok: false, reason: "bad_hmac" }
  }

  return { ok: true, organizationId }
}

export function extractGoogleAlertsAddress(toHeader: string): ParsedGoogleAlertsAddress | null {
  for (const candidate of toHeader.split(/[,;]\s*/u)) {
    const parsed = parseGoogleAlertsAddress(candidate)
    if (parsed.ok) return parsed
  }
  return null
}
