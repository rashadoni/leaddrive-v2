import { describe, it, expect, vi } from "vitest"
import type { Prisma } from "@prisma/client"
import { calendarAccounts, isIdentityOnlyGoogleScope } from "@/lib/google-calendar-account"
import { replaceCalendarConnection } from "@/lib/google-calendar-connection"

describe("calendar connection consent", () => {
  it("recognizes only positively known identity-only scopes, preserving unknown grants", () => {
    expect(isIdentityOnlyGoogleScope("openid email profile")).toBe(true)
    expect(isIdentityOnlyGoogleScope(" profile\topenid https://www.googleapis.com/auth/userinfo.email ")).toBe(true)
    for (const scope of [null, "", "future.unknown.scope", "openid https://www.googleapis.com/auth/calendar.events"]) expect(isIdentityOnlyGoogleScope(scope)).toBe(false)
  })
  it("keeps a broken standalone connection ahead of SSO; excludes sign-in-only SSO", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "standalone", userId: "explicit", provider: "google-calendar", scope: "openid" },
      { id: "sso-calendar", userId: "explicit", provider: "google", scope: "https://www.googleapis.com/auth/calendar.readonly" },
      { id: "sign-in", userId: "identity", provider: "google", scope: "openid email profile" },
      { id: "unknown", userId: "unknown", provider: "google", scope: null },
    ])
    const result = await calendarAccounts({ account: { findMany } } as unknown as Prisma.TransactionClient, ["explicit", "identity", "unknown"])
    expect(result.get("explicit")?.id).toBe("standalone")
    expect(result.has("identity")).toBe(false)
    expect(result.get("unknown")?.id).toBe("unknown")
    expect(findMany.mock.calls[0][0].select).toEqual({ id: true, userId: true, provider: true, scope: true })
  })
  it("rotates consent generation without borrowing old refresh credentials or retargeting bindings", async () => {
    const order: string[] = []
    const tx = {
      $executeRaw: vi.fn(async () => { order.push("lock") }),
      account: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn(async () => [{ id: "old" }]), deleteMany: vi.fn(async (args: Prisma.AccountDeleteManyArgs) => { void args; order.push("retire") }), create: vi.fn(async (args: { data: Prisma.AccountCreateInput }) => { void args; order.push("new"); return { id: "new" } }) },
      bookingIntegrationBinding: { updateMany: vi.fn(async (args: Prisma.BookingIntegrationBindingUpdateManyArgs) => { void args; order.push("reconcile") }) },
    }
    await replaceCalendarConnection(tx as unknown as Prisma.TransactionClient, "org", "host", { access_token: "synthetic-new-access" }, "verified-new-primary")
    expect(order).toEqual(["lock", "reconcile", "retire", "new"])
    expect(tx.account.create.mock.calls[0][0].data.refresh_token).toBeNull()
    expect(tx.account.deleteMany.mock.calls[0][0]).toEqual({ where: { userId: "host", provider: "google-calendar" } })
    expect(tx.bookingIntegrationBinding.updateMany.mock.calls[0][0].data).toEqual({ state: "reconciliation_required" })
    expect(tx.account.create.mock.calls[0][0].data).not.toHaveProperty("id")
  })
})
