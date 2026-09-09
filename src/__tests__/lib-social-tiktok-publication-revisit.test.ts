import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import { planTikTokPublicationRevisit } from "@/lib/social/tiktok-publication-revisit"

const approvedAt = new Date("2026-07-01T00:00:00Z")
function state(overrides = {}) {
  return { approvedAt, lastActivityAt: approvedAt, lastCheckedAt: null, status: "ACTIVE" as const, reactivationGeneration: 0, ...overrides }
}

describe("TikTok publication revisit lifecycle", () => {
  it("runs daily during the first seven days", () => {
    expect(planTikTokPublicationRevisit({ state: state(), now: new Date("2026-07-02T00:00:00Z") }))
      .toMatchObject({ status: "ACTIVE", cadenceDays: 1, due: true, reason: "FIRST_SEVEN_DAYS" })
  })
  it("uses a three-day cadence after day seven", () => {
    expect(planTikTokPublicationRevisit({ state: state({ lastActivityAt: new Date("2026-07-08T00:00:00Z"), lastCheckedAt: new Date("2026-07-08T00:00:00Z") }), now: new Date("2026-07-11T00:00:00Z") }))
      .toMatchObject({ status: "ACTIVE", cadenceDays: 3, due: true, reason: "ACTIVE_THREE_DAY_CADENCE" })
  })
  it("becomes inactive after thirty quiet days", () => {
    expect(planTikTokPublicationRevisit({ state: state(), now: new Date("2026-07-31T00:00:00Z") }))
      .toEqual({ status: "INACTIVE", cadenceDays: null, nextDueAt: null, due: false, reason: "THIRTY_DAYS_QUIET", reactivationGeneration: 0 })
  })
  it("reactivates deterministically for a webhook or manual URL event", () => {
    const now = new Date("2026-08-05T00:00:00Z")
    expect(planTikTokPublicationRevisit({ state: state({ status: "INACTIVE" as const, lastCheckedAt: new Date("2026-07-31T00:00:00Z"), reactivationGeneration: 2 }), now, reactivatedAt: now }))
      .toEqual({ status: "ACTIVE", cadenceDays: 1, nextDueAt: now, due: true, reason: "REACTIVATED", reactivationGeneration: 3 })
  })
  it("ships tenant RLS and composite approved-envelope identity", () => {
    const sql = readFileSync("prisma/migrations/20260718203000_tiktok_publication_revisits/migration.sql", "utf8")
    expect(sql).toContain('REFERENCES "ingest_envelopes"("organizationId", "id")')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE POLICY "tenant_isolation"')
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"tiktok_publication_revisits"/i)
  })
})
