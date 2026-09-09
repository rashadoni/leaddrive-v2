import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

/**
 * T9 Proactive Service — slice-3 PATCH endpoint.
 *
 * Acknowledge OR dismiss a single alert.
 *
 *   action=acknowledge → stamp `acknowledgedAt` + `acknowledgedBy`.
 *                        Alert STAYS visible in active list (just
 *                        marked "seen").
 *   action=dismiss     → stamp `dismissedAt` + `dismissedBy`. Alert
 *                        drops from the active list (audit-retained).
 *
 * Cross-tenant guard: `findFirst({where:{id, organizationId}})`
 * before any mutation — same pattern as the rest of the project.
 *
 * Idempotency:
 *   - acknowledging an already-acknowledged alert is a no-op (we
 *     don't overwrite the original timestamp).
 *   - dismissing an already-dismissed alert is a no-op.
 *   - acknowledging then dismissing is the canonical flow; both
 *     timestamps survive on the row.
 */

const patchSchema = z.object({
  action: z.enum(["acknowledge", "dismiss"]),
})

export const PATCH = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.userId ?? null

  const { id } = await params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const existing = await prisma.proactiveAlert.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        acknowledgedAt: true,
        dismissedAt: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 })
    }

    const now = new Date()
    const data: {
      acknowledgedAt?: Date
      acknowledgedBy?: string | null
      dismissedAt?: Date
      dismissedBy?: string | null
    } = {}

    if (parsed.data.action === "acknowledge") {
      // No-op if already acknowledged — preserve the original timestamp
      // so audit shows when the rep FIRST saw it, not the last click.
      if (!existing.acknowledgedAt) {
        data.acknowledgedAt = now
        data.acknowledgedBy = userId
      }
    } else if (parsed.data.action === "dismiss") {
      // No-op if already dismissed.
      if (!existing.dismissedAt) {
        data.dismissedAt = now
        data.dismissedBy = userId
        // If never acknowledged, dismissing also implicitly counts as
        // "seen" — stamp acknowledgedAt too so the audit trail makes
        // sense (the operator must have read it to dismiss).
        if (!existing.acknowledgedAt) {
          data.acknowledgedAt = now
          data.acknowledgedBy = userId
        }
      }
    }

    if (Object.keys(data).length === 0) {
      // Nothing to do — return current state without a write.
      return NextResponse.json({ success: true, noOp: true })
    }

    const updated = await prisma.proactiveAlert.update({
      where: { id },
      data,
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[proactive-alerts/:id] PATCH error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
