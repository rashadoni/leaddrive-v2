/**
 * C9 Marketing Attribution — models collection API.
 *
 * GET  /api/v1/attribution-models — list `attribution_models` org-scoped +
 *   latest run summary + total influence/touchpoint counts. Sort: default
 *   model first (isDefault), then active before draft before archived, then
 *   most-recent updatedAt.
 * POST /api/v1/attribution-models — create a model (config validated against
 *   modelType; draft/active on create; isDefault clears the prior default).
 *
 * Single-model mutations (PATCH/DELETE) live in `[id]/route.ts`. The recompute
 * worker that fills campaign_influences is Phase 3 (cron + manual trigger).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { validateModelConfig, isCanonicalAttributionModelType } from "@/lib/marketing-attribution/model-config-validator"
import { withRls, withRlsAuth } from "@/lib/with-rls"

const MAX_MODEL_NAME_LEN = 120
const MAX_MODEL_DESC_LEN = 500

interface ModelRow {
  id: string
  name: string
  description: string | null
  modelType: string
  config: unknown
  status: string
  isDefault: boolean
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface LatestRunRow {
  modelId: string
  status: string
  triggerSource: string
  dealsTotal: number
  dealsProcessed: number
  influencesWritten: number
  startedAt: Date | null
  endedAt: Date | null
  errorMessage: string | null
  createdAt: Date
}

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  draft: 1,
  archived: 2,
}

export const GET = withRls(async (_req: NextRequest, { orgId }) => {
  try {
    const models = (await prisma.attributionModel.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        description: true,
        modelType: true,
        config: true,
        status: true,
        isDefault: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }],
    })) as ModelRow[]

    const modelIds = models.map((m) => m.id)

    // Latest run per model. Earlier approach used `findMany(take: N*5)` +
    // client-side bucketing — that silently drops other models' latest
    // runs when one model has many recent runs in the window
    // (cron-retry loop, manual backfill). Architect raised this.
    // Replaced with parallel per-model `findFirst` — bounded N (usually
    // a handful of models), one round trip each, no eviction risk.
    const latestRunByModel = new Map<string, LatestRunRow>()
    if (modelIds.length) {
      const runs = (await Promise.all(
        modelIds.map((modelId) =>
          prisma.attributionCalculationRun.findFirst({
            where: { organizationId: orgId, modelId },
            select: {
              modelId: true,
              status: true,
              triggerSource: true,
              dealsTotal: true,
              dealsProcessed: true,
              influencesWritten: true,
              startedAt: true,
              endedAt: true,
              errorMessage: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }],
          }),
        ),
      )) as (LatestRunRow | null)[]
      for (const run of runs) {
        if (run) latestRunByModel.set(run.modelId, run)
      }
    }

    // Influence + touchpoint counts per model — single grouped query.
    // #18 — split by kind: realized (won) drives the headline KPIs;
    // projected (pipeline, open deals) is surfaced separately.
    const influenceCounts = modelIds.length
      ? await prisma.campaignInfluence.groupBy({
          by: ["modelId", "kind"],
          where: {
            organizationId: orgId,
            modelId: { in: modelIds },
          },
          _count: { _all: true },
          _sum: { attributedRevenue: true },
        })
      : []
    const infByModel = new Map<
      string,
      { count: number; revenue: number; pipelineCount: number; pipelineRevenue: number }
    >()
    for (const row of influenceCounts) {
      const cur = infByModel.get(row.modelId) ?? { count: 0, revenue: 0, pipelineCount: 0, pipelineRevenue: 0 }
      // decimalToNumber handles null (→ 0) and Decimal objects from Prisma _sum
      const rev = decimalToNumber(row._sum.attributedRevenue)
      if (row.kind === "pipeline") {
        cur.pipelineCount += row._count._all
        cur.pipelineRevenue += rev
      } else {
        cur.count += row._count._all
        cur.revenue += rev
      }
      infByModel.set(row.modelId, cur)
    }

    // Total touchpoints is model-agnostic — single org-scoped count.
    const touchpointTotal = await prisma.campaignTouchpoint.count({
      where: { organizationId: orgId },
    })

    const enriched = models.map((m) => {
      const run = latestRunByModel.get(m.id) ?? null
      const inf = infByModel.get(m.id) ?? { count: 0, revenue: 0, pipelineCount: 0, pipelineRevenue: 0 }
      const durationMs =
        run?.startedAt && run.endedAt
          ? run.endedAt.getTime() - run.startedAt.getTime()
          : null
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        modelType: m.modelType,
        config: m.config,
        status: m.status,
        isDefault: m.isDefault,
        archivedAt: m.archivedAt,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        influenceCount: inf.count,
        attributedRevenue: inf.revenue,
        pipelineInfluenceCount: inf.pipelineCount,
        pipelineRevenue: inf.pipelineRevenue,
        latestRun: run
          ? {
              status: run.status,
              triggerSource: run.triggerSource,
              dealsTotal: run.dealsTotal,
              dealsProcessed: run.dealsProcessed,
              influencesWritten: run.influencesWritten,
              startedAt: run.startedAt,
              endedAt: run.endedAt,
              durationMs,
              errorMessage: run.errorMessage,
              createdAt: run.createdAt,
            }
          : null,
      }
    })

    // Sort: default first, then status (active > draft > archived), then
    // updatedAt desc (stable tiebreaker).
    enriched.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      const sa = STATUS_ORDER[a.status] ?? 9
      const sb = STATUS_ORDER[b.status] ?? 9
      if (sa !== sb) return sa - sb
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    })

    return NextResponse.json({
      models: enriched,
      totalModels: enriched.length,
      activeModelCount: enriched.filter((m) => m.status === "active").length,
      totalTouchpoints: touchpointTotal,
    })
  } catch (err) {
    console.error("[attribution-models] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load attribution models" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  name?: unknown
  description?: unknown
  modelType?: unknown
  config?: unknown
  isDefault?: unknown
  status?: unknown
}

/**
 * POST /api/v1/attribution-models — create a model.
 *
 * Config is validated against the chosen modelType via validateModelConfig
 * (mirrors the DB CHECK + the helper math). `status` may be created as draft
 * (default) or active; archived is reached only via PATCH (needs archivedAt
 * coherence). `isDefault=true` unsets the previous default in one transaction
 * (partial-unique `attribution_models_org_default_uniq`).
 */
export const POST = withRlsAuth("campaigns", "write", async (req: NextRequest, auth, _ctx) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > MAX_MODEL_NAME_LEN) {
    return NextResponse.json(
      { error: "Invalid `name` — required, up to 120 chars" },
      { status: 400 },
    )
  }
  if (!isCanonicalAttributionModelType(body.modelType)) {
    return NextResponse.json(
      { error: "Invalid `modelType` — must be one of first_touch, last_touch, linear, time_decay, u_shaped, custom" },
      { status: 400 },
    )
  }
  const config = body.config ?? {}
  const configCheck = validateModelConfig(body.modelType, config)
  if (!configCheck.ok) {
    return NextResponse.json(
      { error: `Invalid \`config\`: ${configCheck.message}`, code: configCheck.code, field: configCheck.field },
      { status: 400 },
    )
  }
  // Created models are draft (default) or active; archived requires the
  // archivedAt-coherence path handled in PATCH. Creating straight as active
  // is intentional (skips draft) — the lifecycle trigger is BEFORE UPDATE
  // only, so it doesn't constrain INSERT status.
  let status: "draft" | "active" = "draft"
  if (body.status !== undefined) {
    if (body.status !== "draft" && body.status !== "active") {
      return NextResponse.json(
        { error: "Invalid `status` — only `draft` or `active` allowed on create" },
        { status: 400 },
      )
    }
    status = body.status
  }
  const description =
    typeof body.description === "string" ? body.description.slice(0, MAX_MODEL_DESC_LEN) : null
  const isDefault = body.isDefault === true

  try {
    const data = {
      organizationId: orgId,
      name: body.name.trim(),
      description,
      modelType: body.modelType,
      config: config as object,
      status,
      isDefault,
      createdBy: auth.userId,
    }
    const model = isDefault
      ? await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.attributionModel.updateMany({
            where: { organizationId: orgId, isDefault: true },
            data: { isDefault: false },
          })
          return tx.attributionModel.create({ data })
        })
      : await prisma.attributionModel.create({ data })
    return NextResponse.json({ model }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A model with this `name` already exists for your tenant" },
        { status: 409 },
      )
    }
    console.error("[attribution-models] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create attribution model" },
      { status: 500 },
    )
  }
})
