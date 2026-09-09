/**
 * Tests for D3 OMS slice 1 — shipment state machine + return state machine
 * + return-quantity validator + BuyerOrder → Invoice projection.
 * No DB. Pure helpers.
 */
import { describe, expect, it } from "vitest"
import {
  advanceShipmentState,
  isTerminalShipmentState,
} from "@/lib/oms/shipment-state-machine"
import {
  advanceReturnState,
  isTerminalReturnState,
} from "@/lib/oms/return-state-machine"
import { validateReturnQuantities } from "@/lib/oms/return-quantity-validator"
import { projectInvoiceFromOrder } from "@/lib/oms/invoice-projector"
import type {
  ExistingReturnLine,
  OrderForInvoice,
  OrderForInvoiceLine,
  OrderLineRow,
  ProposedReturnLine,
  ReturnStatus,
  ShipmentStatus,
} from "@/lib/oms/types"
import type { BuyerOrderStatus } from "@/lib/b2b-commerce/types"

/* ─── Shipment state machine ──────────────────────────────────────────── */

describe("D3 OMS — advanceShipmentState", () => {
  it("pending → in_transit returns shipping side-effect", () => {
    const r = advanceShipmentState({ from: "pending", to: "in_transit" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("shipping")
  })

  it("in_transit → delivered returns delivering side-effect", () => {
    const r = advanceShipmentState({ from: "in_transit", to: "delivered" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("delivering")
  })

  it("in_transit → exception returns none side-effect (no new timestamp)", () => {
    const r = advanceShipmentState({ from: "in_transit", to: "exception" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("exception → in_transit (recovery) is allowed with no timestamp", () => {
    const r = advanceShipmentState({ from: "exception", to: "in_transit" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("exception → delivered returns delivering", () => {
    const r = advanceShipmentState({ from: "exception", to: "delivered" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("delivering")
  })

  it("pending → cancelled is allowed without timestamp", () => {
    const r = advanceShipmentState({ from: "pending", to: "cancelled" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("rejects no-op same-state transitions", () => {
    const r = advanceShipmentState({ from: "in_transit", to: "in_transit" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no-op/i)
  })

  it("rejects leaving the delivered terminal state", () => {
    const r = advanceShipmentState({ from: "delivered", to: "in_transit" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("rejects leaving the cancelled terminal state", () => {
    const r = advanceShipmentState({ from: "cancelled", to: "pending" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("rejects pending → delivered (must transit first)", () => {
    const r = advanceShipmentState({ from: "pending", to: "delivered" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("rejects in_transit → pending (no backward)", () => {
    const r = advanceShipmentState({ from: "in_transit", to: "pending" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("isTerminalShipmentState matches the documented terminal set", () => {
    const terminal: ShipmentStatus[] = ["delivered", "cancelled"]
    const nonTerminal: ShipmentStatus[] = ["pending", "in_transit", "exception"]
    for (const s of terminal) expect(isTerminalShipmentState(s)).toBe(true)
    for (const s of nonTerminal) expect(isTerminalShipmentState(s)).toBe(false)
  })
})

/* ─── Return state machine ────────────────────────────────────────────── */

describe("D3 OMS — advanceReturnState", () => {
  it("requested → approved returns approving side-effect", () => {
    const r = advanceReturnState({ from: "requested", to: "approved" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("approving")
  })

  it("approved → received returns receiving", () => {
    const r = advanceReturnState({ from: "approved", to: "received" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("receiving")
  })

  it("received → refunded returns refunding", () => {
    const r = advanceReturnState({ from: "received", to: "refunded" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("refunding")
  })

  it("received → closed (no-refund close, e.g. store-credit) is allowed without timestamp", () => {
    // Refund-coherence DB CHECK allows the all-NULL state, so closing
    // direct from received (no money refunded) is valid + leaves the
    // refunded* columns NULL on the row.
    const r = advanceReturnState({ from: "received", to: "closed" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("refunded → closed returns none side-effect", () => {
    const r = advanceReturnState({ from: "refunded", to: "closed" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("requested → rejected is the early-reject terminal branch", () => {
    const r = advanceReturnState({ from: "requested", to: "rejected" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("approved → cancelled is the post-approval terminal branch", () => {
    const r = advanceReturnState({ from: "approved", to: "cancelled" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sideEffect).toBe("none")
  })

  it("rejects approved → rejected (must use cancelled after approval)", () => {
    const r = advanceReturnState({ from: "approved", to: "rejected" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("rejects received → refunded skip via rejected", () => {
    const r = advanceReturnState({ from: "received", to: "rejected" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("rejects leaving the closed terminal", () => {
    const r = advanceReturnState({ from: "closed", to: "refunded" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("rejects leaving the rejected terminal", () => {
    const r = advanceReturnState({ from: "rejected", to: "approved" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal/i)
  })

  it("rejects same-state no-op", () => {
    const r = advanceReturnState({ from: "approved", to: "approved" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no-op/i)
  })

  it("rejects requested → refunded (must approve + receive first)", () => {
    const r = advanceReturnState({ from: "requested", to: "refunded" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/invalid/i)
  })

  it("isTerminalReturnState matches documented terminals", () => {
    const terminal: ReturnStatus[] = ["closed", "rejected", "cancelled"]
    const nonTerminal: ReturnStatus[] = [
      "requested",
      "approved",
      "received",
      "refunded",
    ]
    for (const s of terminal) expect(isTerminalReturnState(s)).toBe(true)
    for (const s of nonTerminal) expect(isTerminalReturnState(s)).toBe(false)
  })
})

/* ─── Return-quantity validator ───────────────────────────────────────── */

const ORDER_LINES: OrderLineRow[] = [
  { id: "oi_widget", quantity: 5 },
  { id: "oi_gadget", quantity: 2 },
]

describe("D3 OMS — validateReturnQuantities", () => {
  it("accepts a single proposed line within cap with no prior returns", () => {
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 3 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: [],
      proposed,
    })
    expect(r.ok).toBe(true)
  })

  it("accepts cumulative-cap-equal proposed quantity (5 = 5)", () => {
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 5 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: [],
      proposed,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects when proposed alone exceeds cap (6 > 5)", () => {
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 6 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: [],
      proposed,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/exceeds original quantity 5/)
  })

  it("rejects when active prior returns + proposed exceed cap (3+3 > 5)", () => {
    const existing: ExistingReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 3, returnStatus: "approved" },
    ]
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 3 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: existing,
      proposed,
    })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors.join(" ")).toMatch(/already returned: 3, proposed: 3/)
  })

  it("ignores rejected / cancelled prior returns when computing cap", () => {
    // Customer first asked for 4, got rejected → cap is fully open again.
    const existing: ExistingReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 4, returnStatus: "rejected" },
      { orderItemId: "oi_widget", quantity: 4, returnStatus: "cancelled" },
    ]
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 5 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: existing,
      proposed,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects empty proposed list", () => {
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: [],
      proposed: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/at least one line/)
  })

  it("rejects non-positive proposed quantity", () => {
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 0 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: [],
      proposed,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/invalid quantity/)
  })

  it("rejects unknown orderItemId", () => {
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_does_not_exist", quantity: 1 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: [],
      proposed,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/not present on the order/)
  })

  it("rejects duplicate orderItemId in the same proposed payload", () => {
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 1 },
      { orderItemId: "oi_widget", quantity: 2 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: [],
      proposed,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/more than once/)
  })

  it("validates multi-line proposal independently per line", () => {
    const existing: ExistingReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 4, returnStatus: "received" },
    ]
    // widget: 4 + 2 = 6 > 5 (FAIL)
    // gadget: 0 + 2 = 2 ≤ 2 (OK)  — but widget fail dominates
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 2 },
      { orderItemId: "oi_gadget", quantity: 2 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: existing,
      proposed,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // Only the widget line should error — gadget passes.
      expect(r.errors.some((e) => e.includes("oi_widget"))).toBe(true)
      expect(r.errors.some((e) => e.includes("oi_gadget"))).toBe(false)
    }
  })

  it("aggregates MULTIPLE existing returns per orderItemId against the cap", () => {
    // Two prior active returns for the SAME line — sum should accumulate.
    // 2 (approved) + 2 (received) + proposed 2 = 6 > 5 cap → fail.
    const existing: ExistingReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 2, returnStatus: "approved" },
      { orderItemId: "oi_widget", quantity: 2, returnStatus: "received" },
    ]
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 2 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: existing,
      proposed,
    })
    expect(r.ok).toBe(false)
    if (!r.ok)
      // already-returned should be 4 (2+2), not 2 — confirms aggregation.
      expect(r.errors.join(" ")).toMatch(/already returned: 4, proposed: 2/)
  })

  it("counts a closed (post-refund) return against the cap", () => {
    // Refunded + closed is still effectively "the goods came back" — it
    // must occupy quantity capacity. Refunded counted; closed too.
    const existing: ExistingReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 3, returnStatus: "refunded" },
      { orderItemId: "oi_widget", quantity: 2, returnStatus: "closed" },
    ]
    const proposed: ProposedReturnLine[] = [
      { orderItemId: "oi_widget", quantity: 1 },
    ]
    const r = validateReturnQuantities({
      orderLines: ORDER_LINES,
      existingReturns: existing,
      proposed,
    })
    // 3 + 2 + 1 = 6 > 5 cap
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/already returned: 5, proposed: 1/)
  })
})

/* ─── BuyerOrder → Invoice projection ─────────────────────────────────── */

const VALID_ORDER_ITEMS: OrderForInvoiceLine[] = [
  {
    id: "oi_widget",
    productId: "p_widget",
    productName: "Widget",
    quantity: 2,
    unitPrice: 10,
    discountPct: 0,
    totalPrice: 20,
  },
  {
    id: "oi_gadget",
    productId: "p_gadget",
    productName: "Gadget",
    quantity: 1,
    unitPrice: 50,
    discountPct: 10, // 10% off → 50 - 5 = 45
    totalPrice: 45,
  },
]

function makeOrder(overrides: Partial<OrderForInvoice> = {}): OrderForInvoice {
  return {
    id: "ord_123",
    organizationId: "org_acme",
    orderNumber: "ORD-001",
    currency: "USD",
    status: "delivered",
    items: VALID_ORDER_ITEMS,
    ...overrides,
  }
}

describe("D3 OMS — projectInvoiceFromOrder", () => {
  it("projects a delivered order into invoice with default INV-<orderNumber>", () => {
    const r = projectInvoiceFromOrder({ order: makeOrder() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.invoice.invoiceNumber).toBe("INV-ORD-001")
      expect(r.invoice.organizationId).toBe("org_acme")
      expect(r.invoice.currency).toBe("USD")
      expect(r.invoice.sourceOrderId).toBe("ord_123")
      expect(r.invoice.subtotal).toBe(65) // 20 + 45
      expect(r.invoice.items).toHaveLength(2)
    }
  })

  it("converts discountPct back to flat discount on each line", () => {
    const r = projectInvoiceFromOrder({ order: makeOrder() })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const widget = r.invoice.items.find((i) => i.productId === "p_widget")!
      const gadget = r.invoice.items.find((i) => i.productId === "p_gadget")!
      expect(widget.discount).toBe(0)
      expect(widget.total).toBe(20)
      expect(gadget.discount).toBe(5) // 50 * 10%
      expect(gadget.total).toBe(45)
    }
  })

  it("honours an explicit invoiceNumber override", () => {
    const r = projectInvoiceFromOrder({
      order: makeOrder(),
      invoiceNumber: "INV-2026-0042",
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.invoice.invoiceNumber).toBe("INV-2026-0042")
  })

  it("accepts the shipped and closed statuses too", () => {
    expect(projectInvoiceFromOrder({ order: makeOrder({ status: "shipped" }) }).ok).toBe(true)
    expect(projectInvoiceFromOrder({ order: makeOrder({ status: "closed" }) }).ok).toBe(true)
  })

  it("rejects projecting a draft / submitted / approved / cancelled / rejected order", () => {
    const ineligible: BuyerOrderStatus[] = [
      "draft",
      "submitted",
      "approved",
      "cancelled",
      "rejected",
    ]
    for (const status of ineligible) {
      const r = projectInvoiceFromOrder({ order: makeOrder({ status }) })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.join(" ")).toMatch(/must be "shipped", "delivered", or "closed"/)
    }
  })

  it("rejects an empty item list", () => {
    const r = projectInvoiceFromOrder({ order: makeOrder({ items: [] }) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/no items/i)
  })

  it("rejects when stored totalPrice diverges from recomputed unitPrice*qty - discount", () => {
    const broken: OrderForInvoiceLine = {
      id: "oi_x",
      productId: "p_x",
      productName: "X",
      quantity: 1,
      unitPrice: 100,
      discountPct: 0,
      totalPrice: 999, // mismatch — should be 100
    }
    const r = projectInvoiceFromOrder({
      order: makeOrder({ items: [broken] }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/does not match/)
  })

  it("accepts a stored totalPrice within the 0.01 rounding tolerance", () => {
    // The projector uses `Math.abs(diff) > 0.01` (strict >), so diffs
    // at or below the threshold pass. IEEE-754 trivia: 10.01 - 10.00
    // is actually 0.009999...787 in float, comfortably below 0.01 —
    // so this case passes regardless of the strict/non-strict choice.
    // The two decompositions (single-round vs triple-round) can also
    // disagree by ~0.01 on legitimate inputs, and rejecting would
    // false-positive on every such order.
    const onCusp: OrderForInvoiceLine = {
      id: "oi_t",
      productId: "p_t",
      productName: "T",
      quantity: 1,
      unitPrice: 10,
      discountPct: 0,
      totalPrice: 10.01, // recomputed is 10.00; |diff| ≈ 0.00999... ≤ 0.01 → pass
    }
    const r = projectInvoiceFromOrder({
      order: makeOrder({ items: [onCusp] }),
    })
    expect(r.ok).toBe(true)
  })

  it("rejects a stored totalPrice just past the 0.01 tolerance", () => {
    // diff = 0.02 — exceeds threshold, must reject (slice-2 audit signal).
    const offCusp: OrderForInvoiceLine = {
      id: "oi_t2",
      productId: "p_t2",
      productName: "T2",
      quantity: 1,
      unitPrice: 10,
      discountPct: 0,
      totalPrice: 10.02,
    }
    const r = projectInvoiceFromOrder({
      order: makeOrder({ items: [offCusp] }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/does not match/)
  })

  it("rejects invalid line data (negative price, bad qty, bad pct)", () => {
    const bad: OrderForInvoiceLine[] = [
      {
        id: "oi_neg",
        productId: "p_neg",
        productName: "Neg",
        quantity: 1,
        unitPrice: -5,
        discountPct: 0,
        totalPrice: -5,
      },
    ]
    const r = projectInvoiceFromOrder({ order: makeOrder({ items: bad }) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/invalid unitPrice/)
  })

  it("rejects 0 quantity lines", () => {
    const bad: OrderForInvoiceLine[] = [
      {
        id: "oi_z",
        productId: "p_z",
        productName: "Z",
        quantity: 0,
        unitPrice: 5,
        discountPct: 0,
        totalPrice: 0,
      },
    ]
    const r = projectInvoiceFromOrder({ order: makeOrder({ items: bad }) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/invalid quantity/)
  })

  it("rejects discountPct outside 0..100", () => {
    const bad: OrderForInvoiceLine[] = [
      {
        id: "oi_dp",
        productId: "p_dp",
        productName: "DP",
        quantity: 1,
        unitPrice: 10,
        discountPct: 150,
        totalPrice: -5,
      },
    ]
    const r = projectInvoiceFromOrder({ order: makeOrder({ items: bad }) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/invalid discountPct/)
  })

  it("rounds subtotal and per-line totals to 2dp", () => {
    const fractional: OrderForInvoiceLine[] = [
      {
        id: "oi_a",
        productId: "p_a",
        productName: "A",
        quantity: 3,
        unitPrice: 3.333,
        discountPct: 0,
        // 3.333 * 3 = 9.999 → round to 10.00
        totalPrice: 10,
      },
    ]
    const r = projectInvoiceFromOrder({
      order: makeOrder({ items: fractional }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.invoice.items[0].total).toBe(10)
      expect(r.invoice.subtotal).toBe(10)
    }
  })
})
