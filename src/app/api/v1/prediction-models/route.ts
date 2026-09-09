/**
 * Prediction Builder model registry — H3 Phase 3 slice 1.
 *
 *   POST /api/v1/prediction-models   — create a new model definition
 *   GET  /api/v1/prediction-models   — list models for the tenant
 *
 * Training is a separate explicit step (POST /[id]/train) so a new model
 * starts in `status: "draft"` until the user runs training. Slice 2
 * adds an auto-retrain cron.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { parseFieldSpecs } from "@/lib/ml/prediction/engine"

const fieldSpecSchema = z.union([
  z.object({ field: z.string().min(1).max(64), kind: z.literal("numeric") }),
  z.object({
    field: z.string().min(1).max(64),
    kind: z.literal("categorical"),
    oneHotValues: z.array(z.string().min(1).max(64)).min(1).max(50),
  }),
])

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  objectType: z.enum(["deal", "lead", "ticket"]),
  targetField: z.string().min(1).max(64),
  positiveValues: z.array(z.string().min(1).max(120)).min(1).max(20),
  inputFields: z.array(fieldSpecSchema).min(1).max(30),
})

export const POST = withRlsAuth("ai", "write", async (req: NextRequest, auth) => {
  let body: unknown
  try { body = await req.json() } catch { body = {} }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Defensive double-parse — the runtime parser is what the trainer/scorer
  // calls, so this surfaces any drift between the Zod and engine schemas
  // before the row hits the DB.
  try {
    parseFieldSpecs(parsed.data.inputFields)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid inputFields" },
      { status: 400 }
    )
  }

  const created = await prisma.predictionModel.create({
    data: {
      organizationId: auth.orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      objectType: parsed.data.objectType,
      targetField: parsed.data.targetField,
      positiveValues: parsed.data.positiveValues,
      inputFields: parsed.data.inputFields as unknown as Prisma.InputJsonValue,
      status: "draft",
      createdBy: auth.userId,
    },
  })

  return NextResponse.json({ model: created }, { status: 201 })
})

export const GET = withRlsAuth("ai", "read", async (req: NextRequest, auth) => {
  const url = new URL(req.url)
  const objectType = url.searchParams.get("objectType")

  const models = await prisma.predictionModel.findMany({
    where: {
      organizationId: auth.orgId,
      ...(objectType ? { objectType } : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      objectType: true,
      targetField: true,
      positiveValues: true,
      inputFields: true,
      status: true,
      accuracy: true,
      trainedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  })

  return NextResponse.json({ models })
})
