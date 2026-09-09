import { describe, expect, it, vi } from "vitest"
import {
  assertMonitoringSourceIdentityCollectable,
  findProtectedMonitoringIdentityCollision,
  MonitoringSourceIdentityBlockedError,
} from "@/lib/social/monitoring-source-protection"

function dbReturning(rows: unknown[], subjects: unknown[] = []) {
  return {
    monitoringSource: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
    monitoringSubject: {
      findMany: vi.fn().mockResolvedValue(subjects),
    },
  }
}

describe("monitoring source identity protection", () => {
  it("rejects an official current source at the final dispatch boundary", async () => {
    const db = dbReturning([{
      id: "official",
      platform: "instagram",
      sourceType: "profile",
      url: "https://instagram.com/brand",
      handle: null,
      ownership: "external",
      subjectSources: [{ relationType: "OFFICIAL" }],
    }])

    await expect(assertMonitoringSourceIdentityCollectable({
      organizationId: "org-1",
      source: {
        id: "official",
        platform: "instagram",
        sourceType: "profile",
        url: "https://instagram.com/brand",
      },
      db: db as never,
    })).rejects.toBeInstanceOf(MonitoringSourceIdentityBlockedError)
  })

  it("rejects an owned current source even without a subject relation", async () => {
    const db = dbReturning([{
      id: "owned",
      platform: "facebook",
      sourceType: "page",
      url: "https://facebook.com/brand",
      handle: null,
      ownership: "owned",
      subjectSources: [],
    }])

    await expect(assertMonitoringSourceIdentityCollectable({
      organizationId: "org-1",
      source: {
        id: "owned",
        platform: "facebook",
        sourceType: "page",
        url: "https://facebook.com/brand",
      },
      db: db as never,
    })).rejects.toBeInstanceOf(MonitoringSourceIdentityBlockedError)
  })

  it("rejects a legacy external duplicate of an owned canonical identity", async () => {
    const db = dbReturning([
      {
        id: "external",
        platform: "instagram",
        sourceType: "profile",
        url: null,
        handle: "brand",
        ownership: "external",
        subjectSources: [{ relationType: "MONITORS" }],
      },
      {
        id: "owned",
        platform: "instagram",
        sourceType: "profile",
        url: "https://www.instagram.com/Brand/?utm_source=test",
        handle: null,
        ownership: "owned",
        subjectSources: [],
      },
    ])

    await expect(assertMonitoringSourceIdentityCollectable({
      organizationId: "org-1",
      source: {
        id: "external",
        platform: "instagram",
        sourceType: "profile",
        handle: "@brand",
      },
      db: db as never,
    })).rejects.toBeInstanceOf(MonitoringSourceIdentityBlockedError)
  })

  it("allows a genuinely unrelated external target", async () => {
    const db = dbReturning([
      {
        id: "external",
        platform: "instagram",
        sourceType: "profile",
        url: null,
        handle: "competitor",
        ownership: "external",
        subjectSources: [{ relationType: "MONITORS" }],
      },
      {
        id: "official",
        platform: "instagram",
        sourceType: "profile",
        url: "https://instagram.com/our-brand",
        handle: null,
        ownership: "external",
        subjectSources: [{ relationType: "OFFICIAL" }],
      },
    ])

    await expect(assertMonitoringSourceIdentityCollectable({
      organizationId: "org-1",
      source: {
        id: "external",
        platform: "instagram",
        sourceType: "profile",
        handle: "competitor",
      },
      db: db as never,
    })).resolves.toEqual({
      authorNames: [],
      sourceIds: [],
      webHosts: [],
      profileUrls: [],
    })
  })

  it("rejects an owned domain mislabeled as an external monitored source", async () => {
    const db = dbReturning([{
      id: "legacy-external",
      platform: "web",
      sourceType: "domain",
      url: "https://www.bakuelectronics.az/",
      handle: null,
      query: null,
      ownership: "external",
      subjectSources: [{ relationType: "MONITORS" }],
    }], [{
      name: "Baku Electronics",
      aliases: [{ kind: "DOMAIN", value: "bakuelectronics.az" }],
      sources: [],
    }])

    await expect(assertMonitoringSourceIdentityCollectable({
      organizationId: "org-1",
      source: {
        id: "legacy-external",
        platform: "web",
        sourceType: "domain",
        url: "https://www.bakuelectronics.az/",
      },
      db: db as never,
    })).rejects.toBeInstanceOf(MonitoringSourceIdentityBlockedError)
  })

  it("allows brand keyword discovery and returns owned hosts for provider exclusions", async () => {
    const db = dbReturning([{
      id: "keyword",
      platform: "web",
      sourceType: "keyword",
      url: null,
      handle: null,
      query: "Baku Electronics",
      ownership: "external",
      subjectSources: [{ relationType: "MONITORS" }],
    }], [{
      name: "Baku Electronics",
      aliases: [{ kind: "DOMAIN", value: "bakuelectronics.az" }],
      sources: [],
    }])

    await expect(assertMonitoringSourceIdentityCollectable({
      organizationId: "org-1",
      source: {
        id: "keyword",
        platform: "web",
        sourceType: "keyword",
      },
      db: db as never,
    })).resolves.toMatchObject({
      webHosts: ["bakuelectronics.az"],
    })
  })

  it("finds a protected collision and skips DB work for keyword queries", async () => {
    const db = dbReturning([{
      id: "official",
      platform: "facebook",
      sourceType: "page",
      url: "https://m.facebook.com/OurBrand",
      handle: null,
      ownership: "external",
      subjectSources: [{ relationType: "OFFICIAL" }],
    }])

    await expect(findProtectedMonitoringIdentityCollision({
      organizationId: "org-1",
      source: { platform: "facebook", sourceType: "profile", handle: "@ourbrand" },
      db: db as never,
    })).resolves.toMatchObject({ id: "official" })

    db.monitoringSource.findMany.mockClear()
    await expect(findProtectedMonitoringIdentityCollision({
      organizationId: "org-1",
      source: { platform: "facebook", sourceType: "keyword" },
      db: db as never,
    })).resolves.toBeNull()
    expect(db.monitoringSource.findMany).not.toHaveBeenCalled()
  })
})
