import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const azMessages = JSON.parse(readFileSync("messages/az.json", "utf8")) as {
  meddpicc: Record<string, string>
}
const componentSource = readFileSync(
  "src/components/deals/deal-meddpicc.tsx",
  "utf8",
)

describe("MEDDPICC plain-language copy", () => {
  it("explains Metrics as a measurable customer benefit with examples", () => {
    expect(azMessages.meddpicc.block_metrics).toBe(
      "Ölçülə bilən fayda (Metrics)",
    )
    expect(azMessages.meddpicc.hint_metrics).toContain("5 000 AZN")
    expect(azMessages.meddpicc.hint_metrics).toContain("15%")
    expect(azMessages.meddpicc.hint_metrics).toContain("2 saat")
  })

  it("explains every score and gives actionable field prompts", () => {
    for (const score of [1, 2, 3, 4, 5]) {
      expect(azMessages.meddpicc[`score_${score}`]).toBeTruthy()
    }
    expect(azMessages.meddpicc.whyPlaceholder).toContain("faktı")
    expect(azMessages.meddpicc.nextPlaceholder).toContain("növbəti addımı")
    expect(componentSource).toContain('t("scoreGuide")')
    expect(componentSource).toContain("aria-pressed={block.score === s}")
  })
})
