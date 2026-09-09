import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const ruleSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.string().max(50),
  percentage: z.number().min(0).max(100).optional(),
  fixedAmount: z.number().min(0).max(999999999).optional(),
}).strict()

const updateRuleSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200).optional(),
  triggerType: z.string().max(50).optional(),
  percentage: z.union([z.string(), z.number().min(0).max(100)]).optional().nullable(),
  fixedAmount: z.union([z.string(), z.number().min(0).max(999999999)]).optional().nullable(),
  isActive: z.boolean().optional(),
}).strict()

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRlsAuth<RouteContext>(
  "finance",
  "read",
  async (_req, auth, { params }) => {
    const { id: fundId } = await params
    const fund = await prisma.fund.findFirst({
      where: { id: fundId, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!fund) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const rules = await prisma.fundRule.findMany({
      where: { fundId, organizationId: auth.orgId },
      orderBy: { createdAt: "asc" },
    })
    return NextResponse.json({ data: rules })
  },
)

export const POST = withRlsAuth<RouteContext>(
  "finance",
  "write",
  async (req, auth, { params }) => {
    const { id: fundId } = await params
    const fund = await prisma.fund.findFirst({
      where: { id: fundId, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!fund) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
    const parsed = ruleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { name, triggerType, percentage, fixedAmount } = parsed.data
    const rule = await prisma.fundRule.create({
      data: {
        organizationId: auth.orgId,
        fundId,
        name,
        triggerType,
        percentage: percentage ?? null,
        fixedAmount: fixedAmount ?? null,
      },
    })
    return NextResponse.json({ data: rule }, { status: 201 })
  },
)

export const PUT = withRlsAuth<RouteContext>(
  "finance",
  "write",
  async (req, auth, { params }) => {
    const { id: fundId } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data: z.infer<typeof updateRuleSchema>
    try {
      data = updateRuleSchema.parse(body)
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json({ error: "Validation failed", details: error.flatten().fieldErrors }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    const existing = await prisma.fundRule.findFirst({
      where: { id: data.id, fundId, organizationId: auth.orgId },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const rule = await prisma.fundRule.update({
      where: { id: data.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.triggerType !== undefined && { triggerType: data.triggerType }),
        ...(data.percentage !== undefined && { percentage: data.percentage ? parseFloat(String(data.percentage)) : null }),
        ...(data.fixedAmount !== undefined && { fixedAmount: data.fixedAmount ? parseFloat(String(data.fixedAmount)) : null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    })
    return NextResponse.json({ data: rule })
  },
)

export const DELETE = withRlsAuth<RouteContext>(
  "finance",
  "delete",
  async (req, auth, { params }) => {
    const { id: fundId } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
    const parsed = z.object({ id: z.string().min(1).max(100) }).strict().safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "id required" }, { status: 400 })

    const deleted = await prisma.fundRule.deleteMany({
      where: { id: parsed.data.id, fundId, organizationId: auth.orgId },
    })
    if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ data: { success: true } })
  },
)
