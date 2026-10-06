import { describe, expect, it } from "vitest"
import { compareWorkforceMigrationFacts as compare, type WorkforceMigrationFactSnapshot as Snapshot } from "@/lib/workforce/migration-fact-comparison"

function snapshot(): Snapshot {
  return {
    organizationId: "org-private", periodStart: "2026-09-12", periodEnd: "2026-09-12",
    agentIds: ["agent-private", "agent-zero"], sourceSnapshotId: "fixture-snapshot",
    capturedAt: new Date("2026-09-13T12:00:00.000Z"),
    coverage: { complete: true, consistentSnapshot: true, workdays: 1, events: 2 },
    workdays: [{ id: "day-private", organizationId: "org-private", agentId: "agent-private",
      workDate: new Date("2026-09-12T00:00:00.000Z"), status: "COMPLETED",
      startedAt: new Date("2026-09-12T09:00:00.000Z"), pausedAt: null,
      completedAt: new Date("2026-09-12T18:00:00.000Z"), totalPausedSeconds: 0 }],
    events: ["START", "FINISH"].map((type, index) => ({
      id: `event-private-${index}`, organizationId: "org-private", agentId: "agent-private",
      workdayId: "day-private", type, occurredAt: new Date(`2026-09-12T${index ? "18" : "09"}:00:00.000Z`),
      appliedAt: null, clientEventId: null, schemaVersion: 1, requestHash: null,
      claimedAt: null, capturedAt: null, queuedAt: null, serverReceivedAt: null,
      attendanceReviewState: "LEGACY_UNKNOWN",
    })),
  }
}
function changed(mutate: (value: Snapshot) => void) {
  const before = snapshot(), after = snapshot(); mutate(after)
  return compare({ before, after })
}
const invalid = "WORKFORCE_MIGRATION_FACT_INPUT_INVALID"

describe("bounded migration fact comparison", () => {
  it("matches complete provided facts regardless of input order and does not claim staging", () => {
    const result = changed(after => { after.events = [...after.events].reverse(); after.agentIds = [...after.agentIds].reverse() })
    expect(result.status).toBe("MATCHED_INPUT_FACTS")
    expect(result).toMatchObject({ historicalCompleteness: "CALLER_ASSERTED_NOT_VERIFIED", rolloutAcceptance: "NOT_ESTABLISHED", repair: "NONE" })
    expect(result.notCovered).toContain("APPROVALS")
    expect(JSON.stringify(result)).not.toMatch(/org-private|agent-private|day-private|event-private|fixture-snapshot/)
  })
  it.each([
    ["status", "STARTED"], ["totalPausedSeconds", 60],
    ["startedAt", new Date("2026-09-12T09:01:00Z")],
    ["completedAt", null], ["pausedAt", new Date("2026-09-12T10:00:00Z")],
  ])("detects same-ID same-count workday %s mutation", (key, value) => {
    const result = changed(after => Object.assign(after.workdays[0], { [key]: value }))
    expect(result.compared.workdays).toMatchObject({ countMatches: true, factsMatch: false })
    expect(result.status).toBe("FACT_MISMATCH")
  })
  it.each([
    ["type", "PAUSE"], ["occurredAt", new Date("2026-09-12T09:01:00Z")],
    ["appliedAt", new Date("2026-09-12T09:01:00Z")], ["clientEventId", "operation-2"],
    ["requestHash", "a".repeat(64)], ["schemaVersion", 5],
    ["claimedAt", new Date("2026-09-12T09:00:00Z")], ["capturedAt", new Date("2026-09-12T09:00:00Z")],
    ["queuedAt", new Date("2026-09-12T09:00:00Z")], ["serverReceivedAt", new Date("2026-09-12T09:00:00Z")],
    ["attendanceReviewState", "PENDING_REVIEW"],
  ])("detects same-ID same-count event %s mutation", (key, value) => {
    expect(changed(after => Object.assign(after.events[0], { [key]: value })).compared.events)
      .toMatchObject({ countMatches: true, factsMatch: false })
  })
  it("detects replacement and disappearance even when caller asserts completeness", () => {
    expect(changed(after => { after.events[0].id = "event-replacement" }).status).toBe("FACT_MISMATCH")
    expect(changed(after => { after.events = []; after.coverage.events = 0 }).compared.events)
      .toMatchObject({ before: 2, after: 0, countMatches: false, factsMatch: false })
  })
  it("detects consistent agent reassignment within the same explicit cohort", () => {
    expect(changed(after => {
      after.workdays[0].agentId = "agent-zero"; after.events.forEach(event => { event.agentId = "agent-zero" })
    }).status).toBe("FACT_MISMATCH")
  })
  it.each([
    (s: Snapshot) => { s.agentIds = ["agent-private"] },
    (s: Snapshot) => { s.organizationId = "org-other" },
    (s: Snapshot) => { s.events[0].organizationId = "org-other" },
    (s: Snapshot) => { s.events[0].agentId = "agent-zero" },
    (s: Snapshot) => { s.events[0].workdayId = "missing-day" },
    (s: Snapshot) => { s.periodEnd = "2026-09-13" },
    (s: Snapshot) => { s.capturedAt = new Date("2026-09-12T00:00:00Z") },
    (s: Snapshot) => { s.workdays[0].workDate = new Date("2026-09-11T00:00:00Z") },
    (s: Snapshot) => { s.workdays[0].workDate = new Date("2026-09-12T00:00:01Z") },
  ])("rejects incomparable or crossed scope %#", mutate => expect(() => changed(mutate)).toThrow(invalid))
  it.each([
    (s: Snapshot) => { s.coverage.events = 1 },
    (s: Snapshot) => { Object.assign(s.coverage, { complete: false }) },
    (s: Snapshot) => { Object.assign(s.coverage, { consistentSnapshot: false }) },
    (s: Snapshot) => { s.events = [s.events[0], s.events[0]] },
    (s: Snapshot) => { s.workdays = [s.workdays[0], s.workdays[0]]; s.coverage.workdays = 2 },
    (s: Snapshot) => { s.agentIds = ["agent-private", "agent-private"] },
    (s: Snapshot) => { Object.assign(s.events[0], { appliedAt: undefined }) },
    (s: Snapshot) => { Object.assign(s.events[0], { requestHash: undefined }) },
    (s: Snapshot) => { Object.assign(s.events[0], { clientEventId: undefined }) },
    (s: Snapshot) => { s.events[0].schemaVersion = 6 },
    (s: Snapshot) => { s.events[0].schemaVersion = 1.5 },
    (s: Snapshot) => { s.events[0].attendanceReviewState = "ACCEPTED" },
    (s: Snapshot) => { s.events[0].occurredAt = new Date(NaN) },
    (s: Snapshot) => { s.periodStart = "2026-02-30" },
    (s: Snapshot) => { s.sourceSnapshotId = "" },
    (s: Snapshot) => { s.events = new Array(1); s.coverage.events = 1 },
    (s: Snapshot) => { s.agentIds = new Array(1) },
  ])("rejects incomplete/duplicate/malformed input %# with a fixed private error", mutate => expect(() => changed(mutate)).toThrow(invalid))
  it.each([1, 2, 3, 4, 5])("supports canonical event schema version %s", version => {
    const before = snapshot(); before.events.forEach(e => { e.schemaVersion = version })
    expect(compare({ before, after: before }).status).toBe("MATCHED_INPUT_FACTS")
  })
  it("scopes by workDate rather than dropping later journal instants", () => {
    expect(changed(after => { after.events[0].occurredAt = new Date("2026-09-13T09:00:00Z") }).status).toBe("FACT_MISMATCH")
  })
  it("preserves server reopen event keys containing colons", () => {
    const before = snapshot(); before.events[0].clientEventId = "reopen-undo:day-private:operation-1"
    expect(compare({ before, after: before }).status).toBe("MATCHED_INPUT_FACTS")
  })
  it("does not mutate either supplied snapshot", () => {
    const before = snapshot(), after = snapshot(), serialized = JSON.stringify({ before, after })
    compare({ before, after })
    expect(JSON.stringify({ before, after })).toBe(serialized)
  })
  it("compares capture chronology numerically across extended ISO years", () => {
    const before = snapshot(), after = snapshot()
    before.capturedAt = new Date("+010000-01-01T00:00:00.000Z")
    after.capturedAt = new Date("9999-12-31T00:00:00.000Z")
    expect(() => compare({ before, after })).toThrow(invalid)
    expect(compare({ before: after, after: before }).status).toBe("MATCHED_INPUT_FACTS")
  })
  it("reads intrinsic Date epochs without invoking overridden formatters or serializers", () => {
    const before = snapshot(), after = snapshot()
    const changedDate = new Date("2026-09-12T09:01:00Z")
    let calls = 0
    Object.assign(changedDate, {
      getTime() { calls++; return before.events[0].occurredAt.getTime() },
      toISOString() { calls++; return { toJSON() { calls++; return "private-secret" } } },
      toJSON() { calls++; return "private-secret" },
    })
    after.events[0].occurredAt = changedDate
    expect(compare({ before, after }).compared.events.factsMatch).toBe(false)
    after.workdays[0].startedAt = changedDate
    expect(compare({ before, after }).compared.workdays.factsMatch).toBe(false)
    expect(calls).toBe(0)
  })
  it("rejects an oversized minimized projection even below row limits", () => {
    const before = snapshot(), long = "x".repeat(150)
    before.organizationId = long; before.agentIds = [long]
    Object.assign(before.workdays[0], { id: long, organizationId: long, agentId: long })
    before.events = Array.from({ length: 5000 }, (_, i) => ({ ...before.events[0],
      id: `${long}${i}`, organizationId: long, agentId: long, workdayId: long,
      clientEventId: "y".repeat(256), requestHash: "a".repeat(64),
    }))
    before.coverage.events = 5000
    expect(() => compare({ before, after: before })).toThrow(invalid)
  })
  it("excludes raw properties and never invokes their serializers", () => {
    const before = snapshot(), after = snapshot()
    Object.assign(after.events[0], { latitude: 42.1234, note: "private-reason", proof: { toJSON() { throw new Error("private-secret") } } })
    expect(compare({ before, after }).status).toBe("MATCHED_INPUT_FACTS")
  })
  it("handles a complete zero-row cohort without claiming historical completeness", () => {
    const before = snapshot(); before.workdays = []; before.events = []
    before.coverage.workdays = 0; before.coverage.events = 0
    expect(compare({ before, after: before }).historicalCompleteness).toBe("CALLER_ASSERTED_NOT_VERIFIED")
  })
  it("accepts exact row bounds and rejects one extra", () => {
    const before = snapshot()
    before.workdays = Array.from({ length: 1000 }, (_, i) => ({ ...before.workdays[0], id: `day-${i}` }))
    before.events = Array.from({ length: 5000 }, (_, i) => ({ ...before.events[0], id: `event-${i}`, workdayId: `day-${i % 1000}` }))
    before.coverage.workdays = 1000; before.coverage.events = 5000
    expect(compare({ before, after: before }).status).toBe("MATCHED_INPUT_FACTS")
    before.events = [...before.events, { ...before.events[0], id: "extra" }]; before.coverage.events++
    expect(() => compare({ before, after: before })).toThrow(invalid)
  })
})
