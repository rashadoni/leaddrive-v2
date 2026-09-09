/**
 * Cart merger — D2 Phase 6 Block A slice 1.
 *
 * When a guest user with an active cart signs in / registers, we
 * merge their guest cart into the user's existing cart. Same-product
 * lines collapse quantities; unitPrice on collision keeps the
 * user-cart price (older snapshot wins — stability over freshness).
 *
 * This mirrors Salesforce B2C Commerce's "anonymous → registered"
 * cart-merge convention. Slice 2's auth bridge calls this helper
 * when the sign-in event fires.
 *
 * Pure synchronous. Caller persists the result + flips the guest
 * cart's status to "merged".
 */
import type { CartItemRow, MergeCartsInput, MergedCart } from "./types"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function mergeGuestCartIntoUserCart(input: MergeCartsInput): MergedCart {
  if (!input.guestCart || !input.userCart) {
    throw new Error("Both guestCart and userCart are required")
  }
  if (input.guestCart.id === input.userCart.id) {
    throw new Error("Cannot merge a cart into itself")
  }

  // Start with user-cart items (priority on collision).
  const byProduct = new Map<string, CartItemRow>()
  for (const item of input.userCart.items) {
    if (!isValidItem(item)) continue
    byProduct.set(item.productId, { ...item })
  }

  // Add guest-cart items, collapsing on collision.
  for (const item of input.guestCart.items) {
    if (!isValidItem(item)) continue
    const existing = byProduct.get(item.productId)
    if (existing) {
      const newQty = existing.quantity + item.quantity
      byProduct.set(item.productId, {
        productId: existing.productId,
        // Snapshot resolution: user cart's name + unitPrice wins.
        // The guest's unitPrice (later snapshot) is dropped because
        // promotional UX dictates the buyer shouldn't be surprised
        // by mid-session re-pricing.
        productName: existing.productName,
        quantity: newQty,
        unitPrice: existing.unitPrice,
      })
    } else {
      byProduct.set(item.productId, { ...item })
    }
  }

  return {
    items: [...byProduct.values()].map(it => ({
      ...it,
    })),
  }
}

/**
 * Compute the line-total for a merged item set — caller usually
 * passes this through `calculateCartTotals` for the full breakdown,
 * but for a quick "how much will the merged cart cost" preview
 * the per-line totals are enough.
 */
export function previewMergedLineTotals(merged: MergedCart): Array<{
  productId: string
  lineTotal: number
}> {
  return merged.items.map(item => ({
    productId: item.productId,
    lineTotal: round2(item.quantity * item.unitPrice),
  }))
}

function isValidItem(item: CartItemRow): boolean {
  if (!item.productId) return false
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) return false
  if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) return false
  return true
}
