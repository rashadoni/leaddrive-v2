import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { isKnownFeature, isKnownAddon } from "@/lib/plan-catalog"

const SLUG = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

const createSchema = z.object({
  key: z.string().regex(SLUG, "key must be a 3-30 char lowercase slug"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  features: z.array(z.string()).default([]).refine((a) => a.every(isKnownFeature), "unknown feature key"),
  addons: z.array(z.string()).default([]).refine((a) => a.every(isKnownAddon), "unknown addon key"),
  maxUsers: z.number().int().gte(-1),
  maxContacts: z.number().int().gte(-1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
})

// GET /api/v1/admin/plans — list all plan templates (active + inactive)
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const plans = await prisma.planTemplate.findMany({ orderBy: { sortOrder: "asc" } })
  return NextResponse.json({ success: true, data: plans })
}

// POST /api/v1/admin/plans — create a new plan template
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  try {
    const plan = await prisma.planTemplate.create({ data: parsed.data })
    // NOTE: PlanTemplate is a global resource; audit is logged under the superadmin's orgId
    // by design (consistent with the tenant-provisioning audit in admin/tenants/route.ts).
    logAudit(auth.orgId, "create", "plan_template", plan.id, plan.name, { newValue: parsed.data })
    return NextResponse.json({ success: true, data: plan }, { status: 201 })
  } catch (e: any) {
    if (e.code === "P2002") return NextResponse.json({ error: `Plan key "${parsed.data.key}" already exists` }, { status: 409 })
    console.error("[plans POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
