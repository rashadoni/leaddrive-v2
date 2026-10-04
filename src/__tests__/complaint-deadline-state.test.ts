import { describe, expect, it } from "vitest"
import { complaintDeadlineState } from "@/lib/complaints/deadline-state"

const due = "2026-10-02T12:00:00Z"
const now = Date.parse("2026-10-04T12:00:00Z")
describe("complaint deadline lifecycle", () => {
  it("distinguishes live overdue work from missing and future deadlines", () => {
    expect(complaintDeadlineState({ status: "open", slaDueAt: due }, now)).toBe("overdue")
    expect(complaintDeadlineState({ status: "open", slaDueAt: "2026-10-05T12:00:00Z" }, now)).toBe("upcoming")
    expect(complaintDeadlineState({ status: "open", slaDueAt: null }, now)).toBe("none")
    expect(complaintDeadlineState({ status: "open", slaDueAt: "invalid" }, now)).toBe("none")
  })
  it("uses resolution time rather than later closure or today's date", () => {
    expect(complaintDeadlineState({ status: "closed", slaDueAt: due, resolvedAt: due, closedAt: "2026-10-04T00:00:00Z" }, now)).toBe("met")
    expect(complaintDeadlineState({ status: "resolved", slaDueAt: due, resolvedAt: "2026-10-02T12:00:01Z" }, now)).toBe("missed")
    expect(complaintDeadlineState({ status: "closed", slaDueAt: due, closedAt: "2026-10-02T11:00:00Z" }, now)).toBe("met")
  })
  it("does not infer a historical breach when completion evidence is absent", () => {
    expect(complaintDeadlineState({ status: "closed", slaDueAt: due }, now)).toBe("completed_unknown")
    expect(complaintDeadlineState({ status: "resolved", slaDueAt: due, resolvedAt: "invalid" }, now)).toBe("completed_unknown")
  })
  it("evaluates reopened complaints against their active deadline", () => {
    expect(complaintDeadlineState({ status: "open", slaDueAt: due, resolvedAt: "2026-10-01T12:00:00Z" }, now)).toBe("overdue")
  })
})
