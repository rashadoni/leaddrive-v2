import { NextResponse } from "next/server"
import { z } from "zod"

import { prepareSlaCalendar } from "@/lib/ticketing/sla-calendar-policy"
import { SlaCalendarError } from "@/lib/ticketing/sla-business-calendar"
import { prisma } from "@/lib/prisma"
import { SLA_POLICY_PRIORITIES, validateSlaTargets } from "@/lib/ticketing/sla-policy"
import { withRls } from "@/lib/with-rls"

const updateSlaPolicySchema = z.object({
  businessCalendarAction: z.enum(["preserve", "capture", "clear"]).optional(),
  expectedCalendarUpdatedAt: z.string().datetime().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  priority: z.enum(SLA_POLICY_PRIORITIES).optional(),
  firstResponseHours: z.number().min(1 / 60, "First response must be at least 1 minute").max(8760).optional(),
  resolutionHours: z.number().min(1 / 60, "Resolution must be at least 1 minute").max(8760).optional(),
  businessHoursOnly: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    const policy = await prisma.slaPolicy.findFirst({
      where: { id, organizationId: orgId },
      include: { _count: { select: { companies: true, entitlements: true } } },
    })
    if (!policy) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: policy })
  } catch (error) {
    console.error("[sla-policies/:id GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateSlaPolicySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.slaPolicy.findFirst({
        where: { id, organizationId: orgId },
      })
      if (!existing) return { kind: "not_found" as const }

      const firstResponseHours = parsed.data.firstResponseHours ?? existing.firstResponseHours
      const resolutionHours = parsed.data.resolutionHours ?? existing.resolutionHours
      const targetError = validateSlaTargets(firstResponseHours, resolutionHours)
      if (targetError) return { kind: "invalid_targets" as const, targetError }

      const priority = parsed.data.priority ?? existing.priority
      const isActive = parsed.data.isActive ?? existing.isActive
      if (isActive) {
        const conflict = await tx.slaPolicy.findFirst({
          where: { organizationId: orgId, priority, isActive: true, id: { not: id } },
          select: { id: true },
        })
        if (conflict) return { kind: "conflict" as const }
      }

      const { businessCalendarAction, expectedCalendarUpdatedAt, ...policyData } = parsed.data
      const businessCalendar = await prepareSlaCalendar(tx, orgId, businessCalendarAction, policyData.businessHoursOnly ?? existing.businessHoursOnly, firstResponseHours, resolutionHours, expectedCalendarUpdatedAt, existing.businessCalendar)
      const result = await tx.slaPolicy.updateMany({
        where: { id, organizationId: orgId },
        data: { ...policyData, ...(businessCalendar !== undefined ? { businessCalendar } : {}) },
      })
      if (result.count === 0) return { kind: "not_found" as const }
      const updated = await tx.slaPolicy.findFirst({
        where: { id, organizationId: orgId },
        include: { _count: { select: { companies: true, entitlements: true } } },
      })
      return { kind: "ok" as const, updated }
    }, { isolationLevel: "Serializable" })

    if (outcome.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (outcome.kind === "invalid_targets") {
      return NextResponse.json({ error: outcome.targetError, code: outcome.targetError.toUpperCase() }, { status: 400 })
    }
    if (outcome.kind === "conflict") {
      return NextResponse.json({ error: "Active priority conflict", code: "ACTIVE_PRIORITY_CONFLICT" }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: outcome.updated })
  } catch (error) {
    if (error instanceof SlaCalendarError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    if ((error as { code?: string }).code === "P2034") {
      return NextResponse.json({ error: "Concurrent SLA policy conflict", code: "ACTIVE_PRIORITY_CONFLICT" }, { status: 409 })
    }
    console.error("[sla-policies/:id PUT]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    const policy = await prisma.slaPolicy.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, _count: { select: { companies: true, entitlements: true } } },
    })
    if (!policy) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (policy._count.entitlements > 0) {
      return NextResponse.json({ error: "Policy is used by entitlements", code: "POLICY_IN_USE" }, { status: 409 })
    }

    const result = await prisma.slaPolicy.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({
      success: true,
      data: { deleted: id, detachedCompanies: policy._count.companies },
    })
  } catch (error) {
    console.error("[sla-policies/:id DELETE]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
