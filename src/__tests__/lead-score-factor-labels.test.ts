import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  getLeadScoreFactorLabel,
  type LeadScoreFactorTranslationKey,
} from "@/lib/leads/score-factor-labels"

const azMessages = JSON.parse(readFileSync("messages/az.json", "utf8")) as {
  leads: Record<string, string>
}

const translateAz = (key: LeadScoreFactorTranslationKey): string => azMessages.leads[key] ?? key

const scoringSurfaces = [
  "src/components/leads/lead-overview.tsx",
  "src/components/lead-item-modal.tsx",
  "src/app/(dashboard)/leads/[id]/page.tsx",
]

describe("lead score factor labels", () => {
  it.each([
    ["Recency", "Yaxınlıq"],
    ["DealPotential", "Sövdələşmə potensialı"],
    ["source_quality", "Mənbə keyfiyyəti"],
    ["engagement-level", "Əlaqə səviyyəsi"],
    ["Contact Completeness", "Əlaqə tamlığı"],
  ])("localizes %s in Azerbaijani", (factorKey, expected) => {
    expect(getLeadScoreFactorLabel(factorKey, translateAz)).toBe(expected)
  })

  it("localizes factors from the rule-based scoring fallback", () => {
    expect(getLeadScoreFactorLabel("priority", translateAz)).toBe("Prioritet")
    expect(getLeadScoreFactorLabel("value", translateAz)).toBe("Təxmini dəyər")
    expect(getLeadScoreFactorLabel("notes", translateAz)).toBe("Qeydlər")
  })

  it("turns an unknown camel-case key into a readable fallback", () => {
    expect(getLeadScoreFactorLabel("DecisionMakerFit", translateAz)).toBe("Decision Maker Fit")
  })

  it("uses the localized label helper on every lead scoring surface", () => {
    for (const file of scoringSurfaces) {
      expect(readFileSync(file, "utf8")).toContain("getLeadScoreFactorLabel(key, t)")
    }
  })
})
