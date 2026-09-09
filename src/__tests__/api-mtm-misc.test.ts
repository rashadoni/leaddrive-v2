import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Make audit + task findFirst available globally for new audit calls
vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v: any) => v && v.status >= 400),
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-pw"), compare: vi.fn() },
}))

vi.mock("jsonwebtoken", () => ({
  default: { sign: vi.fn().mockReturnValue("mock-jwt-token") },
}))

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimit: vi.fn(),
}))

vi.mock("@/lib/request-ip", () => ({
  clientIp: vi.fn(() => "203.0.113.10"),
}))

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

import { GET as ListCustomers, POST as CreateCustomer } from "@/app/api/v1/mtm/customers/route"
import { GET as GetCustomer, PUT as UpdateCustomer, DELETE as DeleteCustomer } from "@/app/api/v1/mtm/customers/[id]/route"
import { GET as ListTasks, POST as CreateTask } from "@/app/api/v1/mtm/tasks/route"
import { PUT as UpdateTask, DELETE as DeleteTask } from "@/app/api/v1/mtm/tasks/[id]/route"
import { GET as ListPhotos } from "@/app/api/v1/mtm/photos/route"
import { GET as ListAlerts } from "@/app/api/v1/mtm/alerts/route"
import { GET as GetSettings, PUT as UpdateSettings } from "@/app/api/v1/mtm/settings/route"
import { POST as MobileAuth } from "@/app/api/v1/mtm/mobile/auth/route"
import { GET as MobilePing } from "@/app/api/v1/mtm/mobile/ping/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"

const ORG = "org-1"
const MOBILE_ORG = {
  id: ORG,
  name: "Test Org",
  isActive: true,
  plan: "starter",
  addons: [],
  features: ["mtm"],
  modules: { mtm: true },
}

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

function makeJsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consumePublicRateLimit).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    role: "admin",
    userId: "admin-user",
    email: "admin@example.com",
    name: "Admin",
  } as never)
})

// ─── GET /api/v1/mtm/customers ─────────────────────────────
describe("GET /api/v1/mtm/customers", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } },
    ) as never)
    const res = await ListCustomers(makeReq("/api/v1/mtm/customers"))
    expect(res.status).toBe(401)
  })

  it("returns paginated customers", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "c1", name: "Shop A" }] as any)
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(1)

    const res = await ListCustomers(makeReq("/api/v1/mtm/customers"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.customers).toHaveLength(1)
    expect(json.data.total).toBe(1)
  })

  it("filters by search, category, and status", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmCustomer.count).mockResolvedValue(0)

    await ListCustomers(makeReq("/api/v1/mtm/customers?search=shop&category=A&status=ACTIVE"))

    const callArgs = vi.mocked(prisma.mtmCustomer.findMany).mock.calls[0][0] as any
    expect(callArgs.where.OR.map((condition: Record<string, unknown>) => Object.keys(condition)[0])).toEqual([
      "name",
      "code",
      "address",
      "city",
      "district",
      "territoryCode",
      "phone",
      "contactPerson",
    ])
    expect(callArgs.where.category).toBe("A")
    expect(callArgs.where.status).toBe("ACTIVE")
  })
})

// ─── POST /api/v1/mtm/customers ────────────────────────────
describe("POST /api/v1/mtm/customers", () => {
  it("creates customer and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.create).mockResolvedValue({ id: "c-new", name: "New Shop" } as any)

    const body = { name: "New Shop", category: "A", address: "Main St", latitude: "40.1", longitude: "49.8" }
    const res = await CreateCustomer(makeJsonReq("/api/v1/mtm/customers", "POST", body))
    expect(res.status).toBe(201)

    const createArgs = vi.mocked(prisma.mtmCustomer.create).mock.calls[0][0] as any
    expect(createArgs.data.organizationId).toBe(ORG)
    expect(createArgs.data.latitude).toBe(40.1)
    expect(createArgs.data.longitude).toBe(49.8)
  })

  it("stores Null Island (0,0) as unknown coordinates (audit A1)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.create).mockResolvedValue({ id: "c-new", name: "Ocean Shop" } as any)

    const res = await CreateCustomer(makeJsonReq("/api/v1/mtm/customers", "POST", { name: "Ocean Shop", latitude: 0, longitude: 0 }))
    expect(res.status).toBe(201)

    const createArgs = vi.mocked(prisma.mtmCustomer.create).mock.calls[0][0] as any
    expect(createArgs.data.latitude).toBeNull()
    expect(createArgs.data.longitude).toBeNull()
  })

  it("treats untouched form inputs (empty strings) as unknown coordinates (audit A1)", async () => {
    // The web customer form posts "" for empty fields; coercing that to 0 was
    // the origin of the customers at Null Island.
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.create).mockResolvedValue({ id: "c-new", name: "Blank Shop" } as any)

    const res = await CreateCustomer(makeJsonReq("/api/v1/mtm/customers", "POST", { name: "Blank Shop", latitude: "", longitude: "" }))
    expect(res.status).toBe(201)

    const createArgs = vi.mocked(prisma.mtmCustomer.create).mock.calls[0][0] as any
    expect(createArgs.data.latitude).toBeNull()
    expect(createArgs.data.longitude).toBeNull()
  })

  it("rejects a half coordinate pair instead of storing it (audit A1)", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)

    const res = await CreateCustomer(makeJsonReq("/api/v1/mtm/customers", "POST", { name: "Half Shop", latitude: 40.1 }))
    expect(res.status).toBe(400)
    expect(prisma.mtmCustomer.create).not.toHaveBeenCalled()
  })

  it("returns 400 on create failure", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.create).mockRejectedValue(new Error("Validation error"))

    const res = await CreateCustomer(makeJsonReq("/api/v1/mtm/customers", "POST", { name: "X" }))
    expect(res.status).toBe(400)
  })

  it("requires field agents to use the approval workflow", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      role: "sales",
      userId: "agent-user",
      email: "agent@example.com",
      name: "Agent",
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as never)

    const res = await CreateCustomer(makeJsonReq("/api/v1/mtm/customers", "POST", { name: "Direct customer" }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "CUSTOMER_APPROVAL_REQUIRED" })
    expect(prisma.mtmCustomer.create).not.toHaveBeenCalled()
  })
})

// ─── GET /api/v1/mtm/customers/[id] ────────────────────────
describe("GET /api/v1/mtm/customers/[id]", () => {
  it("returns 404 when not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)

    const res = await GetCustomer(makeReq("/api/v1/mtm/customers/c1"), makeParams("c1"))
    expect(res.status).toBe(404)
  })

  it("returns customer data", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "c1", name: "Shop A" } as any)

    const res = await GetCustomer(makeReq("/api/v1/mtm/customers/c1"), makeParams("c1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Shop A")
  })
})

// ─── PUT /api/v1/mtm/customers/[id] ────────────────────────
describe("PUT /api/v1/mtm/customers/[id]", () => {
  it("returns 404 when not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.updateMany).mockResolvedValue({ count: 0 })

    const res = await UpdateCustomer(
      makeJsonReq("/api/v1/mtm/customers/c1", "PUT", { name: "Updated" }),
      makeParams("c1")
    )
    expect(res.status).toBe(404)
  })

  it("updates customer successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.updateMany).mockResolvedValue({ count: 1 })

    const res = await UpdateCustomer(
      makeJsonReq("/api/v1/mtm/customers/c1", "PUT", { name: "Updated", category: "A" }),
      makeParams("c1")
    )
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ─── DELETE /api/v1/mtm/customers/[id] ─────────────────────
describe("DELETE /api/v1/mtm/customers/[id]", () => {
  it("returns 404 when not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    // M2-1d soft-delete: customer DELETE uses updateMany (sets deletedAt),
    // not physical deleteMany. 404 path now keys on updateMany.count === 0.
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmCustomer.updateMany).mockResolvedValue({ count: 0 })

    const res = await DeleteCustomer(makeReq("/api/v1/mtm/customers/c1"), makeParams("c1"))
    expect(res.status).toBe(404)
  })

  it("deletes customer successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "c1", name: "Cust", code: "C-1" } as any)
    vi.mocked(prisma.mtmCustomer.updateMany).mockResolvedValue({ count: 1 })

    const res = await DeleteCustomer(makeReq("/api/v1/mtm/customers/c1"), makeParams("c1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ─── GET /api/v1/mtm/tasks ─────────────────────────────────
describe("GET /api/v1/mtm/tasks", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } },
    ) as never)
    const res = await ListTasks(makeReq("/api/v1/mtm/tasks"))
    expect(res.status).toBe(401)
  })

  it("returns paginated tasks with filters", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([{ id: "t1", title: "Task 1" }] as any)
    vi.mocked(prisma.mtmTask.count).mockResolvedValue(1)

    const res = await ListTasks(makeReq("/api/v1/mtm/tasks?agentId=a1&status=PENDING&priority=URGENT"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.tasks).toHaveLength(1)

    const callArgs = vi.mocked(prisma.mtmTask.findMany).mock.calls[0][0] as any
    expect(callArgs.where.AND).toContainEqual({ agentId: "a1" })
    expect(callArgs.where.status).toBe("PENDING")
    expect(callArgs.where.priority).toBe("URGENT")
  })
})

// ─── POST /api/v1/mtm/tasks ────────────────────────────────
describe("POST /api/v1/mtm/tasks", () => {
  it("creates task and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmTask.create).mockResolvedValue({ id: "t-new" } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "a1" } as any)

    const body = { agentId: "a1", title: "Visit shop", priority: "HIGH", dueDate: "2026-04-15" }
    const res = await CreateTask(makeJsonReq("/api/v1/mtm/tasks", "POST", body))
    expect(res.status).toBe(201)

    const createArgs = vi.mocked(prisma.mtmTask.create).mock.calls[0][0] as any
    expect(createArgs.data.organizationId).toBe(ORG)
    expect(createArgs.data.agentId).toBe("a1")
    expect(createArgs.data.priority).toBe("HIGH")
    expect(createArgs.data.dueDate).toEqual(new Date("2026-04-15"))
  })
})

// ─── PUT /api/v1/mtm/tasks/[id] ────────────────────────────
describe("PUT /api/v1/mtm/tasks/[id]", () => {
  it("returns 404 when task not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 0 })

    const res = await UpdateTask(
      makeJsonReq("/api/v1/mtm/tasks/t1", "PUT", { title: "X", agentId: "a1", expectedVersion: 1 }),
      makeParams("t1")
    )
    expect(res.status).toBe(404)
  })

  it("requires managers to use the review workflow for status changes", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "t1", title: "Done", status: "PENDING", agentId: "a1", priority: "MEDIUM", customerId: null, visitId: null, version: 1 } as any)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 })

    await UpdateTask(
      makeJsonReq("/api/v1/mtm/tasks/t1", "PUT", { status: "COMPLETED", expectedVersion: 1 }),
      makeParams("t1")
    )

    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })
})

// ─── DELETE /api/v1/mtm/tasks/[id] ─────────────────────────
describe("DELETE /api/v1/mtm/tasks/[id]", () => {
  it("deletes task successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "t1", agentId: "a1", status: "PENDING", version: 1 } as any)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 })

    const res = await DeleteTask(makeReq("/api/v1/mtm/tasks/t1?expectedVersion=1"), makeParams("t1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ─── GET /api/v1/mtm/photos ────────────────────────────────
describe("GET /api/v1/mtm/photos", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const res = await ListPhotos(makeReq("/api/v1/mtm/photos"))
    expect(res.status).toBe(401)
  })

  it("returns paginated photos with filters", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmPhoto.findMany).mockResolvedValue([{ id: "p1", url: "/img.jpg" }] as any)
    vi.mocked(prisma.mtmPhoto.count).mockResolvedValue(1)

    const res = await ListPhotos(makeReq("/api/v1/mtm/photos?agentId=a1&status=APPROVED"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.photos).toHaveLength(1)

    const callArgs = vi.mocked(prisma.mtmPhoto.findMany).mock.calls[0][0] as any
    expect(callArgs.where.agentId).toBe("a1")
    expect(callArgs.where.status).toBe("APPROVED")
  })
})

// ─── GET /api/v1/mtm/alerts ────────────────────────────────
describe("GET /api/v1/mtm/alerts", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }) as never)
    const res = await ListAlerts(makeReq("/api/v1/mtm/alerts"))
    expect(res.status).toBe(401)
  })

  it("returns alerts filtered by resolved and type", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmAlert.findMany).mockResolvedValue([{ id: "al1", type: "GPS_SPOOF" }] as any)
    vi.mocked(prisma.mtmAlert.count).mockResolvedValue(1)

    const res = await ListAlerts(makeReq("/api/v1/mtm/alerts?resolved=false&type=GPS_SPOOF"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.alerts).toHaveLength(1)

    const callArgs = vi.mocked(prisma.mtmAlert.findMany).mock.calls[0][0] as any
    expect(callArgs.where.isResolved).toBe(false)
    expect(callArgs.where.type).toBe("GPS_SPOOF")
  })
})

// ─── GET /api/v1/mtm/settings ──────────────────────────────
describe("GET /api/v1/mtm/settings", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GetSettings(makeReq("/api/v1/mtm/settings"))
    expect(res.status).toBe(401)
  })

  it("returns merged settings with defaults", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "gpsInterval", value: 60 },
      { key: "geofenceRadius", value: 200 },
    ] as any)

    const res = await GetSettings(makeReq("/api/v1/mtm/settings"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.gpsInterval).toBe(60)
    expect(json.data.geofenceRadius).toBe(200)
    // photoRequired default flipped to false when enforcement landed —
    // it was never enforced before, so `false` preserves actual behavior
    // and orgs now opt IN explicitly (honest-settings redesign).
    expect(json.data.photoRequired).toBe(false) // default preserved
    // decorative keys are gone from the schema entirely
    expect(json.data.alertGpsSpoofing).toBeUndefined()
    expect(json.data.workingHoursStart).toBeUndefined()
    // and the real alert toggles took their place
    expect(json.data.alertOutOfZone).toBe(true)
    expect(json.data.alertLongBreak).toBe(true)
    expect(json.data.timezone).toBe("Asia/Baku")
    expect(json.data.supportEmail).toBe("")
    expect(json.data.supportPhone).toBe("")
    expect(json.data.teamScheduleVisibilityEnabled).toBe(false)
    expect(json.data.taskSelfCreate).toBe(true)
    expect(json.data.taskSelfRecurring).toBe(true)
  })
})

// ─── PUT /api/v1/mtm/settings ──────────────────────────────
describe("PUT /api/v1/mtm/settings", () => {
  it("upserts settings keys", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role: "admin", userId: "u1" } as any)
    vi.mocked(prisma.mtmSetting.upsert).mockResolvedValue({} as any)

    const body = { gpsInterval: 15, photoRequired: false, taskSelfCreate: false }
    const res = await UpdateSettings(makeJsonReq("/api/v1/mtm/settings", "PUT", body))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.mtmSetting.upsert).toHaveBeenCalledTimes(3)
  })

  it("rejects an invalid route timezone", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role: "admin", userId: "u1" } as any)

    const res = await UpdateSettings(makeJsonReq("/api/v1/mtm/settings", "PUT", { timezone: "Baku/Invalid" }))

    expect(res.status).toBe(400)
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })

  it("rejects a non-boolean team schedule visibility policy", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role: "admin", userId: "u1" } as any)

    const res = await UpdateSettings(makeJsonReq(
      "/api/v1/mtm/settings",
      "PUT",
      { teamScheduleVisibilityEnabled: "yes" },
    ))

    expect(res.status).toBe(400)
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })

  it("validates and trims tenant support contacts", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role: "admin", userId: "u1" } as any)
    vi.mocked(prisma.mtmSetting.upsert).mockResolvedValue({} as any)

    const res = await UpdateSettings(makeJsonReq("/api/v1/mtm/settings", "PUT", {
      supportEmail: " support@swissmed.example ",
      supportPhone: " +994 12 555 01 01 ",
    }))

    expect(res.status).toBe(200)
    expect(prisma.mtmSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ key: "supportEmail", value: "support@swissmed.example" }),
    }))
    expect(prisma.mtmSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ key: "supportPhone", value: "+994 12 555 01 01" }),
    }))
  })

  it("rejects an invalid tenant support email", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role: "admin", userId: "u1" } as any)

    const res = await UpdateSettings(makeJsonReq("/api/v1/mtm/settings", "PUT", {
      supportEmail: "not-an-email",
    }))

    expect(res.status).toBe(400)
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })
})

// ─── POST /api/v1/mtm/mobile/auth ──────────────────────────
describe("POST /api/v1/mtm/mobile/auth", () => {
  it("returns 400 when email or password missing", async () => {
    const res = await MobileAuth(makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "x@test.com" }))
    expect(res.status).toBe(400)
  })

  it.each([
    { email: { nested: "agent@test.com" }, password: "secret" },
    { email: "not-an-email", password: "secret" },
    { email: "agent@test.com", password: "x".repeat(1025) },
    { email: "agent@test.com", password: "secret", organizationSlug: "../foreign" },
  ])("rejects malformed bounded login input before rate limiting: %j", async (body) => {
    const res = await MobileAuth(makeJsonReq("/api/v1/mtm/mobile/auth", "POST", body))

    expect(res.status).toBe(400)
    expect(consumePublicRateLimit).not.toHaveBeenCalled()
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
  })

  it("returns 401 when agent not found", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)

    const res = await MobileAuth(
      makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "ghost@test.com", password: "pw" })
    )
    expect(res.status).toBe(401)
  })

  it("never resolves a mobile login through an inactive organization", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)

    const res = await MobileAuth(
      makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "agent@test.com", password: "pw" }),
    )

    expect(res.status).toBe(401)
    expect(prisma.mtmAgent.findFirst).toHaveBeenCalledWith({
      where: {
        email: "agent@test.com",
        status: "ACTIVE",
        organization: { isActive: true },
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            isActive: true,
            plan: true,
            addons: true,
            features: true,
            modules: true,
          },
        },
      },
    })
    expect(jwt.sign).not.toHaveBeenCalled()
  })

  it("returns 429 when the distributed principal budget is exhausted", async () => {
    vi.mocked(consumePublicRateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, unavailable: false })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 37, unavailable: false })

    const res = await MobileAuth(
      makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "agent@test.com", password: "guess" }),
    )

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("37")
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
  })

  it("authenticates via agent passwordHash and returns JWT", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      name: "Agent",
      email: "agent@test.com",
      phone: null,
      role: "AGENT",
      avatar: null,
      passwordHash: "hashed",
      userId: null,
      organizationId: ORG,
      organization: MOBILE_ORG,
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
    vi.mocked(prisma.mtmAgent.update).mockResolvedValue({} as any)

    const res = await MobileAuth(
      makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "agent@test.com", password: "secret" })
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.token).toBe("mock-jwt-token")
    expect(json.data.agent.id).toBe("a1")
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionFingerprint: expect.any(String),
        userSessionFingerprint: undefined,
      }),
      expect.any(String),
      { expiresIn: "7d" },
    )
    const tokenPayload = vi.mocked(jwt.sign).mock.calls[0][0] as Record<string, unknown>
    expect(tokenPayload.agentSessionFingerprint).not.toBe("hashed")
    expect(JSON.stringify(tokenPayload)).not.toContain('"passwordHash"')
  })

  it("does not issue a field JWT when both tenant products are disabled", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a-neither",
      name: "No Mobile Product",
      email: "neither@test.com",
      phone: null,
      role: "AGENT",
      avatar: null,
      passwordHash: "hashed",
      userId: null,
      organizationId: ORG,
      organization: {
        ...MOBILE_ORG,
        features: [],
        modules: { mtm: false, "workforce-hrm": false },
      },
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)

    const response = await MobileAuth(
      makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "neither@test.com", password: "secret" }),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "mobile-field-app",
    })
    expect(jwt.sign).not.toHaveBeenCalled()
  })

  it("does not auto-link a CRM user when both tenant products are disabled", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a-neither-unlinked",
      name: "No Mobile Product",
      email: "neither-unlinked@test.com",
      phone: null,
      role: "AGENT",
      avatar: null,
      passwordHash: null,
      userId: null,
      organizationId: ORG,
      organization: {
        ...MOBILE_ORG,
        features: [],
        modules: { mtm: false, "workforce-hrm": false },
      },
    } as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "user-neither",
      passwordHash: "crm-hash",
      passwordChangedAt: null,
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)

    const response = await MobileAuth(makeJsonReq("/api/v1/mtm/mobile/auth", "POST", {
      email: "neither-unlinked@test.com",
      password: "secret",
    }))

    expect(response.status).toBe(403)
    expect(prisma.mtmAgent.update).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "AUTO_LINK" }),
    }))
    expect(jwt.sign).not.toHaveBeenCalled()
  })

  it("binds a linked-agent mobile token to the CRM user's credential state", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a-linked",
      name: "Linked Agent",
      email: "linked-agent@test.com",
      phone: null,
      role: "AGENT",
      avatar: null,
      passwordHash: "agent-hash",
      userId: "user-linked",
      organizationId: ORG,
      organization: MOBILE_ORG,
    } as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "user-linked",
      passwordHash: "crm-user-hash",
      passwordChangedAt: new Date("2026-08-11T12:00:00.123Z"),
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
    vi.mocked(prisma.mtmAgent.update).mockResolvedValue({} as any)

    const res = await MobileAuth(
      makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "linked-agent@test.com", password: "secret" }),
    )
    const tokenPayload = vi.mocked(jwt.sign).mock.calls[0][0] as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(tokenPayload.agentSessionFingerprint).toEqual(expect.any(String))
    expect(tokenPayload.userSessionFingerprint).toEqual(expect.any(String))
    expect(JSON.stringify(tokenPayload)).not.toContain("crm-user-hash")
  })

  it("never verifies a linked CRM user outside the agent tenant", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a-linked",
      name: "Linked Agent",
      email: "linked-agent@test.com",
      passwordHash: "agent-hash",
      userId: "foreign-user",
      organizationId: ORG,
      organization: MOBILE_ORG,
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

    const res = await MobileAuth(
      makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "linked-agent@test.com", password: "guess" }),
    )

    expect(res.status).toBe(401)
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-user", organizationId: ORG, isActive: true },
      select: { id: true, passwordHash: true, passwordChangedAt: true, isActive: true },
    })
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(jwt.sign).not.toHaveBeenCalled()
  })

  it("returns 401 on wrong password", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      passwordHash: "hashed",
      userId: null,
      organizationId: ORG,
      organization: { id: ORG, name: "Org" },
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never)

    const res = await MobileAuth(
      makeJsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "a@test.com", password: "wrong" })
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("Invalid email or password")
  })
})

// ─── GET /api/v1/mtm/mobile/ping ───────────────────────────
describe("GET /api/v1/mtm/mobile/ping", () => {
  it("answers anonymous server discovery without metadata", async () => {
    const res = await MobilePing()
    const json = await res.json()
    expect(json).toEqual({ success: true, data: {} })
  })

  // The endpoint is anonymous — the mobile ServerScreen calls it before login.
  // It therefore may not read a tenant row: it used to return the oldest
  // organization's name, which the 2026-08 penetration re-test reported as
  // information disclosure. Asserting on the query, not just the body, is what
  // stops the convenience of "show the org name here" from creeping back.
  it("does not touch the database at all", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ name: "Acme Corp" } as any)

    const res = await MobilePing()
    const json = await res.json()

    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
    expect(JSON.stringify(json)).not.toContain("Acme Corp")
  })
})
