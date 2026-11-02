import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// The channel catalog's «Test mesajı». Channels are Settings for every tenant since 2026-10-26; the button used to
// call /api/v1/whatsapp/test, which the proxy files under the Omni-channel inbox, so an admin of a tenant without
// that module saw the button and got a module refusal. The catalog now calls /api/v1/channels/whatsapp/test.
const m = vi.hoisted(() => ({
  session: vi.fn(),
  module: vi.fn(),
  findFirst: vi.fn(),
  send: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: m.session,
  isAuthError: (value: unknown) => value instanceof Response,
  orgHasModule: m.module,
}))
vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: { findFirst: m.findFirst, findMany: vi.fn(async () => []) } } }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: m.send }))

import { POST } from "@/app/api/v1/channels/whatsapp/test/route"
import { resolveModuleFromPath } from "@/lib/permissions"

const admin = { orgId: "org-zeytun", userId: "u-admin", role: "admin", email: "a@zeytun.az", name: "Admin" }
const request = (body: unknown) =>
  new NextRequest("https://zeytun.leaddrivecrm.org/api/v1/channels/whatsapp/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue(admin)
  m.module.mockResolvedValue(false) // no Omni-channel
  m.findFirst.mockImplementation(async ({ where }: { where: { id?: string; organizationId: string } }) =>
    where.id === "wa-fanum" && where.organizationId === "org-zeytun" ? { id: "wa-fanum" } : null)
  m.send.mockResolvedValue({ success: true, messageId: "wamid.fixture" })
})

describe("POST /api/v1/channels/whatsapp/test", () => {
  it("sends the test template from the chosen number for an admin of a tenant without Omni-channel", async () => {
    const res = await POST(request({ to: "+994501234567", channelConfigId: "wa-fanum" }))

    expect(res.status).toBe(200)
    expect(m.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      to: "+994501234567",
      templateName: "hello_world",
      templateLanguage: "en_US",
      organizationId: "org-zeytun",
      channelConfigId: "wa-fanum",
    }))
    // The proxy's module gate files this path under Settings, not under the Omni-channel inbox.
    expect(resolveModuleFromPath("/api/v1/channels/whatsapp/test")).toBe("settings")
  })

  it("refuses a number of another workspace and sends nothing", async () => {
    const res = await POST(request({ to: "+994501234567", channelConfigId: "wa-other-org" }))
    expect(res.status).toBe(404)
    expect(m.send).not.toHaveBeenCalled()
  })

  it("stays an admin action: a manager is refused, a request without a session is refused", async () => {
    m.session.mockResolvedValueOnce({ ...admin, role: "manager" })
    expect((await POST(request({ to: "+994501234567", channelConfigId: "wa-fanum" }))).status).toBe(403)
    m.session.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    expect((await POST(request({ to: "+994501234567", channelConfigId: "wa-fanum" }))).status).toBe(401)
    expect(m.send).not.toHaveBeenCalled()
  })

  it("asks for a recipient", async () => {
    expect((await POST(request({ channelConfigId: "wa-fanum" }))).status).toBe(400)
    expect(m.send).not.toHaveBeenCalled()
  })
})
