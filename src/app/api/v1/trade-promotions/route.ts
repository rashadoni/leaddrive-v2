/**
 * Trade-promotion registry — R4 Phase 5 slice 1.
 *
 *   POST /api/v1/trade-promotions  — create a promotion campaign
 *   GET  /api/v1/trade-promotions  — list tenant campaigns
 *
 * Tactics + spends + audits are written via separate endpoints
 * (slice-1 ships POST /[id]/audits; tactic + spend CRUD lands in
 * slice 2 alongside the KPI rollup cron).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    status: z.enum(["planned", "active", "completed", "cancelled"]).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    productSkus: z.array(z.string().min(1).max(64)).max(500).optional(),
    channelType: z.string().max(64).optional(),
    budgetAmount: z.number().min(0).optional(),
    budgetCurrency: z.string().length(3).optional(),
    upliftTargetAmount: z.number().min(0).optional(),
    baselineSalesAmount: z.number().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    if (new Date(data.endsAt) <= new Date(data.startsAt)) {
      ctx.addIssue({
        code: "custom",
        message: "endsAt must be strictly after startsAt",
        path: ["endsAt"],
      })
    }
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

export const POST = withRlsAuth("tpm", "write", async (req, auth) => {
  // `tpm` (Trade Promotion Management) module — field agents
  // (sales/support roles) get write access via permissions.ts; admin
  // tier gets delete. Avoids the slice-1 mistake of gating retail-
  // execution audits behind admin-only `settings:write`.

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  let created
  try {
    created = await prisma.tradePromotion.create({
      data: {
        organizationId: auth.orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        status: parsed.data.status ?? "planned",
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        productSkus: parsed.data.productSkus ?? [],
        channelType: parsed.data.channelType ?? null,
        budgetAmount: parsed.data.budgetAmount ?? 0,
        budgetCurrency: parsed.data.budgetCurrency ?? "USD",
        upliftTargetAmount: parsed.data.upliftTargetAmount ?? null,
        baselineSalesAmount: parsed.data.baselineSalesAmount ?? null,
        createdBy: auth.userId,
      },
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `A promotion with name "${parsed.data.name}" already exists in this tenant` },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ promotion: created }, { status: 201 })
})

const statusFilterSchema = z.enum(["planned", "active", "completed", "cancelled"]).optional()

export const GET = withRlsAuth("tpm", "read", async (req, auth) => {
  const url = new URL(req.url)
  // Validate the status query param via Zod — silently dropping
  // `?status=bogus` would return an empty list, which is misleading.
  const statusRaw = url.searchParams.get("status")
  const statusParsed = statusFilterSchema.safeParse(statusRaw ?? undefined)
  if (!statusParsed.success) {
    // Truncate the echoed value to keep oversized `?status=<huge_blob>`
    // from inflating error bodies.
    const echo = (statusRaw ?? "").slice(0, 32)
    return NextResponse.json(
      { error: `Invalid status filter: "${echo}"` },
      { status: 400 }
    )
  }
  const status = statusParsed.data

  const promotions = await prisma.tradePromotion.findMany({
    where: {
      organizationId: auth.orgId,
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { startsAt: "desc" }],
    // TODO(slice 2): cursor pagination alongside the KPI dashboard
    // — tenants with >500 promotions would silently truncate today.
    take: 500,
  })

  return NextResponse.json({ promotions })
})
