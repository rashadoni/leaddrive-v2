import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(),
  prisma: {
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pipeline: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    customField: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  orgHasModule: vi.fn().mockResolvedValue(true),
  moduleDisabledResponse: vi.fn((moduleId: string) =>
    NextResponse.json({ error: "Forbidden", message: `Module "${moduleId}" is not enabled.` }, { status: 403 })),
  isAuthError: vi.fn().mockImplementation((result: any) => result instanceof NextResponse),
}))

vi.mock("@/lib/plan-limits", () => ({
  checkUserLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-pw") },
}))

vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "USD",
  STAGE_COLORS: { LEAD: "#ccc" },
}))

import { GET as GET_USERS, POST as POST_USER } from "@/app/api/v1/users/route"
import { GET as GET_USER, PUT as PUT_USER, DELETE as DELETE_USER } from "@/app/api/v1/users/[id]/route"
import { GET as GET_PIPELINES, POST as POST_PIPELINE } from "@/app/api/v1/pipelines/route"
import { GET as GET_PIPELINE, PATCH as PATCH_PIPELINE, DELETE as DELETE_PIPELINE } from "@/app/api/v1/pipelines/[id]/route"
import { GET as GET_CUSTOM_FIELDS, POST as POST_CUSTOM_FIELD } from "@/app/api/v1/custom-fields/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { checkUserLimit } from "@/lib/plan-limits"

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as any
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  // pipelines GET/POST are getOrgId-only withRls handlers; default getSession to null
  // so withRls falls through to getOrgId (the requireAuth-based /users routes are unaffected).
  vi.mocked(getSession).mockResolvedValue(null as any)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin" } as any)
  vi.mocked(requireSessionAuth).mockResolvedValue({
    orgId: "org-1",
    userId: "user-1",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  })
  vi.mocked(checkUserLimit).mockResolvedValue({ allowed: true })
})

// ─── Users ──────────────────────────────────────────────────────────

describe("GET /api/v1/users", () => {
  it("returns 401 when requireAuth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    const res = await GET_USERS(makeReq("http://localhost/api/v1/users"))
    expect(res.status).toBe(401)
  })

  it("returns list of users ordered by name", async () => {
    const users = [{ id: "u1", name: "Alice", email: "alice@test.com" }]
    vi.mocked(prisma.user.findMany).mockResolvedValue(users as any)
    const res = await GET_USERS(makeReq("http://localhost/api/v1/users"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toEqual(users)
  })

  it("gives a Bearer read:users principal only the safe roster projection", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: "org-1",
      userId: "automation-owner",
      role: "admin",
      email: "",
      name: "API Key: roster",
      principalType: "api_key",
      scopes: ["read:users"],
    } as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([])

    const res = await GET_USERS(makeReq("http://localhost/api/v1/users", {
      headers: { authorization: "Bearer ld_roster_key" },
    }))

    expect(res.status).toBe(200)
    const select = vi.mocked(prisma.user.findMany).mock.calls.at(-1)![0].select
    for (const field of [
      "phone", "verifiedPhone", "totpEnabled", "require2fa",
      "smsAuthEnabled", "lastLogin", "passwordChangedAt", "loginCount",
    ]) {
      expect(select, `Bearer read:users must not receive ${field}`).not.toHaveProperty(field)
    }
    expect(select).toEqual(expect.objectContaining({ id: true, name: true, email: true }))
  })
})

describe("POST /api/v1/users", () => {
  it("returns 400 when required fields missing", async () => {
    const res = await POST_USER(makeReq("http://localhost/api/v1/users", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    }))
    expect(res.status).toBe(400)
  })

  it("returns 403 when plan limit exceeded", async () => {
    vi.mocked(checkUserLimit).mockResolvedValue({ allowed: false, message: "User limit reached" })
    const res = await POST_USER(makeReq("http://localhost/api/v1/users", {
      method: "POST",
      body: JSON.stringify({ name: "Bob", email: "bob@test.com", password: "SecurePass123!" }),
    }))
    expect(res.status).toBe(403)
  })

  it("returns 409 when email already exists", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "existing" } as any)
    const res = await POST_USER(makeReq("http://localhost/api/v1/users", {
      method: "POST",
      body: JSON.stringify({ name: "Bob", email: "bob@test.com", password: "SecurePass123!" }),
    }))
    expect(res.status).toBe(409)
  })

  it("creates user and returns 201", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "u2", name: "Bob", email: "bob@test.com" } as any)
    const res = await POST_USER(makeReq("http://localhost/api/v1/users", {
      method: "POST",
      body: JSON.stringify({ name: "Bob", email: "bob@test.com", password: "SecurePass123!" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.name).toBe("Bob")
  })
})

describe("GET /api/v1/users/[id]", () => {
  it("returns 401 without a browser session", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const res = await GET_USER(makeReq("http://localhost/api/v1/users/u1"), makeParams("u1"))

    expect(res.status).toBe(401)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 when user not found", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const res = await GET_USER(makeReq("http://localhost/api/v1/users/u1"), makeParams("u1"))
    expect(res.status).toBe(404)
  })
})

describe("PUT /api/v1/users/[id]", () => {
  it("returns 404 when user not found", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const res = await PUT_USER(
      makeReq("http://localhost/api/v1/users/u1", { method: "PUT", body: JSON.stringify({ name: "New" }) }),
      makeParams("u1"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 409 when changing to duplicate email", async () => {
    vi.mocked(prisma.user.findFirst)
      .mockResolvedValueOnce({ id: "u1", email: "old@test.com" } as any)
      .mockResolvedValueOnce({ id: "u2", email: "taken@test.com" } as any)
    const res = await PUT_USER(
      makeReq("http://localhost/api/v1/users/u1", { method: "PUT", body: JSON.stringify({ email: "taken@test.com" }) }),
      makeParams("u1"),
    )
    expect(res.status).toBe(409)
  })
})

describe("DELETE /api/v1/users/[id]", () => {
  it("anonymises the user instead of deleting the row", async () => {
    // Физического удаления здесь быть не может: четыре таблицы под триггером
    // «только добавление» ссылаются на пользователя через onDelete: SetNull,
    // и удаление обязано их обновить — триггер это отвергает.
    // Полный разбор в src/lib/user-anonymization.ts.
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1", anonymizedAt: null } as any)
    vi.mocked(prisma.user.update).mockResolvedValue({} as any)
    const res = await DELETE_USER(
      makeReq("http://localhost/api/v1/users/u1", { method: "DELETE" }),
      makeParams("u1"),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(prisma.user.delete).not.toHaveBeenCalled()
    expect(prisma.user.update).toHaveBeenCalledOnce()
  })

  it("reports an already anonymised user as not found", async () => {
    // Иначе повторное «удаление» затирало бы метку заново и выглядело как
    // успешная операция над тем, чего уже нет.
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1", anonymizedAt: new Date() } as any)
    const res = await DELETE_USER(
      makeReq("http://localhost/api/v1/users/u1", { method: "DELETE" }),
      makeParams("u1"),
    )
    expect(res.status).toBe(404)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})

// ─── Pipelines ──────────────────────────────────────────────────────

describe("GET /api/v1/pipelines", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_PIPELINES(makeReq("http://localhost/api/v1/pipelines"))
    expect(res.status).toBe(401)
  })

  it("returns pipelines with stages and deal counts", async () => {
    const pipelines = [{ id: "p1", name: "Sales", stages: [], _count: { deals: 3 } }]
    vi.mocked(prisma.pipeline.findMany).mockResolvedValue(pipelines as any)
    const res = await GET_PIPELINES(makeReq("http://localhost/api/v1/pipelines"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual(pipelines)
  })
})

describe("POST /api/v1/pipelines", () => {
  it("returns 400 for invalid name", async () => {
    const res = await POST_PIPELINE(makeReq("http://localhost/api/v1/pipelines", {
      method: "POST",
      body: JSON.stringify({}),
    }))
    expect(res.status).toBe(400)
  })

  it("creates pipeline and returns 201", async () => {
    vi.mocked(prisma.pipeline.create).mockResolvedValue({ id: "p1", name: "New Pipeline" } as any)
    const res = await POST_PIPELINE(makeReq("http://localhost/api/v1/pipelines", {
      method: "POST",
      body: JSON.stringify({ name: "New Pipeline" }),
    }))
    expect(res.status).toBe(201)
  })
})

describe("DELETE /api/v1/pipelines/[id]", () => {
  it("returns 400 when pipeline has deals", async () => {
    vi.mocked(prisma.pipeline.findFirst).mockResolvedValue({ id: "p1", isDefault: false, _count: { deals: 5 } } as any)
    const res = await DELETE_PIPELINE(
      makeReq("http://localhost/api/v1/pipelines/p1", { method: "DELETE" }),
      makeParams("p1"),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when deleting default pipeline", async () => {
    vi.mocked(prisma.pipeline.findFirst).mockResolvedValue({ id: "p1", isDefault: true, _count: { deals: 0 } } as any)
    const res = await DELETE_PIPELINE(
      makeReq("http://localhost/api/v1/pipelines/p1", { method: "DELETE" }),
      makeParams("p1"),
    )
    expect(res.status).toBe(400)
  })
})

// ─── Custom Fields ──────────────────────────────────────────────────

describe("GET /api/v1/custom-fields", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET_CUSTOM_FIELDS(makeReq("http://localhost/api/v1/custom-fields"))
    expect(res.status).toBe(401)
  })

  it("returns fields filtered by entityType", async () => {
    const fields = [{ id: "f1", fieldName: "color", entityType: "deal" }]
    vi.mocked(prisma.customField.findMany).mockResolvedValue(fields as any)
    const res = await GET_CUSTOM_FIELDS(makeReq("http://localhost/api/v1/custom-fields?entityType=deal"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual(fields)
  })
})

describe("POST /api/v1/custom-fields", () => {
  it("returns 400 for missing required fields", async () => {
    const res = await POST_CUSTOM_FIELD(makeReq("http://localhost/api/v1/custom-fields", {
      method: "POST",
      body: JSON.stringify({ entityType: "deal" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates custom field and returns 201", async () => {
    const field = { id: "f1", entityType: "deal", fieldName: "color", fieldLabel: "Color", fieldType: "text" }
    vi.mocked(prisma.customField.create).mockResolvedValue(field as any)
    const res = await POST_CUSTOM_FIELD(makeReq("http://localhost/api/v1/custom-fields", {
      method: "POST",
      body: JSON.stringify({ entityType: "deal", fieldName: "color", fieldLabel: "Color", fieldType: "text" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.fieldName).toBe("color")
  })
})
