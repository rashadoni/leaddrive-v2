import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AdvisorSignal } from "@/lib/ai/advisor/types"

const db = {
  snapshotUpsert: vi.fn(),
  snapshotFindFirst: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    advisorSignalSnapshot: {
      upsert: (...args: unknown[]) => db.snapshotUpsert(...args),
      findFirst: (...args: unknown[]) => db.snapshotFindFirst(...args),
    },
  },
}))

import {
  ADVISOR_SIGNAL_SNAPSHOT_LIMIT,
  advisorSnapshotKey,
  buildAdvisorSignalSnapshotSummary,
  getPreviousAdvisorSignalSnapshot,
  persistAdvisorSignalSnapshot,
} from "@/lib/ai/advisor/snapshots"

function signal(overrides: Partial<AdvisorSignal>): AdvisorSignal {
  return {
    id: "signal-1",
    domain: "sales",
    domainLabel: "Sales",
    severity: "high",
    title: "Stalled deal",
    summary: "Deal has no next step",
    entityType: "deal",
    entityId: "deal-1",
    detectedAt: "2026-06-27T08:00:00.000Z",
    facts: [],
    sources: [{ entityType: "deal", entityId: "deal-1", label: "Deal", href: "/deals/deal-1" }],
    recommendedActions: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.snapshotUpsert.mockResolvedValue({ id: "snapshot-1" })
  db.snapshotFindFirst.mockResolvedValue(null)
})

describe("Advisor signal snapshots", () => {
  it("builds deterministic UTC snapshot keys", () => {
    expect(advisorSnapshotKey(new Date("2026-06-27T23:59:59.000Z"))).toBe("2026-06-27")
  })

  it("summarizes signal counts, money and owner/domain buckets", () => {
    const summary = buildAdvisorSignalSnapshotSummary([
      signal({ id: "sales-1", domain: "sales", severity: "high", amount: 1200, ownerLabel: "Aysel" }),
      signal({ id: "finance-1", domain: "finance", severity: "critical", metric: { kind: "money", value: 300, label: "Overdue", formatted: "300 AZN", unit: "AZN" } }),
      signal({ id: "tasks-1", domain: "tasks", severity: "medium", ownerId: "user-2" }),
    ], new Date("2026-06-27T08:00:00.000Z"))

    expect(summary).toMatchObject({
      snapshotKey: "2026-06-27",
      totalSignals: 3,
      criticalCount: 1,
      highCount: 1,
      moneyAtRisk: 1500,
      domainCounts: { sales: 1, finance: 1, tasks: 1 },
      ownerCounts: { Aysel: 1, "user-2": 1, unassigned: 1 },
      signalIds: ["sales-1", "finance-1", "tasks-1"],
    })
  })

  it("limits stored signal payload while preserving full id counts", () => {
    const signals = Array.from({ length: ADVISOR_SIGNAL_SNAPSHOT_LIMIT + 5 }, (_, index) => signal({ id: `signal-${index}` }))
    const summary = buildAdvisorSignalSnapshotSummary(signals, new Date("2026-06-27T08:00:00.000Z"))

    expect(summary.totalSignals).toBe(ADVISOR_SIGNAL_SNAPSHOT_LIMIT + 5)
    expect(summary.signalIds).toHaveLength(ADVISOR_SIGNAL_SNAPSHOT_LIMIT + 5)
    expect(summary.signals).toHaveLength(ADVISOR_SIGNAL_SNAPSHOT_LIMIT)
  })

  it("upserts one server-side snapshot per tenant day", async () => {
    await persistAdvisorSignalSnapshot("org-1", [
      signal({ id: "sales-1", domain: "sales", severity: "high", amount: 1200 }),
    ], new Date("2026-06-27T08:00:00.000Z"))

    expect(db.snapshotUpsert).toHaveBeenCalledWith({
      where: {
        organizationId_snapshotKey: {
          organizationId: "org-1",
          snapshotKey: "2026-06-27",
        },
      },
      create: expect.objectContaining({
        organizationId: "org-1",
        snapshotKey: "2026-06-27",
        totalSignals: 1,
        highCount: 1,
        moneyAtRisk: 1200,
      }),
      update: expect.objectContaining({
        totalSignals: 1,
        highCount: 1,
        moneyAtRisk: 1200,
      }),
    })
  })

  it("loads the latest snapshot before the current day", async () => {
    await getPreviousAdvisorSignalSnapshot("org-1", new Date("2026-06-27T08:00:00.000Z"))

    expect(db.snapshotFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        snapshotKey: { lt: "2026-06-27" },
      },
      orderBy: { snapshotKey: "desc" },
    })
  })
})
