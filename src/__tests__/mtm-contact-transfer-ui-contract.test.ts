import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("MTM contact transfer offline result UI contract", () => {
  it("keeps the receipt scope-bound, persistent and reconcilable", () => {
    const explorer = readFileSync("src/components/mtm/contact-explorer.tsx", "utf8")
    const dialog = readFileSync("src/components/mtm/contact-transfer-dialog.tsx", "utf8")
    const panel = readFileSync("src/components/mtm/contact-transfer-receipt-panel.tsx", "utf8")

    expect(dialog).toContain("saveContactTransferReceipt")
    expect(explorer).toContain("loadContactTransferReceipt")
    expect(explorer).toContain("applyContactTransferReconciliation")
    expect(explorer).toContain("window.addEventListener(\"online\"")
    expect(panel).toContain("savedOffline")
    expect(panel).toContain("mismatchDescription")
    expect(panel).toContain("min-h-11")
  })
})
