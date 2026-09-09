/**
 * POST/DELETE /api/v1/public/portal-push-register — Expo push-token (de)registration.
 *
 * Identity from the portal JWT only (never the body); token validated as
 * ExponentPushToken[...]; dedup on register; array-filter on unregister.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_o: string, fn: () => unknown) => fn() }))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: { contact: { findFirst: vi.fn(), updateMany: vi.fn() } },
}))

import { POST, DELETE } from "@/app/api/v1/public/portal-push-register/route"
import { getPortalUser } from "@/lib/portal-auth"
import { prisma } from "@/lib/prisma"

const USER = { contactId: "c-1", organizationId: "org-1", companyId: null, fullName: "Jane", email: "j@x.com" }
const TOKEN = "ExponentPushToken[abc123]"

function mkReq(body?: unknown) {
  return new Request("http://x/api/v1/public/portal-push-register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getPortalUser).mockResolvedValue(USER as never)
  vi.mocked(prisma.contact.findFirst).mockResolvedValue({ expoPushTokens: [] } as never)
  vi.mocked(prisma.contact.updateMany).mockResolvedValue({ count: 1 } as never)
})

describe("POST portal-push-register", () => {
  it("401 when not a portal member", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null as never)
    expect((await POST(mkReq({ expoPushToken: TOKEN }))).status).toBe(401)
    expect(prisma.contact.updateMany).not.toHaveBeenCalled()
  })

  it("400 on a malformed token", async () => {
    expect((await POST(mkReq({ expoPushToken: "nope" }))).status).toBe(400)
    expect((await POST(mkReq({}))).status).toBe(400)
  })

  it("appends the token (scoped to the JWT contactId) when new", async () => {
    const r = await POST(mkReq({ expoPushToken: TOKEN }))
    expect(r.status).toBe(200)
    expect(prisma.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "c-1", organizationId: "org-1" }),
        data: { expoPushTokens: { push: TOKEN } },
      }),
    )
  })

  it("does NOT append a duplicate token", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ expoPushTokens: [TOKEN] } as never)
    const r = await POST(mkReq({ expoPushToken: TOKEN }))
    expect(r.status).toBe(200)
    expect(prisma.contact.updateMany).not.toHaveBeenCalled()
  })

  it("ignores a contactId supplied in the body (uses the JWT)", async () => {
    await POST(mkReq({ expoPushToken: TOKEN, contactId: "victim-9" }))
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "c-1" }) }),
    )
  })
})

describe("DELETE portal-push-register", () => {
  it("removes the token from the array", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ expoPushTokens: [TOKEN, "ExponentPushToken[other]"] } as never)
    const r = await DELETE(mkReq({ expoPushToken: TOKEN }))
    expect(r.status).toBe(200)
    expect(prisma.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expoPushTokens: { set: ["ExponentPushToken[other]"] } } }),
    )
  })

  it("no-ops when the token isn't registered", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ expoPushTokens: ["ExponentPushToken[other]"] } as never)
    const r = await DELETE(mkReq({ expoPushToken: TOKEN }))
    expect(r.status).toBe(200)
    expect(prisma.contact.updateMany).not.toHaveBeenCalled()
  })

  it("401 when not a member", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null as never)
    expect((await DELETE(mkReq({ expoPushToken: TOKEN }))).status).toBe(401)
  })
})
