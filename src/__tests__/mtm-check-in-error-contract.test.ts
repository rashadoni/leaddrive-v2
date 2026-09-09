import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  MTM_CHECK_IN_ERROR,
  MTM_CHECK_IN_ERROR_CODES,
  MTM_CHECK_IN_ERROR_MESSAGE,
  MTM_CHECK_IN_ERROR_STATUS,
  checkInConflict,
  checkInErrorBody,
  checkInErrorFromThrown,
} from "@/lib/mtm/check-in-errors"

const SPEC = readFileSync("docs/mtm-mobile-update-spec-2026-07-11.md", "utf8")
const VISITS_ROUTE = readFileSync("src/app/api/v1/mtm/visits/route.ts", "utf8")
const PUSH_ROUTE = readFileSync("src/app/api/v1/mtm/mobile/sync/push/route.ts", "utf8")
const WEB_PUSH_ROUTE = readFileSync("src/app/api/v1/mtm/sync/push/route.ts", "utf8")

describe("MTM check-in error contract (field UX audit A6)", () => {
  it("names every code of the audit plan", () => {
    expect(MTM_CHECK_IN_ERROR).toMatchObject({
      TOO_FAR: "MTM_VISIT_OUT_OF_ZONE",
      NO_COORDINATES: "MTM_VISIT_CUSTOMER_NO_COORDINATES",
      ACTIVE_VISIT: "MTM_VISIT_ALREADY_ACTIVE",
      ROUTE_POINT_NOT_AVAILABLE: "MTM_ROUTE_POINT_NOT_AVAILABLE",
      CUSTOMER_MISSING: "MTM_VISIT_CUSTOMER_NOT_FOUND",
    })
    expect(new Set(MTM_CHECK_IN_ERROR_CODES).size).toBe(MTM_CHECK_IN_ERROR_CODES.length)
  })

  it("gives every code a message and an HTTP status", () => {
    for (const code of MTM_CHECK_IN_ERROR_CODES) {
      expect(MTM_CHECK_IN_ERROR_MESSAGE[code], code).toBeTruthy()
      expect(MTM_CHECK_IN_ERROR_STATUS[code], code).toBeGreaterThanOrEqual(400)
    }
    expect(MTM_CHECK_IN_ERROR_STATUS.MTM_VISIT_CUSTOMER_NO_COORDINATES).toBe(422)
  })

  it("shapes both transports from the same vocabulary", () => {
    expect(checkInErrorBody("MTM_VISIT_OUT_OF_ZONE", { distanceMeters: 500, geofenceRadius: 100 })).toEqual({
      error: MTM_CHECK_IN_ERROR_MESSAGE.MTM_VISIT_OUT_OF_ZONE,
      code: "MTM_VISIT_OUT_OF_ZONE",
      distanceMeters: 500,
      geofenceRadius: 100,
    })
    expect(checkInConflict("MTM_VISIT_ALREADY_ACTIVE", { activeVisit: { id: "v-1" } })).toEqual({
      errorMsg: MTM_CHECK_IN_ERROR_MESSAGE.MTM_VISIT_ALREADY_ACTIVE,
      serverData: { code: "MTM_VISIT_ALREADY_ACTIVE", activeVisit: { id: "v-1" } },
    })
  })

  it("maps only contract codes thrown inside the check-in transaction", () => {
    expect(checkInErrorFromThrown(new Error("MTM_ROUTE_POINT_NOT_AVAILABLE"))).toBe("MTM_ROUTE_POINT_NOT_AVAILABLE")
    expect(checkInErrorFromThrown(new Error("DB constraint"))).toBeNull()
    expect(checkInErrorFromThrown("MTM_VISIT_ALREADY_ACTIVE")).toBeNull()
  })

  it("documents every code in the mobile update spec", () => {
    for (const code of MTM_CHECK_IN_ERROR_CODES) {
      expect(SPEC, code).toContain(`\`${code}\``)
    }
  })

  it("keeps both server entry points on the shared vocabulary", () => {
    expect(VISITS_ROUTE).toContain('from "@/lib/mtm/check-in-errors"')
    expect(PUSH_ROUTE).toContain('from "@/lib/mtm/check-in-errors"')
    // No hand-written check-in code literals may survive outside the module.
    for (const source of [VISITS_ROUTE, PUSH_ROUTE]) {
      expect(source).not.toMatch(/code: "MTM_VISIT_(CUSTOMER_NOT_FOUND|ALREADY_ACTIVE|OUT_OF_ZONE|CONTACT_NOT_FOUND|FORCE_FORBIDDEN|CUSTOMER_NO_COORDINATES)"/)
      expect(source).not.toMatch(/code: "MTM_ROUTE_(POINT_NOT_AVAILABLE|POINT_ALREADY_ACTIVE|TARGET_MISMATCH|TARGET_INVALID)"/)
    }
    expect(VISITS_ROUTE).toContain("hasMtmCoordinates(scopedCustomer)")
    expect(PUSH_ROUTE).toContain("hasMtmCoordinates(customer)")
  })

  it("applies the same rule to the web PWA offline check-in", () => {
    expect(WEB_PUSH_ROUTE).toContain('from "@/lib/mtm/check-in-errors"')
    expect(WEB_PUSH_ROUTE).toContain("if (!hasMtmCoordinates(customer)) {")
    expect(WEB_PUSH_ROUTE).toContain('status: "customer_no_coordinates", code: MTM_CHECK_IN_ERROR.NO_COORDINATES')
    expect(WEB_PUSH_ROUTE).toContain('status: "out_of_zone", code: MTM_CHECK_IN_ERROR.TOO_FAR')
  })
})
