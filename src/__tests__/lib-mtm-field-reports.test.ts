import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { computeFieldReport, type FieldReportInput } from "@/lib/mtm/field-reports"
import { resolveReportRange } from "@/lib/mtm/report-period"

// Owner, 2026-11-01: «каких типов отчётностей… предложить, что может быть
// полезным менеджеру». Each report is checked on what a manager reads off it.
const BAKU = "Asia/Baku"
const range = resolveReportRange(new URLSearchParams("from=2026-11-02&to=2026-11-08"), "2026-11-08", BAKU)
if ("error" in range) throw new Error("range")
const input: FieldReportInput = { organizationId: "org-1", range, timezone: BAKU, agentIds: null, page: 1, limit: 50, language: "ru", now: new Date("2026-11-08T12:00:00Z") }
const summary = (report: { summary: Array<{ labelKey: string; value: unknown }> }) => Object.fromEntries(report.summary.map((item) => [item.labelKey, item.value]))

const AGENTS = [{ id: "a-seymur", name: "Seymur" }, { id: "a-elnur", name: "Elnur" }]
const assignment = (agentId: string, contactId: string, category: string, displayName = contactId) => ({ agentId, contactId, contact: { displayName, category } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue(AGENTS as never)
})

describe("coverage: of the doctors each agent answers for, how many were seen", () => {
  it("counts a doctor seen by anyone, per class, and a shared doctor once in the totals", async () => {
    vi.mocked(prisma.mtmContactAgentAssignment.findMany).mockResolvedValue([
      assignment("a-seymur", "c-1", "A"), assignment("a-seymur", "c-2", "B"), assignment("a-seymur", "c-3", "VIP"),
      assignment("a-elnur", "c-3", "VIP"), assignment("a-elnur", "c-4", "C"),
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      { contactId: "c-1", checkInAt: new Date("2026-11-03T08:00:00Z") },
      { contactId: "c-3", checkInAt: new Date("2026-11-04T08:00:00Z") },
    ] as never)
    const report = await computeFieldReport("coverage", input)
    expect(report.rows).toEqual([
      { id: "a-seymur", agent: "Seymur", contacts: 3, visited: 2, coverage: 67, coverageA: 100, coverageB: 0, coverageC: null },
      { id: "a-elnur", agent: "Elnur", contacts: 2, visited: 1, coverage: 50, coverageA: 100, coverageB: null, coverageC: 0 },
    ])
    expect(summary(report)).toEqual({ "sum.contacts": 4, "sum.visitedContacts": 2, "sum.coverage": 50, "sum.coverageA": 100, "sum.coverageB": 0 })
  })
})

describe("not_visited: who nobody came to, the most important first", () => {
  it("lists VIP and A before the rest, the longest forgotten first, and «never» as its own answer", async () => {
    vi.mocked(prisma.mtmContactAgentAssignment.findMany).mockResolvedValue([
      assignment("a-seymur", "c-b-old", "B", "Bəşir"), assignment("a-seymur", "c-a-never", "A", "Aydın"),
      assignment("a-elnur", "c-a-recent", "A", "Arzu"), assignment("a-elnur", "c-seen", "VIP", "Vüsal"),
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ contactId: "c-seen", checkInAt: new Date("2026-11-03T08:00:00Z") }] as never)
    vi.mocked(prisma.mtmVisit.groupBy).mockResolvedValue([
      { contactId: "c-b-old", _max: { checkInAt: new Date("2026-08-01T08:00:00Z") } },
      { contactId: "c-a-recent", _max: { checkInAt: new Date("2026-10-30T08:00:00Z") } },
    ] as never)
    const report = await computeFieldReport("not_visited", input)
    expect(report.rows.map((row) => [row.contact, row.category, row.agent, row.daysSince])).toEqual([
      ["Aydın", "A", "Seymur", null],
      ["Arzu", "A", "Elnur", 9],
      ["Bəşir", "B", "Seymur", 99],
    ])
    expect(summary(report)).toEqual({ "sum.notVisited": 3, "sum.notVisitedA": 2, "sum.neverVisited": 1, "sum.notVisitedShare": 75 })
  })
})

describe("suspicious: visits that do not look like visits", () => {
  it("names too short, far from the client and without a position — and leaves a normal visit out", async () => {
    const base = { status: "CHECKED_OUT", checkInCustomerLat: 40.4093, checkInCustomerLng: 49.8671, checkInGeofenceRadius: 100, agent: { name: "Seymur" }, customer: { name: "Apteka" } }
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      { ...base, id: "ok", checkInAt: new Date("2026-11-03T08:00:00Z"), duration: 20, checkInLat: 40.4093, checkInLng: 49.8671 },
      { ...base, id: "short", checkInAt: new Date("2026-11-03T09:00:00Z"), duration: 2, checkInLat: 40.4093, checkInLng: 49.8671 },
      { ...base, id: "far", checkInAt: new Date("2026-11-04T09:00:00Z"), duration: 15, checkInLat: 40.4193, checkInLng: 49.8671 },
      { ...base, id: "nogps", checkInAt: new Date("2026-11-05T09:00:00Z"), duration: 15, checkInLat: null, checkInLng: null },
    ] as never)
    const report = await computeFieldReport("suspicious", input)
    expect(report.rows.map((row) => [row.id, row.reasons])).toEqual([["short", "SHORT"], ["far", "FAR"], ["nogps", "NO_GPS"]])
    expect(report.rows.find((row) => row.id === "far")?.distance).toBeGreaterThan(1000)
    expect(summary(report)).toMatchObject({ "sum.suspicious": 3, "sum.suspiciousShare": 75, "sum.shortVisits": 1, "sum.farVisits": 1, "sum.noGpsVisits": 1 })
  })
})

describe("presentations: what was really shown", () => {
  it("groups the shows by product with clients, average seconds and pages", async () => {
    vi.mocked(prisma.mtmPresentationSession.findMany).mockResolvedValue([
      { productId: "p-omega", customerId: "cu-1", openedAt: new Date("2026-11-03T08:00:00Z"), activeDurationSeconds: 60, pagesViewed: [1, 2, 3], lastPage: 3, product: { name: "Omega 3" } },
      { productId: "p-omega", customerId: "cu-2", openedAt: new Date("2026-11-04T08:00:00Z"), activeDurationSeconds: 120, pagesViewed: [1], lastPage: 1, product: { name: "Omega 3" } },
      { productId: "p-vit", customerId: "cu-1", openedAt: new Date("2026-11-04T09:00:00Z"), activeDurationSeconds: 30, pagesViewed: null, lastPage: 2, product: { name: "Vitamin D" } },
    ] as never)
    const report = await computeFieldReport("presentations", input)
    expect(report.rows).toEqual([
      { id: "p-omega", product: "Omega 3", shows: 2, clients: 2, avgSeconds: 90, avgPages: 2 },
      { id: "p-vit", product: "Vitamin D", shows: 1, clients: 1, avgSeconds: 30, avgPages: 2 },
    ])
    expect(summary(report)).toEqual({ "sum.shows": 3, "sum.productsShown": 2, "sum.clientsShown": 2, "sum.avgShowSeconds": 70 })
  })
})

describe("field_day: when the day began, the first and the last visit, the hours", () => {
  it("reads the organization's clock and counts the paused time out", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
      { id: "w-1", agentId: "a-seymur", workDate: new Date("2026-11-03T00:00:00Z"), startedAt: new Date("2026-11-03T05:00:00Z"), completedAt: new Date("2026-11-03T14:00:00Z"), totalPausedSeconds: 3600, agent: { name: "Seymur" } },
    ] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([
      { agentId: "a-seymur", checkInAt: new Date("2026-11-03T06:30:00Z"), duration: 20 },
      { agentId: "a-seymur", checkInAt: new Date("2026-11-03T12:10:00Z"), duration: 25 },
    ] as never)
    const report = await computeFieldReport("field_day", input)
    // Baku is UTC+4: 05:00Z is 09:00.
    expect(report.rows[0]).toMatchObject({ agentId: "a-seymur", start: "09:00", firstVisit: "10:30", lastVisit: "16:10", end: "18:00", hours: 8, visits: 2, atClients: 45, firstDelay: 90 })
    expect(summary(report)).toMatchObject({ "sum.workdays": 1, "sum.avgStart": "09:00", "sum.avgHours": 8, "sum.avgVisitsPerDay": 2, "sum.avgFirstVisitDelay": 90 })
  })
})

describe("joint_evaluations: how managers rated their agents", () => {
  it("averages each agent and names the weakest point in the reader's language", async () => {
    const questions = [{ id: "PREP", labels: { az: "Hazırlıq", ru: "Подготовка", en: "Preparation" } }, { id: "TALK", labels: { az: "Söhbət", ru: "Беседа", en: "Talk" } }]
    vi.mocked(prisma.mtmVisitEvaluation.findMany).mockResolvedValue([
      { agentId: "a-seymur", createdAt: new Date("2026-11-03T08:00:00Z"), scores: { PREP: 5, TALK: 3 }, questions },
      { agentId: "a-seymur", createdAt: new Date("2026-11-05T08:00:00Z"), scores: { PREP: 4, TALK: 2 }, questions },
    ] as never)
    const report = await computeFieldReport("joint_evaluations", input)
    expect(report.rows).toEqual([expect.objectContaining({ id: "a-seymur", agent: "Seymur", evaluations: 2, average: 3.5, weakest: "Беседа · 2.5" })])
  })
})
