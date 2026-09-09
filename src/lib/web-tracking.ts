/**
 * C1 (Creatio 10X roadmap) — anonymous web-tracking helpers.
 *
 * Pure (no Prisma / no request access) → unit-testable. The public
 * /api/v1/public/web-tracking ingest route and the settings API share these.
 * Bot filtering reuses account-engagement's isBotUserAgent (the C5 pixel) —
 * one UA blocklist for both tracking surfaces.
 */
import { randomBytes, timingSafeEqual } from "crypto"
import { hmacToken } from "./secure-token"
import { IDENTITY_TOKEN_PARAM } from "./web-tracking-shapes"

export { IDENTITY_TOKEN_PARAM }

/** A visitor session closes after this many minutes of inactivity. */
export const SESSION_IDLE_MINUTES = 30

/**
 * C2 identity stitching — how far back a freshly-identified visitor's anonymous
 * history is attributed to the contact. Matches the roadmap's "30-day backfill":
 * older sessions are treated as stale and left anonymous (and the retention cron
 * eventually reaps them). Sessions attributed here survive retention.
 */
export const STITCH_WINDOW_DAYS = 30

/** Hard caps enforced by the ingest route (a batch is a browser flush, not an import). */
export const MAX_EVENTS_PER_BATCH = 20
export const MAX_METADATA_JSON_CHARS = 2000

// Wire-format shapes live in the browser-safe web-tracking-shapes.ts (client
// components import that directly); re-exported here so server code keeps a
// single import site.
export { VISITOR_ID_RE, isValidVisitorId, VISITOR_ID_PARAM } from "./web-tracking-shapes"

/**
 * CORS headers for the public snippet endpoints (ingest + identify). The
 * snippet never reads response bodies; echoing the origin just keeps fetch()
 * fallbacks from logging console CORS noise. The real gate is the server-side
 * origin whitelist each route enforces.
 */
export function webTrackingCorsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  }
}

/** "ldt_" + 16 base64url chars — the public snippet key (NOT a secret). */
export function generateTrackingKey(): string {
  return "ldt_" + randomBytes(12).toString("base64url")
}

export interface UtmParams {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
}

// ── C2 identity token (email-click stitching) ─────────────────────────────
//
// A tracked email/SMS/ad click resolves the Contact server-side (via logId /
// signed `k`), but the click runs on OUR domain and cannot read the visitor's
// first-party `_ldv` cookie (that lives on the tenant's site). So the click
// appends a signed `_ldi` token to the redirect URL; the snippet on the landing
// page reads it and POSTs it back with its visitorId, and the identify endpoint
// verifies it here before stitching. HMAC (not encryption) — the payload is not
// secret, we only need it unforgeable and scoped to one org+contact for a short
// window so it cannot be replayed to bind arbitrary history.

/** Signed identity tokens expire quickly — a click is followed by a pageview in seconds. */
export const IDENTITY_TOKEN_TTL_MS = 15 * 60 * 1000

const IDENTITY_TOKEN_PURPOSE = "web-identify"

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url")
}
function fromB64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8")
}

/**
 * Mint an unforgeable `orgId.contactId.expiry` token. Returned value is safe to
 * put in a URL query param. Callers pass the current time so the function stays
 * pure/testable.
 */
export function signIdentityToken(
  organizationId: string,
  contactId: string,
  now: number = Date.now(),
): string {
  const exp = now + IDENTITY_TOKEN_TTL_MS
  const payload = `${organizationId}.${contactId}.${exp}`
  const sig = hmacToken(payload, IDENTITY_TOKEN_PURPOSE)
  return `${b64url(payload)}.${sig}`
}

/**
 * Append a freshly-signed identity token to a redirect URL so the snippet on
 * the landing page can stitch the click's contact to the visitor. Returns the
 * URL unchanged if it cannot be parsed (never breaks the redirect).
 */
export function appendIdentityToken(
  url: string,
  organizationId: string,
  contactId: string,
  now: number = Date.now(),
): string {
  try {
    const u = new URL(url)
    u.searchParams.set(IDENTITY_TOKEN_PARAM, signIdentityToken(organizationId, contactId, now))
    return u.toString()
  } catch {
    return url
  }
}

export interface VerifiedIdentity {
  organizationId: string
  contactId: string
}

/**
 * Verify a token from the snippet. Returns the org+contact only when the
 * signature matches (constant-time) AND the token has not expired; null on any
 * malformation, tamper, or expiry. `contactId`/`organizationId` are matched
 * against the resolving config's org by the caller before any write.
 */
export function verifyIdentityToken(
  token: unknown,
  now: number = Date.now(),
): VerifiedIdentity | null {
  if (typeof token !== "string" || token.length > 512) return null
  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  let payload: string
  try {
    payload = fromB64url(payloadB64)
  } catch {
    return null
  }
  const expected = hmacToken(payload, IDENTITY_TOKEN_PURPOSE)
  // Constant-time compare; lengths must match for timingSafeEqual.
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null
  const parts = payload.split(".")
  if (parts.length !== 3) return null
  const [organizationId, contactId, expStr] = parts
  const exp = Number(expStr)
  if (!organizationId || !contactId || !Number.isFinite(exp) || exp < now) return null
  return { organizationId, contactId }
}

/** Extract utm_* params from a page URL; tolerant of bare paths / garbage. */
export function parseUtm(url: string | null | undefined): UtmParams {
  const empty: UtmParams = { utmSource: null, utmMedium: null, utmCampaign: null }
  if (typeof url !== "string" || !url.trim()) return empty
  try {
    const u = new URL(url, "https://placeholder.local")
    const pick = (k: string) => {
      const v = u.searchParams.get(k)
      return v ? v.slice(0, 200) : null
    }
    return {
      utmSource: pick("utm_source"),
      utmMedium: pick("utm_medium"),
      utmCampaign: pick("utm_campaign"),
    }
  } catch {
    return empty
  }
}
