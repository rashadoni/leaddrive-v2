import { describe, expect, it } from "vitest"
import { ENTITY_TO_MODULE } from "@/lib/notifications/taxonomy"
import { KINDS_ON_UNLESS_SWITCHED_OFF } from "@/lib/notifications/prefs"
import { ATTENDANCE_EXPLANATION_NOTIFICATION_ENTITY, ATTENDANCE_EXPLANATION_NOTIFICATION_KIND } from "@/lib/mtm/attendance-explanation-notification"
import { ATTENDANCE_EXPLANATION_ENTITY, ATTENDANCE_EXPLANATION_NOTIFICATION_KIND as STORE_KIND } from "@/lib/mtm/attendance-explanation-store"
import { attendanceExplanationsShown } from "@/components/mtm/attendance-explanations"
import type { AttendanceExplanationDto } from "@/lib/mtm/attendance-explanation-contract"

// Zeytun, 2026-11-20: Ayshan asked why the owner was late, he answered in the app, and her bell
// stayed empty — the row was written, but the bell hides entity types it does not know.
describe("an employee's explanation reaches the bell", () => {
  it("is a type the bell shows, under Route & Field, on until switched off", () => {
    expect(ATTENDANCE_EXPLANATION_ENTITY).toBe(ATTENDANCE_EXPLANATION_NOTIFICATION_ENTITY)
    expect(STORE_KIND).toBe(ATTENDANCE_EXPLANATION_NOTIFICATION_KIND)
    expect(ENTITY_TO_MODULE[ATTENDANCE_EXPLANATION_NOTIFICATION_ENTITY]).toBe("mtm")
    expect(KINDS_ON_UNLESS_SWITCHED_OFF.has(ATTENDANCE_EXPLANATION_NOTIFICATION_KIND)).toBe(true)
  })
})

describe("Personnel → Explanations list", () => {
  const item = (id: string, status: AttendanceExplanationDto["status"], answeredAt: string | null): AttendanceExplanationDto => ({
    id, employeeId: id, employeeName: id, date: "2026-11-20", kind: "LATE", status, lateMinutes: 10, requestedAt: null, requestedByName: null,
    answer: answeredAt ? "Fictional" : null, answeredAt, decidedAt: null, decidedByName: null })
  const items = [item("accepted", "ACCEPTED", "2026-11-19T08:00:00Z"), item("old", "ANSWERED", "2026-11-18T08:00:00Z"),
    item("asked", "REQUESTED", null), item("new", "ANSWERED", "2026-11-20T08:00:00Z")]

  it("shows what waits for a decision first, newest on top, and filters by state", () => {
    expect(attendanceExplanationsShown(items, "waiting").map(i => i.id)).toEqual(["new", "old"])
    expect(attendanceExplanationsShown(items, "asked").map(i => i.id)).toEqual(["asked"])
    expect(attendanceExplanationsShown(items, "all").map(i => i.id)).toEqual(["new", "old", "asked", "accepted"])
  })
})
