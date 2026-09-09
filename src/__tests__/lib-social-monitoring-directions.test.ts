import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  archiveMatchSignature,
  scenarioSourceTargets,
  type MonitoringScenario,
  type MonitoringScenarioDirection,
} from "@/lib/social/monitoring-scenarios"

/**
 * The product promise is that enabling both "general reputation" and "customer
 * complaints" collects the data ONCE. These tests are the structural guard: if
 * anyone ever routes `ai.directions` into source building or the archive
 * signature, a direction toggle would start costing money and silently discard
 * already-paid-for archive work. Both assertions must stay byte-exact.
 */
function scenario(directions: MonitoringScenarioDirection[]): MonitoringScenario {
  return {
    id: "scn-1",
    subjectId: "subject-1",
    subjectName: "Araz Supermarket",
    name: "Araz Supermarket",
    description: null,
    status: "active",
    platforms: ["instagram", "facebook", "tiktok", "web"],
    search: {
      topics: [],
      keywords: ["Araz Supermarket"],
      hashtags: ["arazsupermarket"],
      handles: ["araz_supermarket"],
      urls: [],
      useHashtagFallback: true,
      includeOwnedComments: true,
      includeExternalComments: true,
    },
    ai: { sentiments: ["negative", "complaint"], minConfidence: 80, action: "draft_reply", directions },
    reply: { identityId: null, identityLabel: null, mode: "manual_approval", autoReplyEnabled: false, liveSendAllowed: false },
    archive: { startAt: null, lastBackfilledAt: null, scannedCount: 0, matchedCount: 0, status: "pending" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  }
}

const reputationOnly = scenario(["general_reputation"])
const complaintsOnly = scenario(["customer_complaints"])
const bothDirections = scenario(["general_reputation", "customer_complaints"])

describe("analysis directions never fan out into provider collection", () => {
  it("builds an identical source set for one direction and for two", () => {
    expect(scenarioSourceTargets(bothDirections)).toEqual(scenarioSourceTargets(reputationOnly))
  })

  it("builds an identical source set regardless of which direction is chosen", () => {
    expect(scenarioSourceTargets(complaintsOnly)).toEqual(scenarioSourceTargets(reputationOnly))
  })

  it("does not grow the source count when a direction is added", () => {
    // The Araz acceptance case: 4 platforms x (1 keyword + 1 hashtag + 1 handle).
    const before = scenarioSourceTargets(reputationOnly).length
    const after = scenarioSourceTargets(bothDirections).length
    expect(after).toBe(before)
    expect(after).toBeGreaterThan(0)
  })

  it("ignores legacy pinned pages and keeps global keyword discovery", () => {
    const mixedTargets = scenario(["general_reputation"])
    mixedTargets.search.handles = []
    mixedTargets.search.urls = [
      "https://www.instagram.com/arazsupermarket/",
      "https://www.facebook.com/arazsupermarket/",
    ]

    const targets = scenarioSourceTargets(mixedTargets)
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetType: "keyword", input: expect.objectContaining({ platform: "instagram" }) }),
      expect.objectContaining({ targetType: "keyword", input: expect.objectContaining({ platform: "facebook" }) }),
      expect.objectContaining({ targetType: "keyword", input: expect.objectContaining({
        platform: "tiktok",
        query: "Araz Supermarket",
        keywords: [],
        settings: expect.objectContaining({ canonicalBrandQuery: true }),
      }) }),
    ]))
    expect(targets.every(target => target.targetType !== "url" && target.targetType !== "handle")).toBe(true)
  })

  it("never provisions direct YouTube/web targets from legacy scenario URLs", () => {
    const withChannelUrl = scenario(["general_reputation"])
    withChannelUrl.platforms = ["youtube", "web", "tiktok"]
    withChannelUrl.search.handles = []
    withChannelUrl.search.keywords = ["zeytun aptek"]
    withChannelUrl.search.hashtags = []
    withChannelUrl.search.urls = [
      "https://www.youtube.com/@zeytunpharmaceuticals",
      "https://www.linkedin.com/company/pharmastore-mmc",
    ]

    const targets = scenarioSourceTargets(withChannelUrl)
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetType: "keyword", input: expect.objectContaining({
        platform: "youtube",
        query: "zeytun aptek",
        keywords: [],
      }) }),
      expect.objectContaining({ targetType: "keyword", input: expect.objectContaining({
        platform: "tiktok",
        query: "zeytun aptek",
        keywords: [],
      }) }),
    ]))
    expect(targets.every(target => !target.input.url && !target.input.handle)).toBe(true)
    // Веб больше не порождает поисковый источник: покрытие даёт только
    // подключённая к сценарию лента Google Alerts.
    expect(targets.some(target => target.input.platform === "web")).toBe(false)
  })

  it("keeps one source per platform: the canonical query plus a scenario-owned fan-out list (#638)", () => {
    const aliases = scenario(["general_reputation"])
    aliases.platforms = ["youtube", "tiktok"]
    aliases.search.topics = ["Araz Supermarket"]
    aliases.search.keywords = ["Araz Market", "araz supermarket"]
    aliases.search.hashtags = ["#arazsupermarket", "arazendirim"]
    aliases.search.handles = []

    const targets = scenarioSourceTargets(aliases)
    const youtubeTargets = targets.filter(target => target.input.platform === "youtube")
    const tiktokTargets = targets.filter(target => target.input.platform === "tiktok")

    expect(youtubeTargets).toEqual([
      expect.objectContaining({
        targetType: "keyword",
        targetValue: "Araz Supermarket",
        input: expect.objectContaining({
          sourceType: "keyword",
          query: "Araz Supermarket",
          keywords: [],
          settings: expect.objectContaining({
            canonicalBrandQuery: true,
            aliases: ["Araz Market", "arazsupermarket", "arazendirim"],
            // Веер платного поиска (#638) идёт из этого списка — сценарий
            // перезаписывает его при каждом сохранении, в отличие от aliases.
            searchFanOutTerms: ["Araz Market", "arazsupermarket", "arazendirim"],
          }),
        }),
      }),
    ])
    expect(tiktokTargets).toEqual([
      expect.objectContaining({
        targetType: "keyword",
        targetValue: "Araz Supermarket",
        input: expect.objectContaining({
          sourceType: "keyword",
          query: "Araz Supermarket",
          keywords: [],
          settings: expect.objectContaining({
            canonicalBrandQuery: true,
            aliases: ["Araz Market", "arazsupermarket", "arazendirim"],
            searchFanOutTerms: ["Araz Market", "arazsupermarket", "arazendirim"],
          }),
        }),
      }),
    ])
  })

  it("never fans many aliases out into extra YouTube provider searches", () => {
    const manyAliases = scenario(["general_reputation"])
    manyAliases.platforms = ["youtube"]
    manyAliases.search.topics = []
    manyAliases.search.keywords = Array.from({ length: 11 }, (_, index) => `brand alias ${index + 1}`)
    manyAliases.search.hashtags = []
    manyAliases.search.handles = []

    const targets = scenarioSourceTargets(manyAliases)
    expect(targets).toHaveLength(1)
    expect(targets[0].input.query).toBe("brand alias 1")
    expect(targets[0].input.keywords).toEqual([])
  })

  it("never fans many aliases out into extra TikTok provider searches", () => {
    const manyAliases = scenario(["general_reputation"])
    manyAliases.platforms = ["tiktok"]
    manyAliases.search.topics = []
    manyAliases.search.keywords = Array.from({ length: 11 }, (_, index) => `brand alias ${index + 1}`)
    manyAliases.search.hashtags = []
    manyAliases.search.handles = []

    const targets = scenarioSourceTargets(manyAliases)
    expect(targets).toHaveLength(1)
    expect(targets[0].input.query).toBe("brand alias 1")
    expect(targets[0].input.keywords).toEqual([])
  })
})

describe("analysis directions never invalidate the archive", () => {
  it("keeps the archive signature stable when a direction is added", () => {
    expect(archiveMatchSignature(bothDirections)).toBe(archiveMatchSignature(reputationOnly))
  })

  it("keeps the archive signature stable when directions are swapped", () => {
    expect(archiveMatchSignature(complaintsOnly)).toBe(archiveMatchSignature(reputationOnly))
  })

  it("still invalidates the archive when the search terms really change", () => {
    const widened = scenario(["general_reputation"])
    widened.search.keywords = ["Araz Supermarket", "Araz Market"]
    expect(archiveMatchSignature(widened)).not.toBe(archiveMatchSignature(reputationOnly))
  })

  it("still invalidates the archive when platforms really change", () => {
    const narrowed = scenario(["general_reputation"])
    narrowed.platforms = ["instagram"]
    expect(archiveMatchSignature(narrowed)).not.toBe(archiveMatchSignature(reputationOnly))
  })

  it("does not invalidate the archive for removed legacy URL/handle fields", () => {
    const legacyDirectTargets = scenario(["general_reputation"])
    legacyDirectTargets.search.handles = ["another_handle"]
    legacyDirectTargets.search.urls = ["https://www.instagram.com/another_page"]
    expect(archiveMatchSignature(legacyDirectTargets)).toBe(archiveMatchSignature(reputationOnly))
  })
})
