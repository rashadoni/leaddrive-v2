/**
 * Buyer-account registry — D1 Phase 6 Block A slice 1.
 *
 *   POST /api/v1/buyer-accounts  — create a B2B buyer account on a Company
 *   GET  /api/v1/buyer-accounts  — list (filter by status)
 *
 * One buyer account per (org, company). Slice 1 ships account CRUD;
 * slice 2 wires order create + RFQ submit/convert routes (the engine
 * helpers + tests for those are already in place).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createSchema = z.object({
  companyId: z.string().min(1).max(120),
  creditLimit: z.number().min(0).max(1_000_000_000).optional(),
  currency: z.string().length(3).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  priceListId: z.string().min(1).max(120).optional(),
  status: z.enum(["active", "suspended", "closed"]).optional(),
  notes: z.string().max(4000).optional(),
})

const statusFilterSchema = z.enum(["active", "suspended", "closed"]).optional()

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

export const POST = withRlsAuth("commerce", "write", async (req: NextRequest, auth) => {
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Cross-tenant Company FK check — no FK enforces same-org boundary.
  const company = await prisma.company.findFirst({
    where: { id: parsed.data.companyId, organizationId: auth.orgId },
    select: { id: true },
  })
  if (!company) {
    return NextResponse.json({ error: "Company not found in tenant" }, { status: 404 })
  }

  let created
  try {
    created = await prisma.buyerAccount.create({
      data: {
        organizationId: auth.orgId,
        companyId: company.id,
        creditLimit: parsed.data.creditLimit ?? 0,
        currency: parsed.data.currency ?? "USD",
        paymentTermsDays: parsed.data.paymentTermsDays ?? 0,
        priceListId: parsed.data.priceListId ?? null,
        status: parsed.data.status ?? "active",
        notes: parsed.data.notes ?? null,
        createdBy: auth.userId,
      },
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A buyer account already exists for this company in this tenant" },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ buyerAccount: created }, { status: 201 })
})

export const GET = withRlsAuth("commerce", "read", async (req: NextRequest, auth) => {
  const url = new URL(req.url)
  const statusRaw = url.searchParams.get("status")
  const statusParsed = statusFilterSchema.safeParse(statusRaw ?? undefined)
  if (!statusParsed.success) {
    const echo = (statusRaw ?? "").slice(0, 32)
    return NextResponse.json(
      { error: `Invalid status filter: "${echo}"` },
      { status: 400 }
    )
  }

  const accounts = await prisma.buyerAccount.findMany({
    where: {
      organizationId: auth.orgId,
      ...(statusParsed.data ? { status: statusParsed.data } : {}),
    },
    orderBy: { createdAt: "desc" },
    // TODO(slice 2): cursor pagination paired with the commerce admin dashboard.
    take: 500,
  })

  return NextResponse.json({ accounts })
})
