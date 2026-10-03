import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { DEPLOY_SHA } from "@/generated/build-sha"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { SUPPORT_UX_V2_CANARY_FLAG } from "@/lib/support-ux-rollout"
import { planSupportCanaryChange, SupportCanaryChangeError } from "@/lib/support-ux-canary-change"

const changeSchema = z.object({
  tenantSlug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/),
  enabled: z.boolean(),
  expectedEnabled: z.boolean(),
  expectedArtifactSha: z.string().regex(/^[a-f0-9]{40}$/),
}).strict()

function failure(code: string, status: number) {
  return NextResponse.json({ success: false, code }, { status, headers: { "Cache-Control": "no-store" } })
}

/** Explicit operator action; deployment alone never enables any tenant. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const parsed = changeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return failure("SUPPORT_UX_CHANGE_INVALID", 400)
  if (!/^[a-f0-9]{40}$/.test(DEPLOY_SHA)) return failure("SUPPORT_UX_ARTIFACT_UNVERIFIED", 503)
  if (parsed.data.expectedArtifactSha !== DEPLOY_SHA) return failure("SUPPORT_UX_ARTIFACT_CHANGED", 409)
  const { id } = await params
  if (!id || id.length > 100) return failure("SUPPORT_UX_CHANGE_INVALID", 400)
  const { tenantSlug, enabled, expectedEnabled } = parsed.data

  try {
    const result = await runWithRlsBypass(async () => await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Serialize confirmations and changes while this transaction is open.
      await tx.$queryRaw`SELECT id FROM public.organizations WHERE id = ${id} AND slug = ${tenantSlug} FOR UPDATE`
      const tenant = await tx.organization.findUnique({
        where: { id }, select: { id: true, slug: true, isActive: true, features: true },
      })
      if (!tenant || tenant.slug !== tenantSlug) throw new SupportCanaryChangeError("SUPPORT_UX_TENANT_MISMATCH", 404)
      if (enabled && !tenant.isActive) throw new SupportCanaryChangeError("SUPPORT_UX_TENANT_INACTIVE", 409)
      const change = planSupportCanaryChange(tenant.features, enabled)
      if (change.before !== expectedEnabled) throw new SupportCanaryChangeError("SUPPORT_UX_STATE_CHANGED", 409)
      if (change.changed) {
        await tx.organization.update({ where: { id }, data: { features: change.nextFeatures }, select: { id: true } })
      }
      // logAudit deliberately swallows failures; this insert must abort the flag write.
      const audit = await tx.auditLog.create({
        data: {
          organizationId: id, userId: auth.userId,
          action: change.changed ? enabled ? "support_ux_canary_enable" : "support_ux_canary_disable" : "support_ux_canary_confirm",
          entityType: "support_ux_canary", entityId: id, entityName: SUPPORT_UX_V2_CANARY_FLAG,
          oldValue: { enabled: change.before },
          newValue: { enabled, changed: change.changed, artifactSha: DEPLOY_SHA },
        },
        select: { id: true, createdAt: true },
      })
      return { tenantSlug, enabled, changed: change.changed, artifactSha: DEPLOY_SHA,
        auditId: audit.id, auditRecordedAtUtc: audit.createdAt.toISOString() }
    }, { isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 }))
    return NextResponse.json({ success: true, data: { ...result, receiptIssuedAtUtc: new Date().toISOString() } },
      { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof SupportCanaryChangeError) return failure(error.code, error.status)
    if (error && typeof error === "object" && "code" in error) {
      const meta = "meta" in error ? error.meta : null
      const sqlState = meta && typeof meta === "object" && "code" in meta ? meta.code : null
      if (error.code === "P2034" || error.code === "P2010" && (sqlState === "40001" || sqlState === "40P01")) {
        return failure("SUPPORT_UX_STATE_CHANGED", 409)
      }
    }
    return failure("SUPPORT_UX_CHANGE_FAILED", 500)
  }
}
