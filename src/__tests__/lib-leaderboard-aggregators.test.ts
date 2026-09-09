import { describe, it, expect, vi } from "vitest"

// The aggregator modules `import { prisma }` at top-level; the PURE builders
// under test never touch it, but the import must resolve.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { buildTicketAgents, type TicketRow } from "@/lib/leaderboard/tickets"
import { buildProjectAgents, type ProjectRow } from "@/lib/leaderboard/projects"
import { buildTaskAgents, type CompletedTaskRow } from "@/lib/leaderboard/tasks"
import { mtmAttainment, mtmToNormalized, type MtmRanking } from "@/lib/leaderboard/mtm"
import { statusFromAttainment, DEFAULT_STATUS_THRESHOLDS, type StatusThresholds } from "@/lib/leaderboard/types"

const d = (iso: string) => new Date(iso)
const metric = (a: { metrics: { key: string; value: number }[] }, k: string) =>
  a.metrics.find((m) => m.key === k)!.value

describe("buildTicketAgents", () => {
  const users = [
    { id: "A", name: "Ann", avatar: null },
    { id: "B", name: "Bob", avatar: null },
  ]
  // Ann: 2 resolved, both had an SLA, 1 met → SLA adherence 50%.
  // Bob: 2 resolved, NONE had an SLA → falls back to resolution rate (2/2 = 100%).
  // Ann: ticket1 reopened once, ticket2 escalated → reopen 1/2, escalation 1/2.
  const resolved: TicketRow[] = [
    { assignedTo: "A", resolvedAt: d("2026-06-10T10:00Z"), slaDueAt: d("2026-06-10T12:00Z"), firstResponseAt: d("2026-06-10T09:30Z"), satisfactionRating: 4, handleTimeSeconds: 600, escalationLevel: 0, reopenCount: 1, createdAt: d("2026-06-10T09:00Z") },
    { assignedTo: "A", resolvedAt: d("2026-06-11T15:00Z"), slaDueAt: d("2026-06-11T12:00Z"), firstResponseAt: null, satisfactionRating: 2, handleTimeSeconds: 0, escalationLevel: 1, reopenCount: 0, createdAt: d("2026-06-11T09:00Z") },
    { assignedTo: "B", resolvedAt: d("2026-06-12T10:00Z"), slaDueAt: null, firstResponseAt: d("2026-06-12T09:10Z"), satisfactionRating: 5, handleTimeSeconds: 300, escalationLevel: 0, reopenCount: 0, createdAt: d("2026-06-12T09:00Z") },
    { assignedTo: "B", resolvedAt: d("2026-06-12T11:00Z"), slaDueAt: null, firstResponseAt: null, satisfactionRating: null, handleTimeSeconds: 0, escalationLevel: 0, reopenCount: 0, createdAt: d("2026-06-12T10:00Z") },
  ]
  // Single cohort = created in-window: A had 4 created (2 resolved), B had 2 created (2 resolved).
  const cohort = new Map([["A", 4], ["B", 2]])
  const cohortResolved = new Map([["A", 2], ["B", 2]])
  const out = buildTicketAgents(users, resolved, cohort, cohortResolved)

  it("uses SLA adherence when SLA data exists, resolution-rate fallback otherwise", () => {
    const ann = out.find((a) => a.id === "A")!
    const bob = out.find((a) => a.id === "B")!
    expect(ann.attainmentPct).toBe(50)
    expect(bob.attainmentPct).toBe(100) // no SLA → cohort resolution rate 2/2
  })
  it("reports reopen-rate and escalation-rate over resolved tickets", () => {
    const ann = out.find((a) => a.id === "A")!
    const bob = out.find((a) => a.id === "B")!
    expect(metric(ann, "reopenRate")).toBe(50) // 1 of 2 reopened
    expect(metric(ann, "escalationRate")).toBe(50) // 1 of 2 escalated
    expect(metric(bob, "reopenRate")).toBe(0)
    expect(metric(bob, "escalationRate")).toBe(0)
  })
  it("ranks higher attainment first and reports volume = resolved count", () => {
    expect(out[0].id).toBe("B")
    expect(out[0].rank).toBe(1)
    expect(out.find((a) => a.id === "A")!.volume).toBe(2)
  })
  it("computes CSAT average and FRT median minutes", () => {
    const ann = out.find((a) => a.id === "A")!
    expect(metric(ann, "csat")).toBe(3) // (4+2)/2
    expect(metric(ann, "frtMedianMin")).toBe(30) // single FRT row: 09:00→09:30
  })
})

describe("buildProjectAgents", () => {
  const now = d("2026-06-19T00:00Z")
  const managers = [
    { id: "M1", name: "Mara", avatar: null },
    { id: "M2", name: "Max", avatar: null },
  ]
  const projects: ProjectRow[] = [
    // M1: one on-time completion, one late completion, one active (overdue), one cancelled
    { managerId: "M1", status: "completed", endDate: d("2026-05-10"), actualEndDate: d("2026-05-08"), actualStartDate: d("2026-05-01") },
    { managerId: "M1", status: "completed", endDate: d("2026-05-20"), actualEndDate: d("2026-05-25"), actualStartDate: d("2026-05-10") },
    { managerId: "M1", status: "active", endDate: d("2026-06-01"), actualEndDate: null, actualStartDate: d("2026-05-15") },
    { managerId: "M1", status: "cancelled", endDate: d("2026-05-01"), actualEndDate: null, actualStartDate: null },
    // M2: one on-time completion only
    { managerId: "M2", status: "completed", endDate: d("2026-06-10"), actualEndDate: d("2026-06-09"), actualStartDate: d("2026-06-01") },
  ]
  const out = buildProjectAgents(managers, projects, undefined, now)

  it("on-time delivery % among completed-with-plan; managed excludes cancelled", () => {
    const m1 = out.find((a) => a.id === "M1")!
    expect(m1.attainmentPct).toBe(50) // 1 of 2 completions on time
    expect(m1.volume).toBe(3) // 4 projects minus the cancelled one
    expect(metric(m1, "overdue")).toBe(1) // active, endDate < now
  })
  it("ranks the perfect manager first", () => {
    expect(out[0].id).toBe("M2")
    expect(out[0].attainmentPct).toBe(100)
  })
  it("window filter drops completions before windowStart", () => {
    const windowed = buildProjectAgents(managers, projects, d("2026-06-01"), now)
    const m1 = windowed.find((a) => a.id === "M1")!
    expect(metric(m1, "completed")).toBe(0) // both M1 completions are in May
  })
})

describe("buildTaskAgents", () => {
  const users = [
    { id: "U1", name: "Una", avatar: null },
    { id: "U2", name: "Uri", avatar: null },
    { id: "U3", name: "Uma", avatar: null },
  ]
  const completed: CompletedTaskRow[] = [
    { assignedTo: "U1", completedAt: d("2026-06-10"), dueDate: d("2026-06-12") }, // on time
    { assignedTo: "U1", completedAt: d("2026-06-15"), dueDate: d("2026-06-12") }, // late
    { assignedTo: "U2", completedAt: d("2026-06-10"), dueDate: d("2026-06-12") }, // on time
    { assignedTo: "U3", completedAt: d("2026-06-10"), dueDate: null }, // no due → fallback 100
  ]
  const overdue = new Map([["U1", 2]])
  const out = buildTaskAgents(users, completed, overdue)

  it("on-time completion % with no-due-date fallback to 100", () => {
    expect(out.find((a) => a.id === "U1")!.attainmentPct).toBe(50)
    expect(out.find((a) => a.id === "U2")!.attainmentPct).toBe(100)
    expect(out.find((a) => a.id === "U3")!.attainmentPct).toBe(100)
  })
  it("reports volume = completed count and surfaces overdue", () => {
    const u1 = out.find((a) => a.id === "U1")!
    expect(u1.volume).toBe(2)
    expect(metric(u1, "overdue")).toBe(2)
  })
})

describe("mtm composite attainment", () => {
  it("weights task 0.5 / photo 0.3 / route 0.2", () => {
    expect(mtmAttainment({ taskCompletion: 80, photoApproval: 90, routeCompletion: 100 })).toBe(87)
  })
  it("ranks by composite attainment, ties broken by visits; volume = visits", () => {
    const rankings: MtmRanking[] = [
      { agentId: "L", name: "Low", avatar: null, score: 200, visits: 50, completedTasks: 0, approvedPhotos: 0, onTimeRoutes: 0, taskCompletion: 40, photoApproval: 40, routeCompletion: 40, achievements: [], rank: 0 },
      { agentId: "H", name: "High", avatar: null, score: 500, visits: 10, completedTasks: 20, approvedPhotos: 0, onTimeRoutes: 0, taskCompletion: 100, photoApproval: 100, routeCompletion: 100, achievements: [], rank: 0 },
    ]
    const out = mtmToNormalized(rankings)
    expect(out[0].id).toBe("H")
    expect(out[0].attainmentPct).toBe(100)
    expect(out[0].volume).toBe(10) // volume = visits (headline; radius now scales with attainment %)
  })
})

describe("C3 config-driven weights + thresholds", () => {
  const ranking = (overrides: Partial<MtmRanking>): MtmRanking => ({
    agentId: "X", name: "X", avatar: null, score: 0, visits: 0, completedTasks: 0,
    approvedPhotos: 0, onTimeRoutes: 0, taskCompletion: 0, photoApproval: 0,
    routeCompletion: 0, achievements: [], rank: 0, ...overrides,
  })

  it("mtmAttainment honours custom weights (all weight on task → = taskCompletion)", () => {
    expect(mtmAttainment({ taskCompletion: 80, photoApproval: 0, routeCompletion: 0 }, { task: 1, photo: 0, route: 0 })).toBe(80)
  })
  it("mtmAttainment normalises by the weight sum — a partial override can't exceed 100", () => {
    // sum 1.1; every rate 100 → 110/1.1 = 100, NOT 110
    expect(mtmAttainment({ taskCompletion: 100, photoApproval: 100, routeCompletion: 100 }, { task: 0.6, photo: 0.3, route: 0.2 })).toBe(100)
  })
  it("mtmAttainment returns 0 when all weights are 0 (no div-by-zero)", () => {
    expect(mtmAttainment({ taskCompletion: 100, photoApproval: 100, routeCompletion: 100 }, { task: 0, photo: 0, route: 0 })).toBe(0)
  })
  it("default weights still give the documented 0.5/0.3/0.2 result", () => {
    expect(mtmAttainment({ taskCompletion: 80, photoApproval: 90, routeCompletion: 100 })).toBe(87)
  })

  it("statusFromAttainment honours custom thresholds", () => {
    const strict: StatusThresholds = { exceeding: 120, on_track: 100, behind: 80, at_risk: 60 }
    expect(statusFromAttainment(95)).toBe("on_track") // default band (>=90)
    expect(statusFromAttainment(95, strict)).toBe("behind") // strict band (<100, >=80)
    expect(statusFromAttainment(125, strict)).toBe("exceeding")
    expect(DEFAULT_STATUS_THRESHOLDS.on_track).toBe(90)
  })

  it("mtmToNormalized threads custom thresholds into the agent status", () => {
    const r = ranking({ taskCompletion: 95, photoApproval: 95, routeCompletion: 95, visits: 5 })
    expect(mtmToNormalized([r])[0].status).toBe("on_track") // 95 ≥ default on_track 90
    const strict: StatusThresholds = { exceeding: 120, on_track: 100, behind: 80, at_risk: 60 }
    expect(mtmToNormalized([r], undefined, strict)[0].status).toBe("behind") // 95 < strict on_track 100
  })
})
