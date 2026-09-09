/**
 * DELETE /api/v1/zapier/subscribe/[id]
 *
 * Zapier unsubscribe — called when a user turns off a Zap. We deactivate
 * the corresponding Webhook record (soft-delete to preserve audit trail).
 *
 * Ownership check: the Webhook must belong to the org of the API key,
 * otherwise 404 (not 403 — don't leak existence of other orgs' subs).
 *
 * Part of L6 Native Zapier Connector.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getZapierAuth, hasAnyScope, requiredScopesForEvent } from "@/lib/zapier-auth"
import { ZAPIER_TRIGGER_KEYS } from "@/lib/zapier-triggers"
import { runWithTenant } from "@/lib/rls-context"

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getZapierAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 })
  }

  return runWithTenant(auth.orgId, async () => {
    const webhook = await prisma.webhook.findFirst({
      where: {
        id,
        organizationId: auth.orgId,
        createdByApiKeyId: auth.apiKeyId,
        provenance: "zapier",
      },
      select: {
        id: true,
        organizationId: true,
        createdByApiKeyId: true,
        provenance: true,
        events: true,
      },
    })
    // Provenance and single-event shape are part of the authorization
    // boundary. Return 404 for generic/admin, multi-event, other-key, and
    // cross-tenant rows so the endpoint cannot be used as an existence oracle.
    if (
      !webhook ||
      webhook.organizationId !== auth.orgId ||
      webhook.createdByApiKeyId !== auth.apiKeyId ||
      webhook.provenance !== "zapier" ||
      webhook.events.length !== 1 ||
      !ZAPIER_TRIGGER_KEYS.has(webhook.events[0])
    ) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    const event = webhook.events[0]
    const needed = requiredScopesForEvent(event)
    if (!hasAnyScope(auth, needed)) {
      return NextResponse.json(
        { error: "insufficient_scope", required_any_of: needed },
        { status: 403 },
      )
    }

    const deactivated = await prisma.webhook.updateMany({
      where: {
        id,
        organizationId: auth.orgId,
        createdByApiKeyId: auth.apiKeyId,
        provenance: "zapier",
        events: { equals: [event] },
      },
      data: { isActive: false },
    })
    if (deactivated.count !== 1) {
      return NextResponse.json({ error: "not_found" }, { status: 404 })
    }

    return NextResponse.json({ id, deleted: true })
  })
}
