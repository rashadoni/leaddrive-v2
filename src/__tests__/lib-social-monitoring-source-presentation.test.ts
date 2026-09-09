import { describe, expect, it } from "vitest"
import {
  monitoringDirectSourceKey,
  monitoringDirectSourceTargetsMatch,
  monitoringSourceHasScenarioLink,
  monitoringSourcePresentationKind,
  scenarioSearchWithoutMonitoringSource,
  scenarioSourceReferences,
  type MonitoringSourcePresentationInput,
} from "@/lib/social/monitoring-source-presentation"

function source(overrides: Partial<MonitoringSourcePresentationInput> = {}): MonitoringSourcePresentationInput {
  return {
    id: "source-1",
    platform: "instagram",
    sourceType: "profile",
    url: "https://instagram.com/example",
    handle: null,
    query: null,
    ownership: "external",
    settings: {},
    ...overrides,
  }
}

describe("monitoring source presentation", () => {
  it("keeps concrete page, profile and post targets in the direct-source list", () => {
    expect(monitoringSourcePresentationKind(source())).toBe("direct")
    expect(monitoringSourcePresentationKind(source({ url: null, handle: "example" }))).toBe("direct")
    expect(monitoringSourcePresentationKind(source({ sourceType: "search_url" }))).toBe("direct")
  })

  it("separates scenario-generated keyword routes from manually managed sources", () => {
    const generated = source({
      sourceType: "keyword",
      url: null,
      query: "pharma store",
      settings: { managedBy: "monitoring_scenario", scenarioId: "scenario-1", scenarioName: "PharmaStore" },
    })
    const standalone = source({ sourceType: "keyword", url: null, query: "pharma store" })

    expect(monitoringSourcePresentationKind(generated)).toBe("scenario_query")
    expect(monitoringSourcePresentationKind(standalone)).toBe("standalone_query")
    expect(monitoringSourceHasScenarioLink(generated)).toBe(true)
  })

  it("recovers concrete source references from saved scenarios without duplicating URLs", () => {
    const references = scenarioSourceReferences([
      {
        id: "scenario-1",
        name: "Araz",
        platforms: ["instagram", "facebook"],
        search: {
          topics: [],
          keywords: ["Araz Supermarket"],
          hashtags: ["arazsupermarket"],
          handles: [],
          urls: ["https://www.instagram.com/arazsupermarket/"],
        },
      },
      {
        id: "scenario-2",
        name: "Araz campaign",
        platforms: ["instagram"],
        search: {
          topics: [],
          keywords: [],
          hashtags: [],
          handles: [],
          // Same profile, pasted without `www.` — the case normalizeUrlKey
          // exists for. Together with scenario-1's trailing slash this covers
          // both ways an operator can re-add a source they already have.
          urls: ["https://instagram.com/arazsupermarket"],
        },
      },
    ])

    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject({
      key: "url:https://instagram.com/arazsupermarket",
      scenarioNames: ["Araz", "Araz campaign"],
      platforms: ["facebook", "instagram"],
    })
    expect(monitoringDirectSourceKey({ url: "https://www.instagram.com/arazsupermarket/", handle: null })).toBe(references[0].key)
  })

  it("matches saved scenario URLs to source options across harmless URL formatting differences", () => {
    expect(monitoringDirectSourceTargetsMatch(
      { url: "https://www.instagram.com/arazsupermarket/", handle: null },
      { url: "https://www.instagram.com/arazsupermarket", handle: null },
    )).toBe(true)
    expect(monitoringDirectSourceTargetsMatch(
      { url: null, handle: "@ArazSupermarket" },
      { url: null, handle: "arazsupermarket" },
    )).toBe(true)
    expect(monitoringDirectSourceTargetsMatch(
      { url: "https://www.instagram.com/arazsupermarket", handle: null },
      { url: "https://www.instagram.com/another-brand", handle: null },
    )).toBe(false)
  })

  it("removes both handle and generated URL forms before a source is deleted", () => {
    expect(scenarioSearchWithoutMonitoringSource({
      urls: ["https://www.instagram.com/brand/", "https://www.instagram.com/news"],
      handles: ["@brand", "other"],
    }, {
      platform: "instagram",
      url: null,
      handle: "brand",
    })).toEqual({
      urls: ["https://www.instagram.com/news"],
      handles: ["other"],
      changed: true,
    })
  })
})
