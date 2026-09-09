import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    eventType: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: null } }),
    },
    task: { count: vi.fn().mockResolvedValue(0) },
  }
  prisma.$transaction = vi.fn((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : typeof arg === "function" ? (arg as any)(prisma) : Promise.resolve(arg),
  )
  return { prisma, logAudit: vi.fn() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  // GET migrated to withRls (getSession ?? getOrgId) — default getSession→null
  // so withRls falls through to the getOrgId mock (set to "org-1" in beforeEach).
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, POST, PATCH } from "@/app/api/v1/event-types/route"
import { PUT, DELETE } from "@/app/api/v1/event-types/[id]/route"
import { isValidEventType } from "@/lib/tasks/task-types"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "u1", role: "admin", email: "a@b.com", name: "A" }
const req = (url: string, opts?: RequestInit) => new Request(url, opts) as any
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
  vi.mocked(prisma.eventType.findMany).mockResolvedValue([])
  vi.mocked(prisma.eventType.aggregate).mockResolvedValue({ _max: { sortOrder: null } } as any)
  vi.mocked(prisma.task.count).mockResolvedValue(0)
})

describe("GET /api/v1/event-types", () => {
  it("401 without org", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    expect((await GET(req("http://x/api/v1/event-types"))).status).toBe(401)
  })
  it("falls back to the seeded channels when the org has none", async () => {
    const res = await GET(req("http://x/api/v1/event-types"))
    const json = await res.json()
    expect(json.data.map((t: any) => t.name)).toContain("social_media")
  })
})

describe("POST /api/v1/event-types", () => {
  it("derives a slug from displayName and creates", async () => {
    vi.mocked(prisma.eventType.create).mockImplementation(async (args: any) => ({ id: "new", ...args.data }))
    const res = await POST(req("http://x/api/v1/event-types", {
      method: "POST", body: JSON.stringify({ displayName: "VIP GROUP WHATSAPP", color: "#06b6d4" }),
    }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.data.name).toBe("vip_group_whatsapp")
  })
  it("propagates auth errors", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any)
    const res = await POST(req("http://x/api/v1/event-types", { method: "POST", body: JSON.stringify({ displayName: "X" }) }))
    expect(res.status).toBe(403)
  })
})

describe("PATCH reorder", () => {
  it("updates sortOrder per item", async () => {
    const res = await PATCH(req("http://x/api/v1/event-types", {
      method: "PATCH", body: JSON.stringify([{ id: "a", sortOrder: 1 }, { id: "b", sortOrder: 0 }]),
    }))
    expect(res.status).toBe(200)
    expect(prisma.eventType.updateMany).toHaveBeenCalledTimes(2)
  })
})

describe("PUT/DELETE /api/v1/event-types/[id]", () => {
  it("404 when the event type is not in the org", async () => {
    vi.mocked(prisma.eventType.findFirst).mockResolvedValue(null)
    const res = await PUT(req("http://x/api/v1/event-types/z", { method: "PUT", body: JSON.stringify({ displayName: "Y" }) }), params("z"))
    expect(res.status).toBe(404)
  })
  it("blocks delete while tasks still use the event type", async () => {
    vi.mocked(prisma.eventType.findFirst).mockResolvedValue({ id: "1", organizationId: "org-1", name: "social_media" } as any)
    vi.mocked(prisma.task.count).mockResolvedValue(2)
    const res = await DELETE(req("http://x/api/v1/event-types/1", { method: "DELETE" }), params("1"))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.taskCount).toBe(2)
    expect(prisma.eventType.delete).not.toHaveBeenCalled()
  })
  it("deletes when unused", async () => {
    vi.mocked(prisma.eventType.findFirst).mockResolvedValue({ id: "1", organizationId: "org-1", name: "social_media" } as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)
    const res = await DELETE(req("http://x/api/v1/event-types/1", { method: "DELETE" }), params("1"))
    expect(res.status).toBe(200)
    expect(prisma.eventType.delete).toHaveBeenCalled()
  })
})

describe("isValidEventType", () => {
  it("allows an empty value (optional field)", async () => {
    expect(await isValidEventType("org-1", undefined)).toBe(true)
    expect(prisma.eventType.findMany).not.toHaveBeenCalled()
  })
  it("matches a configured (active or inactive) value, rejects unknown", async () => {
    vi.mocked(prisma.eventType.findMany).mockResolvedValue([{ name: "social_media" }] as any)
    expect(await isValidEventType("org-1", "social_media")).toBe(true)
    expect(await isValidEventType("org-1", "nope")).toBe(false)
  })
  it("falls back to the seeded channels when the org has none", async () => {
    vi.mocked(prisma.eventType.findMany).mockResolvedValue([])
    expect(await isValidEventType("org-1", "914_line")).toBe(true)
    expect(await isValidEventType("org-1", "nope")).toBe(false)
  })
})
