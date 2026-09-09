/**
 * POST /api/v1/trade-promotions/[id]/audits
 *
 * Record a RetailExecutionAudit for an MTM visit, scored against the
 * supplied planogram spec + observations. The route runs the
 * planogram-scorer + persists the result.
 *
 * Body:
 *   { visitId, planogramSpec, observations, weights? }
 *
 * Slice 1 ships the audit-record path; slice 2 wires the KPI cron
 * that aggregates audit scores by promotion / route / agent.
 *
 * Part of R4 Consumer Goods Cloud (Phase 5 slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { scorePlanogram } from "@/lib/consumer-goods/planogram-scorer"

const bodySchema = z.object({
  visitId: z.string().min(1).max(120),
  planogramSpec: z.object({
    facingsByProduct: z.record(z.string(), z.number().int().min(0)),
    requiredProducts: z.array(z.string().min(1).max(64)).max(500),
    expectedShareOfShelf: z.number().min(0).max(1).optional(),
  }),
  observations: z.object({
    facingsByProduct: z.record(z.string(), z.number().int().min(0)),
    productsPresent: z.array(z.string().min(1).max(64)).max(500),
    priceTagsCorrect: z.number().int().min(0),
    priceTagsTotal: z.number().int().min(0),
    totalShelfFacings: z.number().int().min(0).optional(),
  }),
  weights: z
    .object({
      osa: z.number().min(0),
      shareOfShelf: z.number().min(0),
      planogramCompliance: z.number().min(0),
      priceTagAccuracy: z.number().min(0),
    })
    .partial()
    .optional(),
})

async function readBody(req: NextRequest): Promise<unknown | NextResponse> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }
}

export const POST = withRlsAuth("tpm", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Validate sanity: priceTagsCorrect <= priceTagsTotal.
  if (parsed.data.observations.priceTagsCorrect > parsed.data.observations.priceTagsTotal) {
    return NextResponse.json(
      { error: "priceTagsCorrect cannot exceed priceTagsTotal" },
      { status: 400 }
    )
  }

  // Verify the promotion belongs to this tenant.
  const promotion = await prisma.tradePromotion.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true, status: true },
  })
  if (!promotion) return NextResponse.json({ error: "Promotion not found" }, { status: 404 })

  // Verify the visit belongs to this tenant — defence-in-depth FK
  // check; route enforces tenant scoping that DB FK alone can't.
  const visit = await prisma.mtmVisit.findFirst({
    where: { id: parsed.data.visitId, organizationId: auth.orgId, deletedAt: null },
    select: { id: true },
  })
  if (!visit) return NextResponse.json({ error: "Visit not found in this tenant" }, { status: 404 })

  // Score before persisting so the persisted row carries the scored
  // breakdown atomically.
  const scoreBreakdown = scorePlanogram({
    spec: parsed.data.planogramSpec,
    observations: parsed.data.observations,
    weights: parsed.data.weights,
  })

  const created = await prisma.retailExecutionAudit.create({
    data: {
      organizationId: auth.orgId,
      promotionId: promotion.id,
      visitId: visit.id,
      planogramSpec: parsed.data.planogramSpec as unknown as Prisma.InputJsonValue,
      observations: parsed.data.observations as unknown as Prisma.InputJsonValue,
      scoreBreakdown: scoreBreakdown as unknown as Prisma.InputJsonValue,
      totalScore: scoreBreakdown.totalScore,
      auditedBy: auth.userId,
    },
    select: {
      id: true,
      visitId: true,
      promotionId: true,
      totalScore: true,
      auditedAt: true,
    },
  })

  return NextResponse.json({ audit: created, scoreBreakdown }, { status: 201 })
})
