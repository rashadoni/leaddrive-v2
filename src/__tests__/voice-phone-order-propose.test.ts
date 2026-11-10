import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Этап 5 (владелец 2026-11-10): «в заказе 1015 поставь пять коробок Кетонала»
 * — слова модели в заказ, строку и товар каталога. Ниже — как сервер их
 * находит и когда спрашивает вместо догадки.
 */

const mocks = vi.hoisted(() => ({
  orders: vi.fn(),
  order: vi.fn(),
  lines: vi.fn(),
  catalog: vi.fn(),
  enabled: vi.fn(async () => true),
  running: vi.fn(async () => false),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pharmacyPhoneOrder: { findMany: mocks.orders, findFirst: mocks.order },
    pharmacyPhoneOrderLine: { findMany: mocks.lines },
  },
}))
vi.mock("@/lib/pharmacy-orders/orders", () => ({
  PhoneOrderError: class PhoneOrderError extends Error {},
  phoneOrdersEnabled: mocks.enabled,
  callStillRunning: mocks.running,
  searchPhoneOrderCatalog: mocks.catalog,
}))

import { phoneOrderWords, resolvePhoneOrderProposal } from "@/lib/ai/voice/propose-phone-order"
import { voiceMayConfirm, voiceProposalNeedsButton } from "@/lib/ai/voice/voice-confirmation"
import type { AuthResult } from "@/lib/api-auth"

const auth = { orgId: "org-z", userId: "user-1", role: "manager" } as unknown as AuthResult

const ORDER = {
  id: "order-1015", number: 1015, status: "pending_review", revision: 3, providerCallId: "call-1",
  pharmacyName: "92 Yasamal", totalAmount: { toFixed: () => "154.30" }, currency: "AZN", company: { name: "Nur Aptek 92 Yasamal" },
}
const LINES = [
  { id: "line-1", position: 1, productName: "Ketonal gel 2,5% 50 q", sourceName: "Кетонал гель", spokenText: "ketonal gel", quantity: 10, unit: "qutu" },
  { id: "line-2", position: 2, productName: "No-şpa 40 mq № 24", sourceName: "Но-шпа", spokenText: "noşpa", quantity: 4, unit: "qutu" },
]
const KREM = { externalId: "11111111-1111-4111-8111-111111111111", itemCode: "001", name: "Ketonal krem 5% 50 q", sourceName: "Кетонал крем", price: { amount: "6.20", per: "qutu" } }
const GEL100 = { externalId: "22222222-2222-4222-8222-222222222222", itemCode: "002", name: "Ketonal gel 2,5% 100 q", sourceName: "Кетонал гель 100", price: { amount: "9.10", per: "qutu" } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.order.mockImplementation(async ({ where }: { where: { number?: number; id?: string } }) =>
    where.number === 1015 || where.id === "order-1015" ? ORDER : null)
  mocks.orders.mockResolvedValue([ORDER])
  mocks.lines.mockResolvedValue(LINES)
  mocks.catalog.mockResolvedValue({ observedAt: "2026-11-10T00:00:00Z", items: [KREM, GEL100] })
})

describe("phone order by voice: words to an order, a line and a catalog product", () => {
  it("reads Russian, Azerbaijani and 1C spellings as the same words", () => {
    expect(phoneOrderWords("Кетонал гель")).toEqual(phoneOrderWords("Ketonal gel"))
    expect(phoneOrderWords("Но-шпа")).toEqual(phoneOrderWords("No-şpa"))
  })

  it("finds the order by number, by the pharmacy's words, or the one open on screen", async () => {
    const byNumber = await resolvePhoneOrderProposal(auth, "propose_confirm_phone_order", { order: "TS-1015" }, {})
    expect(byNumber).toEqual({ kind: "resolved", actionType: "confirm_phone_order", payload: { orderId: "order-1015", revision: 3 } })
    expect(await resolvePhoneOrderProposal(auth, "propose_confirm_phone_order", { order: "1015" }, {})).toMatchObject({ kind: "resolved" })
    expect(await resolvePhoneOrderProposal(auth, "propose_confirm_phone_order", { order: "Nur Yasamal" }, {})).toMatchObject({ kind: "resolved" })
    expect(await resolvePhoneOrderProposal(auth, "propose_confirm_phone_order", {}, { recordType: "phone_order", recordId: "order-1015" }))
      .toMatchObject({ kind: "resolved", payload: { orderId: "order-1015" } })
    // Nothing named and nothing open: a question with the waiting orders.
    expect(await resolvePhoneOrderProposal(auth, "propose_confirm_phone_order", {}, {})).toEqual({
      kind: "clarify", code: "PHONE_ORDER_TARGET_REQUIRED", field: "order", candidates: [{ id: "order-1015", label: "TS-1015 · Nur Aptek 92 Yasamal · 154.30 AZN" }],
    })
    expect(await resolvePhoneOrderProposal(auth, "propose_confirm_phone_order", { order: "2001" }, {}))
      .toMatchObject({ kind: "clarify", code: "PHONE_ORDER_NOT_FOUND" })
  })

  it("names the line by its number or its product, and asks when the words fit two lines", async () => {
    const byWords = await resolvePhoneOrderProposal(auth, "propose_change_phone_order_line", { order: "1015", line: "кетонал", quantity: 5 }, {})
    expect(byWords).toEqual({ kind: "resolved", actionType: "update_phone_order_line",
      payload: { orderId: "order-1015", revision: 3, lineId: "line-1", quantity: 5 } })
    expect(await resolvePhoneOrderProposal(auth, "propose_remove_phone_order_line", { order: "1015", line: "2" }, {}))
      .toMatchObject({ kind: "resolved", payload: { lineId: "line-2" } })
    mocks.lines.mockResolvedValueOnce([...LINES, { ...LINES[0], id: "line-3", position: 3 }])
    expect(await resolvePhoneOrderProposal(auth, "propose_remove_phone_order_line", { order: "1015", line: "ketonal" }, {}))
      .toMatchObject({ kind: "clarify", code: "PHONE_ORDER_LINE_AMBIGUOUS", field: "line" })
  })

  it("asks which product when the catalog has several, and takes the one named exactly", async () => {
    const asked = await resolvePhoneOrderProposal(auth, "propose_change_phone_order_line", { order: "1015", line: "1", product: "ketonal" }, {})
    expect(asked).toMatchObject({ kind: "clarify", code: "PRODUCT_AMBIGUOUS", field: "product" })
    if (asked.kind === "clarify") expect(asked.candidates.map(candidate => candidate.label)).toEqual(["Ketonal krem 5% 50 q · 6.20 / qutu", "Ketonal gel 2, 5% 100 q · 9.10 / qutu"])
    const chosen = await resolvePhoneOrderProposal(auth, "propose_change_phone_order_line", { order: "1015", line: "1", product: "Ketonal krem 5% 50 q" }, {})
    expect(chosen).toEqual({ kind: "resolved", actionType: "update_phone_order_line", payload: {
      orderId: "order-1015", revision: 3, lineId: "line-1",
      externalId: KREM.externalId, itemCode: "001", productName: KREM.name, sourceName: KREM.sourceName, unitPrice: "6.20" } })
    // A new line takes 1C's unit when the user named none.
    mocks.catalog.mockResolvedValueOnce({ observedAt: "", items: [KREM] })
    expect(await resolvePhoneOrderProposal(auth, "propose_add_phone_order_line", { order: "1015", product: "ketonal krem", quantity: 2 }, {}))
      .toMatchObject({ kind: "resolved", payload: { externalId: KREM.externalId, quantity: 2, unit: "qutu" } })
  })

  it("refuses an order that is closed, still on its call, or an organization without phone orders", async () => {
    mocks.order.mockResolvedValueOnce({ ...ORDER, status: "confirmed" })
    expect(await resolvePhoneOrderProposal(auth, "propose_reject_phone_order", { order: "1015", reason: "dublikat" }, {}))
      .toMatchObject({ kind: "invalid", issues: [{ path: "order", message: expect.stringContaining("already confirmed") }] })
    mocks.running.mockResolvedValueOnce(true)
    expect(await resolvePhoneOrderProposal(auth, "propose_confirm_phone_order", { order: "1015" }, {}))
      .toMatchObject({ kind: "invalid", issues: [{ message: expect.stringContaining("still on the call") }] })
    mocks.enabled.mockResolvedValueOnce(false)
    expect(await resolvePhoneOrderProposal(auth, "propose_confirm_phone_order", { order: "1015" }, {}))
      .toMatchObject({ kind: "invalid" })
  })

  it("confirms and rejects an order only with the button: 1C and the pharmacy hear it", () => {
    expect(voiceMayConfirm("confirm_phone_order", ["orderId"])).toBe(false)
    expect(voiceMayConfirm("reject_phone_order", ["orderId", "reason"])).toBe(false)
    expect(voiceMayConfirm("update_phone_order_line", ["orderId", "lineId", "quantity"])).toBe(true)
    expect(voiceProposalNeedsButton("propose_confirm_phone_order", {})).toBe(true)
    expect(voiceProposalNeedsButton("propose_change_phone_order_line", { quantity: 2 })).toBe(false)
  })
})
