import { describe, expect, it } from "vitest"

import {
  allowsAutomaticRouteAdapter,
  automaticSourceCollectionDecision,
} from "@/lib/social/automatic-collection-policy"

const currentPolicyVersion = "policy-v1"
const unconfiguredBudget = { usdLimitsConfigured: false }
const configuredBudget = {
  usdLimitsConfigured: true,
  maxTotalChargeUsd: 1,
  dailyBudgetUsd: 5,
  monthlyBudgetUsd: 50,
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    status: "ACTIVE",
    primaryAdapter: "APIFY_ASYNC",
    fallbackAdapters: ["MANUAL_TASK"],
    budget: unconfiguredBudget,
    policyVersion: currentPolicyVersion,
    dependsOnCapability: null,
    ...overrides,
  }
}

describe("automatic social collection policy", () => {
  it("never schedules official identities as external provider sources", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      linkedSubjectRelations: [{ relationType: "OFFICIAL" }],
      routePlans: [plan({ budget: configuredBudget })],
      organizationSettings: {},
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "official_identity_not_collectable" })
  })

  it("keeps an unbudgeted Apify-only route out of cron while preserving it as a route", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      routePlans: [plan()],
      organizationSettings: {},
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "no_authorized_automatic_route" })
  })

  it("allows the same Apify route after recurring route limits are configured", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      routePlans: [plan({ budget: configuredBudget })],
      organizationSettings: {
        socialMonitoringPaidRuns: { emergencyStopped: false },
      },
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: true, reason: "automatic_collection_enabled" })
  })

  it("keeps a budgeted Apify route out of cron while the tenant emergency stop is active", () => {
    expect(allowsAutomaticRouteAdapter({
      adapter: "APIFY_ASYNC",
      budget: configuredBudget,
      organizationSettings: {
        socialMonitoringPaidRuns: { emergencyStopped: true },
      },
    })).toBe(false)
  })

  it("does not schedule a source linked only to paused or deleted subjects", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["paused", "deleted"],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "no_active_linked_subject" })
  })

  it("does not revive an orphaned scenario source after its subject link was deleted", () => {
    expect(automaticSourceCollectionDecision({
      settings: { managedBy: "monitoring_scenario", scenarioId: "deleted-scenario" },
      linkedSubjectStatuses: [],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "no_active_linked_subject" })
  })

  it("keeps legacy scenario-managed direct targets out of cron before cleanup", () => {
    expect(automaticSourceCollectionDecision({
      settings: {
        managedBy: "monitoring_scenario",
        scenarioId: "legacy-scenario",
        scenarioTargetType: "url",
      },
      sourceType: "profile",
      linkedSubjectStatuses: ["active"],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "legacy_scenario_direct_source" })
  })

  it("recognizes a markerless legacy direct target by its persisted URL", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      sourceType: "campaign",
      url: "https://example.com/legacy-campaign",
      linkedSubjectStatuses: ["active"],
      linkedSubjectRelations: [{ relationType: "MONITORS", scenarioId: "legacy-scenario" }],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "legacy_scenario_direct_source" })
  })

  // Раньше источник без единой связи считался «независимым» и допускался в
  // автосбор. Ровно в таком состоянии остаются источники УДАЛЁННОГО клиента:
  // удаление профиля стирает связи, но источник живёт — и крон продолжал
  // платно опрашивать провайдера по несуществующему клиенту. Автосбор тратит
  // деньги, поэтому требует живого клиента без исключений.
  // Владелец пополняет счёт Apify фиксированными суммами — потолком служит
  // баланс провайдера, а не наши локальные лимиты. Тот же принцип уже применён
  // к Bright Data; без этого автосбор молча не запускался, хотя ручные прогоны
  // этого тенанта работали.
  it("пускает Apify в автосбор, когда тенант платит со своего счёта у провайдера", () => {
    expect(allowsAutomaticRouteAdapter({
      adapter: "APIFY_ASYNC",
      budget: {},
      // emergencyStopped обязателен явно: по умолчанию он считается включённым.
      organizationSettings: { socialMonitoringPaidRuns: { clientFundedManualRunsEnabled: true, emergencyStopped: false } },
    })).toBe(true)
  })

  it("аварийный стоп сильнее оплаты со счёта провайдера", () => {
    expect(allowsAutomaticRouteAdapter({
      adapter: "APIFY_ASYNC",
      budget: {},
      organizationSettings: { socialMonitoringPaidRuns: { clientFundedManualRunsEnabled: true, emergencyStopped: true } },
    })).toBe(false)
  })

  it("без оплаты со счёта провайдера Apify по-прежнему требует заданных лимитов", () => {
    expect(allowsAutomaticRouteAdapter({
      adapter: "APIFY_ASYNC",
      budget: {},
      organizationSettings: {},
    })).toBe(false)
  })

  it("собирает независимый источник реестра, у которого связей с клиентом нет вовсе", () => {
    // Ноль связей ≠ мёртвый клиент: так выглядит всё, что добавлено вручную в
    // «Источниках» (POST /monitoring-sources связь не создаёт) и источники
    // сценария без клиента. Деньги за удалённого клиента защищает само
    // удаление — оно гасит осиротевшие источники и инвалидирует их платные
    // маршруты (deleteMonitoringSubject).
    expect(automaticSourceCollectionDecision({
      settings: {
        scenarioLinks: [{ scenarioId: "legacy-scenario", targetType: "url" }],
      },
      sourceType: "profile",
      linkedSubjectStatuses: [],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: true, reason: "automatic_collection_enabled" })
  })

  it("отказывает сценарному источнику, оставшемуся без связей", () => {
    // Жизненным циклом такого источника управляет сценарий: остался без связей —
    // значит сценарий/клиент его больше не держит, собирать платно нечего.
    expect(automaticSourceCollectionDecision({
      settings: { managedBy: "monitoring_scenario" },
      sourceType: "keyword",
      linkedSubjectStatuses: [],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "no_active_linked_subject" })
  })

  it("отказывает, когда все связанные клиенты удалены или архивны", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      sourceType: "keyword",
      linkedSubjectStatuses: ["deleted", "archived"],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "no_active_linked_subject" })
  })

  it("keeps scenario-managed global keyword discovery eligible", () => {
    expect(automaticSourceCollectionDecision({
      settings: {
        managedBy: "monitoring_scenario",
        scenarioId: "scenario-1",
        scenarioTargetType: "keyword",
      },
      sourceType: "keyword",
      linkedSubjectStatuses: ["active"],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: true, reason: "automatic_collection_enabled" })
  })

  it("allows a free automatic route but not a manual-only route", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      routePlans: [plan({ primaryAdapter: "YOUTUBE_DATA_API" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    }).allowed).toBe(true)
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      routePlans: [plan({ primaryAdapter: "MANUAL_TASK", fallbackAdapters: [] })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "no_authorized_automatic_route" })
  })

  it("admits missing or stale plans once so route compilation can self-heal", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      routePlans: [],
      currentRoutePolicyVersion: currentPolicyVersion,
    }).reason).toBe("route_plan_missing")
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      routePlans: [plan({ policyVersion: "old-policy" })],
      currentRoutePolicyVersion: currentPolicyVersion,
    }).reason).toBe("route_plan_stale")
  })

  it("does not let healthy dependent routes mask a quarantined entry route", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      routePlans: [
        plan({
          status: "BLOCKED",
          primaryAdapter: "META_GRAPH",
          dependsOnCapability: null,
          lastFailureClass: "AUTH",
        }),
        plan({
          primaryAdapter: "BRIGHT_DATA_SNAPSHOT",
          dependsOnCapability: "DISCOVER_POSTS",
          budget: configuredBudget,
        }),
      ],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: false, reason: "blocked_entry_route_requires_action" })
  })

  it("admits a legacy proofless Instagram Business Discovery plan for targeted repair", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      platform: "instagram",
      ownership: "external",
      linkedSubjectStatuses: ["active"],
      routePlans: [plan({
        capability: "DISCOVER_POSTS",
        primaryAdapter: "META_GRAPH",
        capabilityProofId: null,
      })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: true, reason: "legacy_route_migration_required" })
  })

  it("still admits compiler-blocked entry plans with no runtime quarantine for one repair attempt", () => {
    expect(automaticSourceCollectionDecision({
      settings: {},
      linkedSubjectStatuses: ["active"],
      routePlans: [plan({ status: "BLOCKED", primaryAdapter: "MANUAL_TASK", fallbackAdapters: [], lastFailureClass: null })],
      currentRoutePolicyVersion: currentPolicyVersion,
    })).toEqual({ allowed: true, reason: "route_plan_repair_required" })
  })

  it("allows quota-governed guarded adapters but never treats quota as Apify authorization", () => {
    const organizationSettings = {
      socialMonitoringPaidRuns: {
        policyVersion: 1,
        manualRunsEnabled: true,
        emergencyStopped: false,
        maxPerRunUsd: 0,
        dailyBudgetUsd: 0,
        monthlyBudgetUsd: 0,
        dailyRunQuota: 3,
        authorizedAt: "2026-07-22T00:00:00.000Z",
        authorizedBy: "owner-1",
      },
    }
    expect(allowsAutomaticRouteAdapter({
      adapter: "BRIGHT_DATA_SNAPSHOT",
      budget: unconfiguredBudget,
      organizationSettings,
    })).toBe(true)
    expect(allowsAutomaticRouteAdapter({
      adapter: "APIFY_ASYNC",
      budget: unconfiguredBudget,
      organizationSettings,
    })).toBe(false)
  })
})
