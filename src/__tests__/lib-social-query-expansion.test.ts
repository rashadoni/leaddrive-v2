import { describe, expect, it } from "vitest"
import { expandMonitoringQueries, suggestedCadenceFromExpansions } from "@/lib/social/query-expansion"

describe("social query expansion", () => {
  it("expands hashtags with base, hashtag, keyword, alias, and spacing variants", () => {
    const expansions = expandMonitoringQueries({
      sourceType: "hashtag",
      query: "#LeadDriveCRM",
      keywords: ["Lead Drive", "LeadDriveCRM", "лид драйв"],
      aliases: ["LD CRM"],
    })

    expect(expansions.map((item) => item.displayTerm)).toEqual(expect.arrayContaining([
      "leaddrivecrm",
      "#leaddrivecrm",
      "lead drive",
      "лид драйв",
      "ld crm",
      "lead drive crm",
    ]))
    expect(expansions.find((item) => item.displayTerm === "#leaddrivecrm")).toMatchObject({
      reason: "hashtag_variant",
      priority: 95,
      cadenceMinutes: 30,
    })
    expect(expansions.find((item) => item.displayTerm === "лид драйв")).toMatchObject({
      language: "ru",
      reason: "keyword",
    })
  })

  it("adds Azerbaijani ASCII variants and de-duplicates repeated keywords", () => {
    const expansions = expandMonitoringQueries({
      sourceType: "keyword",
      query: "məhsul qiyməti",
      keywords: ["məhsul qiyməti", "Mehsul Qiymeti", "kampaniya"],
    })

    expect(expansions.map((item) => item.displayTerm)).toEqual(expect.arrayContaining([
      "məhsul qiyməti",
      "mehsul qiymeti",
      "kampaniya",
    ]))
    expect(expansions.filter((item) => item.normalizedTerm === "məhsul qiyməti")).toHaveLength(1)
    expect(expansions.find((item) => item.displayTerm === "məhsul qiyməti")).toMatchObject({
      language: "az",
      priority: 100,
    })
  })

  it("suggests source cadence from the highest-priority expanded query", () => {
    const lowPriority = expandMonitoringQueries({
      sourceType: "keyword",
      keywords: ["support phrase"],
    })
    const highPriority = expandMonitoringQueries({
      sourceType: "keyword",
      query: "brand complaint",
      keywords: ["support phrase"],
    })

    expect(suggestedCadenceFromExpansions(lowPriority, 1440)).toBe(60)
    expect(suggestedCadenceFromExpansions(highPriority, 1440)).toBe(30)
  })
})
