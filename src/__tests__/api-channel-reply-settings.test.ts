import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Per-channel reply-routing settings API (`/api/v1/settings/channel-reply`).
 *
 * Covers:
 *  CR-1  GET → lists channels with parsed reply policy (defaults applied)
 *  CR-2  PATCH mode → MERGES into settings, preserving auth keys, returns policy
 *  CR-3  PATCH unknown configId → 404, no update
 *  CR-4  PATCH invalid mode → 400
 *  CR-5  PATCH escalateKeywords → trimmed + deduped
 */

const db: { channels: any[]; found: any; updateArgs: any } = { channels: [], found: null, updateArgs: null }

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(async () => db.channels),
      findFirst: vi.fn(async () => db.found),
      update: vi.fn(async (args: any) => {
        db.updateArgs = args
        return { id: args.where.id }
      }),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(async () => ({ orgId: "org_1" })),
  getOrgId: vi.fn(async () => "org_1"),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(async () => ({ orgId: "org_1", userId: "user_1", role: "admin", email: "admin@example.test", name: "Admin" })),
  isAuthError: vi.fn(() => false),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_o: string, fn: () => any) => fn(),
  runWithRlsBypass: (fn: () => any) => fn(),
  enterTenantContext: vi.fn(),
}))

function getReq() {
  return new NextRequest("http://localhost/api/v1/settings/channel-reply")
}
function patchReq(body: any) {
  return new NextRequest("http://localhost/api/v1/settings/channel-reply", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  db.channels = []
  db.found = null
  db.updateArgs = null
})

describe("channel-reply settings API", () => {
  it("CR-1: GET lists channels with parsed reply policy + defaults", async () => {
    db.channels = [
      { id: "c1", channelType: "chatwoot", configName: "TikTok via Chatwoot", isActive: true,
        settings: { baseUrl: "x", replyMode: "ai", escalateKeywords: ["оператор"] } },
      { id: "c2", channelType: "telegram", configName: "Bot", isActive: true, settings: null },
    ]
    const { GET } = await import("../app/api/v1/settings/channel-reply/route")
    const json = await (await GET(getReq(), {} as any)).json()

    expect(json.data.channels).toHaveLength(2)
    expect(json.data.channels[0]).toMatchObject({ channelType: "chatwoot", reply: { mode: "ai" } })
    expect(json.data.channels[0].reply).toMatchObject({ modeDefaulted: false, modeSource: "explicit" })
    expect(json.data.channels[0].reply.escalateKeywords).toEqual(["оператор"])
    // missing settings → safe defaults
    expect(json.data.channels[1].reply).toMatchObject({ mode: "agent", afterHoursAi: false, draftMode: false })
    expect(json.data.channels[1].reply).toMatchObject({ modeDefaulted: true, modeSource: "default_agent" })
  })

  it("CR-7: WhatsApp is default-ON — an unset whatsapp channel reads as 'ai', explicit 'agent' off", async () => {
    db.channels = [
      { id: "w1", channelType: "whatsapp", configName: "WA Business", isActive: true, settings: null },
      { id: "w2", channelType: "whatsapp", configName: "WA Off", isActive: true, settings: { replyMode: "agent" } },
    ]
    const { GET } = await import("../app/api/v1/settings/channel-reply/route")
    const json = await (await GET(getReq(), {} as any)).json()
    // unset whatsapp → "ai" (Da Vinci default-on), NOT the generic "agent" default
    expect(json.data.channels[0]).toMatchObject({ channelType: "whatsapp", reply: { mode: "ai" } })
    expect(json.data.channels[0].reply).toMatchObject({ modeDefaulted: true, modeSource: "whatsapp_default_ai" })
    // explicit "agent" → off
    expect(json.data.channels[1].reply.mode).toBe("agent")
    expect(json.data.channels[1].reply).toMatchObject({ modeDefaulted: false, modeSource: "explicit" })
  })

  it("CR-2: PATCH mode MERGES — preserves auth keys, adds replyMode", async () => {
    db.found = { id: "c1", settings: { baseUrl: "https://app.chatwoot.com", accountId: 171064, webhookSecret: "s3cr3t" } }
    const { PATCH } = await import("../app/api/v1/settings/channel-reply/route")
    const res = await PATCH(patchReq({ configId: "c1", mode: "ai" }), {} as any)

    expect(res.status).toBe(200)
    // the critical assertion: existing auth/config keys survive the merge
    expect(db.updateArgs.where).toEqual({ id: "c1" })
    expect(db.updateArgs.data.settings).toEqual({
      baseUrl: "https://app.chatwoot.com",
      accountId: 171064,
      webhookSecret: "s3cr3t",
      replyMode: "ai",
    })
  })

  it("CR-3: PATCH unknown configId → 404, no update", async () => {
    db.found = null
    const { PATCH } = await import("../app/api/v1/settings/channel-reply/route")
    const res = await PATCH(patchReq({ configId: "nope", mode: "ai" }), {} as any)

    expect(res.status).toBe(404)
    expect(db.updateArgs).toBeNull()
  })

  it("CR-4: PATCH invalid mode → 400", async () => {
    const { PATCH } = await import("../app/api/v1/settings/channel-reply/route")
    const res = await PATCH(patchReq({ configId: "c1", mode: "robot" }), {} as any)
    expect(res.status).toBe(400)
    expect(db.updateArgs).toBeNull()
  })

  it("CR-5: PATCH escalateKeywords → trimmed + deduped", async () => {
    db.found = { id: "c1", settings: {} }
    const { PATCH } = await import("../app/api/v1/settings/channel-reply/route")
    await PATCH(patchReq({ configId: "c1", escalateKeywords: [" оператор ", "жалоба", "оператор"] }), {} as any)
    expect(db.updateArgs.data.settings.escalateKeywords).toEqual(["оператор", "жалоба"])
  })

  it("CR-6: PATCH over null settings → safe (no throw, just the new field)", async () => {
    db.found = { id: "c1", settings: null }
    const { PATCH } = await import("../app/api/v1/settings/channel-reply/route")
    const res = await PATCH(patchReq({ configId: "c1", mode: "ai" }), {} as any)
    expect(res.status).toBe(200)
    expect(db.updateArgs.data.settings).toEqual({ replyMode: "ai" })
  })
})
