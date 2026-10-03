import { createHmac, timingSafeEqual } from "crypto"

/**
 * Confirmation code for a Meta data deletion request: `LD-<issued at, base36>-<signature>`.
 *
 * Meta shows it to the person and links them to our status page with it. Signing the code over its
 * own timestamp lets that page answer without storing anything, and lets it tell a code we issued
 * from one somebody typed — an unknown code must never read as "request received".
 */
function sign(body: string): string {
  const secret = process.env.NEXTAUTH_SECRET || "ld-meta-data-deletion"
  return createHmac("sha256", secret).update(`meta-data-deletion:${body}`).digest("hex").slice(0, 12).toUpperCase()
}

export function makeDeletionConfirmationCode(issuedAt: number): string {
  const body = Math.floor(issuedAt).toString(36).toUpperCase()
  return `LD-${body}-${sign(body)}`
}

/** The issue time of a code we signed, or null for anything else. */
export function readDeletionConfirmationCode(code: string | null | undefined): number | null {
  const match = /^LD-([0-9A-Z]{1,12})-([0-9A-F]{12})$/.exec((code || "").trim())
  if (!match) return null
  const expected = Buffer.from(sign(match[1]))
  const given = Buffer.from(match[2])
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const issuedAt = parseInt(match[1], 36)
  return Number.isFinite(issuedAt) ? issuedAt : null
}
