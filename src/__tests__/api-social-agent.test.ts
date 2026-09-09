import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>
type AgentConfigRow = Record<string, unknown> & {
  id?: string
  version?: number
}
type AgentConfigUpdate = Record<string, unknown> & {
  version?: number | { increment?: number }
}

const db = { configs: [] as AgentConfigRow[] }

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiAgentConfig: {
      findMany: vi.fn(async () => db.configs),
      findFirst: vi.fn(async () => db.configs[0] ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "cfg-1",
        version: 1,
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: AgentConfigUpdate }) => ({
        ...db.configs[0],
        id: db.configs[0]?.id ?? "cfg-1",
        ...data,
        version: typeof data.version === "object" && typeof data.version.increment === "number"
          ? Number(db.configs[0]?.version ?? 0) + data.version.increment
          : data.version ?? db.configs[0]?.version ?? 1,
      })),
    },
  },
}))

vi.mock("@/lib/ai/budget", () => ({
  KNOWN_AI_MODELS: ["claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-sonnet-4-6", "claude-opus-4-8"],
}))

import { GET, PUT } from "@/app/api/v1/social/agent/route"
import { prisma } from "@/lib/prisma"

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/agent", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.configs = []
})

describe("social agent persona API", () => {
  it("returns defaults with configured=false when no social agent exists", async () => {
    const res = await GET(req("GET"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({ configured: false, model: "claude-haiku-4-5-20251001" })
  })

  it("scopes the lookup to the tenant and agentType social", async () => {
    await GET(req("GET"))
    expect(prisma.aiAgentConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", agentType: "social" } }),
    )
  })

  it("reads the active canonical persona when legacy duplicate rows exist", async () => {
    db.configs = [
      {
        id: "legacy",
        configName: "Legacy Social Agent",
        version: 7,
        systemPrompt: "Legacy prompt",
        model: "claude-haiku-4-5-20251001",
        temperature: 0.2,
        greeting: null,
        escalationEnabled: true,
        isActive: true,
      },
      {
        id: "canonical",
        configName: "Social AI Agent",
        version: 3,
        systemPrompt: "Saved tenant persona",
        model: "claude-sonnet-4-5-20250929",
        temperature: 0.1,
        greeting: "Salam",
        escalationEnabled: true,
        isActive: true,
      },
    ]

    const res = await GET(req("GET"))
    const json = await res.json()

    expect(json.data).toMatchObject({
      id: "canonical",
      systemPrompt: "Saved tenant persona",
      version: 3,
      agents: expect.arrayContaining([
        expect.objectContaining({ id: "canonical", configName: "Social AI Agent", version: 3 }),
        expect.objectContaining({ id: "legacy", version: 7 }),
      ]),
    })
  })

  it("creates a social singleton on first save", async () => {
    db.configs = []
    const res = await PUT(req("PUT", { systemPrompt: "Be warm and concise", temperature: 0.4 }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.id).toBe("cfg-1")
    expect(prisma.aiAgentConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-1", agentType: "social", systemPrompt: "Be warm and concise" }),
      }),
    )
  })

  it("updates the existing social singleton instead of creating a duplicate", async () => {
    db.configs = [{
      id: "cfg-1",
      configName: "Social AI Agent",
      version: 2,
      systemPrompt: "Old voice",
      model: "claude-haiku-4-5-20251001",
      temperature: 0.2,
      greeting: null,
      escalationEnabled: true,
      isActive: true,
    }]
    const res = await PUT(req("PUT", { systemPrompt: "Updated voice" }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prisma.aiAgentConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cfg-1" }, data: expect.objectContaining({ systemPrompt: "Updated voice" }) }),
    )
    expect(prisma.aiAgentConfig.create).not.toHaveBeenCalled()
    expect(json.data).toMatchObject({ systemPrompt: "Updated voice", version: 3 })
  })

  it("rejects an unsupported model", async () => {
    const res = await PUT(req("PUT", { model: "gpt-4o" }))
    expect(res.status).toBe(400)
  })
})
