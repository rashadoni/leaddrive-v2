import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { isKnownFeature, isKnownAddon } from "@/lib/plan-catalog"

// `key` is intentionally NOT updatable (it's stored in Organization.plan).
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  features: z.array(z.string()).refine((a) => a.every(isKnownFeature), "unknown feature key").optional(),
  addons: z.array(z.string()).refine((a) => a.every(isKnownAddon), "unknown addon key").optional(),
  maxUsers: z.number().int().gte(-1).optional(),
  maxContacts: z.number().int().gte(-1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  try {
    const plan = await prisma.planTemplate.update({ where: { id }, data: parsed.data })
    logAudit(auth.orgId, "update", "plan_template", plan.id, plan.name, { newValue: parsed.data })
    return NextResponse.json({ success: true, data: plan })
  } catch (e: any) {
    if (e.code === "P2025") return NextResponse.json({ error: "Not found" }, { status: 404 })
    console.error("[plans PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  try {
    // Atomic: re-check in-use INSIDE the transaction so a concurrent provision can't slip through.
    const result = await prisma.$transaction(async (tx: any) => {
      const plan = await tx.planTemplate.findUnique({ where: { id } })
      if (!plan) return { status: 404 as const }
      const inUse = await tx.organization.count({ where: { plan: plan.key } })
      if (inUse > 0) return { status: 409 as const, key: plan.key as string, inUse }
      await tx.planTemplate.delete({ where: { id } })
      return { status: 200 as const, key: plan.key as string }
    })
    if (result.status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.status === 409) {
      return NextResponse.json(
        { error: `Plan "${result.key}" is used by ${result.inUse} tenant(s). Deactivate it instead.` },
        { status: 409 },
      )
    }
    logAudit(auth.orgId, "delete", "plan_template", id, result.key, {})
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error("[plans DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
