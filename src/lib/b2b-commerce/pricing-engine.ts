/**
 * B2B order pricing engine — D1 Phase 6 Block A slice 1.
 *
 * Snapshots prices at order create time: walks the caller's line
 * items, resolves each to a unit price (price-list override → product
 * list price fallback), applies the per-line discount, computes
 * line totals + order total. The output is what gets persisted onto
 * `BuyerOrderItem` rows — a future Product.price change doesn't
 * retroactively mutate this order.
 *
 * Pure synchronous. No I/O.
 */
import type {
  BuildPricedOrderInput,
  PricedOrder,
  PricedOrderItem,
  PriceListEntry,
  ProductRow,
} from "./types"

/** Round half-to-even-style avoidance via Math.round on cents. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function buildPricedOrder(input: BuildPricedOrderInput): PricedOrder {
  if (input.items.length === 0) {
    throw new Error("Cannot build a priced order with no items")
  }

  const productById = new Map<string, ProductRow>(input.products.map(p => [p.id, p]))

  // Index price-list overrides by productId; pick highest minQuantity
  // ≤ requested qty for tiered overrides (slice 1 supports flat +
  // per-product min-qty; slice 2 widens to true volume tiers).
  const overridesByProduct = groupOverridesByProduct(input.priceList ?? [])

  const items: PricedOrderItem[] = []
  let total = 0
  for (const line of input.items) {
    if (!line.productId) throw new Error("Order line missing productId")
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error(`Order line for product "${line.productId}" has invalid quantity ${line.quantity}`)
    }
    const product = productById.get(line.productId)
    if (!product) {
      throw new Error(`Product "${line.productId}" not in catalog`)
    }

    const discountPct = clampDiscount(line.discountPct ?? 0, line.productId)
    const override = pickBestOverride(overridesByProduct.get(line.productId) ?? [], line.quantity)
    const priceSource: "list" | "priceList" = override ? "priceList" : "list"
    const unitPrice = override?.unitPrice ?? product.price

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`Resolved unit price for "${line.productId}" is invalid: ${unitPrice}`)
    }

    const lineTotal = round2(unitPrice * line.quantity * (1 - discountPct / 100))
    items.push({
      productId: line.productId,
      productName: product.name,
      quantity: line.quantity,
      unitPrice: round2(unitPrice),
      discountPct,
      totalPrice: lineTotal,
      priceSource,
    })
    total += lineTotal
  }

  return { items, total: round2(total) }
}

function clampDiscount(value: number, productId: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Order line for product "${productId}" has non-finite discount`)
  }
  if (value < 0 || value > 100) {
    throw new Error(
      `Order line for product "${productId}" has discount ${value} outside [0, 100]`
    )
  }
  return value
}

function groupOverridesByProduct(
  entries: readonly PriceListEntry[]
): Map<string, PriceListEntry[]> {
  const out = new Map<string, PriceListEntry[]>()
  for (const e of entries) {
    if (!e.productId) continue
    if (!Number.isFinite(e.unitPrice) || e.unitPrice < 0) continue
    const list = out.get(e.productId) ?? []
    list.push(e)
    out.set(e.productId, list)
  }
  return out
}

/**
 * Pick the override whose minQuantity ≤ requested qty and is the
 * highest such minQuantity (tiered pricing). Entries without
 * minQuantity match any qty and are considered minQuantity=0.
 */
function pickBestOverride(
  overrides: readonly PriceListEntry[],
  requestedQty: number
): PriceListEntry | null {
  let best: PriceListEntry | null = null
  let bestMin = -1
  for (const o of overrides) {
    const min = o.minQuantity ?? 0
    if (min > requestedQty) continue
    if (min > bestMin) {
      best = o
      bestMin = min
    }
  }
  return best
}
