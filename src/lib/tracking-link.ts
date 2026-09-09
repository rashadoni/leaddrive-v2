// src/lib/tracking-link.ts
import { timingSafeEqual } from "node:crypto"

import { hmacToken } from "@/lib/secure-token"

/**
 * Signatures for click-tracking redirect targets.
 *
 * Finding F-29 (docs/isms/ISMS-02-gap-analysis.md): the three tracking routes
 * check `isPrivateUrl`, which stops SSRF into the internal network and blocks
 * non-http schemes — but says nothing about where the redirect goes on the
 * public internet. Anyone could therefore mint
 * `app.leaddrivecrm.org/api/v1/tracking/click?url=<anything>` and hand out a
 * phishing link wearing this product's domain. The recipient sees a familiar
 * host, and so do the reputation filters that decide whether mail from that
 * domain is delivered at all.
 *
 * Redirecting to arbitrary external URLs is the FEATURE — a tenant's campaign
 * points at the tenant's own landing page — so the target cannot be restricted
 * by an allow-list. What can be required is proof that this system generated
 * the link, which is what the signature is.
 *
 * Truncated to 16 hex characters (64 bits). Full-width would be 64 characters
 * in every SMS body, and 64 bits is far beyond forgeable for a value that only
 * authorises a redirect — the tradeoff is deliberate, not an oversight.
 */

const PURPOSE = "tracking-redirect"

/** Query parameter carrying the signature. Short: it rides in SMS bodies. */
export const TRACKING_SIGNATURE_PARAM = "s"

export function signRedirectTarget(url: string): string {
  return hmacToken(url, PURPOSE).slice(0, 16)
}

export function redirectTargetSignatureValid(url: string, signature: string | null | undefined): boolean {
  if (!signature) return false
  const expected = signRedirectTarget(url)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Appends the signature to an already-built tracking URL.
 *
 * The signature covers the redirect target only. The campaign and contact
 * identifiers are analytics, not authorisation: forging them writes a bogus
 * click event, which is a data-quality nuisance, while forging the target is
 * what puts this domain in front of someone else's phishing page.
 */
export function withSignedRedirect(trackingUrl: string, target: string): string {
  const joiner = trackingUrl.includes("?") ? "&" : "?"
  return `${trackingUrl}${joiner}${TRACKING_SIGNATURE_PARAM}=${signRedirectTarget(target)}`
}

/**
 * Whether an unsigned link must be refused.
 *
 * Defaults to false so that links already sitting in delivered emails and SMS
 * keep working. Every unsigned use is logged by the routes, so the owner can
 * watch the tail of old links die out and then set this to "1" — at which point
 * the finding is fully closed rather than merely detected.
 */
export function trackingSignatureRequired(): boolean {
  return process.env.TRACKING_REQUIRE_SIGNATURE === "1"
}
