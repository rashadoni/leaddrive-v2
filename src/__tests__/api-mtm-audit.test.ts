/**
 * Audit log regression suite — ensures every CRUD MTM endpoint writes a
 * MtmAuditLog entry with the correct action, entity, and metadataKind.
 *
 * Why: F-08 / F-16 / F-17 added writeMtmAudit calls across ~13 endpoints.
 * Production code is correct today; this suite locks the contract so a
 * future refactor cannot silently drop an audit write.
 *
 * Strategy: mock `@/lib/mtm-audit` so we assert on the call signature
 * directly (action, entity, metadataKind, oldData/newData shape) without
 * coupling to writeMtmAudit's internals (Prisma create + IP extraction).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Factory covers mtmPhoto.count default (resolves 0) which the M3-5b
// burst-detection path in POST /photos relies on — without it the
// fire-and-forget `.then(...)` rejects and crashes the route handler.
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

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
  // Audit-channel constants used by POST /photos (M1-2 watermark + M3-5a
  // GPS anomaly + M3-5b burst). The route imports them as named
  // exports — partial mocks must re-export every consumed constant or
  // vitest blows up at first access (see CI failure 2026-05-21T18:45).
  PHOTO_TAMPER_DETECTED: "PHOTO_TAMPER_DETECTED",
  PHOTO_GPS_VS_CUSTOMER_MISMATCH: "PHOTO_GPS_VS_CUSTOMER_MISMATCH",
  PHOTO_ANOMALY_CHECK_FAILED: "PHOTO_ANOMALY_CHECK_FAILED",
  PHOTO_BURST_SUSPICIOUS: "PHOTO_BURST_SUSPICIOUS",
}))

vi.mock("@/lib/mtm-notify", () => ({
  notifyAgent: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/geo-utils", () => ({
  calculateDistance: vi.fn(() => 600), // forces "out of zone" branch when needed
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async (s: string) => s),
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-pw"), compare: vi.fn() },
}))

vi.mock("jsonwebtoken", () => ({
  default: { sign: vi.fn().mockReturnValue("mock-jwt-token") },
}))

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

// F-39: HEIC→JPEG converter. Mocked here so the test asserts the route's
// branching, not the real (slow) WASM decode.
vi.mock("heic-convert", () => ({
  default: vi.fn(async () => {
    // Return a JPEG magic-bytes buffer wrapped as ArrayBuffer (route
    // doesn't validate the output, just writes it).
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    return jpg.buffer
  }),
}))

import { POST as CreateAgent } from "@/app/api/v1/mtm/agents/route"
import { PUT as UpdateAgent, DELETE as DeleteAgent } from "@/app/api/v1/mtm/agents/[id]/route"
import { POST as CreateCustomer } from "@/app/api/v1/mtm/customers/route"
import { PUT as UpdateCustomer, DELETE as DeleteCustomer } from "@/app/api/v1/mtm/customers/[id]/route"
import { POST as CreateRoute } from "@/app/api/v1/mtm/routes/route"
import { PUT as UpdateRoute, DELETE as DeleteRoute } from "@/app/api/v1/mtm/routes/[id]/route"
import { POST as CreateTask } from "@/app/api/v1/mtm/tasks/route"
import { PUT as UpdateTask, DELETE as DeleteTask } from "@/app/api/v1/mtm/tasks/[id]/route"
import { POST as UploadPhoto } from "@/app/api/v1/mtm/photos/route"
import { PATCH as ReviewPhoto, DELETE as DeletePhoto } from "@/app/api/v1/mtm/photos/[id]/route"
import { PATCH as UpdateAlert, DELETE as DeleteAlert } from "@/app/api/v1/mtm/alerts/[id]/route"
import { POST as CreateVisit } from "@/app/api/v1/mtm/visits/route"
import { PUT as UpdateVisit, DELETE as DeleteVisit } from "@/app/api/v1/mtm/visits/[id]/route"
import { PUT as UpdateSettings } from "@/app/api/v1/mtm/settings/route"
import { POST as MobileAuth } from "@/app/api/v1/mtm/mobile/auth/route"

import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth } from "@/lib/api-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import bcrypt from "bcryptjs"

const ORG = "org-1"
const MOBILE_ORG = {
  id: ORG,
  name: "Org",
  isActive: true,
  plan: "starter",
  addons: [],
  features: ["mtm"],
  modules: { mtm: true },
}

function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function plainReq(url: string, method = "DELETE"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method })
}

function pp(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(getSession).mockResolvedValue({
    orgId: ORG,
    role: "admin",
    userId: "admin-user",
    email: "admin@example.com",
    name: "Admin",
  } as any)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    role: "admin",
    userId: "admin-user",
    email: "admin@example.com",
    name: "Admin",
  } as any)
  vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as any)
  // Reset writeMtmAudit to a happy mock — clearAllMocks wipes the implementation.
  vi.mocked(writeMtmAudit).mockResolvedValue(undefined as never)
})

// ═══════════════════════════════════════════════════════════════════════════
// AGENTS — F-08 admin actions
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: agents", () => {
  it("AGENT_CREATE on POST /agents", async () => {
    vi.mocked(prisma.mtmAgent.create).mockResolvedValue({ id: "a1", name: "John", email: "j@t.com", role: "AGENT" } as any)
    await CreateAgent(jsonReq("/api/v1/mtm/agents", "POST", { name: "John", email: "j@t.com", password: "AgentSecret123!" }))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        action: "AGENT_CREATE",
        entity: "agent",
        entityId: "a1",
        metadataKind: "agent_create",
        newData: expect.objectContaining({ name: "John", email: "j@t.com", role: "AGENT" }),
      })
    )
  })

  it("AGENT_UPDATE on PUT /agents/[id] with redacted password", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "a1", name: "John", email: "j@t.com", role: "AGENT", status: "ACTIVE", managerId: null } as any)
    vi.mocked(prisma.mtmAgent.updateMany).mockResolvedValue({ count: 1 } as any)
    await UpdateAgent(jsonReq("/api/v1/mtm/agents/a1", "PUT", { name: "John Jr", password: "NewAgentSecret456!" }), pp("a1"))
    const call = vi.mocked(writeMtmAudit).mock.calls[0][0]
    expect(call.action).toBe("AGENT_UPDATE")
    expect(call.entity).toBe("agent")
    expect(call.entityId).toBe("a1")
    expect(call.metadataKind).toBe("agent_update")
    expect(call.oldData).toMatchObject({ id: "a1", name: "John" })
    // sanitization: passwordHash MUST NOT leak — handler maps it to "[redacted]"
    expect((call.newData as any).passwordHash).toBe("[redacted]")
  })

  it("AGENT_DELETE on DELETE /agents/[id]", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "a1", name: "John", email: "j@t.com", role: "AGENT" } as any)
    vi.mocked(prisma.mtmAgent.deleteMany).mockResolvedValue({ count: 1 } as any)
    await DeleteAgent(plainReq("/api/v1/mtm/agents/a1"), pp("a1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AGENT_DELETE", entity: "agent", entityId: "a1", metadataKind: "agent_delete" })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: customers", () => {
  it("CUSTOMER_CREATE on POST /customers", async () => {
    vi.mocked(prisma.mtmCustomer.create).mockResolvedValue({ id: "c1", name: "Shop", code: "C-001", category: "A" } as any)
    await CreateCustomer(jsonReq("/api/v1/mtm/customers", "POST", { name: "Shop", code: "C-001", category: "A" }))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CUSTOMER_CREATE", entity: "customer", entityId: "c1", metadataKind: "customer_create" })
    )
  })

  it("CUSTOMER_UPDATE on PUT /customers/[id]", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "c1", name: "Old", code: "C-001", category: "A", status: "ACTIVE", geofenceRadius: null } as any)
    vi.mocked(prisma.mtmCustomer.updateMany).mockResolvedValue({ count: 1 } as any)
    await UpdateCustomer(jsonReq("/api/v1/mtm/customers/c1", "PUT", { name: "New" }), pp("c1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CUSTOMER_UPDATE", entity: "customer", entityId: "c1", metadataKind: "customer_update" })
    )
  })

  it("CUSTOMER_DELETE on DELETE /customers/[id]", async () => {
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "c1", name: "Shop", code: "C-001" } as any)
    vi.mocked(prisma.mtmCustomer.deleteMany).mockResolvedValue({ count: 1 } as any)
    await DeleteCustomer(plainReq("/api/v1/mtm/customers/c1"), pp("c1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CUSTOMER_DELETE", entity: "customer", entityId: "c1", metadataKind: "customer_delete" })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: routes", () => {
  it("ROUTE_CREATE on POST /routes", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-cuid-1" }] as any)
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmRoute.create).mockResolvedValue({ id: "r1", totalPoints: 0 } as any)
    await CreateRoute(
      jsonReq("/api/v1/mtm/routes", "POST", { agentId: "agent-cuid-1", date: "2026-05-13", name: "Route A" })
    )
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ROUTE_CREATE", entity: "route", entityId: "r1", metadataKind: "route_create" })
    )
  })

  it("ROUTE_UPDATE on PUT /routes/[id]", async () => {
    vi.mocked(prisma.mtmRoute.findFirst)
      .mockResolvedValueOnce({
        id: "r1",
        agentId: "agent-cuid-1",
        date: new Date("2026-05-13"),
        status: "DRAFT",
        version: 1,
        updatedAt: new Date("2026-05-12T12:00:00.000Z"),
        totalPoints: 3,
        assignments: [{ agentId: "agent-cuid-1", role: "PRIMARY" }],
        points: [],
      } as any)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-cuid-1" }] as any)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as any)
    await UpdateRoute(jsonReq("/api/v1/mtm/routes/r1", "PUT", {
      expectedVersion: 1,
      notes: "Updated notes",
    }), pp("r1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ROUTE_UPDATE", entity: "route", entityId: "r1", metadataKind: "route_update" })
    )
  })

  it("ROUTE_DELETE on DELETE /routes/[id]", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue({
      id: "r1",
      agentId: "agent-cuid-1",
      date: new Date(),
      status: "DRAFT",
      assignments: [{ agentId: "agent-cuid-1" }],
    } as any)
    // M2-1d soft-delete: handler uses updateMany (sets deletedAt), not deleteMany.
    vi.mocked(prisma.mtmRoutePoint.updateMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prisma.mtmRoute.updateMany).mockResolvedValue({ count: 1 } as any)
    await DeleteRoute(plainReq("/api/v1/mtm/routes/r1"), pp("r1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ROUTE_DELETE", entity: "route", entityId: "r1", metadataKind: "route_delete" })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TASKS — TASK_COMPLETE has separate semantic action
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: tasks", () => {
  it("TASK_CREATE on POST /tasks", async () => {
    vi.mocked(prisma.mtmTask.create).mockResolvedValue({ id: "t1", title: "Visit", priority: "MEDIUM", customerId: null } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-cuid-1" } as any)
    await CreateTask(jsonReq("/api/v1/mtm/tasks", "POST", { agentId: "agent-cuid-1", title: "Visit" }))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TASK_CREATE", entity: "task", entityId: "t1", metadataKind: "task_create" })
    )
  })

  it("TASK_UPDATE on PUT /tasks/[id] (non-completion)", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "t1", title: "Visit", status: "PENDING", agentId: "agent-cuid-1", priority: "MEDIUM", customerId: null, visitId: null, version: 1 } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-cuid-1" } as any)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as any)
    await UpdateTask(jsonReq("/api/v1/mtm/tasks/t1", "PUT", { title: "Visit (revised)", expectedVersion: 1 }), pp("t1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TASK_UPDATE", entity: "task", entityId: "t1", metadataKind: "task_update" })
    )
  })

  it("TASK_COMPLETE on PUT /tasks/[id] with status=COMPLETED transition", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role: "member", userId: "agent-user", email: "agent@example.com", name: "Agent" } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-cuid-1", role: "AGENT" } as any)
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "t1", title: "Visit", description: null, status: "PENDING", agentId: "agent-cuid-1", priority: "MEDIUM", customerId: null, visitId: null, version: 1, scheduledStartAt: null, dueDate: null, recurrenceRule: null, recurrenceInterval: null, recurrenceUntil: null, recurrenceTimezone: null, recurrenceParentId: null } as any)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as any)
    await UpdateTask(jsonReq("/api/v1/mtm/tasks/t1", "PUT", { status: "COMPLETED", expectedVersion: 1 }), pp("t1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TASK_COMPLETE", entity: "task", entityId: "t1", metadataKind: "task_complete" })
    )
  })

  it("TASK_DELETE on DELETE /tasks/[id]", async () => {
    vi.mocked(prisma.mtmTask.findFirst).mockResolvedValue({ id: "t1", title: "X", agentId: "agent-cuid-1", status: "PENDING", version: 1 } as any)
    vi.mocked(prisma.mtmTask.updateMany).mockResolvedValue({ count: 1 } as any)
    await DeleteTask(plainReq("/api/v1/mtm/tasks/t1?expectedVersion=1"), pp("t1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TASK_DELETE", entity: "task", entityId: "t1", metadataKind: "task_delete" })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHOTOS — review + delete (F-16)
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: photos", () => {
  it("PHOTO_UPLOAD on POST /photos with valid JPEG payload", async () => {
    // Build a real FormData with a 16-byte buffer that has a valid JPEG magic
    // header (FF D8 FF) — the route reads the first 12 bytes and rejects
    // anything that fails magic-number validation (F-15), so we can't shortcut
    // this with an empty file.
    const jpegHeader = new Uint8Array(16)
    jpegHeader[0] = 0xff
    jpegHeader[1] = 0xd8
    jpegHeader[2] = 0xff
    const file = new File([jpegHeader], "photo.jpg", { type: "image/jpeg" })
    const form = new FormData()
    form.append("file", file)
    form.append("agentId", "agent-cuid-1")
    form.append("visitId", "visit-cuid-1")
    form.append("category", "display")

    vi.mocked(prisma.mtmPhoto.create).mockResolvedValue({ id: "p-up-1" } as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-cuid-1" } as any)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ mode: "OPTIONAL" }] },
      customer: { id: "cust-1", latitude: null, longitude: null },
    } as any)

    const req = new NextRequest(new URL("http://localhost:3000/api/v1/mtm/photos"), {
      method: "POST",
      body: form,
    })
    await UploadPhoto(req)

    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PHOTO_UPLOAD",
        entity: "photo",
        entityId: "p-up-1",
        newData: expect.objectContaining({ visitId: "visit-cuid-1", category: "display" }),
      })
    )
  })

  it("PHOTO_UPLOAD on POST /photos with HEIC payload rewrites url to .jpg (F-39)", async () => {
    // HEIC magic: bytes 4-7 = "ftyp", bytes 8-11 = "heic". Pad to 16 so
    // the route's short-buffer rejection (<12) doesn't fire.
    const heicHeader = new Uint8Array(32)
    heicHeader.set([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0)
    const file = new File([heicHeader], "visit-proof.heic", { type: "image/heic" })
    const form = new FormData()
    form.append("file", file)
    form.append("agentId", "agent-cuid-1")
    form.append("visitId", "visit-cuid-1")

    vi.mocked(prisma.mtmPhoto.create).mockImplementation(async (args: any) => ({ id: "p-heic-1", ...args.data }) as any)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-cuid-1" } as any)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ mode: "OPTIONAL" }] },
      customer: { id: "cust-1", latitude: null, longitude: null },
    } as any)

    const req = new NextRequest(new URL("http://localhost:3000/api/v1/mtm/photos"), {
      method: "POST",
      body: form,
    })
    const res = await UploadPhoto(req)
    expect(res.status).toBe(201)

    // The Prisma create call must use a .jpg url, NOT .heic — the whole
    // point of F-39 is that the on-disk artifact is renderable in
    // browsers, so the DB column has to match.
    const createCall = vi.mocked(prisma.mtmPhoto.create).mock.calls[0][0] as any
    expect(createCall.data.url).toMatch(/\.jpg$/)
    expect(createCall.data.url).not.toMatch(/\.heic$/)
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PHOTO_UPLOAD",
        entity: "photo",
        newData: expect.objectContaining({
          storage: "LEGACY",
        }),
      })
    )
  })

  it("PHOTO_REVIEW on PATCH /photos/[id] approval", async () => {
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({ id: "p1", status: "PENDING", agentId: "agent-cuid-1" } as any)
    vi.mocked(prisma.mtmPhoto.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.mtmPhoto.findUnique).mockResolvedValue({ id: "p1", status: "APPROVED" } as any)
    await ReviewPhoto(jsonReq("/api/v1/mtm/photos/p1", "PATCH", { status: "APPROVED" }), pp("p1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PHOTO_REVIEW",
        entity: "photo",
        entityId: "p1",
        metadataKind: "photo_review",
        oldData: { status: "PENDING" },
        newData: expect.objectContaining({ status: "APPROVED" }),
      })
    )
  })

  it("PHOTO_DELETE on DELETE /photos/[id]", async () => {
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({ id: "p1", url: "/u.jpg", agentId: "agent-cuid-1", status: "APPROVED" } as any)
    vi.mocked(prisma.mtmPhoto.deleteMany).mockResolvedValue({ count: 1 } as any)
    await DeletePhoto(plainReq("/api/v1/mtm/photos/p1"), pp("p1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PHOTO_DELETE", entity: "photo", entityId: "p1", metadataKind: "photo_delete" })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: alerts", () => {
  it("ALERT_RESOLVE on PATCH /alerts/[id] with isResolved=true", async () => {
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "al1", type: "OUT_OF_ZONE", isResolved: false, agentId: "agent-cuid-1" } as any)
    vi.mocked(prisma.mtmAlert.updateMany).mockResolvedValue({ count: 1 } as any)
    await UpdateAlert(jsonReq("/api/v1/mtm/alerts/al1", "PATCH", { isResolved: true }), pp("al1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ALERT_RESOLVE", entity: "alert", entityId: "al1", metadataKind: "alert_resolve" })
    )
  })

  it("ALERT_REOPEN on PATCH /alerts/[id] with isResolved=false", async () => {
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "al1", type: "OUT_OF_ZONE", isResolved: true, agentId: "agent-cuid-1" } as any)
    vi.mocked(prisma.mtmAlert.updateMany).mockResolvedValue({ count: 1 } as any)
    await UpdateAlert(jsonReq("/api/v1/mtm/alerts/al1", "PATCH", { isResolved: false }), pp("al1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ALERT_REOPEN", entity: "alert", entityId: "al1", metadataKind: "alert_reopen" })
    )
  })

  it("ALERT_DELETE on DELETE /alerts/[id]", async () => {
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "al1", type: "OUT_OF_ZONE", title: "Geofence", agentId: "agent-cuid-1" } as any)
    vi.mocked(prisma.mtmAlert.deleteMany).mockResolvedValue({ count: 1 } as any)
    await DeleteAlert(plainReq("/api/v1/mtm/alerts/al1"), pp("al1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ALERT_DELETE", entity: "alert", entityId: "al1", metadataKind: "alert_delete" })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// VISITS — CHECK_IN / CHECK_IN_FORCED (F-17) / CHECK_OUT / VISIT_DELETE
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: visits", () => {
  it("CHECK_IN on POST /visits when agent omits GPS (geofence branch skipped by handler)", async () => {
    // Geofence path only runs when both latitude AND longitude are non-null
    // AND customerId is set (visits/route.ts:88). By omitting lat/lng we
    // deterministically take the "no GPS → no geofence check" branch so the
    // test isolates the audit assertion from geofence/customer-lookup mocks.
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "v1" } as any)
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-cuid-1", teamId: null } as any)
    // POST now rejects both before and inside the shared active-visit lock.
    // Override stale findFirst implementations left by earlier audit cases.
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({ id: "cust-cuid-1", category: "B", objectType: "OTHER", latitude: 40.41, longitude: 49.87, geofenceRadius: null } as any)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "cust-cuid-1" }] as any)
    vi.mocked(prisma.mtmVisitRequirementSnapshot.create).mockResolvedValue({ id: "snapshot-1" } as any)
    await CreateVisit(
      jsonReq("/api/v1/mtm/visits", "POST", { agentId: "agent-cuid-1", customerId: "cust-cuid-1" })
    )
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CHECK_IN", entity: "visit", entityId: "v1" })
    )
  })

  it("CHECK_IN_FORCED on POST /visits with force=true override (F-17)", async () => {
    // Caller authorization comes from the fresh ADMIN actor in beforeEach;
    // this row is the active target-agent fixture used again by policy lookup.
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-cuid-1", role: "SUPERVISOR", teamId: null } as any)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)
    // Customer has coords → geofence runs. calculateDistance mock returns 600m
    // which is > default radius 100, so force branch fires.
    vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
      id: "cust-cuid-1",
      name: "Shop",
      category: "B",
      objectType: "OTHER",
      latitude: 40.41,
      longitude: 49.87,
      geofenceRadius: null,
    } as any)
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([{ id: "cust-cuid-1" }] as any)
    vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAlert.create).mockResolvedValue({} as any)
    vi.mocked(prisma.mtmVisit.create).mockResolvedValue({ id: "v2" } as any)
    vi.mocked(prisma.mtmRoutePoint.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmVisitRequirementSnapshot.create).mockResolvedValue({ id: "snapshot-2" } as any)

    await CreateVisit(
      jsonReq("/api/v1/mtm/visits", "POST", {
        agentId: "agent-cuid-1",
        customerId: "cust-cuid-1",
        latitude: 40.5,
        longitude: 49.9,
        force: true,
      })
    )

    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CHECK_IN_FORCED",
        entity: "visit",
        entityId: "v2",
        newData: expect.objectContaining({ forceOverride: true, distanceMeters: 600, geofenceRadius: 100 }),
      })
    )
  })

  it("CHECK_OUT on PUT /visits/[id] with status=CHECKED_OUT", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "v1",
      agentId: "agent-cuid-1",
      status: "CHECKED_IN",
      checkInAt: new Date(Date.now() - 30 * 60_000),
      checkOutAt: null,
      routeId: null,
      routePointId: null,
      requirementSnapshot: { requirements: [] },
      actionResults: [],
      _count: { photos: 0 },
    } as any)
    vi.mocked(prisma.mtmVisit.update).mockResolvedValue({
      id: "v1", agentId: "agent-cuid-1", status: "CHECKED_OUT", duration: 30, routeId: null, routePointId: null,
    } as any)
    await UpdateVisit(
      jsonReq("/api/v1/mtm/visits/v1", "PUT", { agentId: "agent-cuid-1", status: "CHECKED_OUT" }),
      pp("v1")
    )
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CHECK_OUT", entity: "visit", entityId: "v1", metadataKind: "check_out" })
    )
  })

  it("VISIT_DELETE on DELETE /visits/[id]", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({ id: "v1", agentId: "agent-cuid-1", customerId: "cust-cuid-1", status: "CHECKED_OUT" } as any)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as any)
    await DeleteVisit(plainReq("/api/v1/mtm/visits/v1"), pp("v1"))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "VISIT_DELETE", entity: "visit", entityId: "v1", metadataKind: "visit_delete" })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CONTRACT INVARIANTS — properties that must hold across the whole suite
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: contract invariants", () => {
  // Architect suggestion 3: lock the `req` argument. Without this, a refactor
  // could drop `req` from every endpoint call site, breaking IP/UA capture in
  // the audit log, and every other test in this file would still be green.
  it("writeMtmAudit always receives the NextRequest for IP/UA extraction", async () => {
    vi.mocked(prisma.mtmAgent.create).mockResolvedValue({ id: "a-inv", name: "X", email: null, role: "AGENT" } as any)
    await CreateAgent(jsonReq("/api/v1/mtm/agents", "POST", { name: "X" }))
    const call = vi.mocked(writeMtmAudit).mock.calls[0][0]
    expect(call.req).toBeInstanceOf(NextRequest)
  })

  // Architect suggestion 1: negative-case — when the row doesn't exist
  // (PUT against a missing id returns 404), the audit write must NOT fire.
  // Otherwise we'd be logging phantom updates from probe requests.
  it("writeMtmAudit is NOT called when PUT /agents/[id] returns 404", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null) // before-row missing → handler returns 404
    await UpdateAgent(jsonReq("/api/v1/mtm/agents/missing", "PUT", { name: "X" }), pp("missing"))
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: settings", () => {
  it("SETTINGS_UPDATE on PUT /settings", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role: "admin", userId: "u1" } as any)
    vi.mocked(prisma.mtmSetting.upsert).mockResolvedValue({} as any)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])

    await UpdateSettings(jsonReq("/api/v1/mtm/settings", "PUT", {
      gpsInterval: 15,
      photoRequired: false,
      teamScheduleVisibilityEnabled: true,
    }))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SETTINGS_UPDATE",
        entity: "settings",
        entityId: ORG,
        metadataKind: "settings_update",
        oldData: { teamScheduleVisibilityEnabled: false },
        newData: expect.objectContaining({
          keys: expect.arrayContaining(["gpsInterval", "photoRequired", "teamScheduleVisibilityEnabled"]),
          teamScheduleVisibilityEnabled: true,
          actor: { userId: "u1", role: "admin" },
        }),
      })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// MOBILE AUTH — F-03 AUTO_LINK + MOBILE_LOGIN / MOBILE_LOGIN_FAILED
// ═══════════════════════════════════════════════════════════════════════════

describe("audit: mobile auth", () => {
  it("MOBILE_LOGIN on successful auth via agent passwordHash", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      email: "agent@t.com",
      passwordHash: "hashed",
      userId: null,
      organizationId: ORG,
      role: "AGENT",
      avatar: null,
      phone: null,
      name: "Agent",
      organization: MOBILE_ORG,
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
    vi.mocked(prisma.mtmAgent.update).mockResolvedValue({} as any)

    await MobileAuth(jsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "agent@t.com", password: "secret" }))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MOBILE_LOGIN", entity: "agent", entityId: "a1", metadataKind: "login_success" })
    )
  })

  it("MOBILE_LOGIN_FAILED on wrong password", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      email: "agent@t.com",
      passwordHash: "hashed",
      userId: null,
      organizationId: ORG,
      organization: MOBILE_ORG,
    } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never)

    await MobileAuth(jsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "agent@t.com", password: "wrong" }))
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MOBILE_LOGIN_FAILED", entity: "agent", entityId: "a1", metadataKind: "login_failed" })
    )
  })

  it("AUTO_LINK (F-03) when agent without passwordHash matches a CRM user", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
      id: "a1",
      email: "agent@t.com",
      passwordHash: null, // forces Method 3 — find CRM user by email
      userId: null, // previously unlinked
      organizationId: ORG,
      role: "AGENT",
      avatar: null,
      phone: null,
      name: "Agent",
      organization: MOBILE_ORG,
    } as any)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1", passwordHash: "hashed-user-pw" } as any)
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never)
    vi.mocked(prisma.mtmAgent.update).mockResolvedValue({} as any)

    await MobileAuth(jsonReq("/api/v1/mtm/mobile/auth", "POST", { email: "agent@t.com", password: "user-pw" }))

    // Verify AUTO_LINK fired — preserves both old (null) and new (u1) userId values
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AUTO_LINK",
        entity: "agent",
        entityId: "a1",
        metadataKind: "auto_link",
        oldData: { userId: null },
        newData: expect.objectContaining({ userId: "u1" }),
      })
    )
    // And MOBILE_LOGIN follows (success path) — both are part of the same flow
    expect(writeMtmAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MOBILE_LOGIN", entityId: "a1" })
    )
  })
})
