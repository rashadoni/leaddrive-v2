/**
 * POST /api/v1/prediction-models/[id]/train
 *
 * Train the model against historical org records. Slice 1 wires the
 * Deal fetcher only — Lead and Ticket fetchers throw `501` until slice 2
 * adds them (so the route surface area is final but the data path is
 * incremental).
 *
 * Part of H3 Einstein Prediction Builder (Phase 3 slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { parseFieldSpecs, trainPredictionModel } from "@/lib/ml/prediction/engine"
import type { PredictionArtifact } from "@/lib/ml/prediction/types"

/**
 * Pull the universe of records the model trains on. Each fetcher owns
 * the projection (`select`) — we only need the target field + each
 * `inputFields[].field`, plus the row id for debugging.
 */
async function fetchTrainingRecords(
  organizationId: string,
  objectType: "deal" | "lead" | "ticket",
  fieldsNeeded: Set<string>
): Promise<Record<string, unknown>[]> {
  if (objectType === "deal") {
    // Slice 1 ships a generous superset of Deal columns; the engine
    // only reads the ones the model declared, so unused columns are
    // free.
    const rows = await prisma.deal.findMany({
      where: { organizationId },
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
      take: 5000,
    })
    return rows.map((r: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      for (const k of fieldsNeeded) out[k] = r[k]
      return out
    })
  }
  throw new Error(`Object type "${objectType}" not yet supported in slice 1`)
}

export const POST = withRlsAuth("ai", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const model = await prisma.predictionModel.findFirst({
    where: { id, organizationId: auth.orgId },
  })
  if (!model) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let specs
  try {
    specs = parseFieldSpecs(model.inputFields)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid inputFields" },
      { status: 422 }
    )
  }

  // Optimistic-lock the status flip: only transition into "training" from
  // a terminal state. Concurrent POSTs hit count === 0 and get a 409 —
  // prevents two parallel trainers from racing to write `artifact`.
  // Stamping `trainingStartedAt` lets a slice-2 stale-lock sweeper reset
  // models stuck in "training" after a route crash or timeout.
  const lockResult = await prisma.predictionModel.updateMany({
    where: {
      id,
      organizationId: auth.orgId,
      status: { in: ["draft", "trained", "failed"] },
    },
    data: { status: "training", trainingStartedAt: new Date() },
  })
  if (lockResult.count === 0) {
    return NextResponse.json(
      { error: "Model is already training — wait for the current run to finish" },
      { status: 409 }
    )
  }

  let records: Record<string, unknown>[]
  try {
    const fieldsNeeded = new Set<string>([model.targetField, ...specs.map(s => s.field)])
    records = await fetchTrainingRecords(
      auth.orgId,
      model.objectType as "deal" | "lead" | "ticket",
      fieldsNeeded
    )
  } catch (e) {
    await prisma.predictionModel.update({
      where: { id },
      data: { status: "failed", trainingStartedAt: null },
    })
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fetch failed" },
      { status: 501 }
    )
  }

  let artifact: PredictionArtifact
  try {
    artifact = trainPredictionModel({
      specs,
      records,
      targetField: model.targetField,
      positiveValues: model.positiveValues,
    })
  } catch (e) {
    await prisma.predictionModel.update({
      where: { id },
      data: { status: "failed", trainingStartedAt: null },
    })
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Training failed" },
      { status: 422 }
    )
  }

  const trainedAt = new Date(artifact.trainedAt)
  const updated = await prisma.predictionModel.update({
    where: { id },
    data: {
      status: "trained",
      artifact: artifact as unknown as Prisma.InputJsonValue,
      accuracy: artifact.accuracy,
      trainedAt,
      trainingStartedAt: null,
    },
    select: {
      id: true,
      name: true,
      status: true,
      accuracy: true,
      trainedAt: true,
    },
  })

  return NextResponse.json({
    model: updated,
    summary: {
      sampleCount: artifact.sampleCount,
      positiveCount: artifact.positiveCount,
      featureCount: artifact.featureNames.length,
      accuracy: artifact.accuracy,
    },
  })
})
