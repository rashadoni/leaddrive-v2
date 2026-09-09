import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

// DELETE takes its id from the body. Without a schema, a JSON object reaches
// Prisma as a FILTER rather than a value — {"competitorId": {"not": "x"}} would
// have deleted every competitor of the deal except one. The dealId predicate
// keeps that inside the caller's own deal, but a body-supplied id should be a
// string and nothing else.
const removeSchema = z.object({
  competitorId: z.string().min(1),
})

const addSchema = z.object({
  name: z.string().min(1),
  product: z.string().optional(),
  strengths: z.string().optional(),
  weaknesses: z.string().optional(),
  price: z.string().optional(),
  threat: z.enum(["High", "Medium", "Low"]).default("Medium"),
  notes: z.string().optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const competitors = await prisma.dealCompetitor.findMany({
      where: { dealId: id },
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json({ success: true, data: competitors })
  } catch (e: any) {
    console.error("[competitors GET]", e?.message || e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = addSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const { name, product, strengths, weaknesses, price, threat } = parsed.data
    const competitor = await prisma.dealCompetitor.upsert({
      where: { dealId_name: { dealId: id, name } },
      // organizationId is denormalised from the parent deal so deal_competitors
      // can carry the standard tenant_isolation policy.
      create: { organizationId: orgId, dealId: id, name, product: product || null, strengths: strengths || null, weaknesses: weaknesses || null, price: price || null, threat, notes: null },
      update: { product: product || null, strengths: strengths || null, weaknesses: weaknesses || null, price: price || null, threat },
    })

    return NextResponse.json({ success: true, data: competitor })
  } catch (e: any) {
    console.error("[competitors POST]", e?.message || e)
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const parsed = removeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: "competitorId required" }, { status: 400 })
    const { competitorId } = parsed.data

    const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    // competitorId arrives straight from the body and used to reach
    // `delete({ where: { id: competitorId } })` unconstrained. The deal lookup
    // above only ever gated the 404 — it never tied the competitor to the deal,
    // and deal_competitors carried no RLS policy, so any authenticated user in
    // any tenant could delete any competitor row in the database by naming one
    // of their own deals in the URL.
    //
    // deleteMany also closes the existence oracle the old code left behind: a
    // nonexistent id raised P2025 and fell through to 500, while a real foreign
    // id returned 200, which was enough to probe for ids blind. Both now answer
    // 404 identically. GET keys on dealId and POST on the dealId_name compound
    // unique, so only DELETE was affected.
    const removed = await prisma.dealCompetitor.deleteMany({ where: { id: competitorId, dealId: id } })
    if (removed.count === 0) return NextResponse.json({ error: "Competitor not found" }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("[competitors DELETE]", e?.message || e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
