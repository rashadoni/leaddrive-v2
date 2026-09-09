/**
 * Tests for D1 B2B Commerce slice 1 — pricing engine + credit checker + RFQ converter.
 * No DB. Pure helpers.
 */
import { describe, expect, it } from "vitest"
import { asOutstanding, checkCredit } from "@/lib/b2b-commerce/credit-checker"
import { buildPricedOrder } from "@/lib/b2b-commerce/pricing-engine"
import { convertRfqToOrder } from "@/lib/b2b-commerce/rfq-converter"
import type {
  PriceListEntry,
  ProductRow,
  RfqRow,
} from "@/lib/b2b-commerce/types"

/* ─── buildPricedOrder ────────────────────────────────────────────────── */

const PRODUCTS: ProductRow[] = [
  { id: "p_widget", name: "Widget", price: 10 },
  { id: "p_gadget", name: "Gadget", price: 25 },
  { id: "p_gizmo", name: "Gizmo", price: 100 },
]

describe("D1 — buildPricedOrder", () => {
  it("prices a simple order at product list price", () => {
    const r = buildPricedOrder({
      items: [{ productId: "p_widget", quantity: 5 }],
      products: PRODUCTS,
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({
      productName: "Widget",
      quantity: 5,
      unitPrice: 10,
      discountPct: 0,
      totalPrice: 50,
      priceSource: "list",
    })
    expect(r.total).toBe(50)
  })

  it("applies per-line discount correctly", () => {
    const r = buildPricedOrder({
      items: [{ productId: "p_gadget", quantity: 4, discountPct: 25 }],
      products: PRODUCTS,
    })
    // 25 * 4 = 100, * (1 - 0.25) = 75
    expect(r.items[0].totalPrice).toBe(75)
    expect(r.total).toBe(75)
  })

  it("price-list override takes precedence over Product.price", () => {
    const priceList: PriceListEntry[] = [{ productId: "p_widget", unitPrice: 7.5 }]
    const r = buildPricedOrder({
      items: [{ productId: "p_widget", quantity: 10 }],
      products: PRODUCTS,
      priceList,
    })
    expect(r.items[0].unitPrice).toBe(7.5)
    expect(r.items[0].priceSource).toBe("priceList")
    expect(r.total).toBe(75)
  })

  it("picks highest matching minQuantity tier", () => {
    const priceList: PriceListEntry[] = [
      { productId: "p_widget", unitPrice: 9, minQuantity: 5 },
      { productId: "p_widget", unitPrice: 7, minQuantity: 20 }, // best tier @ qty 20
      { productId: "p_widget", unitPrice: 8, minQuantity: 10 },
    ]
    const r = buildPricedOrder({
      items: [{ productId: "p_widget", quantity: 25 }],
      products: PRODUCTS,
      priceList,
    })
    expect(r.items[0].unitPrice).toBe(7) // qty 25 >= 20, best tier
    expect(r.total).toBe(7 * 25)
  })

  it("falls back to list price when no tier matches", () => {
    const priceList: PriceListEntry[] = [
      { productId: "p_widget", unitPrice: 8, minQuantity: 50 },
    ]
    const r = buildPricedOrder({
      items: [{ productId: "p_widget", quantity: 10 }],
      products: PRODUCTS,
      priceList,
    })
    expect(r.items[0].unitPrice).toBe(10)
    expect(r.items[0].priceSource).toBe("list")
  })

  it("snapshots productName from catalog (immune to future Product.name renames)", () => {
    const r = buildPricedOrder({
      items: [{ productId: "p_gizmo", quantity: 1 }],
      products: PRODUCTS,
    })
    expect(r.items[0].productName).toBe("Gizmo")
  })

  it("aggregates total across multiple lines + rounds to 2 dp", () => {
    // Use a rounding fixture with no FP-representation ambiguity:
    // 12.5 * 4 * (1 - 25/100) = 50 * 0.75 = 37.5 (exact in binary FP).
    // Architect flagged the prior 33.33% × 2 × 25 = 33.335-rounding-to-
    // 33.34 case as resting on FP-rep luck; this fixture is exact.
    const r = buildPricedOrder({
      items: [
        { productId: "p_widget", quantity: 3 },              // 10*3 = 30
        { productId: "p_gadget", quantity: 4, discountPct: 25 }, // 25*4*0.75 = 75
        { productId: "p_gizmo", quantity: 1, discountPct: 10 },  // 100*0.9 = 90
      ],
      products: PRODUCTS,
    })
    expect(r.items.map(i => i.totalPrice)).toEqual([30, 75, 90])
    expect(r.total).toBe(195)
  })

  it("rounds line total to 2 dp on inexact discount", () => {
    // 25 * 2 * (1 - 33.33/100) = 50 * 0.6667 = 33.335 → rounds to 33.34
    // (per Math.round half-up; the 33.335 IEEE 754 representation is
    // slightly above the exact midpoint, so this is deterministic).
    const r = buildPricedOrder({
      items: [{ productId: "p_gadget", quantity: 2, discountPct: 33.33 }],
      products: PRODUCTS,
    })
    expect(r.items[0].totalPrice).toBeCloseTo(33.34, 2)
  })

  it("rejects empty line list", () => {
    expect(() => buildPricedOrder({ items: [], products: PRODUCTS })).toThrow(/no items/)
  })

  it("rejects line referencing a missing product", () => {
    expect(() =>
      buildPricedOrder({
        items: [{ productId: "p_doesnt_exist", quantity: 1 }],
        products: PRODUCTS,
      })
    ).toThrow(/not in catalog/)
  })

  it("rejects line with zero or negative quantity", () => {
    expect(() =>
      buildPricedOrder({
        items: [{ productId: "p_widget", quantity: 0 }],
        products: PRODUCTS,
      })
    ).toThrow(/invalid quantity/)
    expect(() =>
      buildPricedOrder({
        items: [{ productId: "p_widget", quantity: -1 }],
        products: PRODUCTS,
      })
    ).toThrow(/invalid quantity/)
  })

  it("rejects line with discount outside [0, 100]", () => {
    expect(() =>
      buildPricedOrder({
        items: [{ productId: "p_widget", quantity: 1, discountPct: 150 }],
        products: PRODUCTS,
      })
    ).toThrow(/outside \[0, 100\]/)
    expect(() =>
      buildPricedOrder({
        items: [{ productId: "p_widget", quantity: 1, discountPct: -5 }],
        products: PRODUCTS,
      })
    ).toThrow(/outside/)
  })

  it("skips invalid price-list entries (defensive against bad data)", () => {
    const priceList: PriceListEntry[] = [
      { productId: "", unitPrice: 5 }, // empty productId — skipped
      { productId: "p_widget", unitPrice: -1 }, // negative — skipped
      { productId: "p_widget", unitPrice: NaN }, // NaN — skipped
      { productId: "p_widget", unitPrice: 8 }, // valid
    ]
    const r = buildPricedOrder({
      items: [{ productId: "p_widget", quantity: 1 }],
      products: PRODUCTS,
      priceList,
    })
    expect(r.items[0].unitPrice).toBe(8)
  })
})

/* ─── checkCredit ─────────────────────────────────────────────────────── */

describe("D1 — checkCredit", () => {
  it("approves an order within limit", () => {
    const r = checkCredit({
      creditLimit: 10_000,
      outstanding: [],
      proposedAmount: 5_000,
    })
    expect(r.approved).toBe(true)
    expect(r.totalAfterOrder).toBe(5_000)
    expect(r.remainingHeadroom).toBe(5_000)
    expect(r.currentOutstanding).toBe(0)
  })

  it("rejects when total exceeds limit", () => {
    const r = checkCredit({
      creditLimit: 1_000,
      outstanding: [],
      proposedAmount: 1_500,
    })
    expect(r.approved).toBe(false)
    expect(r.remainingHeadroom).toBe(-500)
  })

  it("approves at exact limit (>= comparison)", () => {
    const r = checkCredit({
      creditLimit: 1_000,
      outstanding: [],
      proposedAmount: 1_000,
    })
    expect(r.approved).toBe(true)
    expect(r.remainingHeadroom).toBe(0)
  })

  it("ignores terminal-status orders in outstanding sum", () => {
    const r = checkCredit({
      creditLimit: 10_000,
      outstanding: [
        { status: "closed", totalAmount: 8_000 }, // ignored
        { status: "cancelled", totalAmount: 5_000 }, // ignored
        { status: "delivered", totalAmount: 4_000 }, // ignored
        { status: "rejected", totalAmount: 1_000 }, // ignored
        { status: "submitted", totalAmount: 2_000 }, // counted
        { status: "approved", totalAmount: 1_500 }, // counted
      ],
      proposedAmount: 3_000,
    })
    expect(r.currentOutstanding).toBe(3_500)
    expect(r.totalAfterOrder).toBe(6_500)
    expect(r.approved).toBe(true)
  })

  it("skips outstanding orders with invalid amount (defensive)", () => {
    const r = checkCredit({
      creditLimit: 10_000,
      outstanding: [
        { status: "submitted", totalAmount: 2_000 },
        { status: "approved", totalAmount: -5 }, // ignored
        { status: "submitted", totalAmount: NaN }, // ignored
      ],
      proposedAmount: 1_000,
    })
    expect(r.currentOutstanding).toBe(2_000)
    expect(r.approved).toBe(true)
  })

  it("creditLimit = 0 → approves only when total stays 0", () => {
    const approved0 = checkCredit({
      creditLimit: 0,
      outstanding: [],
      proposedAmount: 0,
    })
    expect(approved0.approved).toBe(true)
    expect(approved0.remainingHeadroom).toBe(0)

    const rejectedByProposed = checkCredit({
      creditLimit: 0,
      outstanding: [],
      proposedAmount: 100,
    })
    expect(rejectedByProposed.approved).toBe(false)
  })

  it("creditLimit = 0 + proposed=0 + non-terminal outstanding>0 → rejected", () => {
    // Architect-flagged gap: docstring said cash-only buyers approve
    // when proposed=0, but that's only true when outstanding is also
    // 0. Lock the actual behaviour: any non-terminal outstanding
    // rejects even a zero-amount proposed order under cash-only.
    const r = checkCredit({
      creditLimit: 0,
      outstanding: [{ status: "submitted", totalAmount: 500 }],
      proposedAmount: 0,
    })
    expect(r.approved).toBe(false)
    expect(r.currentOutstanding).toBe(500)
    expect(r.totalAfterOrder).toBe(500)
    expect(r.remainingHeadroom).toBe(-500)
  })

  it("rejects negative creditLimit / proposedAmount (caller bug)", () => {
    expect(() =>
      checkCredit({ creditLimit: -1, outstanding: [], proposedAmount: 100 })
    ).toThrow(/non-negative/)
    expect(() =>
      checkCredit({ creditLimit: 100, outstanding: [], proposedAmount: -1 })
    ).toThrow(/non-negative/)
  })

  it("asOutstanding helper round-trips status + amount fields", () => {
    const r = asOutstanding([
      { status: "submitted", totalAmount: 100 },
      { status: "cancelled", totalAmount: 50 },
    ])
    expect(r).toHaveLength(2)
    expect(r[0].status).toBe("submitted")
    expect(r[1].status).toBe("cancelled")
  })
})

/* ─── convertRfqToOrder ───────────────────────────────────────────────── */

const ASOF = new Date("2026-05-17T00:00:00Z")

const VALID_RFQ: RfqRow = {
  id: "rfq_1",
  status: "quoted",
  validUntil: new Date("2026-06-30T00:00:00Z"),
  items: [
    {
      productId: "p_widget",
      productName: "Widget",
      quantity: 10,
      quotedUnitPrice: 8.5,
    },
    {
      productId: "p_gadget",
      productName: "Gadget",
      quantity: 4,
      quotedUnitPrice: 20,
    },
  ],
}

describe("D1 — convertRfqToOrder", () => {
  it("converts a quoted RFQ with all items priced", () => {
    const r = convertRfqToOrder({ rfq: VALID_RFQ, asOf: ASOF })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.items).toHaveLength(2)
      expect(r.items[0]).toMatchObject({
        productId: "p_widget",
        unitPrice: 8.5,
        quantity: 10,
        totalPrice: 85,
      })
      expect(r.items[1].totalPrice).toBe(80)
      expect(r.total).toBe(165)
    }
  })

  it("converted items carry priceSource='rfq' (audit-trail distinction)", () => {
    // Manually-quoted RFQ prices are distinct from PricingProfile
    // overrides + Product.price defaults; the audit trail must
    // surface this so slice-2 reporting can show "of $X order total,
    // $Y came from negotiated RFQ prices vs $Z from catalog defaults".
    const r = convertRfqToOrder({ rfq: VALID_RFQ, asOf: ASOF })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.items.every(i => i.priceSource === "rfq")).toBe(true)
    }
  })

  it("converts an accepted RFQ as well", () => {
    const r = convertRfqToOrder({
      rfq: { ...VALID_RFQ, status: "accepted" },
      asOf: ASOF,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects an RFQ in draft / submitted / rejected / expired status", () => {
    for (const status of ["draft", "submitted", "rejected", "expired"] as const) {
      const r = convertRfqToOrder({ rfq: { ...VALID_RFQ, status }, asOf: ASOF })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors[0]).toMatch(/status/)
    }
  })

  it("rejects an expired RFQ even when status is quoted", () => {
    const r = convertRfqToOrder({
      rfq: {
        ...VALID_RFQ,
        validUntil: new Date("2026-01-01T00:00:00Z"), // before asOf
      },
      asOf: ASOF,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/expired/i)
  })

  it("allows RFQ with no validUntil (never expires)", () => {
    const r = convertRfqToOrder({
      rfq: { ...VALID_RFQ, validUntil: null },
      asOf: ASOF,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects when any item missing quotedUnitPrice", () => {
    const r = convertRfqToOrder({
      rfq: {
        ...VALID_RFQ,
        items: [
          ...VALID_RFQ.items,
          {
            productId: "p_gizmo",
            productName: "Gizmo",
            quantity: 2,
            quotedUnitPrice: null,
          },
        ],
      },
      asOf: ASOF,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /no quotedUnitPrice/.test(e))).toBe(true)
  })

  it("collects multiple errors at once (not first-fail)", () => {
    const r = convertRfqToOrder({
      rfq: {
        ...VALID_RFQ,
        items: [
          {
            productId: "p_widget",
            productName: "Widget",
            quantity: 0, // invalid
            quotedUnitPrice: 5,
          },
          {
            productId: "p_gadget",
            productName: "Gadget",
            quantity: 1,
            quotedUnitPrice: null, // invalid
          },
        ],
      },
      asOf: ASOF,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2)
  })

  it("rejects empty items list", () => {
    const r = convertRfqToOrder({
      rfq: { ...VALID_RFQ, items: [] },
      asOf: ASOF,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/no items/)
  })

  it("rounds unit price + line total to 2 dp", () => {
    const r = convertRfqToOrder({
      rfq: {
        ...VALID_RFQ,
        items: [
          {
            productId: "p_widget",
            productName: "Widget",
            quantity: 3,
            quotedUnitPrice: 0.3333,
          },
        ],
      },
      asOf: ASOF,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.items[0].unitPrice).toBe(0.33)
      expect(r.items[0].totalPrice).toBe(0.99) // 0.33 * 3
      expect(r.total).toBe(0.99)
    }
  })
})
