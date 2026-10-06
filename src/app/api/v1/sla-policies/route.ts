import { NextResponse } from "next/server"
import { z } from "zod"
import { prepareSlaCalendar } from "@/lib/ticketing/sla-calendar-policy"
import { SlaCalendarError } from "@/lib/ticketing/sla-business-calendar"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { SLA_POLICY_PRIORITIES, validateSlaTargets } from "@/lib/ticketing/sla-policy"

const createSlaPolicySchema = z.object({
  businessCalendarAction: z.enum(["preserve", "capture", "clear"]).optional(),
  expectedCalendarUpdatedAt: z.string().datetime().optional(),
  name: z.string().trim().min(1).max(200),
  priority: z.enum(SLA_POLICY_PRIORITIES),
  // Decimal hours; floor at 1 minute (1/60 h) so a non-form POST can't set a sub-minute SLA.
  firstResponseHours: z.number().min(1 / 60, "First response must be at least 1 minute").max(8760),
  resolutionHours: z.number().min(1 / 60, "Resolution must be at least 1 minute").max(8760),
  businessHoursOnly: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
})

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const policies = await prisma.slaPolicy.findMany({
      where: { organizationId: orgId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { companies: true, entitlements: true } } },
    })

    return NextResponse.json({ success: true, data: policies })
  } catch (e) {
    console.error("[sla-policies GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createSlaPolicySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const targetError = validateSlaTargets(parsed.data.firstResponseHours, parsed.data.resolutionHours)
  if (targetError) {
    return NextResponse.json({ error: targetError, code: targetError.toUpperCase() }, { status: 400 })
  }

  try {
    const policy = await prisma.$transaction(async (tx) => {
      if (parsed.data.isActive) {
        const conflict = await tx.slaPolicy.findFirst({
          where: { organizationId: orgId, priority: parsed.data.priority, isActive: true },
          select: { id: true },
        })
        if (conflict) return null
      }
      const { businessCalendarAction, expectedCalendarUpdatedAt, ...policyData } = parsed.data
      const businessCalendar = await prepareSlaCalendar(tx, orgId, businessCalendarAction, policyData.businessHoursOnly, policyData.firstResponseHours, policyData.resolutionHours, expectedCalendarUpdatedAt)
      return tx.slaPolicy.create({
        data: { organizationId: orgId, ...policyData, ...(businessCalendar !== undefined ? { businessCalendar } : {}) },
      })
    }, { isolationLevel: "Serializable" })
    if (!policy) {
      return NextResponse.json({ error: "Active priority conflict", code: "ACTIVE_PRIORITY_CONFLICT" }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: policy }, { status: 201 })
  } catch (e) {
    if (e instanceof SlaCalendarError) return NextResponse.json({ error: e.message, code: e.code }, { status: 409 })
    if ((e as { code?: string }).code === "P2034") {
      return NextResponse.json({ error: "Concurrent SLA policy conflict", code: "ACTIVE_PRIORITY_CONFLICT" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
