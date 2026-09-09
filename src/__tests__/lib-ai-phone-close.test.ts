import { describe, expect, it } from "vitest"
import { shouldResolveAfterPhone } from "@/lib/inbox/customer-phone"

describe("shouldResolveAfterPhone", () => {
  it.each([
    "051 784 59 39",
    "0503513223",
    "+994 55 704 96 96",
  ])("resolves a TikTok conversation after a supplied phone: %s", (text) => {
    expect(shouldResolveAfterPhone("tiktok", text)).toBe(true)
  })

  it("does not resolve other channels automatically", () => {
    expect(shouldResolveAfterPhone("whatsapp", "050 123 45 67")).toBe(false)
  })

  it.each([
    "90 KV METRƏ",
    "500",
    "501234567",
    "3",
    "qiyməti 55 manatdır",
    "",
    "+994500000012",
    "+99450000000",
    "050 000 00 12",
  ])(
    "does not mistake ordinary numbers for a phone: %s",
    (text) => {
      expect(shouldResolveAfterPhone("tiktok", text)).toBe(false)
    },
  )
})
