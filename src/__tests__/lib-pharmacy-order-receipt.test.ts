import { describe, expect, it } from "vitest"

import { receiptLines } from "@/lib/pharmacy-orders/manager-notice"

// The pharmacy's WhatsApp list: one template parameter, which Meta takes only
// on one line and inside a 1024-character body.
describe("receiptLines", () => {
  const found = (name: string, quantity = 1) => ({ status: "resolved", productName: name, spokenText: name, quantity, unit: "qutu" })

  it("names found lines from the catalog and marks the ones a manager still has to find", () => {
    expect(receiptLines([
      found("Ketonal 2 ml № 10  /*qutu/*  \\*LEK ,Sloveniya\\*", 5),
      { status: "not_found", productName: null, spokenText: "fluimusil\naltı yüz", quantity: 3, unit: "ədəd" },
    ])).toBe("Ketonal 2 ml № 10 (qutu) (LEK, Sloveniya) — 5 qutu; fluimusil altı yüz (yoxlanılır) — 3 ədəd")
  })

  it("keeps whole lines and counts the rest when a long order does not fit", () => {
    const lines = Array.from({ length: 40 }, (_, index) => found(`Preparat nömrə ${index + 1} 500 mq № 20`, index + 1))
    const text = receiptLines(lines)
    expect(text.length).toBeLessThanOrEqual(700)
    expect(text).not.toMatch(/[\n\t]/u)
    const shown = text.split("; ").filter(part => part.startsWith("Preparat"))
    expect(text.endsWith(`; və daha ${40 - shown.length} mövqe`)).toBe(true)
    expect(shown.every((part, index) => part === `Preparat nömrə ${index + 1} 500 mq № 20 — ${index + 1} qutu`)).toBe(true)
  })

  it("never sends an empty parameter", () => {
    expect(receiptLines([])).toBe("—")
  })
})
