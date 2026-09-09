/**
 * C9 Marketing Attribution — recompute cron.
 *
 * POST /api/cron/attribution-recompute — for every active org, recompute each
 * ACTIVE attribution model (triggerSource "cron"). Per-model failures are
 * isolated so one bad model/org can't abort the sweep; each produces an
 * AttributionCalculationRun row regardless. Triggered by
 * scripts/cron-attribution-recompute.sh.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { recomputeModel } from "@/lib/marketing-attribution/recompute-worker"
import { runWithRlsBypass } from "@/lib/rls-context"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const startedAt = Date.now()
  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    let modelsRun = 0
    let succeeded = 0
    let failed = 0
    const errors: Array<{ organizationId: string; modelId?: string; error: string }> = []

    for (const org of orgs) {
      try {
        const models = await prisma.attributionModel.findMany({
          where: { organizationId: org.id, status: "active" },
          select: { id: true, organizationId: true, modelType: true, config: true },
        })
        for (const model of models) {
          try {
            const r = await recomputeModel(org.id, model, { triggerSource: "cron" })
            modelsRun++
            if (r.status === "succeeded") succeeded++
            else {
              failed++
              errors.push({ organizationId: org.id, modelId: model.id, error: r.errorMessage ?? "failed" })
            }
          } catch (e) {
            failed++
            errors.push({
              organizationId: org.id,
              modelId: model.id,
              error: e instanceof Error ? e.message : String(e),
            })
          }
        }
      } catch (e) {
        errors.push({
          organizationId: org.id,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    return NextResponse.json({
      ok: true,
      orgs: orgs.length,
      modelsRun,
      succeeded,
      failed,
      errors,
      tookMs: Date.now() - startedAt,
    })
  } catch (e) {
    console.error("[cron/attribution-recompute] fatal error:", e)
    return NextResponse.json({ error: "Attribution recompute cron failed" }, { status: 500 })
  }
  })
}
