/**
 * The proxy's API module gate for a person holding a ticked section of
 * Settings (lib/settings-sections.ts). Channels' WhatsApp part answers to the
 * inbox's scope; a person with the inbox hidden from them and Channels ticked
 * must reach it as an admin would — gated by what the ORGANIZATION has, not by
 * their own mask — and must still be refused the inbox itself.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async (v: string) => `hash_${v.slice(0, 8)}`),
  RATE_LIMIT_CONFIG: {
    api: { maxRequests: 100, windowMs: 60000 },
    ai: { maxRequests: 20, windowMs: 60000 },
    public: { maxRequests: 10, windowMs: 60000 },
    apiKey: { maxRequests: 300, windowMs: 60000 },
    webhook: { maxRequests: 600, windowMs: 60000 },
    inboundReadiness: { maxRequests: 3600, windowMs: 60000 },
  },
}))
vi.mock("@/lib/auth", () => ({
  auth: (cb: (...args: unknown[]) => unknown) => cb,
}))

import { NextRequest } from "next/server"
import authMiddleware from "@/proxy"

/** A sales person with every module but the boards hidden — the Zeytun marketers' shape. */
function marketer(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: "u1", organizationId: "org-1", role: "sales", plan: "enterprise",
      hiddenModules: ["crm", "sales", "omnichannel", "finance"],
      modules: { crm: false, boards: true, omnichannel: false, sales: false, finance: false },
      ...overrides,
    },
  }
}

async function run(pathname: string, auth: unknown, method = "GET") {
  const req = new NextRequest(new URL(pathname, "http://localhost"), { method, headers: { host: "localhost" } })
  ;(req as unknown as { auth: unknown }).auth = auth
  return authMiddleware(req)
}

describe("proxy module gate and ticked sections of Settings", () => {
  it("refuses the WhatsApp templates of Channels to a person with the inbox hidden and no tick", async () => {
    expect((await run("/api/v1/whatsapp/templates", marketer())).status).toBe(403)
  })

  it("lets them through once Channels is ticked, gated by what the organization has", async () => {
    const ticked = marketer({ settingsSections: ["channels"], sectionTenantModules: { crm: true, boards: true, omnichannel: true } })
    expect((await run("/api/v1/whatsapp/templates", ticked)).status).toBe(200)
    expect((await run("/api/v1/whatsapp/readiness", ticked)).status).toBe(200)
  })

  it("still refuses them the inbox itself, and a WhatsApp route that is not Channels'", async () => {
    const ticked = marketer({ settingsSections: ["channels"], sectionTenantModules: { crm: true, boards: true, omnichannel: true } })
    expect((await run("/api/v1/inbox/conversations", ticked)).status).toBe(403)
    expect((await run("/api/v1/whatsapp/send", ticked, "POST")).status).toBe(403)
  })

  it("refuses the section's routes when the organization itself does not have the module", async () => {
    const ticked = marketer({ settingsSections: ["channels"], sectionTenantModules: { crm: true, boards: true, omnichannel: false } })
    expect((await run("/api/v1/whatsapp/templates", ticked)).status).toBe(403)
  })
})
