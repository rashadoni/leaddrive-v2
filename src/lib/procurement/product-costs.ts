import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { SUPPLIER_CATEGORY } from "@/lib/procurement/suppliers"
import { isSupportedProductCurrency } from "@/lib/products/pricing"

/**
 * What a product costs to buy (docs/sales-procurement/README.md, task 2.2):
 * purchase price and its currency, default supplier, lead time.
 *
 * Kept in `product_costs`, not in `products`: thirteen places read a product
 * row whole — the catalog, the public storefront, quotes, the AI — and a column
 * there would hand the purchase price to every one of them. Here it is read
 * only by code that asked for `procurement-costs`.
 *
 * The planned cost of a deal line comes from here when the line is added; it
 * is copied, so a later price change does not rewrite what was planned. Only a
 * price in the deal's currency is copied — there are no exchange rates.
 */

export const productCostInputSchema = z.strictObject({
  purchasePrice: z.number().finite().min(0).max(1e12).nullable(),
  currency: z.string().trim().transform((value) => value.toUpperCase()).refine(isSupportedProductCurrency, { message: "Unsupported currency" }),
  defaultSupplierId: z.string().trim().min(1).max(60).nullable(),
  leadTimeDays: z.number().int().min(0).max(3650).nullable(),
})

export type ProductCostInput = z.infer<typeof productCostInputSchema>

export interface ProductCostView {
  productId: string
  purchasePrice: number | null
  currency: string
  defaultSupplier: { id: string; name: string } | null
  leadTimeDays: number | null
  updatedAt: Date | null
}

export class ProductCostError extends Error {
  constructor(readonly code: "PRODUCT_NOT_FOUND" | "SUPPLIER_NOT_FOUND", message: string) {
    super(message)
    this.name = "ProductCostError"
  }
}

const COST_SELECT = {
  productId: true,
  purchasePrice: true,
  currency: true,
  leadTimeDays: true,
  updatedAt: true,
  defaultSupplier: { select: { id: true, name: true } },
} satisfies Prisma.ProductCostSelect

type CostRow = Prisma.ProductCostGetPayload<{ select: typeof COST_SELECT }>

function view(productId: string, fallbackCurrency: string, row: CostRow | null): ProductCostView {
  return {
    productId,
    purchasePrice: row?.purchasePrice == null ? null : Number(row.purchasePrice),
    currency: row?.currency ?? fallbackCurrency,
    defaultSupplier: row?.defaultSupplier ?? null,
    leadTimeDays: row?.leadTimeDays ?? null,
    updatedAt: row?.updatedAt ?? null,
  }
}

/** The product's purchase data; a product nobody priced yet reads as empty, in its sale currency. */
export async function readProductCost(orgId: string, productId: string): Promise<ProductCostView | null> {
  const product = await prisma.product.findFirst({ where: { id: productId, organizationId: orgId }, select: { id: true, currency: true } })
  if (!product) return null
  const row = await prisma.productCost.findFirst({ where: { productId, organizationId: orgId }, select: COST_SELECT })
  return view(product.id, product.currency, row)
}

export async function saveProductCost(orgId: string, userId: string | null, productId: string, input: ProductCostInput): Promise<ProductCostView> {
  const product = await prisma.product.findFirst({ where: { id: productId, organizationId: orgId }, select: { id: true, name: true } })
  if (!product) throw new ProductCostError("PRODUCT_NOT_FOUND", "Product not found")
  if (input.defaultSupplierId) {
    const supplier = await prisma.company.findFirst({ where: { id: input.defaultSupplierId, organizationId: orgId, category: SUPPLIER_CATEGORY }, select: { id: true } })
    if (!supplier) throw new ProductCostError("SUPPLIER_NOT_FOUND", "Supplier not found")
  }
  const before = await prisma.productCost.findFirst({ where: { productId, organizationId: orgId }, select: { purchasePrice: true, currency: true } })
  const data = {
    purchasePrice: input.purchasePrice === null ? null : new Prisma.Decimal(input.purchasePrice),
    currency: input.currency,
    defaultSupplierId: input.defaultSupplierId,
    leadTimeDays: input.leadTimeDays,
    updatedBy: userId,
  }
  const row = await prisma.productCost.upsert({
    where: { productId },
    create: { productId, organizationId: orgId, ...data },
    update: data,
    select: COST_SELECT,
  })
  void logAudit(orgId, "update", "product_cost", productId, product.name, {
    oldValue: before ? { purchasePrice: before.purchasePrice == null ? null : Number(before.purchasePrice), currency: before.currency } : null,
    newValue: { purchasePrice: input.purchasePrice, currency: input.currency, defaultSupplierId: input.defaultSupplierId, leadTimeDays: input.leadTimeDays },
    userId: userId ?? undefined,
  })
  return view(productId, input.currency, row)
}

/**
 * Purchase prices of these products that can stand as a planned cost in a deal
 * of `currency` — a price in another currency is left out, not converted.
 */
export async function plannedCostsFor(
  db: Pick<Prisma.TransactionClient, "productCost">,
  orgId: string,
  productIds: string[],
  currency: string,
): Promise<Map<string, Prisma.Decimal>> {
  if (productIds.length === 0) return new Map()
  const rows: { productId: string; purchasePrice: Prisma.Decimal | null; currency: string }[] = await db.productCost.findMany({
    where: { organizationId: orgId, productId: { in: productIds } },
    select: { productId: true, purchasePrice: true, currency: true },
  })
  const out = new Map<string, Prisma.Decimal>()
  for (const row of rows) {
    if (row.purchasePrice !== null && row.currency === currency) out.set(row.productId, row.purchasePrice)
  }
  return out
}
