import { describe, expect, it } from "vitest"

import {
  portalAccessState,
  portalEnableBlocker,
  selectAllVisible,
  togglePortalSelection,
  visibleSelection,
  type PortalContactRecord,
} from "@/lib/portal-users/presentation"

const base: PortalContactRecord = {
  id: "c1",
  fullName: "Jane Doe",
  email: "jane@example.com",
  phone: null,
  companyName: "Acme",
  isActive: true,
  portalAccessEnabled: true,
  hasPassword: true,
  portalLastLoginAt: null,
  recoveryExpiresAt: null,
}

describe("portal user presentation", () => {
  it("explains enable preconditions before a request is sent", () => {
    expect(portalEnableBlocker(base)).toBeNull()
    expect(portalEnableBlocker({ ...base, email: null })).toBe("email")
    expect(portalEnableBlocker({ ...base, email: "  " })).toBe("email")
    expect(portalEnableBlocker({ ...base, isActive: false })).toBe("inactive")
  })
  it("distinguishes disabled, setup-pending and registered access", () => {
    expect(portalAccessState({ ...base, isActive: false })).toBe("contact_inactive")
    expect(portalAccessState({ ...base, portalAccessEnabled: false })).toBe("disabled")
    expect(portalAccessState({ ...base, hasPassword: false })).toBe("setup_pending")
    expect(portalAccessState(base)).toBe("registered")
  })

  it("surfaces active and expired one-time recovery windows", () => {
    const now = Date.parse("2026-09-05T12:00:00Z")
    expect(portalAccessState({ ...base, recoveryExpiresAt: "2026-09-06T12:00:00Z" }, now)).toBe("recovery_active")
    expect(portalAccessState({ ...base, recoveryExpiresAt: "2026-09-04T12:00:00Z" }, now)).toBe("recovery_expired")
  })

  it("selects only the current visible result set", () => {
    const visible = [base, { ...base, id: "c2" }]
    expect([...selectAllVisible(visible)]).toEqual(["c1", "c2"])
  })

  it("removes selections that no longer belong to visible results", () => {
    expect([...visibleSelection(new Set(["c1", "old"]), [base])]).toEqual(["c1"])
  })

  it("toggles a row without mutating the previous selection", () => {
    const previous = new Set(["c1"])
    const next = togglePortalSelection(previous, "c2")
    expect([...next]).toEqual(["c1", "c2"])
    expect([...previous]).toEqual(["c1"])
    expect([...togglePortalSelection(next, "c1")]).toEqual(["c2"])
  })
})
