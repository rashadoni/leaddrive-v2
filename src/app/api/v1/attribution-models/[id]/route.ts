/**
 * C9 Marketing Attribution — single-model mutations.
 *
 * PATCH  /api/v1/attribution-models/[id] — update name/description/config/
 *   isDefault and drive the status machine (draft→active→archived). modelType
 *   is immutable (DB trigger) — attempting to change it is a 400. config is
 *   re-validated against the existing (immutable) modelType.
 * DELETE /api/v1/attribution-models/[id] — remove a model; FK cascade drops
 *   its influences + calculation runs.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  validateModelConfig,
  canTransitionModelStatus,
  isModelStatus,
} from "@/lib/marketing-attribution/model-config-validator"
import type { ModelStatus, AttributionModelType } from "@/lib/marketing-attribution/types"

const MAX_MODEL_NAME_LEN = 120
const MAX_MODEL_DESC_LEN = 500

interface PatchBody {
  name?: unknown
  description?: unknown
  config?: unknown
  isDefault?: unknown
  status?: unknown
  modelType?: unknown
}

export const PATCH = withRlsAuth("campaigns", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing model id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // org-scoped existence + current state (needed for config re-validation
  // against the immutable modelType and for the status-transition guard).
  const existing = await prisma.attributionModel.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, modelType: true, status: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Model not found" }, { status: 404 })
  }

  // modelType is immutable (DB trigger rejects it) — fail loud instead of
  // silently dropping the field.
  if (body.modelType !== undefined && body.modelType !== existing.modelType) {
    return NextResponse.json(
      { error: "`modelType` is immutable — create a new model instead" },
      { status: 400 },
    )
  }

  const data: {
    name?: string
    description?: string | null
    config?: object
    isDefault?: boolean
    status?: ModelStatus
    archivedAt?: Date
  } = {}

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > MAX_MODEL_NAME_LEN) {
      return NextResponse.json(
        { error: "Invalid `name` — required, up to 120 chars" },
        { status: 400 },
      )
    }
    data.name = body.name.trim()
  }

  if (body.description !== undefined) {
    data.description =
      typeof body.description === "string" ? body.description.slice(0, MAX_MODEL_DESC_LEN) : null
  }

  if (body.config !== undefined) {
    const configCheck = validateModelConfig(existing.modelType as AttributionModelType, body.config)
    if (!configCheck.ok) {
      return NextResponse.json(
        { error: `Invalid \`config\`: ${configCheck.message}`, code: configCheck.code, field: configCheck.field },
        { status: 400 },
      )
    }
    data.config = body.config as object
  }

  if (body.isDefault !== undefined) {
    if (typeof body.isDefault !== "boolean") {
      return NextResponse.json({ error: "Invalid `isDefault` — boolean required" }, { status: 400 })
    }
    data.isDefault = body.isDefault
  }

  if (body.status !== undefined) {
    if (!isModelStatus(body.status)) {
      return NextResponse.json(
        { error: "Invalid `status` — one of draft, active, archived" },
        { status: 400 },
      )
    }
    if (body.status !== existing.status) {
      if (!canTransitionModelStatus(existing.status as ModelStatus, body.status)) {
        return NextResponse.json(
          { error: `Illegal status transition ${existing.status} → ${body.status}` },
          { status: 400 },
        )
      }
      data.status = body.status
      // archived-coherence CHECK requires archivedAt set when archiving.
      if (body.status === "archived") data.archivedAt = new Date()
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No mutable fields provided" }, { status: 400 })
  }

  try {
    // Setting this model as default must first clear the previous default
    // (partial-unique index allows only one isDefault=true per org).
    const model =
      data.isDefault === true
        ? await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.attributionModel.updateMany({
              where: { organizationId: orgId, isDefault: true, NOT: { id } },
              data: { isDefault: false },
            })
            return tx.attributionModel.update({ where: { id }, data })
          })
        : await prisma.attributionModel.update({ where: { id }, data })
    return NextResponse.json({ model })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A model with this `name` already exists for your tenant" },
        { status: 409 },
      )
    }
    console.error("[attribution-models/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update attribution model" },
      { status: 500 },
    )
  }
})

export const DELETE = withRlsAuth("campaigns", "delete", async (_req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing model id" }, { status: 400 })
  }

  try {
    const existing = await prisma.attributionModel.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 })
    }
    // FK cascade removes campaign_influences + attribution_calculation_runs.
    await prisma.attributionModel.delete({ where: { id } })
    return NextResponse.json({ ok: true, id: existing.id, name: existing.name })
  } catch (err) {
    console.error("[attribution-models/:id] DELETE error:", err)
    return NextResponse.json(
      { error: "Failed to delete attribution model" },
      { status: 500 },
    )
  }
})
