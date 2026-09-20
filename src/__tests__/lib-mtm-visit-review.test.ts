import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  VISIT_API_ERROR_MESSAGE_KEYS,
  effectiveGeofenceRadius,
  isOwnVisitExecution,
  isVisitGoneResponse,
  placeCheck,
  reviewActionRows,
  selectActiveVisitId,
  visitApiErrorKey,
  visitDurationMinutes,
  visitPlaceSummary,
  visitStatusKey,
  visitStillOpenFromResponse,
} from "@/lib/mtm/visit-review"

/**
 * Office review of a field visit (audit of /mtm/visits on prod, 2026-09-14).
 * These are the rules that decide what a supervisor sees about a visit.
 */

// ADV-Store 22 style pin in Baku; 0.001° of latitude is ~111 m.
const pin = { latitude: 40.4093, longitude: 49.8671 }

describe("geofence radius", () => {
  it("measures against the customer's own radius, then the organization's, then 100 m", () => {
    expect(effectiveGeofenceRadius(250, 100)).toBe(250)
    expect(effectiveGeofenceRadius(null, 300)).toBe(300)
    expect(effectiveGeofenceRadius(undefined, undefined)).toBe(100)
    expect(effectiveGeofenceRadius(0, Number.NaN)).toBe(100)
  })
})

describe("place check", () => {
  it("confirms a fix inside the radius and reports how far it was", () => {
    expect(placeCheck({ latitude: 40.4094, longitude: 49.8671 }, pin, 100)).toEqual({ state: "at_point", distanceMeters: 11, radiusMeters: 100 })
  })

  it("flags a fix outside the radius with its distance", () => {
    const check = placeCheck({ latitude: 40.4193, longitude: 49.8671 }, pin, 100)
    expect(check.state).toBe("outside")
    expect(check.distanceMeters).toBeGreaterThan(1_000)
  })

  it("respects a wider customer radius instead of a fixed 100 m", () => {
    expect(placeCheck({ latitude: 40.4108, longitude: 49.8671 }, pin, 100).state).toBe("outside")
    expect(placeCheck({ latitude: 40.4108, longitude: 49.8671 }, pin, 250).state).toBe("at_point")
  })

  it("never measures from (0, 0): old field APKs sent it for 'no fix' and it read '6745.7 km'", () => {
    expect(placeCheck({ latitude: 0, longitude: 0 }, pin, 100)).toEqual({ state: "no_gps", distanceMeters: null, radiusMeters: 100 })
    expect(placeCheck({ latitude: 40.4094, longitude: 49.8671 }, { latitude: 0, longitude: 0 }, 100).state).toBe("no_pin")
  })

  it("treats half pairs and out-of-range values as unknown, like every other coordinate path", () => {
    expect(placeCheck({ latitude: 40.4094, longitude: null }, pin, 100).state).toBe("no_gps")
    expect(placeCheck({ latitude: 140, longitude: 49.8671 }, pin, 100).state).toBe("no_gps")
    expect(placeCheck({ latitude: 40.4094, longitude: 49.8671 }, { latitude: Number.NaN, longitude: 49.8 }, 100).state).toBe("no_pin")
  })

  it("separates a missing fix from a customer without a pin", () => {
    expect(placeCheck({ latitude: null, longitude: null }, pin, 100).state).toBe("no_gps")
    expect(placeCheck({ latitude: 40.4, longitude: 49.8 }, { latitude: null, longitude: null }, 100).state).toBe("no_pin")
  })
})

describe("visit place summary", () => {
  const finished = {
    status: "CHECKED_OUT",
    checkInLat: 40.4094,
    checkInLng: 49.8671,
    checkOutLat: 40.4093,
    checkOutLng: 49.8672,
    customer: { ...pin, geofenceRadius: null },
  }

  it("confirms a visit only when both check-in and check-out were at the point", () => {
    const summary = visitPlaceSummary(finished, 100)
    expect(summary.verdict).toBe("at_point")
    expect(summary.checkIn.state).toBe("at_point")
    expect(summary.checkOut?.state).toBe("at_point")
  })

  it("flags a finished visit whose check-out has no GPS (the old badge read 'confirmed')", () => {
    const summary = visitPlaceSummary({ ...finished, checkOutLat: null, checkOutLng: null }, 100)
    expect(summary.verdict).toBe("checkout_gps_missing")
    expect(summary.checkOut?.state).toBe("no_gps")
  })

  it("lets being elsewhere at check-out win over a good check-in", () => {
    const summary = visitPlaceSummary({ ...finished, checkOutLat: 40.43, checkOutLng: 49.8671 }, 100)
    expect(summary.verdict).toBe("outside")
    expect(summary.distanceMeters).toBeGreaterThan(2_000)
  })

  it("does not demand a check-out fix from a visit that is still open", () => {
    const summary = visitPlaceSummary({ ...finished, status: "CHECKED_IN", checkOutLat: null, checkOutLng: null }, 100)
    expect(summary.checkOut).toBeNull()
    expect(summary.verdict).toBe("at_point")
  })

  it("reads a (0, 0) check-out as a missing check-out fix, not as 6745 km away", () => {
    const summary = visitPlaceSummary({ ...finished, checkOutLat: 0, checkOutLng: 0 }, 100)
    expect(summary.verdict).toBe("checkout_gps_missing")
    expect(summary.checkOut).toEqual({ state: "no_gps", distanceMeters: null, radiusMeters: 100 })
  })

  it("says so explicitly when only the check-out carries a fix", () => {
    const summary = visitPlaceSummary({ ...finished, checkInLat: null, checkInLng: null }, 100)
    expect(summary.verdict).toBe("checkin_gps_missing")
    expect(summary.checkIn.state).toBe("no_gps")
    expect(summary.checkOut?.state).toBe("at_point")
    expect(summary.distanceMeters).toBe(summary.checkOut?.distanceMeters)
  })

  it("still reports 'outside' when the only fix is a check-out far away", () => {
    const summary = visitPlaceSummary({ ...finished, checkInLat: null, checkInLng: null, checkOutLat: 40.43, checkOutLng: 49.8671 }, 100)
    expect(summary.verdict).toBe("outside")
  })

  it("has no GPS verdict when neither fix is usable", () => {
    expect(visitPlaceSummary({ ...finished, checkInLat: 0, checkInLng: 0, checkOutLat: null, checkOutLng: null }, 100).verdict).toBe("no_gps")
  })

  it("measures check-out only for a checked-out visit and says why it did not", () => {
    const open = visitPlaceSummary({ ...finished, status: "CHECKED_IN" }, 100)
    expect(open.checkOut).toBeNull()
    expect(open.checkOutSkipped).toBe("visit_open")
    const cancelled = visitPlaceSummary({ ...finished, status: "CANCELLED", checkOutLat: 40.43 }, 100)
    expect(cancelled.checkOut).toBeNull()
    expect(cancelled.checkOutSkipped).toBe("not_checked_out")
    expect(cancelled.verdict).toBe("at_point")
    expect(visitPlaceSummary(finished, 100).checkOutSkipped).toBeNull()
  })

  it("uses the organization radius when the customer has none", () => {
    const wide = { ...finished, checkInLat: 40.4108, checkOutLat: 40.4108 }
    expect(visitPlaceSummary(wide, 100).verdict).toBe("outside")
    expect(visitPlaceSummary(wide, 250).verdict).toBe("at_point")
  })
})

describe("review action rows", () => {
  const requirements = [
    { actionKey: "PHOTO", mode: "REQUIRED", minCount: 1 },
    { actionKey: "PRESENTATION", mode: "OPTIONAL", minCount: 1 },
    { actionKey: "STOCK_CHECK", mode: "OPTIONAL", minCount: 1 },
    { actionKey: "CHECKLIST", mode: "REQUIRED", minCount: 1 },
    { actionKey: "VISIT_NOTE", mode: "OPTIONAL", minCount: 1 },
    { actionKey: "SIGNATURE", mode: "OPTIONAL", minCount: 1 },
    { actionKey: "FEEDBACK", mode: "HIDDEN", minCount: 1 },
  ]

  it("hides steps the field app cannot perform, steps the policy hides and empty optional ones", () => {
    // Only the required photo survives: VISIT_NOTE and SIGNATURE are optional
    // with nothing recorded, and the demo organization marks every step
    // optional — which is how the card filled up with "not done" rows the
    // agent was never offered. NEXT_ACTION and CHECKLIST are not in the app.
    const rows = reviewActionRows({ requirements, actionResults: [], photoCount: 0 })
    expect(rows.map((row) => row.actionKey)).toEqual(["PHOTO"])
  })

  it("brings an optional step back as soon as it carries a result", () => {
    const rows = reviewActionRows({
      requirements,
      actionResults: [{ actionKey: "VISIT_NOTE", status: "COMPLETED" }],
      photoCount: 0,
    })
    expect(rows.map((row) => row.actionKey)).toEqual(["PHOTO", "VISIT_NOTE"])
    expect(rows.find((row) => row.actionKey === "VISIT_NOTE")).toMatchObject({ done: true, required: false })
  })

  it("never lists the step the field app removed", () => {
    const rows = reviewActionRows({
      requirements: [...requirements, { actionKey: "NEXT_ACTION", mode: "REQUIRED", minCount: 1 }],
      actionResults: [],
      photoCount: 0,
    })
    expect(rows.map((row) => row.actionKey)).not.toContain("NEXT_ACTION")
  })

  it("still shows an unsupported step when it does carry a result", () => {
    const rows = reviewActionRows({ requirements, actionResults: [{ actionKey: "STOCK_CHECK", status: "COMPLETED" }], photoCount: 0 })
    expect(rows.find((row) => row.actionKey === "STOCK_CHECK")).toMatchObject({ done: true, required: false })
  })

  it("counts photos by the photos themselves and puts required steps first", () => {
    const rows = reviewActionRows({ requirements, actionResults: [], photoCount: 3 })
    expect(rows[0]).toMatchObject({ actionKey: "PHOTO", required: true, count: 3, done: true })
  })

  it("treats the agent's written note as the visit note instead of '0/1'", () => {
    const withNote = reviewActionRows({ requirements, actionResults: [], photoCount: 0, agentNote: "E2E yoxlama" })
    expect(withNote.find((row) => row.actionKey === "VISIT_NOTE")?.done).toBe(true)
    // Blank note, optional step, nothing recorded: the row is dropped rather
    // than printed as a reproach.
    const blank = reviewActionRows({ requirements, actionResults: [], photoCount: 0, agentNote: "   " })
    expect(blank.find((row) => row.actionKey === "VISIT_NOTE")).toBeUndefined()
  })

  it("counts a signature only when it was completed or waived", () => {
    // A pending signature counts as nothing, so an optional signature row is
    // not shown at all.
    const pending = reviewActionRows({ requirements, actionResults: [{ actionKey: "SIGNATURE", status: "PENDING" }], photoCount: 0 })
    expect(pending.find((row) => row.actionKey === "SIGNATURE")).toBeUndefined()
    const signed = reviewActionRows({ requirements, actionResults: [{ actionKey: "SIGNATURE", status: "COMPLETED" }], photoCount: 0 })
    expect(signed.find((row) => row.actionKey === "SIGNATURE")?.done).toBe(true)
  })
})

describe("who executes a visit on the web", () => {
  const visit = { agentId: "agent-anar", status: "CHECKED_IN" }

  it("is the visit's own agent while the visit is open", () => {
    expect(isOwnVisitExecution({ agentId: "agent-anar" }, visit)).toBe(true)
  })

  it("is never an administrator without an agent, nor another agent or manager", () => {
    expect(isOwnVisitExecution({ agentId: null }, visit)).toBe(false)
    expect(isOwnVisitExecution({ agentId: "manager-1" }, visit)).toBe(false)
    expect(isOwnVisitExecution(null, visit)).toBe(false)
  })

  it("ends when the visit is finished, even for its own agent", () => {
    expect(isOwnVisitExecution({ agentId: "agent-anar" }, { ...visit, status: "CHECKED_OUT" })).toBe(false)
  })

  it("does not match two unknown agents to each other", () => {
    expect(isOwnVisitExecution({ agentId: null }, { agentId: null, status: "CHECKED_IN" })).toBe(false)
  })
})

describe("live refresh keeps the agent's workspace", () => {
  it("keeps the visit already on screen while it is still open, even when another visit is focused", () => {
    expect(selectActiveVisitId({ ownOpenVisitIds: ["visit-a", "visit-b"], currentId: "visit-b", focusedId: "visit-a" })).toBe("visit-b")
  })

  it("falls back to the focused visit, then the first open one, only when the current one is gone", () => {
    expect(selectActiveVisitId({ ownOpenVisitIds: ["visit-a", "visit-b"], currentId: "visit-gone", focusedId: "visit-b" })).toBe("visit-b")
    expect(selectActiveVisitId({ ownOpenVisitIds: ["visit-a"], currentId: null, focusedId: "someone-elses" })).toBe("visit-a")
    expect(selectActiveVisitId({ ownOpenVisitIds: [], currentId: "visit-a", focusedId: null })).toBeNull()
  })

  it("marks a visit gone only on 403/404, never on a transient failure", () => {
    expect(isVisitGoneResponse(404)).toBe(true)
    expect(isVisitGoneResponse(403)).toBe(true)
    for (const status of [500, 502, 503, 504, 429, 0]) expect(isVisitGoneResponse(status)).toBe(false)
  })

  it("closes the workspace only when the server says the visit is no longer open", () => {
    expect(visitStillOpenFromResponse(200, { success: true, data: { status: "CHECKED_IN" } })).toBe(true)
    expect(visitStillOpenFromResponse(200, { success: true, data: { status: "CHECKED_OUT" } })).toBe(false)
    expect(visitStillOpenFromResponse(200, { success: true, data: { status: "CANCELLED" } })).toBe(false)
    expect(visitStillOpenFromResponse(404, null)).toBe(false)
    expect(visitStillOpenFromResponse(503, null)).toBe(true)
    expect(visitStillOpenFromResponse(200, null)).toBe(true)
  })
})

describe("small visit facts", () => {
  it("names the status from the server value", () => {
    expect(visitStatusKey("CHECKED_IN")).toBe("statusInProgress")
    expect(visitStatusKey("CHECKED_OUT")).toBe("statusCompleted")
    expect(visitStatusKey("CANCELLED")).toBe("statusCancelled")
    expect(visitStatusKey("SOMETHING")).toBe("statusUnknown")
  })

  it("prefers the stored duration and otherwise derives it from the two times", () => {
    expect(visitDurationMinutes({ checkInAt: "2026-09-14T12:46:00Z", checkOutAt: "2026-09-14T13:09:00Z", duration: 23 })).toBe(23)
    expect(visitDurationMinutes({ checkInAt: "2026-09-14T14:49:00Z", checkOutAt: "2026-09-14T14:53:00Z" })).toBe(4)
    expect(visitDurationMinutes({ checkInAt: "2026-09-14T14:49:00Z", checkOutAt: null })).toBeNull()
  })
})

describe("API errors become localized messages", () => {
  it("maps the task version error that broke every reminder button", () => {
    expect(visitApiErrorKey(400, { error: "expectedVersion is required", code: "MTM_TASK_VERSION_REQUIRED" })).toBe("taskChanged")
    expect(visitApiErrorKey(409, { code: "MTM_TASK_VERSION_CONFLICT" })).toBe("taskChanged")
    expect(visitApiErrorKey(403, { code: "MTM_TASK_EDIT_DENIED" })).toBe("taskEditDenied")
  })

  it("maps visit codes and falls back by HTTP status, never to the English text", () => {
    expect(visitApiErrorKey(422, { code: "MTM_VISIT_REQUIREMENTS_INCOMPLETE" })).toBe("requirementsIncomplete")
    expect(visitApiErrorKey(409, { code: "MTM_VISIT_NOT_ACTIVE" })).toBe("visitNotActive")
    expect(visitApiErrorKey(404, { error: "Not found" })).toBe("visitNotFound")
    expect(visitApiErrorKey(400, { error: "Validation failed" })).toBe("invalidInput")
    expect(visitApiErrorKey(500, { error: "boom" })).toBeNull()
  })

  it("has a message for every key it can return, in every locale", () => {
    expect(VISIT_API_ERROR_MESSAGE_KEYS.length).toBeGreaterThan(10)
    for (const locale of ["en", "ru", "az"]) {
      const errors = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmVisitWorkspace.errors as Record<string, string>
      const missing = VISIT_API_ERROR_MESSAGE_KEYS.filter((key) => typeof errors[key] !== "string" || !errors[key].trim())
      expect(missing, locale).toEqual([])
    }
  })
})
