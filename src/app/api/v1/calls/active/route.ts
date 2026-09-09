import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { accessibleCallWhere } from "@/lib/calls/access"
import { checkPermission } from "@/lib/permissions"
import { withRlsAuth } from "@/lib/with-rls"

type ActiveCallRow = {
  id: string
  callSid: string | null
  direction: string
  fromNumber: string
  toNumber: string
  status: string
  provider: string
  conversationId: string | null
  contactId: string | null
  leadId: string | null
  claimedByUserId: string | null
  claimedAt: Date | null
  browserAnswerClaimExpiresAt: Date | null
  queueId: string | null
  createdAt: Date
  contact: { fullName: string; email: string | null } | null
}

type LeadDisplayRow = {
  id: string
  contactName: string
  companyName: string | null
}

/**
 * GET /api/v1/calls/active — currently ringing/in-progress calls (for incoming call popup polling)
 */
export const GET = withRlsAuth("voip", "read", async (_req, auth) => {
  try {
    const role = auth.role || "viewer"
    const activeCalls: ActiveCallRow[] = await prisma.callLog.findMany({
      where: {
        organizationId: auth.orgId,
        AND: [accessibleCallWhere(role, auth.userId)],
        status: { in: ["ringing", "answering", "in-progress", "initiated"] },
        // Provider delivery may be delayed or replayed. Use the provider's
        // observed start, not the database insertion time, so a spooled old
        // ringing event cannot appear as a live call.
        startedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
      select: {
        id: true,
        callSid: true,
        direction: true,
        fromNumber: true,
        toNumber: true,
        status: true,
        provider: true,
        conversationId: true,
        contactId: true,
        leadId: true,
        claimedByUserId: true,
        claimedAt: true,
        // Safe coordination metadata. The random claim token is deliberately
        // absent: only the browser that won POST /browser-answer receives it.
        browserAnswerClaimExpiresAt: true,
        queueId: true,
        createdAt: true,
        contact: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    })

    const now = Date.now()
    const visibleCalls = activeCalls.flatMap((call) => {
      if (call.provider !== "asterisk" || call.direction !== "inbound") return [call]

      const claimExpiresAt = call.browserAnswerClaimExpiresAt?.getTime() ?? 0
      const hasFreshClaim = Boolean(call.claimedByUserId) && claimExpiresAt > now
      if (hasFreshClaim && call.claimedByUserId !== auth.userId) return []

      // Once readiness has reserved/answered the channel it is no longer a
      // team queue item. Only the owner may keep seeing it while lifecycle
      // catches up; a different seller must never get an answer affordance.
      if (call.status !== "ringing" && call.claimedByUserId !== auth.userId) return []

      if (call.status === "ringing" && !hasFreshClaim) {
        // The database keeps expired attribution for audit, but to the queue
        // this row is free. Do not make clients infer availability from stale
        // owner fields or accidentally display another seller's identity.
        return [{
          ...call,
          claimedByUserId: null,
          claimedAt: null,
          browserAnswerClaimExpiresAt: null,
        }]
      }
      return [call]
    })

    // CallLog deliberately carries only a scalar leadId, so resolve display
    // data in one tenant-scoped batch. A call visible through another scope
    // (for example a ticket) must not reveal lead identity to a role without
    // leads:read.
    const canReadLeads = checkPermission(role, "leads", "read")
    const leadIds = canReadLeads
      ? [...new Set(visibleCalls.flatMap((call) => call.leadId ? [call.leadId] : []))]
      : []
    const leads: LeadDisplayRow[] = leadIds.length > 0
      ? await prisma.lead.findMany({
          where: { organizationId: auth.orgId, id: { in: leadIds } },
          select: { id: true, contactName: true, companyName: true },
        })
      : []
    const leadsById = new Map(leads.map((lead) => [lead.id, lead]))
    const data = visibleCalls.map((call) => canReadLeads
      ? { ...call, lead: call.leadId ? leadsById.get(call.leadId) ?? null : null }
      : { ...call, leadId: null, lead: null })

    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error("Active calls error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
