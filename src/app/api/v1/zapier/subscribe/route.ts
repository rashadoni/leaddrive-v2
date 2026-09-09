/**
 * POST /api/v1/zapier/subscribe
 *
 * Zapier subscribe-hooks endpoint. Called when a user enables a Zap with
 * a LeadDrive trigger — Zapier sends `{ target_url, event }` and we create
 * a Webhook record (reuses the existing webhooks delivery infrastructure
 * in `src/lib/webhooks.ts`).
 *
 * The created Webhook carries immutable API-key provenance; unsubscribe is
 * via DELETE on its returned id and is restricted to that same key.
 *
 * Part of L6 Native Zapier Connector.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getZapierAuth, hasAnyScope, requiredScopesForEvent } from "@/lib/zapier-auth"
import { ZAPIER_TRIGGER_KEYS } from "@/lib/zapier-triggers"
import { validateOutboundWebhookUrl } from "@/lib/integrations/webhook-url-guard"
import { runWithTenant } from "@/lib/rls-context"
import crypto from "crypto"

const subscribeSchema = z.object({
  target_url: z.string().url().max(2048),
  event: z.string().min(1),
})

const existingSubscriptionWhere = (
  orgId: string,
  apiKeyId: string,
  targetUrl: string,
  event: string,
) => ({
  organizationId: orgId,
  createdByApiKeyId: apiKeyId,
  provenance: "zapier",
  url: targetUrl,
  isActive: true,
  // Zapier subscriptions are single-event rows. `equals` deliberately avoids
  // deduping against a generic/admin multi-event webhook that happens to have
  // the same URL and contain this event.
  events: { equals: [event] },
})

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
}

export async function POST(req: NextRequest) {
  const auth = await getZapierAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = subscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", message: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const { event } = parsed.data

  // Allowlist event against catalog — prevents arbitrary string subscriptions
  if (!ZAPIER_TRIGGER_KEYS.has(event)) {
    return NextResponse.json(
      { error: "unknown_event", message: `Event '${event}' is not a recognized Zapier trigger` },
      { status: 400 }
    )
  }

  // Scope enforcement — API key must have read OR write access to the entity
  const needed = requiredScopesForEvent(event)
  if (!hasAnyScope(auth, needed)) {
    return NextResponse.json(
      { error: "insufficient_scope", required_any_of: needed },
      { status: 403 }
    )
  }

  // Use the same async DNS/IP policy as first-party webhook management. The
  // delivery path repeats this check and pins the validated address.
  let targetUrl: string
  try {
    const target = await validateOutboundWebhookUrl(parsed.data.target_url)
    targetUrl = target.url.toString()
  } catch {
    return NextResponse.json(
      { error: "invalid_target", message: "Target URL must be publicly routable" },
      { status: 400 }
    )
  }

  return runWithTenant(auth.orgId, async () => {
    // Idempotency is scoped to the creating key and an exact single-event
    // Zapier subscription. A generic/admin webhook or another API key's
    // subscription is never adopted as this key's resource.
    // `select` keeps the row's `secret` out of memory (we don't need it here).
    const existing = await prisma.webhook.findFirst({
      where: existingSubscriptionWhere(auth.orgId, auth.apiKeyId, targetUrl, event),
      select: { id: true, createdAt: true },
    })
    if (existing) {
      return NextResponse.json(
        {
          id: existing.id,
          event,
          target_url: targetUrl,
          created_at: existing.createdAt.toISOString(),
          deduped: true,
        },
        { status: 200 }
      )
    }

    // Generate a webhook signing secret (Zapier doesn't actually use it but
    // we keep the contract identical to first-party webhooks for audit).
    const secret = crypto.randomBytes(32).toString("hex")

    let webhook: { id: string; createdAt: Date }
    try {
      webhook = await prisma.webhook.create({
        data: {
          organizationId: auth.orgId,
          createdByApiKeyId: auth.apiKeyId,
          provenance: "zapier",
          url: targetUrl,
          events: [event],
          secret,
          isActive: true,
        },
        select: { id: true, createdAt: true },
      })
    } catch (error) {
      // Zapier can retry subscribe concurrently. The partial unique index is
      // the final arbiter; recover the winner instead of surfacing a 500.
      if (!isUniqueConstraintError(error)) throw error
      const winner = await prisma.webhook.findFirst({
        where: existingSubscriptionWhere(auth.orgId, auth.apiKeyId, targetUrl, event),
        select: { id: true, createdAt: true },
      })
      if (!winner) throw error
      return NextResponse.json(
        {
          id: winner.id,
          event,
          target_url: targetUrl,
          created_at: winner.createdAt.toISOString(),
          deduped: true,
        },
        { status: 200 },
      )
    }

    return NextResponse.json(
      {
        id: webhook.id,
        event,
        target_url: targetUrl,
        created_at: webhook.createdAt.toISOString(),
      },
      { status: 201 }
    )
  })
}
