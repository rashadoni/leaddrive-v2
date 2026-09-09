/**
 * C1 (Creatio 10X roadmap) — anonymous web-tracking ingest.
 *
 * POST /api/v1/public/web-tracking   (PUBLIC — called by public/ldtrack.js)
 *   Body: { key, visitorId, events: [{ type, name?, url?, referrer?, metadata? }] }
 *
 * The snippet sends text/plain (sendBeacon-friendly simple request — no CORS
 * preflight), so the body is read as text and JSON.parse'd. Flow:
 *   bot filter → parse/validate → publicKey → config (RLS-bypass resolution,
 *   same as web-chat's widget lookup) → enabled + origin whitelist → rate
 *   limit per (key, IP) → tenant-scoped: resolve/create the visitor's active
 *   session (30-min inactivity window) → insert actions → bump counters.
 *
 * Privacy: no IP is ever stored (rate-limit key hashes it in memory only);
 * the visitorId cookie is set by the snippet ONLY after consent when the
 * tenant enables consent mode; raw actions expire via the retention cron.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { checkRateLimit, hashForRateLimit, type RateLimitConfig } from "@/lib/rate-limit"
import { isOriginAllowed } from "@/lib/widget-cors"
import { clientIp } from "@/lib/request-ip"
import { isBotUserAgent } from "@/lib/account-engagement/track-pixel"
import {
  SESSION_IDLE_MINUTES,
  MAX_EVENTS_PER_BATCH,
  MAX_METADATA_JSON_CHARS,
  isValidVisitorId,
  parseUtm,
  webTrackingCorsHeaders as corsHeaders,
} from "@/lib/web-tracking"
import { fireWebActivityWorkflows } from "@/lib/web-tracking-triggers"

// A browsing session flushes at most every few seconds; 60 batches/min per
// (key, IP) is generous for humans and a wall for floods.
const INGEST_RATE_LIMIT: RateLimitConfig = { maxRequests: 60, windowMs: 60000 }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) })
}

const eventSchema = z.object({
  type: z.enum(["pageview", "event"]),
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().max(2000).optional(),
  referrer: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const batchSchema = z.object({
  key: z.string().min(1).max(100),
  // isValidVisitorId is the single source of truth for the id shape (the
  // snippet's cookie alphabet) — folded into zod so there is one error path.
  visitorId: z.string().refine(isValidVisitorId, "Invalid visitorId"),
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
})

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = corsHeaders(origin)

  // 1. Bot filter — crawlers/headless never reach the DB.
  if (isBotUserAgent(req.headers.get("user-agent"))) {
    return NextResponse.json({ ok: true, recorded: false, reason: "bot" }, { status: 200, headers })
  }

  // 2. Parse. sendBeacon sends text/plain, fetch sends application/json —
  //    read as text and parse either way.
  let body: unknown
  try {
    body = JSON.parse(await req.text())
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers })
  }
  const parsed = batchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400, headers },
    )
  }
  const { key, visitorId, events } = parsed.data

  // 3. Resolve config by public key. Cross-tenant external identifier →
  //    bypass-scoped lookup (resolution only), like web-chat's widget lookup.
  const config = await runWithRlsBypass(() =>
    prisma.webTrackingConfig.findUnique({ where: { publicKey: key } })
  )
  if (!config || !config.enabled) {
    return NextResponse.json({ error: "Tracking not available" }, { status: 404, headers })
  }
  // A whitelist only means something if Origin is mandatory while it's set:
  // isOriginAllowed passes header-less requests, and the publicKey is public
  // (baked into every visitor's HTML). Browsers always send Origin on
  // cross-site POST, so this only rejects non-browser clients — the ones the
  // whitelist exists to stop. Empty whitelist = tenant accepted open ingest.
  if (config.allowedOrigins.length > 0 && !origin) {
    return NextResponse.json({ error: "Origin required" }, { status: 403, headers })
  }
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers })
  }

  // 4. Rate limit per (key, IP). The IP is hashed and lives only in the
  //    in-memory limiter — never persisted.
  const rlKey = "webtrack:" + (await hashForRateLimit(`${key}|${clientIp(req)}`))
  if (!checkRateLimit(rlKey, INGEST_RATE_LIMIT)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429, headers })
  }

  // 5. Tenant-scoped write: active session (30-min idle window) + actions.
  try {
    const now = new Date()
    const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MINUTES * 60 * 1000)
    const firstUrl = events.find((e) => e.url)?.url ?? null
    const pageviews = events.filter((e) => e.type === "pageview").length

    const result = await runWithTenant(config.organizationId, async () => {
      // Known, accepted race: two tabs of the same visitor can flush
      // concurrently, both miss the window and create two sessions for one
      // visit. Rare, and C2 stitches by visitorId (spans sessions), so a
      // split session only slightly skews per-session stats — not worth an
      // advisory lock on the hot ingest path.
      let session = await prisma.webSession.findFirst({
        where: {
          organizationId: config.organizationId,
          visitorId,
          lastSeenAt: { gte: idleCutoff },
        },
        orderBy: { lastSeenAt: "desc" },
        select: { id: true, contactId: true },
      })
      if (!session) {
        session = await prisma.webSession.create({
          data: {
            organizationId: config.organizationId,
            visitorId,
            startedAt: now,
            lastSeenAt: now,
            entryUrl: firstUrl,
            referrer: events[0]?.referrer?.slice(0, 2000) ?? null,
            // UTM stamps the SESSION (first-touch within the visit) — C2's
            // attribution reads it from here, not from every action.
            ...parseUtm(firstUrl),
            userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
          },
          select: { id: true, contactId: true },
        })
      }

      await prisma.webAction.createMany({
        data: events.map((e) => ({
          organizationId: config.organizationId,
          sessionId: session.id,
          visitorId,
          type: e.type,
          name: e.type === "event" ? e.name ?? "custom" : null,
          url: e.url ?? null,
          referrer: e.referrer ?? null,
          // Bound stored props: cap the serialized size, drop oversized whole.
          metadata:
            e.metadata && JSON.stringify(e.metadata).length <= MAX_METADATA_JSON_CHARS
              ? (e.metadata as object)
              : undefined,
          createdAt: now,
        })),
      })

      await prisma.webSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now, pageViews: { increment: pageviews } },
      })

      // C4: an identified visitor's activity fires the org's workflow rules
      // (entityType=contact, triggerEvent=web_activity). Fire-and-forget from
      // inside the tenant scope (ALS inherits); once per batch, never on
      // anonymous sessions — no cost for the common case.
      if (session.contactId) {
        void fireWebActivityWorkflows(prisma, {
          organizationId: config.organizationId,
          contactId: session.contactId,
          events,
        })
      }

      return { recorded: events.length }
    })

    return NextResponse.json({ ok: true, ...result }, { status: 200, headers })
  } catch (err) {
    console.error("[web-tracking] POST error:", err instanceof Error ? err.message : "unknown")
    return NextResponse.json({ ok: false }, { status: 500, headers })
  }
}
