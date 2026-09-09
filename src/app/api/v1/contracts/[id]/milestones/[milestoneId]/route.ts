/**
 * CLM Slice 5a — Contract Milestone: single-item operations
 *
 * PATCH /api/v1/contracts/[id]/milestones/[milestoneId]
 *   Update label/description/dueAt/status/ownerUserId/metadata.
 *   status → "completed"  sets completedAt = now (idempotent if already set).
 *   status → other value  clears completedAt.
 *   ownerUserId validated same-org (400 if foreign or inactive).
 *   Full-predicate CAS: updateMany({id, organizationId, contractId}), count===1 → 404.
 *   requireAuth("contracts", "write")
 *
 * DELETE /api/v1/contracts/[id]/milestones/[milestoneId]
 *   Full-predicate CAS: deleteMany({id, organizationId, contractId}), count===1 → 404.
 *   requireAuth("contracts", "delete")
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const VALID_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const

const patchMilestoneSchema = z.object({
  label:       z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  dueAt:       z.coerce.date().optional(),
  status:      z.enum(VALID_STATUSES).optional(),
  ownerUserId: z.string().nullable().optional(),
  metadata:    z.record(z.string(), z.unknown()).optional(),
})

export const PATCH = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string; milestoneId: string }> }) => {
  const orgId = auth.orgId
  const { id, milestoneId } = await params

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const parsed = patchMilestoneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { label, description, dueAt, status, ownerUserId, metadata } = parsed.data

  try {
    // Validate ownerUserId same-org guard (when being set to a non-null value)
    if (ownerUserId != null && ownerUserId !== undefined) {
      const owner = await prisma.user.findFirst({
        where: { id: ownerUserId, organizationId: orgId, isActive: true },
        select: { id: true },
      })
      if (!owner) {
        return NextResponse.json(
          { error: "ownerUserId not found in this organization" },
          { status: 400 },
        )
      }
    }

    // Build the data payload
    const now = new Date()
    const data: Record<string, unknown> = {}
    if (label       !== undefined) data.label       = label
    if (description !== undefined) data.description = description
    if (dueAt       !== undefined) data.dueAt       = dueAt
    if (metadata    !== undefined) data.metadata    = metadata
    if (ownerUserId !== undefined) data.ownerUserId = ownerUserId

    if (status !== undefined) {
      data.status = status
      if (status === "completed") {
        // Only set completedAt if not already set (idempotent)
        const existing = await prisma.contractMilestone.findFirst({
          where: { id: milestoneId, organizationId: orgId, contractId: id },
          select: { completedAt: true },
        })
        data.completedAt = existing?.completedAt ?? now
      } else {
        // Transitioning away from completed → clear completedAt
        data.completedAt = null
      }
    }

    // Full-predicate CAS: all three predicates must match
    const result = await prisma.contractMilestone.updateMany({
      where: { id: milestoneId, organizationId: orgId, contractId: id },
      data,
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const updated = await prisma.contractMilestone.findFirst({
      where: { id: milestoneId, organizationId: orgId, contractId: id },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[milestones PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("contracts", "delete", async (_req, auth, { params }: { params: Promise<{ id: string; milestoneId: string }> }) => {
  const orgId = auth.orgId
  const { id, milestoneId } = await params

  try {
    // Full-predicate CAS delete
    const result = await prisma.contractMilestone.deleteMany({
      where: { id: milestoneId, organizationId: orgId, contractId: id },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { deleted: milestoneId } })
  } catch (e) {
    console.error("[milestones DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
