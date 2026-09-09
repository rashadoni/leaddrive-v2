import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * GET/PATCH /api/v1/settings/inbox-followup — the self-serve knobs for the 24h follow-up:
 * the org `inboxFollowUp` flag + the chatwoot channel's followUpMessage. PATCH must MERGE
 * the text into settings (never clobber replyMode/webhookSecret) and toggle the flag
 * without dropping other features.
 */
const db: { features: string[]; settings: Record<string, unknown> | null } = {
  features: ["aiAutoReply", "crm"],
  settings: { replyMode: "ai", webhookSecret: "secret", accountId: 171064 },
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async () => ({ features: db.features })),
      update: vi.fn(async ({ data }: any) => {
        db.features = data.features
        return {}
      }),
    },
    channelConfig: {
      findFirst: vi.fn(async () => (db.settings ? { id: "cfg_cw", settings: db.settings } : null)),
      update: vi.fn(async ({ data }: any) => {
        db.settings = data.settings
        return {}
      }),
    },
  },
}))
vi.mock("@/lib/with-rls", () => ({
  withRls: (h: any) => (req: any) => h(req, { orgId: "org_1" }),
  withRlsAuth: (_m: string, _a: string, h: any) => (req: any) => h(req, { orgId: "org_1" }),
}))
// The route now toggles the flag via the atomic helper (not organization.update). Mock it to
// mutate the shared db.features so readState + the flag assertions below still reflect the toggle.
vi.mock("@/lib/org-features", () => ({
  setOrgFeatureFlag: vi.fn(async (_orgId: string, flag: string, enabled: boolean) => {
    if (enabled && !db.features.includes(flag)) db.features = [...db.features, flag]
    if (!enabled) db.features = db.features.filter((f) => f !== flag)
  }),
}))

function req(body?: any) {
  return new NextRequest("http://localhost/api/v1/settings/inbox-followup", {
    method: body ? "PATCH" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  db.features = ["aiAutoReply", "crm"]
  db.settings = { replyMode: "ai", webhookSecret: "secret", accountId: 171064 }
})

describe("inbox-followup settings route", () => {
  it("GET reflects flag-off + existing message", async () => {
    db.settings = { ...db.settings, followUpMessage: "Salam!" }
    const { GET } = await import("../app/api/v1/settings/inbox-followup/route")
    const res = await GET(req() as any, {} as any)
    const j = await res.json()
    expect(j.data).toMatchObject({ enabled: false, message: "Salam!", channelConnected: true })
  })

  it("PATCH enabled:true adds the flag, keeps other features", async () => {
    const { PATCH } = await import("../app/api/v1/settings/inbox-followup/route")
    const res = await PATCH(req({ enabled: true }) as any, {} as any)
    const j = await res.json()
    expect(j.data.enabled).toBe(true)
    expect(db.features).toEqual(["aiAutoReply", "crm", "inboxFollowUp"])
  })

  it("PATCH enabled:false removes only that flag", async () => {
    db.features = ["aiAutoReply", "crm", "inboxFollowUp"]
    const { PATCH } = await import("../app/api/v1/settings/inbox-followup/route")
    await PATCH(req({ enabled: false }) as any, {} as any)
    expect(db.features).toEqual(["aiAutoReply", "crm"])
  })

  it("PATCH message MERGES into settings (preserves replyMode/webhookSecret)", async () => {
    const { PATCH } = await import("../app/api/v1/settings/inbox-followup/route")
    await PATCH(req({ message: "  New nudge  " }) as any, {} as any)
    expect(db.settings).toEqual({ replyMode: "ai", webhookSecret: "secret", accountId: 171064, followUpMessage: "New nudge" })
  })

  it("PATCH rejects an over-long message (400)", async () => {
    const { PATCH } = await import("../app/api/v1/settings/inbox-followup/route")
    const res = await PATCH(req({ message: "x".repeat(1001) }) as any, {} as any)
    expect(res.status).toBe(400)
  })
})
