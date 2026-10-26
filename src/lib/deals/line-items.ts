/**
 * A deal's product lines, and its amount from them (owner 2026-10-26: «товары
 * в сделке: строки с товарами, сумма сделки из них»; mockup accepted).
 *
 * - While a deal has lines, its valueAmount is their sum — written here, in the
 *   same transaction as the lines, and kept by updateDealCommand (it ignores a
 *   typed amount and refuses a currency change for such a deal).
 * - Prices are in the deal's currency. A catalog product priced in another
 *   currency comes in with no price: there are no exchange rates to convert it
 *   (see leaddrive-multicurrency-no-fx), so a line without a price counts 0 and
 *   the screen asks for one.
 * - Name and SKU are copied from the catalog; a later catalog change does not
 *   rewrite what was agreed.
 * Runs inside the caller's tenant scope.
 */
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withDealEvents } from "./deal-events"

export const MAX_DEAL_LINES = 200

const money = z.number().finite().min(0).max(1e12)

export const dealLineInputSchema = z.strictObject({
  productId: z.string().trim().min(1).max(60).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(100).nullable().optional(),
  quantity: z.number().finite().gt(0).max(1e9),
  unitPrice: money.nullable(),
  discountPct: z.number().finite().min(0).max(100).default(0),
})

export const dealLinesInputSchema = z.strictObject({ lines: z.array(dealLineInputSchema).max(MAX_DEAL_LINES) })

export type DealLineInput = z.infer<typeof dealLineInputSchema>

const round2 = (value: number) => Math.round(value * 100) / 100

/** One line's total in the deal's currency; a line without a price counts 0. */
export function lineTotal(line: { quantity: number; unitPrice: number | null; discountPct: number }): number {
  if (line.unitPrice === null) return 0
  return round2(line.quantity * line.unitPrice * (1 - line.discountPct / 100))
}

export function linesTotal(lines: { quantity: number; unitPrice: number | null; discountPct: number }[]): number {
  return round2(lines.reduce((sum, line) => sum + lineTotal(line), 0))
}

export interface DealLineView {
  id: string
  productId: string | null
  name: string
  sku: string | null
  quantity: number
  unitPrice: number | null
  discountPct: number
  total: number
}

export async function readDealLines(orgId: string, dealId: string): Promise<{ currency: string; lines: DealLineView[]; total: number } | null> {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, organizationId: orgId }, select: { currency: true } })
  if (!deal) return null
  const rows = await prisma.dealLineItem.findMany({ where: { organizationId: orgId, dealId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
  const lines = rows.map((row) => {
    const line = {
      quantity: decimalToNumber(row.quantity),
      unitPrice: row.unitPrice === null ? null : decimalToNumber(row.unitPrice),
      discountPct: decimalToNumber(row.discountPct),
    }
    return { id: row.id, productId: row.productId, name: row.name, sku: row.sku, ...line, total: lineTotal(line) }
  })
  return { currency: deal.currency, lines, total: linesTotal(lines) }
}

export async function dealHasLines(orgId: string, dealId: string, db: Pick<Prisma.TransactionClient, "dealLineItem"> = prisma): Promise<boolean> {
  return (await db.dealLineItem.count({ where: { organizationId: orgId, dealId } })) > 0
}

export class DealLinesError extends Error {
  constructor(readonly code: "DEAL_NOT_FOUND" | "PRODUCT_NOT_FOUND", message: string) {
    super(message)
    this.name = "DealLinesError"
  }
}

/**
 * Replace all lines of a deal and set its amount to their sum. With no lines
 * the amount is left as it was — the person types it again, as before.
 */
export async function replaceDealLines(orgId: string, userId: string | null, dealId: string, lines: DealLineInput[]) {
  const productIds = [...new Set(lines.map((line) => line.productId).filter((id): id is string => Boolean(id)))]
  const result = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findFirst({ where: { id: dealId, organizationId: orgId }, select: { id: true, name: true, valueAmount: true } })
    if (!deal) throw new DealLinesError("DEAL_NOT_FOUND", "Deal not found")
    if (productIds.length > 0) {
      const found = await tx.product.count({ where: { organizationId: orgId, id: { in: productIds } } })
      if (found !== productIds.length) throw new DealLinesError("PRODUCT_NOT_FOUND", "Product not found")
    }
    await tx.dealLineItem.deleteMany({ where: { organizationId: orgId, dealId } })
    if (lines.length > 0) {
      await tx.dealLineItem.createMany({
        data: lines.map((line, index) => ({
          organizationId: orgId,
          dealId,
          productId: line.productId ?? null,
          name: line.name,
          sku: line.sku ?? null,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: line.unitPrice === null ? null : new Prisma.Decimal(line.unitPrice),
          discountPct: new Prisma.Decimal(line.discountPct),
          sortOrder: index,
        })),
      })
    }
    const before = decimalToNumber(deal.valueAmount)
    const after = lines.length > 0 ? linesTotal(lines) : before
    if (lines.length > 0) {
      await withDealEvents(tx, orgId, [dealId], async (t) => ({
        value: await t.deal.updateMany({ where: { id: dealId, organizationId: orgId }, data: { valueAmount: new Prisma.Decimal(after) } }),
      }))
    }
    return { name: deal.name, before, after }
  })
  if (result.before !== result.after) {
    void logAudit(orgId, "update", "deal", dealId, result.name, { oldValue: { valueAmount: result.before }, newValue: { valueAmount: result.after, from: "line_items" }, userId: userId ?? undefined })
  }
  return readDealLines(orgId, dealId)
}

/**
 * «Next best offers» → «Əlavə et»: one product as a line (quantity 1). Its
 * price when it is in the deal's currency, none otherwise.
 */
export async function addProductLine(orgId: string, userId: string | null, dealId: string, productId: string) {
  const [current, product] = await Promise.all([
    readDealLines(orgId, dealId),
    prisma.product.findFirst({ where: { id: productId, organizationId: orgId }, select: { id: true, name: true, sku: true, price: true, currency: true } }),
  ])
  if (!current) throw new DealLinesError("DEAL_NOT_FOUND", "Deal not found")
  if (!product) throw new DealLinesError("PRODUCT_NOT_FOUND", "Product not found")
  const lines: DealLineInput[] = current.lines.map(({ productId: id, name, sku, quantity, unitPrice, discountPct }) => ({ productId: id, name, sku, quantity, unitPrice, discountPct }))
  lines.push({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    quantity: 1,
    unitPrice: product.currency === current.currency ? product.price : null,
    discountPct: 0,
  })
  return replaceDealLines(orgId, userId, dealId, lines.slice(0, MAX_DEAL_LINES))
}
