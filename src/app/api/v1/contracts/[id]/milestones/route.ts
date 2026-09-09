/**
 * CLM Slice 5a — Contract Milestones
 *
 * GET  /api/v1/contracts/[id]/milestones
 *   List all milestones for a contract, ordered by dueAt asc.
 *   requireAuth("contracts", "read")
 *
 * POST /api/v1/contracts/[id]/milestones
 *   Create a milestone. label + dueAt required; description?, ownerUserId?,
 *   status?, metadata? optional.
 *   ownerUserId validated same-org (400 if foreign or inactive).
 *   requireAuth("contracts", "write")
 *
 * Guards: contract must belong to org (404 otherwise). All rows scoped to
 * {organizationId}. No bare id-only operations.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const VALID_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const

const createMilestoneSchema = z.object({
  label:       z.string().min(1, "label is required"),
  description: z.string().optional(),
  dueAt:       z.coerce.date(),
  status:      z.enum(VALID_STATUSES).optional(),
  ownerUserId: z.string().optional(),
  metadata:    z.record(z.string(), z.unknown()).optional(),
})

export const GET = withRlsAuth("contracts", "read", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  try {
    // Verify contract belongs to this org
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const milestones = await prisma.contractMilestone.findMany({
      where: { organizationId: orgId, contractId: id },
      orderBy: { dueAt: "asc" },
    })

    return NextResponse.json({ success: true, data: milestones })
  } catch (e) {
    console.error("[milestones GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("contracts", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const userId = auth.userId
  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const parsed = createMilestoneSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { label, description, dueAt, status, ownerUserId, metadata } = parsed.data

  try {
    // Verify contract belongs to this org
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Validate ownerUserId same-org guard
    if (ownerUserId) {
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

    const milestone = await prisma.contractMilestone.create({
      data: {
        organizationId: orgId,
        contractId:     id,
        label,
        description:    description ?? null,
        dueAt,
        status:         status ?? "pending",
        completedAt:    status === "completed" ? new Date() : null,
        ownerUserId:    ownerUserId ?? null,
        metadata:       metadata ?? {},
        createdBy:      userId ?? null,
      },
    })

    return NextResponse.json({ success: true, data: milestone }, { status: 201 })
  } catch (e) {
    console.error("[milestones POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
