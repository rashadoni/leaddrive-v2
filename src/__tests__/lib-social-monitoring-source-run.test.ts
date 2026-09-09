import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findSource: vi.fn(),
  runSourceNow: vi.fn(),
  brandProtectionOnly: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSource: { findFirst: mocks.findSource },
  },
}))

vi.mock("@/lib/social/monitoring-collector", () => ({
  runMonitoringSourceNow: mocks.runSourceNow,
}))

vi.mock("@/lib/social/brand-protection", () => ({
  isSocialBrandProtectionOnly: mocks.brandProtectionOnly,
}))

import { runMonitoringSourceForActor } from "@/lib/social/monitoring-source-run"

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: "source-1",
    ownership: "external",
    status: "active",
    platform: "instagram",
    sourceType: "keyword",
    url: null,
    handle: null,
    query: "brand",
    settings: {},
    subjectSources: [{ relationType: "MONITORS", subject: { status: "active" } }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findSource.mockResolvedValue(source())
  mocks.brandProtectionOnly.mockResolvedValue(false)
  mocks.runSourceNow.mockResolvedValue({
    runId: "collector-1",
    sourceId: "source-1",
    status: "success",
    foundCount: 2,
    newCount: 1,
    duplicateCount: 1,
    ignoredCount: 0,
  })
})

describe("runMonitoringSourceForActor", () => {
  it("revalidates a live external source and forwards the bounded run", async () => {
    const outcome = await runMonitoringSourceForActor({
      organizationId: "org-1",
      requestedByUserId: "manager-1",
      sourceId: "source-1",
      expectedScope: "EXTERNAL",
      maxTotalChargeUsd: 0.5,
      paidRunConfirmed: true,
      onlyCapability: "DISCOVER_POSTS",
      fullArchiveRun: true,
    })

    expect(outcome).toMatchObject({ ok: true, data: { runId: "collector-1" } })
    expect(mocks.runSourceNow).toHaveBeenCalledWith("org-1", "source-1", {
      maxTotalChargeUsd: 0.5,
      paidRunConfirmed: true,
      requestedByUserId: "manager-1",
      onlyCapability: "DISCOVER_POSTS",
      fullArchiveRun: true,
    })
  })

  it("fails closed against a free-to-paid route drift", async () => {
    await runMonitoringSourceForActor({
      organizationId: "org-1",
      requestedByUserId: "manager-1",
      sourceId: "source-1",
      expectedScope: "EXTERNAL",
    })

    expect(mocks.runSourceNow).toHaveBeenCalledWith(
      "org-1",
      "source-1",
      expect.objectContaining({ paidRunConfirmed: false }),
    )
  })

  it.each([
    [source({ status: "paused" }), "monitoring_source_not_active"],
    [source({ ownership: "owned" }), "monitoring_source_scope_changed"],
    [source({ subjectSources: [{ relationType: "OFFICIAL", subject: { status: "active" } }] }), "official_identity_not_collectable"],
    [source({ subjectSources: [{ relationType: "MONITORS", subject: { status: "deleted" } }] }), "no_active_linked_subject"],
  ])("fails closed before dispatch when live eligibility changed", async (row, error) => {
    mocks.findSource.mockResolvedValueOnce(row)

    const outcome = await runMonitoringSourceForActor({
      organizationId: "org-1",
      requestedByUserId: "manager-1",
      sourceId: "source-1",
      expectedScope: "EXTERNAL",
    })

    expect(outcome).toMatchObject({ ok: false, error })
    expect(mocks.runSourceNow).not.toHaveBeenCalled()
  })

  it("preserves the official-identity boundary for an OWNED bulk snapshot", async () => {
    mocks.findSource.mockResolvedValueOnce(source({
      ownership: "owned",
      subjectSources: [{ relationType: "OWNED", subject: { status: "active" } }],
    }))

    const outcome = await runMonitoringSourceForActor({
      organizationId: "org-1",
      requestedByUserId: "manager-1",
      sourceId: "source-1",
      expectedScope: "OWNED",
    })

    expect(outcome).toMatchObject({
      ok: false,
      status: 409,
      error: "official_identity_not_collectable",
    })
    expect(mocks.runSourceNow).not.toHaveBeenCalled()
  })

  it("rechecks the brand-protection direct-target boundary", async () => {
    mocks.findSource.mockResolvedValueOnce(source({
      sourceType: "page",
      url: "https://instagram.com/brand",
    }))
    mocks.brandProtectionOnly.mockResolvedValueOnce(true)

    const outcome = await runMonitoringSourceForActor({
      organizationId: "org-1",
      requestedByUserId: "manager-1",
      sourceId: "source-1",
      expectedScope: "EXTERNAL",
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: "brand_protection_direct_source_not_collectable",
    })
  })

  it("returns a retryable collision without claiming another collector's result", async () => {
    mocks.runSourceNow.mockResolvedValueOnce({ error: "already_running", retryAfterSeconds: 75 })

    const outcome = await runMonitoringSourceForActor({
      organizationId: "org-1",
      requestedByUserId: "manager-1",
      sourceId: "source-1",
      expectedScope: "EXTERNAL",
    })

    expect(outcome).toEqual({
      ok: false,
      status: 409,
      error: "collector_already_running",
      retryAfterSeconds: 75,
    })
  })
})
