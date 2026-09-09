/**
 * D8 Loyalty — earn-rule templates endpoint (Slice 2 Loyalty Builder).
 *
 * GET  /api/v1/loyalty-templates       — catalog + `isApplied` per template.
 * POST /api/v1/loyalty-templates        — apply a template (creates its earn
 *                                          rule(s), each stamped with
 *                                          metadata.templateId for dedup).
 *
 * Dedup uses the existing LoyaltyEarnRule.metadata JSON column (no migration,
 * no separate applied-templates table). seedTiers is a UI hint returned to the
 * quick-start wizard — this endpoint only creates RULES; the wizard seeds the
 * tier ladder via the existing POST /api/v1/loyalty-tiers?seedDefaults=true.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { LOYALTY_TEMPLATES, getLoyaltyTemplateById } from "@/lib/loyalty"

/** Template ids this org has already applied (any earn rule carrying
 *  metadata.templateId). Org rule counts are small → read + filter in JS,
 *  avoiding fragile cross-version Prisma JSON-path filters. */
async function appliedTemplateIds(orgId: string): Promise<Set<string>> {
  const rules = await prisma.loyaltyEarnRule.findMany({
    where: { organizationId: orgId },
    select: { metadata: true },
  })
  const ids = new Set<string>()
  for (const r of rules as { metadata: unknown }[]) {
    const m = r.metadata as Record<string, unknown> | null
    const tid = m?.templateId
    if (typeof tid === "string") ids.add(tid)
  }
  return ids
}

export const GET = withRlsAuth("loyalty", "read", async (_req: NextRequest, auth) => {
  const applied = await appliedTemplateIds(auth.orgId)
  const data = LOYALTY_TEMPLATES.map((t) => ({ ...t, isApplied: applied.has(t.id) }))
  return NextResponse.json({ success: true, data })
})

interface PostBody {
  templateId?: unknown
  /** Re-apply even if a rule from this template already exists. */
  force?: unknown
}

export const POST = withRlsAuth("loyalty", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (typeof body.templateId !== "string" || !body.templateId.trim()) {
    return NextResponse.json({ error: "Invalid `templateId` — required" }, { status: 400 })
  }
  const template = getLoyaltyTemplateById(body.templateId.trim())
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  const force = body.force === true
  if (!force) {
    const applied = await appliedTemplateIds(orgId)
    if (applied.has(template.id)) {
      return NextResponse.json(
        { error: "Template already applied", code: "already_applied" },
        { status: 409 },
      )
    }
  }

  // Templates are hardcoded-valid (positions/triggers/awards within bounds),
  // so we create directly — same trust model as the tiers ?seedDefaults flow.
  const created: { id: string; name: string; trigger: string }[] = []
  for (const r of template.earnRules) {
    const rule = await prisma.loyaltyEarnRule.create({
      data: {
        organizationId: orgId,
        name: r.name,
        trigger: r.trigger,
        pointsRate: r.pointsRate ?? null,
        pointsFlat: r.pointsFlat ?? null,
        minOrderAmount: r.minOrderAmount ?? null,
        productCategory: r.productCategory ?? null,
        priority: r.priority ?? 0,
        applyTierMultiplier: r.applyTierMultiplier ?? true,
        isActive: true,
        metadata: { templateId: template.id },
      },
      select: { id: true, name: true, trigger: true },
    })
    created.push(rule)
  }

  return NextResponse.json(
    { success: true, templateId: template.id, seedTiers: template.seedTiers ?? false, created },
    { status: 201 },
  )
})
