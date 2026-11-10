import { BOOKING_WORKSPACE_ENABLED } from "@/lib/booking/release-phase"
import { describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"
import { checkPermission } from "@/lib/permissions"
import { accessibleNavItems } from "@/lib/nav-items"
import type { AuthResult } from "@/lib/api-auth"

const grants = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { bookingCoordinatorGrant: grants } }))
import { bookingAccess, bookingScope } from "@/lib/booking/access"

const operator = (over: Partial<AuthResult> = {}): AuthResult => ({ orgId: "org-a", userId: "employee", role: "sales", principalType: "session", email: "a@example.test", name: "Employee", ...over })

describe("meeting workspace access", () => {
  it("does not inherit wildcard read or API-key impersonation", async () => {
    for (const role of ["viewer", "reviewer"] as const) {
      expect(checkPermission(role, "bookings", "read")).toBe(false)
      const denied = await bookingAccess(operator({ role }))
      expect(denied).toBeInstanceOf(NextResponse)
      expect((denied as NextResponse).status).toBe(403)
    }
    for (const principalType of ["api_key", undefined] as const) {
      const denied = await bookingAccess(operator({ role: "admin", principalType }))
      expect((denied as NextResponse).status).toBe(403)
    }
  })

  it("keeps own access and distinguishes read-only coordination from management", async () => {
    grants.findMany.mockResolvedValueOnce([{ hostUserId: "colleague-a", canManage: false }, { hostUserId: "colleague-b", canManage: true }])
    const access = await bookingAccess(operator())
    if (access instanceof NextResponse) throw new Error("unexpected denial")
    expect(access.hostIds).toEqual(["employee", "colleague-a", "colleague-b"])
    expect(access.writableHostIds).toEqual(["employee", "colleague-b"])
    expect(bookingScope(access, true)).toEqual({ organizationId: "org-a", hostUserId: { in: ["employee", "colleague-b"] } })
  })

  it("re-reads revoked grants and fails closed on a lookup failure", async () => {
    grants.findMany.mockResolvedValueOnce([{ hostUserId: "colleague", canManage: true }]).mockResolvedValueOnce([])
    const before = await bookingAccess(operator()), after = await bookingAccess(operator())
    expect(before).toHaveProperty("hostIds", ["employee", "colleague"])
    expect(after).toHaveProperty("hostIds", ["employee"])
    grants.findMany.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(bookingAccess(operator())).rejects.toThrow("database unavailable")
  })

  it("administrator access remains bound to the selected organization", async () => {
    const access = await bookingAccess(operator({ role: "admin" }))
    if (access instanceof NextResponse) throw new Error("unexpected denial")
    expect(bookingScope(access)).toEqual({ organizationId: "org-a" })
    expect(access.administrator).toBe(true)
  })

  it("offers the day to everyone who works it and the set-up screens only to an administrator", () => {
    // Four screens, four addresses since 2026-11-10 — and a salon that bought
    // the booking module without Sales reaches them, which is why the menu asks
    // for `booking` and not for `sales`. Only `canConfigure` may open the three
    // that set the section up, so only an administrator is offered them: a menu
    // entry that refuses the person who clicks it is worse than no entry.
    for (const role of ["sales", "manager"] as const) {
      const items = accessibleNavItems({ plan: "professional", role, modules: { booking: true } })
      expect(items.filter((item) => item.permissionScope === "bookings").map((item) => item.href))
        .toEqual(BOOKING_WORKSPACE_ENABLED ? ["/meetings"] : [])
    }
    expect(accessibleNavItems({ plan: "professional", role: "admin", modules: { booking: true } })
      .filter((item) => item.permissionScope === "bookings").map((item) => item.href))
      .toEqual(BOOKING_WORKSPACE_ENABLED
        ? ["/meetings", "/meetings/services", "/meetings/whatsapp", "/meetings/team"]
        : ["/settings/booking"])
    expect(accessibleNavItems({ plan: "professional", role: "viewer", modules: { booking: true } }).some((item) => item.permissionScope === "bookings")).toBe(false)
  })
})
