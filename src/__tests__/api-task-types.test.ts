import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextResponse } from "next/server"

// ── prisma mock ──────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    taskType: {
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

import { GET, POST, PATCH } from "@/app/api/v1/task-types/route"
import { PUT, DELETE } from "@/app/api/v1/task-types/[id]/route"
import { isValidTaskType } from "@/lib/tasks/task-types"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "u1", role: "admin", email: "a@b.com", name: "A" }
const req = (url: string, opts?: RequestInit) => new Request(url, opts) as any
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
  vi.mocked(prisma.taskType.findMany).mockResolvedValue([])
  vi.mocked(prisma.taskType.aggregate).mockResolvedValue({ _max: { sortOrder: null } } as any)
  vi.mocked(prisma.task.count).mockResolvedValue(0)
})

describe("GET /api/v1/task-types", () => {
  it("401 without org", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET(req("http://x/api/v1/task-types"))
    expect(res.status).toBe(401)
  })

  it("falls back to legacy 5 when org has none", async () => {
    const res = await GET(req("http://x/api/v1/task-types"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(5)
    expect(json.data.map((t: any) => t.name)).toContain("bug")
  })

  it("returns the org's own types when present", async () => {
    vi.mocked(prisma.taskType.findMany).mockResolvedValue([
      { id: "1", organizationId: "org-1", name: "seo", displayName: "SEO", color: "#111111", sortOrder: 0, isActive: true },
    ] as any)
    const res = await GET(req("http://x/api/v1/task-types"))
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].name).toBe("seo")
  })
})

describe("POST /api/v1/task-types", () => {
  it("derives a slug name from displayName and creates", async () => {
    vi.mocked(prisma.taskType.create).mockImplementation(async (args: any) => ({ id: "new", ...args.data }))
    const res = await POST(req("http://x/api/v1/task-types", {
      method: "POST", body: JSON.stringify({ displayName: "Social Media", color: "#abcdef" }),
    }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.data.name).toBe("social_media")
    expect(json.data.color).toBe("#abcdef")
  })

  it("transliterates an Azerbaijani label to a readable machine name", async () => {
    vi.mocked(prisma.taskType.create).mockImplementation(async (args: any) => ({ id: "new", ...args.data }))
    const res = await POST(req("http://x/api/v1/task-types", {
      method: "POST", body: JSON.stringify({ displayName: "Təchizat" }),
    }))
    const json = await res.json()
    expect(json.data.name).toBe("techizat")
  })

  it("folds the AZ dotted capital İ instead of producing a combining-mark slug", async () => {
    vi.mocked(prisma.taskType.create).mockImplementation(async (args: any) => ({ id: "new", ...args.data }))
    const res = await POST(req("http://x/api/v1/task-types", {
      method: "POST", body: JSON.stringify({ displayName: "İnzibati" }),
    }))
    const json = await res.json()
    expect(json.data.name).toBe("inzibati") // not "i_nzibati"
  })

  it("rejects a bad color", async () => {
    const res = await POST(req("http://x/api/v1/task-types", {
      method: "POST", body: JSON.stringify({ displayName: "X", color: "red" }),
    }))
    expect(res.status).toBe(400)
  })

  it("propagates auth errors", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any)
    const res = await POST(req("http://x/api/v1/task-types", {
      method: "POST", body: JSON.stringify({ displayName: "X" }),
    }))
    expect(res.status).toBe(403)
  })
})

describe("PATCH /api/v1/task-types (reorder)", () => {
  it("updates sortOrder for each item", async () => {
    const res = await PATCH(req("http://x/api/v1/task-types", {
      method: "PATCH", body: JSON.stringify([{ id: "a", sortOrder: 1 }, { id: "b", sortOrder: 0 }]),
    }))
    expect(res.status).toBe(200)
    expect(prisma.taskType.updateMany).toHaveBeenCalledTimes(2)
  })
})

describe("PUT/DELETE /api/v1/task-types/[id]", () => {
  it("404 when the type is not in the org", async () => {
    vi.mocked(prisma.taskType.findFirst).mockResolvedValue(null)
    const res = await PUT(req("http://x/api/v1/task-types/zzz", {
      method: "PUT", body: JSON.stringify({ displayName: "Y" }),
    }), params("zzz"))
    expect(res.status).toBe(404)
  })

  it("blocks delete while tasks still use the type", async () => {
    vi.mocked(prisma.taskType.findFirst).mockResolvedValue({ id: "1", organizationId: "org-1", name: "seo" } as any)
    vi.mocked(prisma.task.count).mockResolvedValue(3)
    const res = await DELETE(req("http://x/api/v1/task-types/1", { method: "DELETE" }), params("1"))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.taskCount).toBe(3)
    expect(prisma.taskType.delete).not.toHaveBeenCalled()
  })

  it("deletes when no task uses the type", async () => {
    vi.mocked(prisma.taskType.findFirst).mockResolvedValue({ id: "1", organizationId: "org-1", name: "seo" } as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)
    const res = await DELETE(req("http://x/api/v1/task-types/1", { method: "DELETE" }), params("1"))
    expect(res.status).toBe(200)
    expect(prisma.taskType.delete).toHaveBeenCalled()
  })
})

describe("isValidTaskType", () => {
  it("allows an empty/undefined type (optional field)", async () => {
    expect(await isValidTaskType("org-1", undefined)).toBe(true)
    expect(await isValidTaskType("org-1", "")).toBe(true)
    expect(prisma.taskType.findMany).not.toHaveBeenCalled()
  })

  it("matches an active configured type", async () => {
    vi.mocked(prisma.taskType.findMany).mockResolvedValue([{ name: "seo" }, { name: "social" }] as any)
    expect(await isValidTaskType("org-1", "seo")).toBe(true)
    expect(await isValidTaskType("org-1", "nope")).toBe(false)
  })

  it("falls back to the legacy 5 when the org has no types", async () => {
    vi.mocked(prisma.taskType.findMany).mockResolvedValue([])
    expect(await isValidTaskType("org-1", "bug")).toBe(true)
    expect(await isValidTaskType("org-1", "seo")).toBe(false)
  })

  it("still accepts a type that exists even after it is deactivated", async () => {
    // The helper queries WITHOUT an isActive filter, so a retired (isActive=false)
    // type that tasks still carry stays valid on PATCH.
    vi.mocked(prisma.taskType.findMany).mockResolvedValue([{ name: "retired" }] as any)
    expect(await isValidTaskType("org-1", "retired")).toBe(true)
    const where = vi.mocked(prisma.taskType.findMany).mock.calls[0][0] as any
    expect(where.where.isActive).toBeUndefined()
  })
})
