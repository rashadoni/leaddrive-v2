/**
 * C2 (Creatio 10X roadmap) — web-tracking identity stitching ingest.
 *
 * POST /api/v1/public/web-tracking/identify   (PUBLIC — called by public/ldtrack.js)
 *   Body: { key, visitorId, email? , token?, url? }
 *
 * Two ways a visitor gets bound to a Contact:
 *   • email — the site calls `ldTrack('identify', { email })` on form submit;
 *     we match a Contact in the tenant by normalised email (case-insensitive).
 *   • token — the visitor landed from a tracked email/SMS/ad click that already
 *     resolved the Contact server-side; the click appended a signed `_ldi`
 *     token which the snippet echoes here (see signIdentityToken). When both
 *     fields arrive, the token wins — it is server-minted and authoritative.
 *
 * Security posture mirrors the C1 ingest route (shared publicKey → org via
 * RLS-bypass, origin whitelist, per-(key,IP) rate limit, bot filter) and adds:
 *   • Every ACCEPTED request gets the same opaque `{ ok: true }` — the response
 *     never reveals whether the email matched a contact, so the endpoint cannot
 *     be used to enumerate a tenant's contacts. (Infra states — bad key, bad
 *     origin, rate limit — are distinguishable, exactly like the ingest route.)
 *   • Binding is idempotent and non-clobbering (see stitchVisitorToContact), so
 *     a forged email at worst attaches the sender's OWN page views to a contact
 *     — no data is read back, nothing existing is re-pointed.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { checkRateLimit, hashForRateLimit, type RateLimitConfig } from "@/lib/rate-limit"
import { isOriginAllowed } from "@/lib/widget-cors"
import { clientIp } from "@/lib/request-ip"
import { isBotUserAgent } from "@/lib/account-engagement/track-pixel"
import { isValidVisitorId, verifyIdentityToken, webTrackingCorsHeaders } from "@/lib/web-tracking"
import { stitchVisitorToContact, stitchByEmail } from "@/lib/web-tracking-identity"
import { normalizeEmail } from "@/lib/activity-capture/matcher"

// Identify fires at most once per form submit / landing — far rarer than the
// pageview firehose, so a tighter cap than the ingest route is plenty.
const IDENTIFY_RATE_LIMIT: RateLimitConfig = { maxRequests: 20, windowMs: 60000 }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: webTrackingCorsHeaders(req.headers.get("origin")) })
}

const bodySchema = z
  .object({
    key: z.string().min(1).max(100),
    visitorId: z.string().refine(isValidVisitorId, "Invalid visitorId"),
    email: z.string().trim().max(320).optional(),
    token: z.string().max(512).optional(),
    // Landing URL — stamps the stub session when identify wins the race
    // against the first pageview batch (stitchVisitorToContact).
    url: z.string().max(2000).optional(),
  })
  // At least one identifier must be present, else there is nothing to stitch.
  .refine((b) => !!b.email || !!b.token, "email or token required")

/** Opaque success — identical whether or not anything was stitched. */
function ok(headers: Record<string, string>) {
  return NextResponse.json({ ok: true }, { status: 200, headers })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = webTrackingCorsHeaders(origin)

  if (isBotUserAgent(req.headers.get("user-agent"))) return ok(headers)

  let raw: unknown
  try {
    raw = JSON.parse(await req.text())
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400, headers },
    )
  }
  const { key, visitorId, email, token, url } = parsed.data

  // Resolve config by public key (cross-tenant identifier → bypass lookup).
  const config = await runWithRlsBypass(() =>
    prisma.webTrackingConfig.findUnique({
      where: { publicKey: key },
      select: { organizationId: true, enabled: true, allowedOrigins: true },
    }),
  )
  if (!config || !config.enabled) {
    return NextResponse.json({ error: "Tracking not available" }, { status: 404, headers })
  }
  if (config.allowedOrigins.length > 0 && !origin) {
    return NextResponse.json({ error: "Origin required" }, { status: 403, headers })
  }
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers })
  }

  const rlKey = "webident:" + (await hashForRateLimit(`${key}|${clientIp(req)}`))
  if (!checkRateLimit(rlKey, IDENTIFY_RATE_LIMIT)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429, headers })
  }

  try {
    await runWithTenant(config.organizationId, async () => {
      // Token path first and exclusively — server-minted, so authoritative
      // over a caller-supplied email. Trust only tokens minted for THIS org.
      const verified = token ? verifyIdentityToken(token) : null
      if (verified && verified.organizationId === config.organizationId) {
        // Defence in depth: confirm the contact still exists in-org before
        // binding (contactId is a loose FK on WebSession).
        const contact = await prisma.contact.findFirst({
          where: { id: verified.contactId, organizationId: config.organizationId },
          select: { id: true },
        })
        if (contact) {
          await stitchVisitorToContact(prisma, {
            organizationId: config.organizationId,
            visitorId,
            contactId: contact.id,
            url,
          })
        }
        return
      }

      // Email path (site-initiated identify). On no match we silently do
      // nothing (never leaked in the response).
      const normalized = normalizeEmail(email)
      if (normalized) {
        await stitchByEmail(prisma, {
          organizationId: config.organizationId,
          visitorId,
          email: normalized,
          url,
        })
      }
    })
  } catch (err) {
    console.error("[web-tracking/identify] error:", err instanceof Error ? err.message : "unknown")
    // Still opaque — a stitch failure is not the caller's business.
  }

  return ok(headers)
}
