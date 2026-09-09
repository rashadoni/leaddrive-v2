import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().max(50).optional(),
  description: z.string().optional(),
  status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budget: nonNegativeFinancialAmountSchema.optional(),
  currency: z.string().optional(),
  managerId: z.string().optional(),
  companyId: z.string().optional(),
  dealId: z.string().optional(),
  color: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export const GET = withRlsAuth(undefined, undefined, async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  const status = searchParams.get("status")
  const companyId = searchParams.get("companyId")
  const managerId = searchParams.get("managerId")

  try {
    const where = {
      organizationId: orgId,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      ...(status ? { status } : {}),
      ...(companyId ? { companyId } : {}),
      ...(managerId ? { managerId } : {}),
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          company: { select: { id: true, name: true } },
          _count: { select: { tasks: true, members: true, milestones: true } },
        },
      }),
      prisma.project.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: { projects, total, page, limit },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const POST = withRlsAuth(undefined, undefined, async (req, auth) => {
  const orgId = auth.orgId

  const body = await req.json()
  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // Auto-generate project code if not provided
    let code = parsed.data.code
    if (!code) {
      const count = await prisma.project.count({ where: { organizationId: orgId } })
      code = `PRJ-${String(count + 1).padStart(3, "0")}`
    }

    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
        code,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
      },
    })
    return NextResponse.json({ success: true, data: project }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
