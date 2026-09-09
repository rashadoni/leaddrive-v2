/**
 * Tests for D2 B2C Commerce slice 1 — cart calculator + checkout state machine + cart merger.
 * No DB. Pure helpers.
 */
import { describe, expect, it } from "vitest"
import { calculateCartTotals } from "@/lib/b2c-commerce/cart-calculator"
import {
  advanceCheckoutState,
  isTerminalCheckoutState,
} from "@/lib/b2c-commerce/checkout-state-machine"
import {
  mergeGuestCartIntoUserCart,
  previewMergedLineTotals,
} from "@/lib/b2c-commerce/cart-merger"
import type { CartItemRow } from "@/lib/b2c-commerce/types"

/* ─── calculateCartTotals ─────────────────────────────────────────────── */

const ITEMS: CartItemRow[] = [
  { productId: "p_widget", productName: "Widget", quantity: 2, unitPrice: 10 },
  { productId: "p_gadget", productName: "Gadget", quantity: 1, unitPrice: 30 },
  { productId: "p_gizmo", productName: "Gizmo", quantity: 3, unitPrice: 5 },
]

describe("D2 — calculateCartTotals", () => {
  it("sums subtotal + itemCount with no shipping or tax", () => {
    const r = calculateCartTotals({ items: ITEMS })
    // 2*10 + 1*30 + 3*5 = 20 + 30 + 15 = 65
    expect(r.subtotal).toBe(65)
    expect(r.itemCount).toBe(6) // 2 + 1 + 3
    expect(r.shipping).toBe(0)
    expect(r.tax).toBe(0)
    expect(r.total).toBe(65)
  })

  it("adds flat shipping into total", () => {
    const r = calculateCartTotals({ items: ITEMS, shippingFlat: 12.5 })
    expect(r.shipping).toBe(12.5)
    expect(r.total).toBe(77.5) // 65 + 12.5
  })

  it("applies tax to subtotal only, not shipping", () => {
    const r = calculateCartTotals({
      items: ITEMS,
      shippingFlat: 10,
      taxRate: 0.1, // 10%
    })
    expect(r.tax).toBe(6.5) // 65 * 0.1
    expect(r.total).toBe(81.5) // 65 + 10 + 6.5
  })

  it("rounds tax + total to 2 dp", () => {
    const r = calculateCartTotals({
      items: [{ productId: "x", productName: "X", quantity: 1, unitPrice: 9.99 }],
      taxRate: 0.0825,
    })
    // 9.99 * 0.0825 = 0.824175 → rounded 0.82
    expect(r.tax).toBe(0.82)
    expect(r.total).toBe(10.81) // 9.99 + 0.82
  })

  it("empty items list → all zeros", () => {
    const r = calculateCartTotals({ items: [] })
    expect(r.subtotal).toBe(0)
    expect(r.itemCount).toBe(0)
    expect(r.total).toBe(0)
  })

  it("rejects item with missing productId", () => {
    expect(() =>
      calculateCartTotals({
        items: [{ productId: "", productName: "X", quantity: 1, unitPrice: 1 }],
      })
    ).toThrow(/missing productId/)
  })

  it("rejects item with zero or negative quantity", () => {
    expect(() =>
      calculateCartTotals({
        items: [{ productId: "x", productName: "X", quantity: 0, unitPrice: 1 }],
      })
    ).toThrow(/invalid quantity/)
    expect(() =>
      calculateCartTotals({
        items: [{ productId: "x", productName: "X", quantity: -1, unitPrice: 1 }],
      })
    ).toThrow(/invalid quantity/)
  })

  it("rejects item with negative or non-finite unitPrice", () => {
    expect(() =>
      calculateCartTotals({
        items: [{ productId: "x", productName: "X", quantity: 1, unitPrice: -1 }],
      })
    ).toThrow(/invalid unitPrice/)
    expect(() =>
      calculateCartTotals({
        items: [{ productId: "x", productName: "X", quantity: 1, unitPrice: NaN }],
      })
    ).toThrow(/invalid unitPrice/)
  })

  it("rejects negative shippingFlat", () => {
    expect(() =>
      calculateCartTotals({ items: ITEMS, shippingFlat: -1 })
    ).toThrow(/shippingFlat must be >= 0/)
  })

  it("rejects taxRate outside [0, 1]", () => {
    expect(() => calculateCartTotals({ items: ITEMS, taxRate: 1.5 })).toThrow(/in \[0, 1\]/)
    expect(() => calculateCartTotals({ items: ITEMS, taxRate: -0.1 })).toThrow(/in \[0, 1\]/)
  })
})

/* ─── Storefront slug regex (matches Zod + DB CHECK) ─────────────────── */

describe("D2 — storefront slug regex (URL-safe, no consecutive separators)", () => {
  // Test the pattern directly — same regex appears in Zod
  // createSchema + Postgres CHECK constraint.
  const valid = /^[a-z0-9]$|^[a-z0-9][a-z0-9_-]*[a-z0-9]$/
  const forbidsConsecutive = /[-_]{2}/

  function isValid(slug: string): boolean {
    return valid.test(slug) && !forbidsConsecutive.test(slug)
  }

  it("accepts single-char + multi-char URL-safe slugs", () => {
    expect(isValid("a")).toBe(true)
    expect(isValid("acme")).toBe(true)
    expect(isValid("acme-storefront")).toBe(true)
    expect(isValid("acme_store_eu")).toBe(true)
    expect(isValid("brand2024")).toBe(true)
  })

  it("rejects leading/trailing separator", () => {
    expect(isValid("-acme")).toBe(false)
    expect(isValid("acme-")).toBe(false)
    expect(isValid("_acme")).toBe(false)
  })

  it("rejects consecutive separators (a--b, a__b, a-_b, a_-b)", () => {
    expect(isValid("a--b")).toBe(false)
    expect(isValid("a__b")).toBe(false)
    expect(isValid("a-_b")).toBe(false)
    expect(isValid("a_-b")).toBe(false)
  })

  it("rejects uppercase + special chars", () => {
    expect(isValid("Acme")).toBe(false)
    expect(isValid("acme.com")).toBe(false)
    expect(isValid("acme/store")).toBe(false)
    expect(isValid("acme store")).toBe(false)
  })
})

/* ─── advanceCheckoutState ────────────────────────────────────────────── */

describe("D2 — advanceCheckoutState", () => {
  it("allows forward progression shipping → payment → review → completed", () => {
    expect(advanceCheckoutState({ from: "shipping", to: "payment" })).toMatchObject({
      ok: true,
      kind: "forward",
    })
    expect(advanceCheckoutState({ from: "payment", to: "review" })).toMatchObject({
      ok: true,
      kind: "forward",
    })
    expect(advanceCheckoutState({ from: "review", to: "completed" })).toMatchObject({
      ok: true,
      kind: "forward",
    })
  })

  it("allows backward edits within pre-completion flow", () => {
    expect(advanceCheckoutState({ from: "payment", to: "shipping" })).toMatchObject({
      ok: true,
      kind: "backward",
    })
    expect(advanceCheckoutState({ from: "review", to: "shipping" })).toMatchObject({
      ok: true,
      kind: "backward",
    })
    expect(advanceCheckoutState({ from: "review", to: "payment" })).toMatchObject({
      ok: true,
      kind: "backward",
    })
  })

  it("classifies failed/expired as terminal kind on the result", () => {
    expect(advanceCheckoutState({ from: "shipping", to: "failed" })).toMatchObject({
      ok: true,
      kind: "terminal",
    })
    expect(advanceCheckoutState({ from: "review", to: "expired" })).toMatchObject({
      ok: true,
      kind: "terminal",
    })
  })

  it("rejects same-state no-op", () => {
    const r = advanceCheckoutState({ from: "shipping", to: "shipping" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no-op/i)
  })

  it("rejects any transition out of terminal state", () => {
    for (const terminal of ["completed", "failed", "expired"] as const) {
      const r = advanceCheckoutState({ from: terminal, to: "shipping" })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/terminal/i)
    }
  })

  it("rejects forward skips (shipping → review, payment → completed)", () => {
    // shipping must go through payment + review before completed.
    const r1 = advanceCheckoutState({ from: "shipping", to: "review" })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.error).toMatch(/Invalid transition/)
    // payment must go through review before completed.
    const r2 = advanceCheckoutState({ from: "payment", to: "completed" })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error).toMatch(/Invalid transition/)
  })

  it("shipping has no backward targets (earliest non-terminal state)", () => {
    // Architect-flagged: previous test was mis-titled. shipping is
    // the entry state — no earlier step exists to step back to. The
    // only non-no-op moves from shipping are forward (payment) or
    // terminal (failed/expired); any other target is invalid.
    const r = advanceCheckoutState({ from: "shipping", to: "completed" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Invalid transition/)
  })

  it("isTerminalCheckoutState identifies the three terminal states", () => {
    expect(isTerminalCheckoutState("completed")).toBe(true)
    expect(isTerminalCheckoutState("failed")).toBe(true)
    expect(isTerminalCheckoutState("expired")).toBe(true)
    expect(isTerminalCheckoutState("shipping")).toBe(false)
    expect(isTerminalCheckoutState("payment")).toBe(false)
    expect(isTerminalCheckoutState("review")).toBe(false)
  })
})

/* ─── mergeGuestCartIntoUserCart ──────────────────────────────────────── */

describe("D2 — mergeGuestCartIntoUserCart", () => {
  it("merges disjoint products into a single cart", () => {
    const r = mergeGuestCartIntoUserCart({
      guestCart: {
        id: "guest_1",
        items: [{ productId: "p_a", productName: "A", quantity: 2, unitPrice: 10 }],
      },
      userCart: {
        id: "user_1",
        items: [{ productId: "p_b", productName: "B", quantity: 1, unitPrice: 20 }],
      },
    })
    expect(r.items).toHaveLength(2)
    const a = r.items.find(i => i.productId === "p_a")!
    const b = r.items.find(i => i.productId === "p_b")!
    expect(a.quantity).toBe(2)
    expect(b.quantity).toBe(1)
  })

  it("collapses same-product lines by summing quantities", () => {
    const r = mergeGuestCartIntoUserCart({
      guestCart: {
        id: "guest_1",
        items: [{ productId: "p_a", productName: "A (guest)", quantity: 3, unitPrice: 12 }],
      },
      userCart: {
        id: "user_1",
        items: [{ productId: "p_a", productName: "A (user)", quantity: 1, unitPrice: 10 }],
      },
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({
      productId: "p_a",
      quantity: 4, // 1 + 3
      // User-cart wins on collision (older snapshot stability).
      productName: "A (user)",
      unitPrice: 10,
    })
  })

  it("user cart's unitPrice + name win on collision (stability over freshness)", () => {
    const r = mergeGuestCartIntoUserCart({
      guestCart: {
        id: "g",
        items: [{ productId: "p", productName: "GuestName", quantity: 1, unitPrice: 99 }],
      },
      userCart: {
        id: "u",
        items: [{ productId: "p", productName: "UserName", quantity: 1, unitPrice: 50 }],
      },
    })
    expect(r.items[0].unitPrice).toBe(50)
    expect(r.items[0].productName).toBe("UserName")
  })

  it("skips invalid items defensively (NaN qty, missing productId, negative price)", () => {
    const r = mergeGuestCartIntoUserCart({
      guestCart: {
        id: "g",
        items: [
          { productId: "p_a", productName: "A", quantity: NaN, unitPrice: 10 },
          { productId: "", productName: "?", quantity: 1, unitPrice: 1 },
          { productId: "p_b", productName: "B", quantity: 1, unitPrice: -1 },
        ],
      },
      userCart: { id: "u", items: [] },
    })
    expect(r.items).toHaveLength(0)
  })

  it("throws when merging a cart into itself", () => {
    expect(() =>
      mergeGuestCartIntoUserCart({
        guestCart: { id: "same", items: [] },
        userCart: { id: "same", items: [] },
      })
    ).toThrow(/cannot merge a cart into itself/i)
  })

  it("previewMergedLineTotals computes per-line totals", () => {
    const merged = mergeGuestCartIntoUserCart({
      guestCart: {
        id: "g",
        items: [{ productId: "p_a", productName: "A", quantity: 3, unitPrice: 5 }],
      },
      userCart: {
        id: "u",
        items: [{ productId: "p_b", productName: "B", quantity: 2, unitPrice: 12.5 }],
      },
    })
    const preview = previewMergedLineTotals(merged)
    expect(preview.find(p => p.productId === "p_a")?.lineTotal).toBe(15)
    expect(preview.find(p => p.productId === "p_b")?.lineTotal).toBe(25)
  })
})
