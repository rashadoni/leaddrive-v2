import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppTemplate: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
}))
// sanitizeOwnedRefs is unit-tested separately; here it passes refs through so we
// assert the route's threading, not the ownership lookup.
vi.mock("@/lib/verify-owned-refs", () => ({
  sanitizeOwnedRefs: vi.fn(async (_org: string, r: any) => ({ leadId: r.leadId || undefined, contactId: r.contactId || undefined })),
}))

import { POST } from "@/app/api/v1/whatsapp/send/route"
import { getOrgId } from "@/lib/api-auth"
import { sendWhatsAppTemplate } from "@/lib/whatsapp"

const makeReq = (body: any) =>
  new NextRequest("http://localhost:3000/api/v1/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

describe("POST /api/v1/whatsapp/send — lead linkage (Slice 3b)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ success: true, messageId: "wamid.1" } as any)
  })

  it("threads leadId from the request body to sendWhatsAppTemplate", async () => {
    const res = await POST(makeReq({ to: "+994501112233", templateName: "welcome", languageCode: "ru", leadId: "lead-9" }))
    expect(res.status).toBe(200)
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(sendWhatsAppTemplate).mock.calls[0][0]
    expect(arg.leadId).toBe("lead-9")
    expect(arg.organizationId).toBe("org-1")
  })

  it("leadId is optional — omitting it still sends (undefined leadId)", async () => {
    const res = await POST(makeReq({ to: "+994501112233", templateName: "welcome" }))
    expect(res.status).toBe(200)
    expect(vi.mocked(sendWhatsAppTemplate).mock.calls[0][0].leadId).toBeUndefined()
  })

  it("returns 401 without orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await POST(makeReq({ to: "+994501112233", templateName: "welcome", leadId: "lead-9" }))
    expect(res.status).toBe(401)
  })
})
