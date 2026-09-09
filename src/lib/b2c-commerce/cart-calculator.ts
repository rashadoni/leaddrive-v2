/**
 * Cart totals calculator — D2 Phase 6 Block A slice 1.
 *
 * Given a flat array of cart items + optional flat shipping fee +
 * optional tax rate, compute subtotal / shipping / tax / total +
 * itemCount. Tax applies to subtotal only (slice 1 simplification —
 * slice 2 wires destination-based tax for B2C parity with US sales
 * tax + EU VAT rules).
 *
 * Pure synchronous. No I/O.
 */
import type { CartTotals, CartTotalsInput } from "./types"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calculateCartTotals(input: CartTotalsInput): CartTotals {
  let subtotal = 0
  let itemCount = 0

  for (const item of input.items) {
    if (!item.productId) {
      throw new Error("Cart item missing productId")
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error(`Cart item "${item.productId}" has invalid quantity ${item.quantity}`)
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new Error(`Cart item "${item.productId}" has invalid unitPrice ${item.unitPrice}`)
    }
    subtotal += item.quantity * item.unitPrice
    itemCount += item.quantity
  }

  subtotal = round2(subtotal)

  const shipping = round2(validateNonNegative(input.shippingFlat ?? 0, "shippingFlat"))

  const taxRate = validateTaxRate(input.taxRate ?? 0)
  const tax = round2(subtotal * taxRate)

  const total = round2(subtotal + shipping + tax)

  return { subtotal, shipping, tax, total, itemCount }
}

function validateNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number (got ${value})`)
  }
  if (value < 0) {
    throw new Error(`${name} must be >= 0 (got ${value})`)
  }
  return value
}

function validateTaxRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    throw new Error(`taxRate must be a finite number (got ${rate})`)
  }
  if (rate < 0 || rate > 1) {
    throw new Error(`taxRate must be in [0, 1] (got ${rate})`)
  }
  return rate
}
