import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { canUseEntitlementPermission, entitlementPermissionError } from "@/lib/entitlement-process/access"
import { withRlsAuth } from "@/lib/with-rls"

const waiveSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
})

export const POST = withRlsAuth(
  "tickets",
  "write",
  async (req, auth, context: { params: Promise<{ id: string; milestoneId: string }> }) => {
    if (!canUseEntitlementPermission(auth.role, "entitlements.waive_milestone")) {
      return NextResponse.json(
        { error: "Forbidden", message: entitlementPermissionError("entitlements.waive_milestone") },
        { status: 403 },
      )
    }

    const { id: ticketId, milestoneId } = await context.params

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    }

    const parsed = waiveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Waiver reason is required." },
        { status: 400 },
      )
    }

    const existing = await prisma.entitlementTicketMilestone.findFirst({
      where: {
        id: milestoneId,
        organizationId: auth.orgId,
        ticketId,
      },
      include: {
        ticket: { select: { id: true, ticketNumber: true, subject: true } },
        definition: { select: { name: true, type: true } },
      },
    })
    if (!existing) {
      return NextResponse.json({ error: "Ticket milestone not found." }, { status: 404 })
    }
    if (!["pending", "in_progress", "missed"].includes(existing.status)) {
      return NextResponse.json(
        { error: "Only open or missed milestones can be waived." },
        { status: 409 },
      )
    }

    const reason = parsed.data.reason.trim()
    const now = new Date()
    const label = existing.definition.name || existing.definition.type

    try {
      const milestone = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.entitlementTicketMilestone.updateMany({
          where: {
            id: milestoneId,
            organizationId: auth.orgId,
            ticketId,
            status: { in: ["pending", "in_progress", "missed"] },
          },
          data: {
            status: "waived",
            waivedAt: now,
            waivedReason: reason,
            metadata: {
              ...jsonObject(existing.metadata),
              waivedBy: auth.userId,
              waivedAt: now.toISOString(),
            },
          },
        })
        if (updated.count === 0) {
          throw new Error("Milestone waiver was already processed.")
        }
        await tx.entitlementAuditEvent.create({
          data: {
            organizationId: auth.orgId,
            milestoneId,
            eventType: "milestone_waived",
            actorUserId: auth.userId,
            payload: {
              ticketId,
              type: existing.type,
              fromStatus: existing.status,
              reason,
              waivedAt: now.toISOString(),
            },
          },
        })
        await tx.ticketComment.create({
          data: {
            ticketId,
            userId: auth.userId,
            isInternal: true,
            comment: `Support milestone waived: ${label}. Reason: ${reason}`,
          },
        })
        return tx.entitlementTicketMilestone.findFirst({
          where: { id: milestoneId, organizationId: auth.orgId, ticketId },
        })
      })

      return NextResponse.json({ success: true, milestone })
    } catch (error) {
      console.error("[ticket entitlement milestone waive] error:", error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to waive ticket milestone." },
        { status: 500 },
      )
    }
  },
)

function jsonObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Prisma.InputJsonObject
  }
  return {}
}
