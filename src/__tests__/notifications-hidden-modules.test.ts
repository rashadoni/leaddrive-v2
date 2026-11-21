import { describe, expect, it } from "vitest"
import { ENTITY_TO_MODULE } from "@/lib/notifications/taxonomy"
import { entityTypeHiddenFromUser } from "@/lib/notifications/access"
import { PERMISSION_MODULE_TO_MODULE_ID } from "@/lib/permissions"
import { LEGACY_MODULE_MAP } from "@/lib/modules"
import { USER_HIDEABLE_MODULE_IDS, effectiveHiddenModules, hideableIdForGateModule } from "@/lib/user-module-access"

// Owner, 2026-11-20: «если модули будут включены конкретные, то и уведомления только из этих модулей».
describe("a module hidden from a person brings them no notices", () => {
  it("hides a notice exactly when requireAuth would refuse its module to that person", () => {
    for (const [entityType, moduleId] of Object.entries(ENTITY_TO_MODULE)) {
      const hideable = entityType.startsWith("mtm_attendance_")
        ? "personnel"
        : hideableIdForGateModule(PERMISSION_MODULE_TO_MODULE_ID[moduleId] ?? LEGACY_MODULE_MAP[moduleId] ?? moduleId)
      if (!(USER_HIDEABLE_MODULE_IDS as readonly string[]).includes(hideable)) continue
      expect(entityTypeHiddenFromUser(entityType, [hideable]), entityType).toBe(true)
      expect(entityTypeHiddenFromUser(entityType, []), entityType).toBe(false)
    }
  })

  it("hides Personnel notices with Personnel's own tick, and nothing for another module or an unknown type", () => {
    expect(entityTypeHiddenFromUser("mtm_attendance_request", ["personnel"])).toBe(true)
    expect(entityTypeHiddenFromUser("mtm_attendance_explanation", ["personnel"])).toBe(true)
    // HR with Route & Field hidden still gets requests and explanations, and no field notices.
    expect(entityTypeHiddenFromUser("mtm_attendance_request", ["mtm"])).toBe(false)
    expect(entityTypeHiddenFromUser("mtm_location_request", ["mtm"])).toBe(true)
    expect(entityTypeHiddenFromUser("mtm_attendance_request", ["finance"])).toBe(false)
    expect(entityTypeHiddenFromUser("no_such_type", ["mtm"])).toBe(false)
  })

  it("never narrows an administrator", () => {
    expect(effectiveHiddenModules("admin", ["mtm"])).toEqual([])
  })
})
