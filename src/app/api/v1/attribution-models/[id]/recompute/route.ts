/**
 * C9 Marketing Attribution — manual recompute trigger.
 *
 * POST /api/v1/attribution-models/[id]/recompute — recompute this model's
 * influences over the org's closed-won deals now (triggerSource "manual").
 * ASYNC: a big org's sweep is O(deals) sequential and can blow the 60s request
 * budget (504), so we kick the worker off in the BACKGROUND and return 202
 * immediately. The worker records its own AttributionCalculationRun
 * (pending→running→succeeded/failed); the UI polls the model's `latestRun`
 * (GET /attribution-models) to track completion. Archived models are rejected;
 * the cron does the same for all active models on a schedule.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recomputeModel } from "@/lib/marketing-attribution/recompute-worker"

export const POST = withRlsAuth("campaigns", "write", async (_req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing model id" }, { status: 400 })
  }

  const model = await prisma.attributionModel.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, organizationId: true, modelType: true, config: true, status: true },
  })
  if (!model) {
    return NextResponse.json({ error: "Model not found" }, { status: 404 })
  }
  if (model.status === "archived") {
    return NextResponse.json({ error: "Cannot recompute an archived model" }, { status: 400 })
  }

  // Concurrency guard: refuse a second manual run while one is in flight for
  // this model (double-click / two tabs). A run stuck > 10 min (crashed
  // worker) stops blocking. Idempotent upserts make a stray overlap harmless;
  // this just avoids wasted duplicate sweeps + confusing duplicate run rows.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
  const inFlight = await prisma.attributionCalculationRun.findFirst({
    where: {
      organizationId: orgId,
      modelId: model.id,
      status: { in: ["pending", "running"] },
      createdAt: { gt: tenMinAgo },
    },
    select: { id: true },
  })
  if (inFlight) {
    return NextResponse.json(
      { error: "A recompute is already running for this model" },
      { status: 409 },
    )
  }

  // Fire-and-forget: the heavy sweep runs in the background (the PM2 persistent
  // process keeps executing after the response, so the promise completes). The
  // worker creates + updates its own run row and captures any failure there; the
  // `.catch` only logs an unexpected throw before the worker could record it. The
  // UI watches `latestRun` to learn the outcome. Returning 202 dodges the 504.
  void recomputeModel(orgId, model, { triggerSource: "manual" }).catch((e) => {
    console.error("[attribution recompute background]", model.id, e)
  })
  return NextResponse.json({ queued: true }, { status: 202 })
})
