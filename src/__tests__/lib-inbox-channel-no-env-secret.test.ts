import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Regression (Codex finding, 2026-06-09): ensureInboxChannelForPage must NOT stamp the env (LeadDrive
 * shared) appId/appSecret onto an OAuth-created page ChannelConfig row. In Model B that env secret in
 * tenant scope re-enabled env-signed `?t=<slug>` webhook POSTs (cross-tenant write), because the
 * webhook resolver picks the most-recent FB/IG row. Page rows are token carriers only; app creds live
 * on the tenant's Meta-app config row.
 */

const { findFirst, create } = vi.hoisted(() => ({
  findFirst: vi.fn(async () => null), // no existing row → create path
  create: vi.fn(async ({ data }: any) => ({ id: "cfg_new", ...data })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { channelConfig: { findFirst, create, update: vi.fn() } },
}))
vi.mock("@/lib/social/meta-subscribe", () => ({ subscribePageToMessages: vi.fn(async () => ({ success: true })) }))

import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"

beforeEach(() => { findFirst.mockClear(); create.mockClear() })
afterEach(() => { delete process.env.FACEBOOK_APP_ID; delete process.env.FACEBOOK_APP_SECRET })

describe("ensureInboxChannelForPage — no env-secret on page rows", () => {
  it("does NOT copy env FACEBOOK_APP_ID/APP_SECRET onto the created page row", async () => {
    process.env.FACEBOOK_APP_ID = "LEADDRIVE_ENV_APPID"
    process.env.FACEBOOK_APP_SECRET = "LEADDRIVE_ENV_SECRET"

    await ensureInboxChannelForPage("org_b", "facebook", "PAGE_B", "Acme Page", "PAGE_TOKEN_B")

    expect(create).toHaveBeenCalledOnce()
    const data = (create.mock.calls[0][0] as any).data
    // Token carrier fields present:
    expect(data.organizationId).toBe("org_b")
    expect(data.channelType).toBe("facebook")
    expect(data.pageId).toBe("PAGE_B")
    expect(data.apiKey).toBe("PAGE_TOKEN_B")
    // App credentials MUST be absent — the env secret must not leak into tenant scope.
    expect(data.appId).toBeUndefined()
    expect(data.appSecret).toBeUndefined()
  })
})
