import { describe, expect, it } from "vitest"
import {
  monitoringProfileScenarioRoutePlans,
  monitoringProfileSharedSourceCanTargetScenario,
  monitoringProfileSourceBelongsToScenario,
  monitoringProfileSourceRunPolicy,
  type MonitoringProfileRunPlanScenario,
} from "@/lib/social/monitoring-profile-run-plan"

const scenario: MonitoringProfileRunPlanScenario = {
  id: "scenario-a",
  platforms: ["instagram"],
  search: {
    topics: [],
    keywords: ["Baku Electronics"],
    hashtags: [],
    handles: [],
    urls: [
      "https://www.instagram.com/bakuelectronics",
      "https://instagram.com/external-publisher/",
    ],
    useHashtagFallback: true,
    includeOwnedComments: true,
    includeExternalComments: false,
  },
}

describe("monitoring profile run plan", () => {
  it("honors explicit scenario membership and rejects a different scenario", () => {
    const link = {
      scenarioId: null,
      source: {
        platform: "instagram",
        url: "https://www.instagram.com/bakuelectronics",
        handle: null,
        settings: {
          scenarioLinks: [{ scenarioId: "scenario-b" }],
        },
      },
    }

    expect(monitoringProfileSourceBelongsToScenario(link, scenario)).toBe(false)
  })

  it("keeps legacy direct Sources outside the scenario run plan", () => {
    const link = {
      scenarioId: null,
      source: {
        platform: "instagram",
        url: "https://instagram.com/bakuelectronics/",
        handle: null,
        settings: {},
      },
    }

    expect(monitoringProfileSourceBelongsToScenario(link, scenario)).toBe(false)
  })

  it("authorizes the current global query source", () => {
    const link = {
      scenarioId: "scenario-a",
      source: {
        platform: "instagram",
        sourceType: "keyword",
        collectionMode: "search_index",
        query: "Baku Electronics",
        url: null,
        handle: null,
        settings: {},
      },
    }

    expect(monitoringProfileSourceBelongsToScenario(link, scenario)).toBe(true)
  })

  it("never authorizes an official identity even when a stale scenario still contains its URL", () => {
    expect(monitoringProfileSourceBelongsToScenario({
      scenarioId: null,
      relationType: "OFFICIAL",
      source: {
        platform: "instagram",
        url: "https://instagram.com/bakuelectronics/",
        handle: null,
        settings: {},
      },
    }, scenario)).toBe(false)
  })

  it("does not attach neutral shared direct Sources to a scenario run", () => {
    const shared = {
      scenarioId: null,
      relationType: "MONITORS",
      source: {
        platform: "instagram",
        url: "https://instagram.com/external-publisher/",
        handle: null,
        settings: {},
        routePlans: [{ scenarioId: null, status: "ACTIVE" }],
        _count: { subjectSources: 3 },
      },
    }

    expect(monitoringProfileSharedSourceCanTargetScenario(shared, scenario)).toBe(false)
    expect(monitoringProfileSharedSourceCanTargetScenario({
      ...shared,
      relationType: "OFFICIAL",
    }, scenario)).toBe(false)
    expect(monitoringProfileSharedSourceCanTargetScenario({
      ...shared,
      source: {
        ...shared.source,
        settings: { scenarioId: "scenario-b" },
      },
    }, scenario)).toBe(false)
    expect(monitoringProfileSharedSourceCanTargetScenario({
      ...shared,
      source: {
        ...shared.source,
        platform: "facebook",
      },
    }, scenario)).toBe(false)
  })

  it("selects only requested-scenario and neutral route plans", () => {
    const plans = [
      { scenarioId: "scenario-a", status: "ACTIVE", primaryAdapter: "APIFY_ASYNC", fallbackAdapters: [] },
      { scenarioId: "scenario-b", status: "ACTIVE", primaryAdapter: "APIFY_ASYNC", fallbackAdapters: [] },
      { scenarioId: null, status: "ACTIVE", primaryAdapter: "META_GRAPH", fallbackAdapters: [] },
    ]

    expect(monitoringProfileScenarioRoutePlans(plans, "scenario-a")).toEqual([
      plans[0],
      plans[2],
    ])
  })

  it("detects paid routes, uses the conservative configured cap, and flags shared sources", () => {
    const policy = monitoringProfileSourceRunPolicy({
      scenarioId: "scenario-a",
      source: {
        platform: "instagram",
        url: null,
        handle: "bakuelectronics",
        settings: {
          scenarioLinks: [{ scenarioId: "scenario-a" }, { scenarioId: "scenario-b" }],
        },
        routePlans: [
          {
            scenarioId: "scenario-a",
            status: "ACTIVE",
            primaryAdapter: "META_GRAPH",
            fallbackAdapters: ["APIFY_ASYNC"],
            budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 2.5 },
          },
          {
            scenarioId: "scenario-a",
            status: "ACTIVE",
            primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
            fallbackAdapters: [],
            budget: { usdLimitsConfigured: true, maxTotalChargeUsd: 1.25 },
          },
        ],
        _count: { subjectSources: 1 },
      },
    }, "scenario-a")

    expect(policy).toEqual({
      paid: true,
      providerAccountFundedOnly: false,
      maxTotalChargeUsd: 1.25,
      sharedAcrossMonitorings: true,
    })
  })

  it("marks Bright Data-only plans as provider-account funded without a local cap", () => {
    const policy = monitoringProfileSourceRunPolicy({
      scenarioId: "scenario-a",
      source: {
        platform: "instagram",
        url: "https://instagram.com/baku.es__",
        handle: "baku.es__",
        settings: { scenarioId: "scenario-a" },
        routePlans: [{
          scenarioId: "scenario-a",
          status: "ACTIVE",
          primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
          fallbackAdapters: [],
          budget: { usdLimitsConfigured: false },
        }],
        _count: { subjectSources: 1 },
      },
    }, "scenario-a")

    expect(policy).toEqual({
      paid: true,
      providerAccountFundedOnly: true,
      maxTotalChargeUsd: null,
      sharedAcrossMonitorings: false,
    })
  })
})
