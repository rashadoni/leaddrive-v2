import { describe, expect, it } from "vitest"
import { INTENTIONALLY_UNGATED, MODULE_REGISTRY } from "@/lib/modules"
import {
  BUSINESS_UNGATED_EVENT_SCOPES,
  EVENT_DOMAIN_CATALOG,
  EVENT_MIGRATION_WAVES,
  EVENT_SOURCE_PROFILES,
} from "@/lib/event-platform/catalog"

const ACTION_SCOPES = new Set(["read", "write", "delete"])

describe("event-platform governance catalog", () => {
  it("covers every registered module and business ungated scope exactly once", () => {
    const expected = [
      ...Object.keys(MODULE_REGISTRY),
      ...[...INTENTIONALLY_UNGATED].filter((scope) => !ACTION_SCOPES.has(scope)),
    ].sort()
    const actual = EVENT_DOMAIN_CATALOG.flatMap(({ scopes }) => scopes).sort()

    expect(Object.keys(MODULE_REGISTRY)).toHaveLength(20)
    expect(BUSINESS_UNGATED_EVENT_SCOPES).toHaveLength(7)
    expect([...BUSINESS_UNGATED_EVENT_SCOPES].sort()).toEqual(
      [...INTENTIONALLY_UNGATED]
        .filter((scope) => !ACTION_SCOPES.has(scope))
        .sort(),
    )
    expect(actual).toEqual(expected)
    expect(new Set(actual).size).toBe(actual.length)
  })

  it("uses stable, unique domain ids", () => {
    const domainIds = EVENT_DOMAIN_CATALOG.map(({ domainId }) => domainId)

    expect(new Set(domainIds).size).toBe(domainIds.length)
    for (const domainId of domainIds) {
      expect(domainId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it("only uses declared profiles and migration waves", () => {
    const validProfiles = new Set(EVENT_SOURCE_PROFILES)
    const validWaves = new Set<number>(EVENT_MIGRATION_WAVES)

    for (const domain of EVENT_DOMAIN_CATALOG) {
      expect(domain.profiles.length, domain.domainId).toBeGreaterThan(0)
      expect(new Set(domain.profiles).size, domain.domainId).toBe(
        domain.profiles.length,
      )
      expect(
        domain.profiles.every((profile) => validProfiles.has(profile)),
        domain.domainId,
      ).toBe(true)
      expect(validWaves.has(domain.migrationWave), domain.domainId).toBe(true)
    }
  })

  it("marks only the Finance fund pilot implemented", () => {
    const implemented = EVENT_DOMAIN_CATALOG.filter(
      ({ implementation }) => implementation.status === "implemented",
    )

    expect(implemented).toHaveLength(1)
    expect(implemented[0]).toMatchObject({
      domainId: "finance",
      scopes: ["finance"],
      implementation: {
        status: "implemented",
        boundaries: ["fund"],
      },
    })
    expect(
      EVENT_DOMAIN_CATALOG.filter(({ domainId }) => domainId !== "finance")
        .every(({ implementation }) => implementation.status === "planned"),
    ).toBe(true)
  })
})
