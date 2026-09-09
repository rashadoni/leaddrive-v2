import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * POST /api/v1/ai-configs — the inbox agent is a per-org SINGLETON: a re-save / second
 * tab / direct API call must never create duplicate `agentType="inbox"` configs (the
 * auto-reply engine reads exactly one). Upsert on (orgId, "inbox").
 */
const db: { existingInbox: any; created: any; updated: any } = { existingInbox: null, created: null, updated: null }

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAgentConfig: {
      findFirst: vi.fn(async () => db.existingInbox),
      create: vi.fn(async ({ data }: any) => { db.created = data; return { id: "new_1", ...data } }),
      update: vi.fn(async ({ where, data }: any) => { db.updated = { where, data }; return { id: where.id, ...data } }),
    },
  },
}))
vi.mock("@/lib/with-rls", () => ({
  withRls: (h: any) => (req: any, ctx: any) => h(req, { orgId: "org_1" }, ctx),
  withRlsAuth: (_m: string, _a: string, h: any) => (req: any, ctx: any) => h(req, { orgId: "org_1" }, ctx),
}))
vi.mock("@/lib/ai/budget", () => ({
  KNOWN_AI_MODELS: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"],
}))

function postReq(body: any) {
  return new NextRequest("http://localhost/api/v1/ai-configs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => { db.existingInbox = null; db.created = null; db.updated = null })

describe("ai-configs POST — inbox singleton", () => {
  it("creates the inbox agent when none exists (201)", async () => {
    const { POST } = await import("../app/api/v1/ai-configs/route")
    const res = await POST(postReq({ configName: "Inbox AI Agent", agentType: "inbox", systemPrompt: "Ты — бот.", model: "claude-sonnet-4-6" }) as any, {} as any)
    expect(res.status).toBe(201)
    expect(db.created).toMatchObject({ organizationId: "org_1", agentType: "inbox", systemPrompt: "Ты — бот." })
    expect(db.updated).toBeNull()
  })

  it("UPDATES the existing inbox agent instead of duplicating (200)", async () => {
    db.existingInbox = { id: "inbox_existing" }
    const { POST } = await import("../app/api/v1/ai-configs/route")
    const res = await POST(postReq({ configName: "Inbox AI Agent", agentType: "inbox", systemPrompt: "Новый промпт." }) as any, {} as any)
    expect(res.status).toBe(200)
    expect(db.updated?.where).toEqual({ id: "inbox_existing" })
    expect(db.updated?.data).toMatchObject({ agentType: "inbox", systemPrompt: "Новый промпт." })
    expect(db.created).toBeNull() // no duplicate create
  })

  it("rejects an unsupported model (400)", async () => {
    const { POST } = await import("../app/api/v1/ai-configs/route")
    const res = await POST(postReq({ configName: "x", agentType: "inbox", model: "gpt-4" }) as any, {} as any)
    expect(res.status).toBe(400)
  })
})
