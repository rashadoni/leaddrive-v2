import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/mtm/attendance-request-decision", () => ({ decideAttendanceRequestInTransaction: vi.fn() }))
import { decideAttendanceRequestInTransaction } from "@/lib/mtm/attendance-request-decision"
import {
  ATTENDANCE_AUTO_CLOSE_BY_KEY, ATTENDANCE_AUTO_CLOSE_SETTING_KEY, autoApproveForgottenDayClose, isForgottenDayClose,
} from "@/lib/mtm/attendance-auto-close"
import { AttendanceRequestError, type AttendanceCorrectionBasis, type AttendanceRequestDto } from "@/lib/mtm/attendance-request-contract"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import az from "../../messages/az.json"

/**
 * Owner, 2026-10-18: «чтоб была возможность в настройках включить
 * автоподтверждение, но чтоб были показаны опоздания» — «Только «Закрыть день»».
 * The real-database proof is in mtm-attendance-corrections-postgres.test.ts.
 */
const baku = "Asia/Baku"
const sunday = new Date("2026-10-18T00:06:00Z")
const open = (patch: Partial<Extract<AttendanceCorrectionBasis, { kind: "WORKDAY" }>["facts"]> = {}): AttendanceCorrectionBasis => ({
  kind: "WORKDAY",
  facts: { id: "fixture-day", workDate: "2026-10-13", status: "STARTED", startedAt: "2026-10-13T06:21:58.533Z", pausedAt: null, completedAt: null, totalPausedSeconds: 0, ...patch },
})
const minute = new Date("2026-10-13T06:21:00.000Z")

describe("only the close of a forgotten day, with its start untouched", () => {
  it("is the 13 October day closed on the 18th at its own 10:21 start", () => {
    expect(isForgottenDayClose({ basis: open(), requestedStartAt: minute, timezone: baku, now: sunday })).toBe(true)
    expect(isForgottenDayClose({ basis: open({ status: "PAUSED", pausedAt: "2026-10-13T18:18:51.143Z" }), requestedStartAt: minute, timezone: baku, now: sunday })).toBe(true)
  })

  it("is not, when the start moves — that would erase lateness", () => {
    expect(isForgottenDayClose({ basis: open(), requestedStartAt: new Date("2026-10-13T05:00:00.000Z"), timezone: baku, now: sunday })).toBe(false)
    expect(isForgottenDayClose({ basis: open(), requestedStartAt: new Date("2026-10-13T06:22:00.000Z"), timezone: baku, now: sunday })).toBe(false)
    expect(isForgottenDayClose({ basis: open(), requestedStartAt: null, timezone: baku, now: sunday })).toBe(false)
  })

  it("is not for a closed day, a missing day, or today's day", () => {
    expect(isForgottenDayClose({ basis: open({ status: "COMPLETED", completedAt: "2026-10-13T14:00:00.000Z" }), requestedStartAt: minute, timezone: baku, now: sunday })).toBe(false)
    expect(isForgottenDayClose({ basis: { kind: "MISSING", workDate: "2026-10-13" }, requestedStartAt: minute, timezone: baku, now: sunday })).toBe(false)
    expect(isForgottenDayClose({ basis: undefined, requestedStartAt: minute, timezone: baku, now: sunday })).toBe(false)
    // Still the 13th in Baku at 22:00: today's day is the employee's to finish.
    expect(isForgottenDayClose({ basis: open(), requestedStartAt: minute, timezone: baku, now: new Date("2026-10-13T18:00:00Z") })).toBe(false)
  })

  it("is off unless switched on", () => {
    expect(MTM_SETTING_DEFAULTS.attendanceAutoCloseForgottenDay).toBe(false)
  })
})

describe("the approval itself", () => {
  const request = { id: "fixture-request", version: "2026-10-18T00:10:00.000Z" } as AttendanceRequestDto
  const statements: string[] = []
  const db = (settings: Array<{ key: string; value: unknown }>) => ({
    mtmSetting: { findMany: vi.fn().mockResolvedValue(settings) },
    mtmAgent: { findFirst: vi.fn().mockResolvedValue({ user: null }) },
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => { statements.push(strings.join("?")); return 0 }),
  }) as unknown as Prisma.TransactionClient
  const on = [{ key: ATTENDANCE_AUTO_CLOSE_SETTING_KEY, value: true }, { key: ATTENDANCE_AUTO_CLOSE_BY_KEY, value: "fixture-admin" }]
  beforeEach(() => { vi.mocked(decideAttendanceRequestInTransaction).mockReset(); statements.length = 0 })

  it("does nothing while the setting is off, or nobody is recorded as switching it on", async () => {
    for (const settings of [[], [{ key: ATTENDANCE_AUTO_CLOSE_SETTING_KEY, value: false }, on[1]], [on[0]]]) {
      expect(await autoApproveForgottenDayClose(db(settings), { organizationId: "fixture-org", agentId: "fixture-employee", request })).toBeNull()
    }
    expect(decideAttendanceRequestInTransaction).not.toHaveBeenCalled()
    expect(statements).toEqual([])
  })

  it("approves through the manager's own path, in the name of whoever switched it on, with a note saying so", async () => {
    vi.mocked(decideAttendanceRequestInTransaction).mockResolvedValue({ request: { ...request, status: "APPROVED" }, idempotent: false } as never)
    const approved = await autoApproveForgottenDayClose(db(on), { organizationId: "fixture-org", agentId: "fixture-employee", request })
    expect(approved).toMatchObject({ status: "APPROVED" })
    expect(decideAttendanceRequestInTransaction).toHaveBeenCalledWith(expect.anything(), { organizationId: "fixture-org", userId: "fixture-admin", principalType: "session" }, "fixture-request", {
      decision: "APPROVED", version: request.version, note: az.mtmAttendance.autoCloseDecisionNote,
    })
    expect(statements).toEqual(["SAVEPOINT mtm_attendance_auto_close", "RELEASE SAVEPOINT mtm_attendance_auto_close"])
  })

  it("leaves the request waiting for the manager when anything refuses, undoing what the attempt wrote", async () => {
    vi.mocked(decideAttendanceRequestInTransaction).mockRejectedValue(new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403))
    expect(await autoApproveForgottenDayClose(db(on), { organizationId: "fixture-org", agentId: "fixture-employee", request })).toBeNull()
    expect(statements).toEqual(["SAVEPOINT mtm_attendance_auto_close", "ROLLBACK TO SAVEPOINT mtm_attendance_auto_close"])
  })
})

describe("wiring", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8")

  it("tries it before the bell, so an approved close asks nobody to decide", () => {
    const store = read("src/lib/mtm/attendance-request-store.ts")
    expect(store.indexOf("isForgottenDayClose({ basis: correctionBasis, requestedStartAt, timezone, now })"))
      .toBeLessThan(store.indexOf("await notifyAttendanceRequestReviewers(db,"))
  })

  it("is an administrator's switch, recorded with who turned it on, never by a key", () => {
    const route = read("src/app/api/v1/mtm/settings/route.ts")
    expect(route).toContain("|| body[ATTENDANCE_AUTO_CLOSE_SETTING_KEY] !== undefined) && !MODULE_TOGGLE_ROLES.includes(auth.role)")
    expect(route).toContain('body[ATTENDANCE_AUTO_CLOSE_SETTING_KEY] === true && differs(ATTENDANCE_AUTO_CLOSE_SETTING_KEY) && auth.principalType !== "session"')
    expect(route).toContain("await storeSetting(ATTENDANCE_AUTO_CLOSE_BY_KEY, auth.userId)")
    // The "who" key is not a setting a client can send.
    expect(Object.keys(MTM_SETTING_DEFAULTS)).not.toContain(ATTENDANCE_AUTO_CLOSE_BY_KEY)
    // Personnel → Settings → «Подтверждение заявок» (moved from MTM settings, owner 2026-10-18).
    const editor = read("src/components/mtm/attendance-policy-settings.tsx")
    expect(editor).toContain('{ key: "attendanceAutoCloseForgottenDay", labelKey: "lblAttendanceAutoCloseForgottenDay", hintKey: "hintAttendanceAutoCloseForgottenDay", type: "boolean" }')
  })
})
