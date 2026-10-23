/**
 * The Kapital Bank client: what goes on the wire and how the bank's answers
 * are read. Request shapes follow the bank's Postman collection and were
 * checked against its test host on 2026-10-23 (an order was created there and
 * its status read back; a wrong password answered `InvalidLogin`).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createKapitalOrder,
  formatKapitalAmount,
  getKapitalOrderStatus,
  kapitalOutcome,
  kapitalPaymentPageUrl,
  KapitalBankError,
} from "@/lib/payments/kapitalbank/client"
import { getEmailTemplate } from "@/lib/invoice-html"

const creds = { login: "TerminalSys/kapital", password: "kapital123", isTestMode: true }

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Kapital Bank client", () => {
  it("creates a single-message order on the test host with Basic auth and a two-decimal amount", async () => {
    const fetchMock = answer(200, { order: { id: 288724, hppUrl: "https://txpgtst.kapitalbank.az/flex", password: "1bv1s753v9eok", status: "Preparing" } })
    vi.stubGlobal("fetch", fetchMock)

    const order = await createKapitalOrder(creds, {
      amount: 12.3456, currency: "AZN", description: "INV-7", language: "ru", redirectUrl: "https://app.example/return",
    })

    expect(order).toEqual({ id: "288724", password: "1bv1s753v9eok", hppUrl: "https://txpgtst.kapitalbank.az/flex" })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://txpgtst.kapitalbank.az/api/order")
    expect(init.method).toBe("POST")
    expect(new Headers(init.headers).get("authorization")).toBe(`Basic ${Buffer.from("TerminalSys/kapital:kapital123").toString("base64")}`)
    expect(JSON.parse(String(init.body))).toEqual({
      order: {
        typeRid: "Order_SMS", amount: "12.35", currency: "AZN", language: "ru",
        description: "INV-7", hppRedirectUrl: "https://app.example/return",
      },
    })
  })

  it("uses the live host outside test mode", async () => {
    const fetchMock = answer(200, { order: { id: 1, hppUrl: "https://e-commerce.kapitalbank.az/flex", password: "p" } })
    vi.stubGlobal("fetch", fetchMock)

    await createKapitalOrder({ ...creds, isTestMode: false }, {
      amount: 1, currency: "AZN", description: "x", language: "az", redirectUrl: "https://app.example/r",
    })

    expect(fetchMock.mock.calls[0][0]).toBe("https://e-commerce.kapitalbank.az/api/order")
  })

  it("reports a rejected login by the bank's own code", async () => {
    vi.stubGlobal("fetch", answer(400, { errorCode: "InvalidLogin", errorDescription: "Invalid login or password" }))

    const attempt = createKapitalOrder(creds, { amount: 1, currency: "AZN", description: "x", language: "az", redirectUrl: "r" })

    await expect(attempt).rejects.toBeInstanceOf(KapitalBankError)
    await expect(attempt).rejects.toMatchObject({ code: "InvalidLogin" })
  })

  it("reports an unreachable bank as a network error, not as a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed") }))

    await expect(getKapitalOrderStatus(creds, { id: "1", password: "p" })).rejects.toMatchObject({ code: "Network" })
  })

  it("reads an order's status with its password", async () => {
    const fetchMock = answer(200, { order: { id: 5531, status: "FullyPaid", prevStatus: "Preparing", amount: 1.5, currency: "AZN" } })
    vi.stubGlobal("fetch", fetchMock)

    const status = await getKapitalOrderStatus(creds, { id: "5531", password: "a b" })

    expect(status).toEqual({ id: "5531", status: "FullyPaid", prevStatus: "Preparing", amount: 1.5, currency: "AZN" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://txpgtst.kapitalbank.az/api/order/5531?password=a%20b")
  })

  it("builds the payment page address the customer is sent to", () => {
    expect(kapitalPaymentPageUrl({ id: "288724", password: "1bv1s753v9eok", hppUrl: "https://txpgtst.kapitalbank.az/flex" }))
      .toBe("https://txpgtst.kapitalbank.az/flex?id=288724&password=1bv1s753v9eok")
  })

  it("decides only on statuses that settle an order", () => {
    expect(kapitalOutcome({ status: "FullyPaid", prevStatus: "Preparing" })).toBe("paid")
    expect(kapitalOutcome({ status: "Closed", prevStatus: "FullyPaid" })).toBe("paid")
    expect(kapitalOutcome({ status: "Closed", prevStatus: "Declined" })).toBe("open")
    for (const status of ["Declined", "Rejected", "Refused", "Expired", "Cancelled"]) {
      expect(kapitalOutcome({ status, prevStatus: null })).toBe("failed")
    }
    for (const status of ["Preparing", "Authorized", "PartPaid", "Refunded", "Voided"]) {
      expect(kapitalOutcome({ status, prevStatus: null })).toBe("open")
    }
  })

  it("refuses a zero amount instead of opening an order for nothing", () => {
    expect(formatKapitalAmount(0.004 + 99.996)).toBe("100.00")
    expect(() => formatKapitalAmount(0)).toThrow()
  })
})

describe("invoice e-mail", () => {
  const data = { orgName: "Acme", invoiceNumber: "INV-1", total: "10.00", currency: "AZN", dueDate: "01.11.2026" }

  it("carries a pay-by-card button when the invoice can be paid online", () => {
    const { html } = getEmailTemplate("az", { ...data, payUrl: "https://app.example/portal/invoice/t?lang=az&x=\"1\"" })

    expect(html).toContain('href="https://app.example/portal/invoice/t?lang=az&amp;x=&quot;1&quot;"')
    expect(html).toContain("Kartla ödə")
  })

  it("has no button otherwise", () => {
    expect(getEmailTemplate("ru", data).html).not.toContain("Оплатить картой")
  })
})
