/**
 * C5 Account Engagement — Phase 4: first-party web-tracking pixel ingest.
 *
 * POST /api/v1/public/track   (PUBLIC — no auth; called by the tenant's pixel)
 *   Body: { orgId, url?, visitorEmail?, event?, referrer? }
 *
 * Records a page-view AccountIntentSignal for an IDENTIFIED visitor:
 *   bot filter → rate limit (per org+IP) → resolve visitorEmail → contact →
 *   (Phase-2 recorder) company → tracked MarketingAccount → signal.
 *
 * Intent kind is derived from the URL (classifyPageUrl): a /pricing or /demo
 * view is page_view_high_intent, everything else page_view_research.
 *
 * Anonymous views (no visitorEmail) and unknown emails are accepted (200) but
 * NOT attributed — turning an anonymous IP into a company is a paid IP-intel
 * vendor concern, deferred (see memory/deferred_findings.md). The endpoint is
 * safe against fake signals: it only ever adds a signal to an ALREADY-tracked
 * account via an ALREADY-existing contact, is rate-limited + bot-filtered, and
 * the recorder dedupes. Hardening to a signed per-tenant key is a follow-up.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { checkRateLimit, hashForRateLimit, type RateLimitConfig } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request-ip"
import { recordAccountIntentSignal } from "@/lib/account-engagement/contact-event-signal"
import { classifyPageUrl, isBotUserAgent } from "@/lib/account-engagement/track-pixel"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Cache the preflight 24h — the pixel fires on every page view across many
  // tenants; without this each view costs an extra OPTIONS round-trip.
  "Access-Control-Max-Age": "86400",
}

// A browsing session legitimately fires many page views; keep the cap generous
// but bounded per (org, IP) so a single source can't flood.
const TRACK_RATE_LIMIT: RateLimitConfig = { maxRequests: 60, windowMs: 60000 }

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

const trackSchema = z
  .object({
    orgId: z.string().min(1).max(100),
    url: z.string().max(2000).optional(),
    visitorEmail: z.string().email().max(200).optional(),
    event: z.string().max(50).optional(),
    referrer: z.string().max(2000).optional(),
  })
  .passthrough()

export async function POST(req: NextRequest) {
  // 1. Bot filter — drop crawlers/headless before any work.
  if (isBotUserAgent(req.headers.get("user-agent"))) {
    return NextResponse.json(
      { ok: true, recorded: false, reason: "bot" },
      { status: 200, headers: corsHeaders },
    )
  }

  // 2. Parse + validate.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders })
  }
  const parsed = trackSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400, headers: corsHeaders },
    )
  }
  const { orgId, url, visitorEmail } = parsed.data

  // 3. Rate limit per (org, IP).
  const rlKey = "track:" + (await hashForRateLimit(`${orgId}|${clientIp(req)}`))
  if (!checkRateLimit(rlKey, TRACK_RATE_LIMIT)) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: corsHeaders },
    )
  }

  // 4. Anonymous view — accepted, not attributed (no identity to resolve).
  if (!visitorEmail) {
    return NextResponse.json(
      { ok: true, recorded: false, reason: "anonymous" },
      { status: 200, headers: corsHeaders },
    )
  }

  // 5. Attribute: visitorEmail → contact → (recorder) company → account → signal.
  try {
    const result = await runWithTenant(orgId, async () => {
      const contact = await prisma.contact.findFirst({
        where: { organizationId: orgId, email: visitorEmail.trim().toLowerCase() },
        select: { id: true },
      })
      if (!contact) {
        return { recorded: false as const, reason: "unknown_visitor" as const }
      }
      // Minute-bucket the timestamp so the recorder's
      // (account, kind, occurredAt, contact) dedup collapses a pixel flood to
      // ≤1 signal per contact+kind+minute — bounding signal-spam even if the
      // rate-limit is evaded. The server-side live hook + backfill keep full
      // precision; only this public path buckets.
      const occurredAt = new Date(Math.floor(Date.now() / 60000) * 60000)
      return recordAccountIntentSignal({
        organizationId: orgId,
        contactId: contact.id,
        eventType: "page_view",
        signalKind: classifyPageUrl(url),
        occurredAt,
        resourceRef: url ?? null,
      })
    })

    return NextResponse.json({ ok: true, ...result }, { status: 200, headers: corsHeaders })
  } catch (err) {
    console.error("[track] POST error:", err instanceof Error ? err.message : "unknown")
    return NextResponse.json({ ok: false }, { status: 500, headers: corsHeaders })
  }
}
