/**
 * C9 #17 — Marketing Attribution incremental recompute drainer.
 *
 * POST /api/cron/attribution-drain — recompute ONLY the active models flagged
 * dirty (recomputeRequestedAt set, e.g. by a deal entering/leaving a won stage),
 * then compare-and-clear the flag. Designed to run on a tight schedule (every
 * minute) so a won deal is reflected in attribution within ~1 min, WITHOUT a
 * Redis/BullMQ queue (REDIS is intentionally unset on this deployment — same
 * Postgres-cron drainer pattern).
 *
 * The periodic full-sweep `/api/cron/attribution-recompute` stays as the
 * backstop that also catches non-won changes (touchpoint backfills etc.).
 *
 * Triggered by scripts/cron-attribution-drain.sh.
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
    // Oldest-dirty first, capped so a mass-reopen can't make one per-minute
    // tick run unbounded models and overrun the 60s window — the remainder
    // drains on the next tick (FIFO). A synchronous manual recompute does NOT
    // clear recomputeRequestedAt, so the drainer may redundantly recompute a
    // just-manually-run model once more — harmless (recompute is idempotent).
    const dirty = await prisma.attributionModel.findMany({
      where: { status: "active", recomputeRequestedAt: { not: null } },
      orderBy: { recomputeRequestedAt: "asc" },
      take: 50,
      select: {
        id: true,
        organizationId: true,
        modelType: true,
        config: true,
        recomputeRequestedAt: true,
      },
    })

    let modelsRun = 0
    let succeeded = 0
    let failed = 0
    const errors: Array<{ organizationId: string; modelId: string; error: string }> = []

    for (const model of dirty) {
      try {
        const r = await recomputeModel(model.organizationId, model, { triggerSource: "cron" })
        modelsRun++
        if (r.status === "succeeded") succeeded++
        else {
          failed++
          errors.push({ organizationId: model.organizationId, modelId: model.id, error: r.errorMessage ?? "failed" })
        }
      } catch (e) {
        failed++
        errors.push({
          organizationId: model.organizationId,
          modelId: model.id,
          error: e instanceof Error ? e.message : String(e),
        })
      }

      // Compare-and-clear: only clear the marker if no NEWER request arrived
      // while we were recomputing (a deal won mid-recompute bumps
      // recomputeRequestedAt, so the WHERE won't match and the model stays dirty
      // for the next drain — no missed recompute).
      await prisma.attributionModel
        .updateMany({
          where: { id: model.id, recomputeRequestedAt: model.recomputeRequestedAt },
          data: { recomputeRequestedAt: null },
        })
        .catch(() => {
          /* leave the marker set; the next drain retries */
        })
    }

    return NextResponse.json({
      ok: true,
      modelsRun,
      succeeded,
      failed,
      errors,
      tookMs: Date.now() - startedAt,
    })
  } catch (e) {
    console.error("[cron/attribution-drain] error:", e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    )
  }
  })
}
