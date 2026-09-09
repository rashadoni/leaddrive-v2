/**
 * POST /api/v1/prediction-models/[id]/predict
 *
 * Score a single record under a trained model. Two input modes:
 *
 *   { recordId: "deal_xxx" }                   — fetch by id (slice 1: deal only)
 *   { record: { amount: 12000, source: "..." } } — caller-supplied feature dict
 *
 * Returns score + band.
 *
 * **Auth + audit contract:** the route is gated by `ai:read` — scoring
 * is conceptually a read on the model definition. The `PredictionRun`
 * insert is an audit side-effect persisted ONLY for the `recordId` path
 * (ad-hoc `record` payloads skip the run log). This means `ai:read`
 * keys may produce rows in `prediction_runs`; that's intentional. If a
 * future caller needs scoring without audit, split the endpoint —
 * don't gate the run-insert on auth scope.
 *
 * Part of H3 Einstein Prediction Builder (Phase 3 slice 1).
 */
import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { parseFieldSpecs, scoreRecord } from "@/lib/ml/prediction/engine"
import type { PredictionArtifact } from "@/lib/ml/prediction/types"

const bodySchema = z
  .object({
    recordId: z.string().min(1).max(120).optional(),
    record: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(b => b.recordId || b.record, {
    message: "Supply either `recordId` or `record`",
  })

async function loadRecord(
  organizationId: string,
  objectType: string,
  recordId: string,
  fieldsNeeded: Set<string>
): Promise<Record<string, unknown> | null> {
  if (objectType === "deal") {
    const row = await prisma.deal.findFirst({
      where: { id: recordId, organizationId },
      select: {
        id: true,
        stage: true,
        valueAmount: true,
        probability: true,
        currency: true,
        salesChannel: true,
        customerNeed: true,
        confidenceLevel: true,
        lostReason: true,
      },
    })
    if (!row) return null
    const out: Record<string, unknown> = {}
    for (const k of fieldsNeeded) out[k] = (row as Record<string, unknown>)[k]
    return out
  }
  throw new Error(`Object type "${objectType}" not yet supported in slice 1`)
}

export const POST = withRlsAuth("ai", "read", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  // ai:read scope — see top-of-file docstring for the audit-write contract.
  const { id } = await params

  let body: unknown
  try { body = await req.json() } catch { body = {} }
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const model = await prisma.predictionModel.findFirst({
    where: { id, organizationId: auth.orgId },
  })
  if (!model) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (model.status !== "trained" || !model.artifact) {
    return NextResponse.json({ error: "Model not trained yet" }, { status: 409 })
  }

  let specs
  try {
    specs = parseFieldSpecs(model.inputFields)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid inputFields" },
      { status: 422 }
    )
  }

  const artifact = model.artifact as unknown as PredictionArtifact

  let record: Record<string, unknown>
  let recordIdForRun: string

  if (parsed.data.recordId) {
    const fieldsNeeded = new Set<string>(specs.map(s => s.field))
    let loaded: Record<string, unknown> | null
    try {
      loaded = await loadRecord(auth.orgId, model.objectType, parsed.data.recordId, fieldsNeeded)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Load failed" },
        { status: 501 }
      )
    }
    if (!loaded) return NextResponse.json({ error: "Record not found" }, { status: 404 })
    record = loaded
    recordIdForRun = parsed.data.recordId
  } else {
    record = parsed.data.record!
    // Ad-hoc records (slice 1 use-case: dry-run scoring before persisting)
    // get a UUID-suffixed synthetic id; we skip the PredictionRun insert
    // for ad-hoc anyway, so this only matters if a caller inspects the
    // synthesised id in the response.
    recordIdForRun = `adhoc:${crypto.randomUUID()}`
  }

  let score: number
  let band: ReturnType<typeof scoreRecord>["band"]
  try {
    const result = scoreRecord({ artifact, specs, record })
    score = result.score
    band = result.band
  } catch (e) {
    // Re-wrap the engine's drift error with the model name so the UI
    // toast can say "Model 'Win/Loss Predictor' spec drifted…" rather
    // than the bare column index.
    const base = e instanceof Error ? e.message : "Scoring failed"
    return NextResponse.json(
      { error: `Model "${model.name}": ${base}` },
      { status: 422 }
    )
  }

  // Persist only "real" records — ad-hoc scores skip the run log to keep
  // it queryable by the deal/lead/ticket UI.
  if (parsed.data.recordId) {
    await prisma.predictionRun.create({
      data: {
        modelId: model.id,
        organizationId: auth.orgId,
        recordType: model.objectType,
        recordId: recordIdForRun,
        score,
        band,
      },
    })
  }

  return NextResponse.json({
    score,
    band,
    model: { id: model.id, name: model.name, accuracy: model.accuracy },
  })
})
