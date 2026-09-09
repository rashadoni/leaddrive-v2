/**
 * S6 CPQ — Quote list (GET) + Quote create (POST).
 *
 * GET  /api/v1/quotes      — org-scoped list with status + dealId filters
 * POST /api/v1/quotes      — create a draft Quote (optionally with initial line items)
 *
 * Auth: org-scoped via `withRls` (uses the passed { orgId, session }). A dedicated
 * `cpq:*` permission key can land in slice-3 once the Quote builder UI
 * ships and per-role write gating becomes meaningful.
 *
 * State machine: only `draft` quotes can be created via POST. Transition
 * to `sent` / `viewed` / `accepted` etc. happens via PATCH on
 * `/api/v1/quotes/[id]` and is validated by `transitionQuote()` from
 * `src/lib/cpq/state-machine.ts`.
 *
 * Auto-rollup: when initial line items are supplied, `rollUpQuote()`
 * computes line totals + subtotal + totalAmount inside a single
 * `prisma.$transaction` so the persisted state is always consistent.
 */
import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"
import { rollUpQuote } from "@/lib/cpq/totals"
import { isValidLineQuantity, LINE_TYPES } from "@/lib/cpq/line-types"

/**
 * Numeric coercion: accepts number OR string (so the client can send
 * "1500.25" without floating-point surprises). The XOR enforcers below
 * treat "0" / 0 / null / undefined as "not supplied" for the purpose of
 * the discountAmount/discountPct mutual-exclusion rule — same
 * convention `rollUpQuote()` uses internally.
 */
function asPositive(v: unknown): boolean {
  if (v === undefined || v === null) return false
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) && n > 0
}

function asNonNegative(v: unknown): boolean {
  if (v === undefined || v === null) return true
  const n = typeof v === "string" ? Number(v) : (v as number)
  return Number.isFinite(n) && n >= 0
}

const lineItemSchema = z
  .object({
    productId: z.string().min(1).max(50).nullable().optional(),
    productName: z.string().min(1).max(200),
    sku: z.string().max(64).nullable().optional(),
    productType: z.enum(LINE_TYPES).optional(),
    description: z.string().max(2000).nullable().optional(),
    quantity: z.union([z.number(), z.string()]).optional(),
    unitPrice: z.union([z.number(), z.string()]),
    lineDiscountAmount: z.union([z.number(), z.string()]).nullable().optional(),
    lineDiscountPct: z.union([z.number(), z.string()]).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  // Architect P1 fix — XOR enforcement (was promised in totals.ts
  // docblock; now enforced at the route boundary).
  .refine(
    (li) => !(asPositive(li.lineDiscountAmount) && asPositive(li.lineDiscountPct)),
    { message: "lineDiscountAmount and lineDiscountPct are mutually exclusive — supply at most one" },
  )
  // Architect P3 fix — reject negative discounts at the route layer
  // (totals.ts has a defense-in-depth clamp but the inputs themselves
  // shouldn't be negative).
  .refine((li) => asNonNegative(li.lineDiscountAmount), { message: "lineDiscountAmount must be ≥ 0" })
  .refine((li) => asNonNegative(li.lineDiscountPct), { message: "lineDiscountPct must be ≥ 0" })
  .refine((li) => isValidLineQuantity(li.productType, li.quantity), { message: "quantity must be a whole number ≥ 1 (or > 0 for service)" })
  .refine((li) => asNonNegative(li.unitPrice), { message: "unitPrice must be ≥ 0" })

const createQuoteSchema = z
  .object({
    quoteNumber: z.string().min(1).max(50),
    version: z.number().int().min(1).max(1000).optional(),
    dealId: z.string().min(1).max(50).nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
    currency: z.string().min(3).max(3).optional(),
    discountAmount: z.union([z.number(), z.string()]).nullable().optional(),
    discountPct: z.union([z.number(), z.string()]).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    customerName: z.string().max(200).nullable().optional(),
    lineItems: z.array(lineItemSchema).max(500).optional(),
  })
  // Same XOR + non-negative rules at the quote level.
  .refine(
    (q) => !(asPositive(q.discountAmount) && asPositive(q.discountPct)),
    { message: "discountAmount and discountPct are mutually exclusive — supply at most one" },
  )
  .refine((q) => asNonNegative(q.discountAmount), { message: "discountAmount must be ≥ 0" })
  .refine((q) => asNonNegative(q.discountPct), { message: "discountPct must be ≥ 0" })

export const GET = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "sales"))) return moduleDisabledResponse("sales")

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || ""
  const dealId = searchParams.get("dealId") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1 || limit > 200) {
    return NextResponse.json({ error: "Invalid page or limit" }, { status: 400 })
  }

  try {
    const where: Prisma.QuoteWhereInput = {
      organizationId: orgId,
      ...(status ? { status } : {}),
      ...(dealId ? { dealId } : {}),
    }
    // Explicit `select` rather than `include` — the list endpoint
    // intentionally OMITS `trackingToken` and `rejectedReason`. Both
    // are capability-grade fields: a leaked token lets anyone with the
    // URL flip status `sent → viewed`; rejectedReason is bound-AAD
    // PII. Detail GET surfaces them under tighter scrutiny; list-
    // shaped logging / pagination caching shouldn't carry either.
    const [quotes, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          quoteNumber: true,
          version: true,
          dealId: true,
          status: true,
          validUntil: true,
          currency: true,
          subtotal: true,
          discountAmount: true,
          discountPct: true,
          totalAmount: true,
          notes: true,
          sentAt: true,
          viewedAt: true,
          acceptedAt: true,
          rejectedAt: true,
          createdAt: true,
          updatedAt: true,
          deal: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true } },
          _count: { select: { lineItems: true } },
          // trackingToken: NOT exposed in list responses (capability).
          // rejectedReason: NOT exposed (PII bound-AAD; surface via detail GET only).
        },
      }),
      prisma.quote.count({ where }),
    ])

    return NextResponse.json({ quotes, total, page, limit })
  } catch (err) {
    console.error("[quotes] GET error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "sales"))) return moduleDisabledResponse("sales")

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = createQuoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const input = parsed.data

  // Cross-tenant guard — if a dealId is supplied, it MUST belong to the
  // caller's org. Without this, a malicious caller could attach a quote
  // to another tenant's deal by guessing the ID.
  if (input.dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: input.dealId, organizationId: orgId },
      select: { id: true },
    })
    if (!deal) {
      return NextResponse.json(
        { error: "Deal not found in this tenant" },
        { status: 404 },
      )
    }
  }

  // Cross-tenant guard — reject any line-item productId that doesn't belong to
  // this org. Without this a crafted request could plant a foreign-org product FK.
  const lineProductIds = [...new Set((input.lineItems ?? []).map((li) => li.productId).filter((id): id is string => !!id))]
  if (lineProductIds.length > 0) {
    const owned = await prisma.product.findMany({
      where: { id: { in: lineProductIds }, organizationId: orgId },
      select: { id: true },
    })
    if (owned.length !== lineProductIds.length) {
      return NextResponse.json({ error: "A line item references an unknown product" }, { status: 400 })
    }
  }

  // Compute totals from the initial line items (if any) BEFORE persistence.
  const rolled = rollUpQuote(
    (input.lineItems || []).map((li) => ({
      quantity: li.quantity ?? 1,
      unitPrice: li.unitPrice,
      lineDiscountAmount: li.lineDiscountAmount,
      lineDiscountPct: li.lineDiscountPct,
    })),
    {
      discountAmount: input.discountAmount,
      discountPct: input.discountPct,
    },
  )

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          quoteNumber: input.quoteNumber,
          version: input.version ?? 1,
          dealId: input.dealId ?? null,
          status: "draft",
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          currency: input.currency ?? "AZN",
          subtotal: rolled.subtotal.toString(),
          discountAmount: (input.discountAmount ?? 0).toString(),
          discountPct: input.discountPct != null ? input.discountPct.toString() : null,
          totalAmount: rolled.totalAmount.toString(),
          notes: input.notes ?? null,
          customerName: input.customerName ?? null,
          // Slice-3 piece-3: opaque token embedded in the customer email's
          // 1×1 tracking pixel URL. Generated server-side at creation
          // time so quotes are tracking-ready the moment they exist.
          // 122 bits of UUIDv4 randomness — unguessable.
          trackingToken: randomUUID(),
          createdBy: session?.userId ?? null,
        },
      })

      if (input.lineItems && input.lineItems.length > 0) {
        await tx.quoteLineItem.createMany({
          data: input.lineItems.map((li, i) => ({
            quoteId: quote.id,
            productId: li.productId ?? null,
            productName: li.productName,
            sku: li.sku ?? null,
            productType: li.productType ?? "other",
            description: li.description ?? null,
            quantity: (li.quantity ?? 1).toString(),
            unitPrice: li.unitPrice.toString(),
            lineDiscountAmount: (li.lineDiscountAmount ?? 0).toString(),
            lineDiscountPct: li.lineDiscountPct != null ? li.lineDiscountPct.toString() : null,
            lineTotal: rolled.lineTotals[i].toString(),
            sortOrder: li.sortOrder ?? i,
          })),
        })
      }

      return tx.quote.findUnique({
        where: { id: quote.id },
        include: { lineItems: { orderBy: { sortOrder: "asc" } } },
      })
    })

    return NextResponse.json({ quote: created }, { status: 201 })
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 = unique violation on (organizationId, quoteNumber, version).
      if (err.code === "P2002") {
        return NextResponse.json(
          {
            error:
              "A quote with this (quoteNumber, version) already exists. To revise, bump `version`.",
          },
          { status: 409 },
        )
      }
    }
    console.error("[quotes] POST error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
