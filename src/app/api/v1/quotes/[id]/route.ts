/**
 * S6 CPQ — Quote single-row endpoints.
 *
 * Auth: org-scoped via `withRls` (uses the passed { orgId, session }). See parent
 * `route.ts` header for the `cpq:*` permission key carve-out.
 *
 * GET    /api/v1/quotes/[id]   — fetch one quote with line items
 * PATCH  /api/v1/quotes/[id]   — update fields + state transitions + line-item replace + auto-rollup
 * DELETE /api/v1/quotes/[id]   — delete quote (cascades to line items)
 *
 * State machine: `transitionQuote()` from `src/lib/cpq/state-machine.ts`
 * validates every status change. The route also stamps the lifecycle
 * timestamp matching the target state (sent → sentAt, etc.).
 *
 * `rejectedReason` PII wrap: per architect's slice-2 P2 suggestion +
 * `Quote.rejectedReason` docblock, the field is encrypted via the
 * Phase 7 slice-3 column-bound AAD helpers on WRITE and soft-decrypted
 * on READ. Migration-tolerant fallback chain (bound → legacy → plaintext)
 * inside `softDecryptForTenantBound` handles legacy / pre-encryption rows
 * — see `memory/project_phase7_slice2_inventory.md` for the canonical
 * pattern.
 *
 * Auto-rollup: any PATCH that touches lineItems, discountAmount, or
 * discountPct triggers a `rollUpQuote()` recompute inside the same
 * `prisma.$transaction` so subtotal/totalAmount/per-line lineTotal
 * stay consistent.
 */
import { NextResponse } from "next/server"
import { Prisma, type QuoteLineItem } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"
import { rollUpQuote } from "@/lib/cpq/totals"
import { isValidLineQuantity, LINE_TYPES } from "@/lib/cpq/line-types"
import {
  transitionQuote,
  timestampFieldFor,
} from "@/lib/cpq/state-machine"
import { buildSpawnedContractData } from "@/lib/cpq/spawn-contract"
import {
  encryptForTenantBoundOrNull,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"
import { createNotification } from "@/lib/notifications"

const TABLE = "quotes"

/** See identical helpers in `route.ts` — same XOR + non-negative semantics. */
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
  // Architect P1 fix — XOR enforcement (kept in lockstep with POST route schema).
  .refine(
    (li) => !(asPositive(li.lineDiscountAmount) && asPositive(li.lineDiscountPct)),
    { message: "lineDiscountAmount and lineDiscountPct are mutually exclusive — supply at most one" },
  )
  .refine((li) => asNonNegative(li.lineDiscountAmount), { message: "lineDiscountAmount must be ≥ 0" })
  .refine((li) => asNonNegative(li.lineDiscountPct), { message: "lineDiscountPct must be ≥ 0" })
  .refine((li) => isValidLineQuantity(li.productType, li.quantity), { message: "quantity must be a whole number ≥ 1 (or > 0 for service)" })
  .refine((li) => asNonNegative(li.unitPrice), { message: "unitPrice must be ≥ 0" })

const patchSchema = z
  .object({
    status: z.enum(["draft", "sent", "viewed", "accepted", "rejected", "expired"]).optional(),
    dealId: z.string().min(1).max(50).nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    customerName: z.string().max(200).nullable().optional(),
    rejectedReason: z.string().max(5000).nullable().optional(),
    discountAmount: z.union([z.number(), z.string()]).nullable().optional(),
    discountPct: z.union([z.number(), z.string()]).nullable().optional(),
    /**
     * If supplied, REPLACES all existing line items in one atomic transaction.
     * To add/remove individual lines without re-sending the whole set,
     * use the per-item line-items endpoint (slice-3).
     */
    lineItems: z.array(lineItemSchema).max(500).optional(),
  })
  .refine(
    (q) => !(asPositive(q.discountAmount) && asPositive(q.discountPct)),
    { message: "discountAmount and discountPct are mutually exclusive — supply at most one" },
  )
  .refine((q) => asNonNegative(q.discountAmount), { message: "discountAmount must be ≥ 0" })
  .refine((q) => asNonNegative(q.discountPct), { message: "discountPct must be ≥ 0" })

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "sales"))) return moduleDisabledResponse("sales")

  const { id } = await params
  try {
    const quote = await prisma.quote.findFirst({
      where: { id, organizationId: orgId },
      include: {
        deal: { select: { id: true, name: true, company: { select: { name: true } } } },
        creator: { select: { id: true, name: true } },
        lineItems: { orderBy: { sortOrder: "asc" } },
      },
    })
    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }
    // Bound soft-decrypt rejectedReason; legacy/plaintext rows tolerated.
    //
    // `trackingToken` IS returned in the detail GET. Security model:
    // the token's capability scope (flip `sent → viewed`) is strictly
    // narrower than what the same caller can already do via PATCH
    // (manual state machine transition). So scoped readers receiving
    // the token grant no additional escalation. The risk surfaces only
    // if the response is logged / cached / proxied to a third party —
    // mitigation: callers (e.g. dashboard list endpoint) MUST NOT
    // include this projection.
    const response = {
      ...quote,
      rejectedReason: softDecryptForTenantBound(
        orgId,
        TABLE,
        "rejectedReason",
        quote.rejectedReason,
      ),
    }
    return NextResponse.json({ quote: response })
  } catch (err) {
    console.error("[quotes/:id] GET error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PATCH = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "sales"))) return moduleDisabledResponse("sales")

  const { id } = await params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const input = parsed.data

  // Load existing for state-machine + cross-tenant guard.
  const existing = await prisma.quote.findFirst({
    where: { id, organizationId: orgId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  })
  if (!existing) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  // Cross-tenant guard — a supplied dealId must belong to this org.
  // null = unlink (allowed); undefined = leave unchanged.
  if (input.dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: input.dealId, organizationId: orgId },
      select: { id: true },
    })
    if (!deal) {
      return NextResponse.json({ error: "Deal not found in this tenant" }, { status: 404 })
    }
  }

  // State machine — only validate when status actually changes.
  let timestampField: ReturnType<typeof timestampFieldFor> = null
  if (input.status && input.status !== existing.status) {
    const transition = transitionQuote(existing.status, input.status)
    if (!transition.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${transition.error}` },
        { status: 400 },
      )
    }
    timestampField = timestampFieldFor(input.status)
  }

  // Cross-tenant guard — reject any line-item productId that doesn't belong to
  // this org. Without this a crafted request could plant a foreign-org product FK.
  if (input.lineItems !== undefined) {
    const lineProductIds = [...new Set(input.lineItems.map((li) => li.productId).filter((id): id is string => !!id))]
    if (lineProductIds.length > 0) {
      const owned = await prisma.product.findMany({
        where: { id: { in: lineProductIds }, organizationId: orgId },
        select: { id: true },
      })
      if (owned.length !== lineProductIds.length) {
        return NextResponse.json({ error: "A line item references an unknown product" }, { status: 400 })
      }
    }
  }

  // Recompute totals when any cost-affecting field is touched.
  // If lineItems are NOT supplied, reuse existing line totals for the
  // subtotal compute; only the quote-level discount changes affect
  // totalAmount in that case.
  const linesForRollup =
    input.lineItems !== undefined
      ? input.lineItems.map((li) => ({
          quantity: li.quantity ?? 1,
          unitPrice: li.unitPrice,
          lineDiscountAmount: li.lineDiscountAmount,
          lineDiscountPct: li.lineDiscountPct,
        }))
      : existing.lineItems.map((li: QuoteLineItem) => ({
          quantity: li.quantity.toString(),
          unitPrice: li.unitPrice.toString(),
          lineDiscountAmount: li.lineDiscountAmount.toString(),
          lineDiscountPct: li.lineDiscountPct?.toString() ?? null,
        }))

  const newDiscountAmount =
    input.discountAmount !== undefined
      ? input.discountAmount ?? 0
      : existing.discountAmount.toString()
  const newDiscountPct =
    input.discountPct !== undefined
      ? input.discountPct
      : existing.discountPct?.toString() ?? null

  const rolled = rollUpQuote(linesForRollup, {
    discountAmount: newDiscountAmount,
    discountPct: newDiscountPct,
  })

  try {
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Build the update payload. Encrypted rejectedReason goes through
      // the bound-AAD helper; null clears the column.
      const data: Prisma.QuoteUpdateInput = {
        subtotal: rolled.subtotal.toString(),
        totalAmount: rolled.totalAmount.toString(),
      }
      if (input.status !== undefined) data.status = input.status
      if (input.validUntil !== undefined) {
        data.validUntil = input.validUntil ? new Date(input.validUntil) : null
      }
      if (input.notes !== undefined) data.notes = input.notes
      if (input.customerName !== undefined) data.customerName = input.customerName
      if (input.dealId !== undefined) {
        data.deal = input.dealId
          ? { connect: { id: input.dealId } }
          : { disconnect: true }
      }
      if (input.rejectedReason !== undefined) {
        data.rejectedReason =
          input.rejectedReason === null
            ? null
            : encryptForTenantBoundOrNull(
                orgId,
                TABLE,
                "rejectedReason",
                input.rejectedReason,
              )
      }
      if (input.discountAmount !== undefined) {
        data.discountAmount = (input.discountAmount ?? 0).toString()
      }
      if (input.discountPct !== undefined) {
        data.discountPct = input.discountPct != null ? input.discountPct.toString() : null
      }
      // Architect P1 fix — explicit switch instead of `as any` cast.
      // Money-adjacent code stays typed end-to-end; `timestampField`
      // is a narrow union from `timestampFieldFor()`.
      if (timestampField !== null) {
        const now = new Date()
        switch (timestampField) {
          case "sentAt":
            data.sentAt = now
            break
          case "viewedAt":
            data.viewedAt = now
            break
          case "acceptedAt":
            data.acceptedAt = now
            break
          case "rejectedAt":
            data.rejectedAt = now
            break
        }
      }

      await tx.quote.update({
        where: { id },
        data,
      })

      // Atomic replace of line items when supplied.
      if (input.lineItems !== undefined) {
        await tx.quoteLineItem.deleteMany({ where: { quoteId: id } })
        if (input.lineItems.length > 0) {
          await tx.quoteLineItem.createMany({
            data: input.lineItems.map((li, i) => ({
              quoteId: id,
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
      }

      // ── Slice-3 piece-4: Quote → Contract auto-spawn on accept ──
      //
      // Fires only on the `viewed → accepted` transition — the sole
      // source of `accepted` per `QUOTE_TRANSITIONS` in
      // `src/lib/cpq/types.ts:43-44`. State machine in this same
      // route already validated the transition (lines 184-190) before
      // this block runs.
      //
      // Done INSIDE the same `$transaction` as the quote update so a
      // Contract.create failure rolls back the status flip — quote
      // stays at `viewed`, user can retry. Money values come from the
      // rolled totals (the same numbers the route just persisted on
      // the quote), guaranteeing the Contract carries the
      // accepted-at-this-moment amount even if line items get edited
      // later.
      //
      // Idempotency: `Contract.spawnedFromQuoteId @unique` is the
      // physical guarantee — under any race, the second insert
      // violates the constraint and rolls back the transaction. The
      // outer catch surfaces 500 today; piece-4.5 will translate the
      // Prisma P2002 into a clean 409.
      let spawnedContract: { id: string; contractNumber: string } | null = null
      if (input.status === "accepted") {
        // Org-guarded deal lookup — `findUnique({where:{id}})` would
        // leak company data if dealId were stale and pointed at a
        // foreign-org deal. The project-wide invariant is "every read
        // scopes by organizationId"; FK alone is not a tenant boundary.
        const dealForContract = existing.dealId
          ? await tx.deal.findFirst({
              where: { id: existing.dealId, organizationId: orgId },
              select: { companyId: true },
            })
          : null
        // Data construction extracted to the pure helper
        // `buildSpawnedContractData` for unit testability — see
        // `src/lib/cpq/spawn-contract.ts` and the tests under
        // `src/__tests__/lib-cpq-spawn-contract.test.ts`.
        const contractData = buildSpawnedContractData({
          organizationId: orgId,
          quote: {
            id,
            quoteNumber: existing.quoteNumber,
            currency: existing.currency,
            dealId: existing.dealId,
          },
          rolledTotalAmount: rolled.totalAmount.toString(),
          dealCompanyId: dealForContract?.companyId ?? null,
          createdByUserId: session?.userId ?? null,
        })
        const created = await tx.contract.create({
          data: contractData,
          select: { id: true, contractNumber: true },
        })
        spawnedContract = created
      }

      const reloaded = await tx.quote.findUnique({
        where: { id },
        include: {
          deal: { select: { id: true, name: true } },
          lineItems: { orderBy: { sortOrder: "asc" } },
        },
      })
      return { reloaded, spawnedContract }
    })

    // Bound soft-decrypt rejectedReason on the response. Augment with
    // `spawnedContract` so the UI can navigate to the new contract
    // detail page or toast its number.
    const response = updated.reloaded
      ? {
          ...updated.reloaded,
          rejectedReason: softDecryptForTenantBound(
            orgId,
            TABLE,
            "rejectedReason",
            updated.reloaded.rejectedReason,
          ),
        }
      : null

    // Phase 2a — best-effort notification on quote status transitions.
    // Fires after persistence; never blocks the response.
    if (input.status && input.status !== existing.status) {
      const notifRecipient = existing.createdBy ?? ""
      const qNum = existing.quoteNumber ?? id
      if (input.status === "sent") {
        createNotification({
          organizationId: orgId,
          userId: notifRecipient,
          type: "info",
          title: "Quote sent",
          message: `Quote ${qNum} sent`,
          entityType: "quote",
          entityId: id,
          kind: "quote.sent",
          push: true,
        }).catch(() => {})
      } else if (input.status === "accepted") {
        createNotification({
          organizationId: orgId,
          userId: notifRecipient,
          type: "success",
          title: "Quote accepted",
          message: `Quote ${qNum} accepted`,
          entityType: "quote",
          entityId: id,
          kind: "quote.accepted",
          push: true,
        }).catch(() => {})
      } else if (input.status === "rejected") {
        createNotification({
          organizationId: orgId,
          userId: notifRecipient,
          type: "warning",
          title: "Quote rejected",
          message: `Quote ${qNum} rejected`,
          entityType: "quote",
          entityId: id,
          kind: "quote.rejected",
          push: true,
        }).catch(() => {})
      }
    }

    return NextResponse.json({ quote: response, spawnedContract: updated.spawnedContract })
  } catch (err) {
    // Slice-3 piece-4.5: surface unique-constraint violations from the
    // auto-spawn block as a clean 409. The two paths that can fire:
    //   - `Contract.spawnedFromQuoteId @unique` — a concurrent
    //     PATCH-to-accepted race lost. Idempotency intent: one
    //     contract per quote. Client should retry GET to discover
    //     the existing contract.
    //   - `Quote.@@unique([organizationId, quoteNumber, version])` —
    //     can't happen on PATCH (id-keyed), defensive coverage only.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : String(err.meta?.target ?? "unique")
      return NextResponse.json(
        {
          error: "Conflict: a contract has already been spawned from this quote, or the quote unique-key collided",
          target,
        },
        { status: 409 },
      )
    }
    console.error("[quotes/:id] PATCH error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "sales"))) return moduleDisabledResponse("sales")

  const { id } = await params
  try {
    const existing = await prisma.quote.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }
    // Cascade kicks in via FK ON DELETE CASCADE on quote_line_items.
    await prisma.quote.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[quotes/:id] DELETE error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
