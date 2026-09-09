/**
 * F4 — portable agent definitions: lib + export/import routes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { aiAgentConfig: { findFirst: vi.fn(), create: vi.fn() } },
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((v: unknown) => v instanceof Response),
}))

import {
  toPortableDefinition,
  importEnvelopeSchema,
  AGENT_DEFINITION_FORMAT,
} from "@/lib/ai/agent-portable"
import { GET as EXPORT } from "@/app/api/v1/ai-configs/[id]/export/route"
import { POST as IMPORT } from "@/app/api/v1/ai-configs/import/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth } from "@/lib/api-auth"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (body?: unknown) =>
  new NextRequest("http://localhost/x", {
    method: body ? "POST" : "GET",
    headers: { "x-organization-id": "org-1", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

const STORED = {
  id: "cfg-1", organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
  isActive: true, version: 5, handoffTargets: ["cfg-9"],
  configName: "Sales Bot", model: "claude-haiku-4-5-20251001", maxTokens: 2048, temperature: 0.6,
  systemPrompt: "Be helpful", toolsEnabled: ["add_note"], escalationEnabled: true, escalationRules: [],
  kbEnabled: true, kbMaxArticles: 3, agentType: "sales", department: "Sales", priority: 2,
  intents: ["sales_inquiry"], greeting: "Hi", maxToolRounds: 4, notes: "n",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1" as never)
  vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as never)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as never)
})

describe("toPortableDefinition", () => {
  it("keeps definition fields, drops identity/env fields + handoffTargets", () => {
    const env = toPortableDefinition(STORED as never)
    expect(env.format).toBe(AGENT_DEFINITION_FORMAT)
    expect(typeof env.exportedAt).toBe("string")
    expect(env.definition.configName).toBe("Sales Bot")
    expect(env.definition.toolsEnabled).toEqual(["add_note"])
    for (const dropped of ["id", "organizationId", "createdAt", "updatedAt", "isActive", "version", "handoffTargets"]) {
      expect(dropped in env.definition).toBe(false)
    }
  })
})

describe("importEnvelopeSchema", () => {
  it("accepts a valid envelope and strips stray keys", () => {
    const r = importEnvelopeSchema.safeParse({
      format: AGENT_DEFINITION_FORMAT, version: 1,
      definition: { configName: "X", id: "sneaky", handoffTargets: ["a"] },
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect("id" in r.data.definition).toBe(false)
      expect("handoffTargets" in r.data.definition).toBe(false)
    }
  })
  it("rejects a wrong format or missing name", () => {
    expect(importEnvelopeSchema.safeParse({ format: "nope", version: 1, definition: { configName: "X" } }).success).toBe(false)
    expect(importEnvelopeSchema.safeParse({ format: AGENT_DEFINITION_FORMAT, version: 1, definition: {} }).success).toBe(false)
  })
})

describe("GET export route", () => {
  it("404 when the config isn't in the org", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(null as never)
    const res = await EXPORT(req(), ctx("nope"))
    expect(res.status).toBe(404)
  })
  it("returns an attachment envelope without org fields", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(STORED as never)
    const res = await EXPORT(req(), ctx("cfg-1"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toContain("attachment")
    const body = await res.json()
    expect(body.format).toBe(AGENT_DEFINITION_FORMAT)
    expect(body.definition.configName).toBe("Sales Bot")
    expect("organizationId" in body.definition).toBe(false)
  })
})

describe("POST import route", () => {
  const envelope = (defOverrides: Record<string, unknown> = {}) => ({
    format: AGENT_DEFINITION_FORMAT, version: 1,
    definition: { configName: "Imported Bot", systemPrompt: "hi", toolsEnabled: ["add_note"], ...defOverrides },
  })

  it("creates an INACTIVE draft (v1) and returns 201", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.aiAgentConfig.create).mockResolvedValue({ id: "new", configName: "Imported Bot" } as never)
    const res = await IMPORT(req(envelope()), undefined as never)
    expect(res.status).toBe(201)
    const data = vi.mocked(prisma.aiAgentConfig.create).mock.calls[0][0].data as Record<string, unknown>
    expect(data.isActive).toBe(false)
    expect(data.version).toBe(1)
    expect(data.organizationId).toBe("org-1")
  })

  it("suffixes the name on collision", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue({ id: "dupe" } as never)
    vi.mocked(prisma.aiAgentConfig.create).mockResolvedValue({ id: "new" } as never)
    await IMPORT(req(envelope()), undefined as never)
    const data = vi.mocked(prisma.aiAgentConfig.create).mock.calls[0][0].data as Record<string, unknown>
    expect(data.configName).toBe("Imported Bot (imported)")
  })

  it("downgrades an imported inbox agent to general", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.aiAgentConfig.create).mockResolvedValue({ id: "new" } as never)
    await IMPORT(req(envelope({ agentType: "inbox" })), undefined as never)
    const data = vi.mocked(prisma.aiAgentConfig.create).mock.calls[0][0].data as Record<string, unknown>
    expect(data.agentType).toBe("general")
  })

  it("drops an unknown model rather than rejecting", async () => {
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.aiAgentConfig.create).mockResolvedValue({ id: "new" } as never)
    await IMPORT(req(envelope({ model: "gpt-9-ultra" })), undefined as never)
    const data = vi.mocked(prisma.aiAgentConfig.create).mock.calls[0][0].data as Record<string, unknown>
    expect("model" in data).toBe(false)
  })

  it("400 on a malformed file", async () => {
    const res = await IMPORT(req({ nope: true }), undefined as never)
    expect(res.status).toBe(400)
    expect(vi.mocked(prisma.aiAgentConfig.create)).not.toHaveBeenCalled()
  })
})
