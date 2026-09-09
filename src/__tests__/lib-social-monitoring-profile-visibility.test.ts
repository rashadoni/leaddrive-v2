import { beforeEach, describe, expect, it, vi } from "vitest"

const { findManySubjects, getScenarios, queryRaw } = vi.hoisted(() => ({
  findManySubjects: vi.fn(),
  getScenarios: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubject: { findMany: findManySubjects },
    $queryRaw: queryRaw,
  },
}))

vi.mock("@/lib/social/monitoring-scenarios", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/social/monitoring-scenarios")>()
  return {
    ...original,
    getMonitoringScenarios: getScenarios,
  }
})

import { listMonitoringProfiles } from "@/lib/social/monitoring-profiles"

describe("monitoring profile finding visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findManySubjects.mockResolvedValue([{
      id: "subject-1",
      name: "Araz Supermarket",
      type: "COMPANY",
      status: "active",
      updatedAt: new Date("2026-07-28T00:00:00.000Z"),
      aliases: [],
      sources: [],
    }])
    getScenarios.mockResolvedValue([])
    queryRaw.mockResolvedValue([])
  })

  it("excludes purged and source-deleted records from every finding counter", async () => {
    await listMonitoringProfiles("org-1")

    const queries = queryRaw.mock.calls.map(([strings]) => (
      Array.from(strings as TemplateStringsArray).join("?")
    ))
    expect(queries).toHaveLength(3)

    const mentionSummary = queries.find(sql => sql.includes('AS "newCount"'))
    const reviewSummary = queries.find(sql => sql.includes("FROM ingest_envelopes envelope"))
    const platformSummary = queries.find(sql => sql.includes("LOWER(sm.platform::text) AS platform"))

    expect(mentionSummary).toContain('sm."purgedAt" IS NULL')
    expect(mentionSummary).toContain('sm."deletedAtSource" IS NULL')
    expect(reviewSummary).toContain('envelope."purgedAt" IS NULL')
    expect(reviewSummary).toContain('envelope."deletedAtSource" IS NULL')
    expect(platformSummary).toContain('sm."purgedAt" IS NULL')
    expect(platformSummary).toContain('sm."deletedAtSource" IS NULL')
  })
})
