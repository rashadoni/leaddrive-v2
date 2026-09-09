import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    journey: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    journeyEnrollment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    journeyStep: { update: vi.fn() },
    lead: { findFirst: vi.fn() },
    contact: { count: vi.fn(), findFirst: vi.fn() },
    contactSegment: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  // Other routes in this mixed test file still use withRls. Keep their session
  // lookup on the getOrgId fallback (clearAllMocks preserves this implementation).
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/journey-engine", () => ({
  processEnrollmentStep: vi.fn().mockResolvedValue({ status: "ok" }),
}))

vi.mock("@/lib/journey-goals", () => ({
  checkGoal: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn().mockReturnValue(null),
}))

vi.mock("@/lib/cron/job-lease", () => ({
  withJobLease: vi.fn(async (_options: unknown, work: () => Promise<unknown>) => ({
    status: "acquired",
    value: await work(),
  })),
}))

vi.mock("@/lib/report-engine", () => ({
  executeReport: vi.fn(),
}))

vi.mock("@/lib/segment-conditions", () => ({
  buildContactWhere: vi.fn().mockReturnValue({ organizationId: "org-1" }),
}))

vi.mock("exceljs", () => {
  const addRow = vi.fn()
  const getRow = vi.fn().mockReturnValue({ font: {}, commit: vi.fn() })
  return {
    default: {
      Workbook: vi.fn().mockImplementation(() => ({
        addWorksheet: vi.fn().mockReturnValue({
          columns: [],
          addRow,
          getRow,
        }),
        xlsx: { writeBuffer: vi.fn().mockResolvedValue(Buffer.from("xlsx")) },
      })),
    },
  }
})

/* ------------------------------------------------------------------ */
/*  Imports (after mocks)                                              */
/* ------------------------------------------------------------------ */

import { POST as enrollPOST, GET as enrollGET } from "@/app/api/v1/journeys/enroll/route"
import { PATCH as enrollmentPATCH } from "@/app/api/v1/journeys/enrollments/[id]/route"
import { POST as processPOST } from "@/app/api/v1/journeys/process/route"
import { POST as reportPreviewPOST } from "@/app/api/v1/reports/builder/preview/route"
import { POST as reportExportPOST } from "@/app/api/v1/reports/builder/export/route"
import { GET as segmentGET, PUT as segmentPUT, DELETE as segmentDELETE } from "@/app/api/v1/segments/[id]/route"
import { POST as segmentPreviewPOST } from "@/app/api/v1/segments/preview/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { executeReport } from "@/lib/report-engine"
import { processEnrollmentStep } from "@/lib/journey-engine"
import { requireCronAuth } from "@/lib/cron-auth"

function jsonReq(url: string, body: any, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma))
  vi.mocked(requireAuth).mockImplementation(async (req, module, action) => {
    const orgId = await getOrgId(req)
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }) as any
    }
    return {
      orgId,
      userId: "admin-1",
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
      module,
      action,
    } as any
  })
})

/* ================================================================== */
/*  Journey Enroll POST                                                */
/* ================================================================== */

describe("Journey Enroll — POST /api/v1/journeys/enroll", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "l1" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "c1" } as any)
  })

  it("returns 403 when a sales user cannot enroll journey targets", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any,
    )

    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", {
      journeyId: "j1",
      leadId: "l1",
    }))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "journeys", "write")
    expect(prisma.journey.findFirst).not.toHaveBeenCalled()
    expect(prisma.journeyEnrollment.create).not.toHaveBeenCalled()
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", {}))
    expect(res.status).toBe(401)
  })

  it("returns 400 when journeyId missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", { leadId: "l1" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Invalid enrollment request")
  })

  it("returns 400 when neither leadId nor contactId provided", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", { journeyId: "j1" }))
    expect(res.status).toBe(400)
  })

  it("returns 404 when journey not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journey.findFirst).mockResolvedValue(null)
    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", { journeyId: "j1", leadId: "l1" }))
    expect(res.status).toBe(404)
  })

  it("returns 409 when already enrolled", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journey.findFirst).mockResolvedValue({ id: "j1", steps: [{ id: "s1", stepOrder: 1 }] } as any)
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue({ id: "e1" } as any)

    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", { journeyId: "j1", leadId: "l1" }))
    expect(res.status).toBe(409)
  })

  it("does not enroll a lead that is outside the authenticated tenant", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journey.findFirst).mockResolvedValue({ id: "j1", steps: [{ id: "s1", stepOrder: 1 }] } as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null)

    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", {
      journeyId: "j1",
      leadId: "victim-lead",
    }))

    expect(res.status).toBe(404)
    expect(prisma.lead.findFirst).toHaveBeenCalledWith({
      where: { id: "victim-lead", organizationId: "org-1" },
      select: { id: true },
    })
    expect(prisma.journeyEnrollment.create).not.toHaveBeenCalled()
    expect(processEnrollmentStep).not.toHaveBeenCalled()
  })

  it("creates enrollment and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(requireAuth).mockResolvedValueOnce({
      orgId: "org-1",
      userId: "manager-1",
      role: "manager",
      email: "manager@example.com",
      name: "Manager",
    } as any)
    vi.mocked(prisma.journey.findFirst).mockResolvedValue({ id: "j1", steps: [{ id: "s1", stepOrder: 1 }] } as any)
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.journeyEnrollment.create).mockResolvedValue({ id: "e1" } as any)
    vi.mocked(prisma.journey.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.journeyStep.update).mockResolvedValue({} as any)

    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", { journeyId: "j1", leadId: "l1" }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "journeys", "write")
  })

  it("maps the partial unique-index race to 409", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journey.findFirst).mockResolvedValue({ id: "j1", steps: [{ id: "s1", stepOrder: 1 }] } as any)
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.journeyEnrollment.create).mockRejectedValue({ code: "P2002" })

    const res = await enrollPOST(jsonReq("http://localhost/api/v1/journeys/enroll", {
      journeyId: "j1",
      leadId: "l1",
    }))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("Already enrolled in this journey")
    expect(prisma.journey.updateMany).not.toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  Journey Enroll GET                                                 */
/* ================================================================== */

describe("Journey Enroll — GET /api/v1/journeys/enroll", () => {
  it("returns 403 when an API key lacks read:journeys scope", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any,
    )

    const req = new NextRequest("http://localhost/api/v1/journeys/enroll?journeyId=j1")
    const res = await enrollGET(req)

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(req, "journeys", "read")
    expect(prisma.journeyEnrollment.findMany).not.toHaveBeenCalled()
  })
})

/* ================================================================== */
/*  Journey Enrollment PATCH                                           */
/* ================================================================== */

describe("Journey Enrollment — PATCH /api/v1/journeys/enrollments/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 403 when a viewer cannot mutate an enrollment", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any,
    )
    const req = jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "pause" })

    const res = await enrollmentPATCH(req, params("e1"))

    expect(res.status).toBe(403)
    expect(requireAuth).toHaveBeenCalledWith(req, "journeys", "write")
    expect(prisma.journeyEnrollment.findFirst).not.toHaveBeenCalled()
    expect(prisma.journeyEnrollment.update).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid action", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const req = jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "invalid" })
    const res = await enrollmentPATCH(req, params("e1"))
    expect(res.status).toBe(400)
  })

  it("returns 404 when enrollment not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue(null)
    const req = jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "pause" })
    const res = await enrollmentPATCH(req, params("e1"))
    expect(res.status).toBe(404)
  })

  it("pauses an enrollment successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue({ id: "e1", journeyId: "j1", status: "active" } as any)
    vi.mocked(prisma.journeyEnrollment.updateMany).mockResolvedValue({ count: 1 } as any)
    const req = jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "pause" })
    const res = await enrollmentPATCH(req, params("e1"))
    expect(res.status).toBe(200)
    expect((await res.json()).action).toBe("pause")
    expect(prisma.journeyEnrollment.updateMany).toHaveBeenCalledWith({
      where: {
        id: "e1",
        organizationId: "org-1",
        status: "active",
        OR: [
          { processingToken: null },
          { processingLeaseUntil: null },
          { processingLeaseUntil: { lte: expect.any(Date) } },
        ],
      },
      data: {
        status: "paused",
        nextActionAt: null,
        processingToken: null,
        processingLeaseUntil: null,
      },
    })
  })

  it("rejects lifecycle changes while a processor lease is live", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue({
      id: "e1",
      journeyId: "j1",
      status: "active",
      processingToken: "worker-token",
      processingLeaseUntil: new Date(Date.now() + 60_000),
    } as any)

    const res = await enrollmentPATCH(
      jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "pause" }),
      params("e1"),
    )

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("currently processing"),
    })
    expect(prisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it("rejects invalid lifecycle source states", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue({
      id: "e1",
      journeyId: "j1",
      status: "paused",
    } as any)

    const res = await enrollmentPATCH(
      jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "pause" }),
      params("e1"),
    )

    expect(res.status).toBe(409)
    expect(prisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it("resumes only a paused enrollment through a tenant-scoped CAS", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue({
      id: "e1",
      journeyId: "j1",
      status: "paused",
    } as any)
    vi.mocked(prisma.journeyEnrollment.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await enrollmentPATCH(
      jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "resume" }),
      params("e1"),
    )

    expect(res.status).toBe(200)
    expect(prisma.journeyEnrollment.updateMany).toHaveBeenCalledWith({
      where: {
        id: "e1",
        organizationId: "org-1",
        status: "paused",
        OR: [
          { processingToken: null },
          { processingLeaseUntil: null },
          { processingLeaseUntil: { lte: expect.any(Date) } },
        ],
      },
      data: {
        status: "active",
        nextActionAt: expect.any(Date),
        processingToken: null,
        processingLeaseUntil: null,
      },
    })
  })

  it("does not cancel an already-terminal enrollment", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue({
      id: "e1",
      journeyId: "j1",
      status: "completed",
    } as any)

    const res = await enrollmentPATCH(
      jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "cancel" }),
      params("e1"),
    )

    expect(res.status).toBe(409)
    expect(prisma.journeyEnrollment.updateMany).not.toHaveBeenCalled()
    expect(prisma.journey.updateMany).not.toHaveBeenCalled()
  })

  it("increments cancel counters only after the conditional transition wins", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue({
      id: "e1",
      journeyId: "j1",
      status: "active",
    } as any)
    vi.mocked(prisma.journeyEnrollment.updateMany)
      .mockResolvedValueOnce({ count: 0 } as any)
      .mockResolvedValueOnce({ count: 1 } as any)
    vi.mocked(prisma.journey.updateMany).mockResolvedValue({ count: 1 } as any)

    const first = await enrollmentPATCH(
      jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "cancel" }),
      params("e1"),
    )
    expect(first.status).toBe(409)
    expect(prisma.journey.updateMany).not.toHaveBeenCalled()

    const second = await enrollmentPATCH(
      jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "cancel" }),
      params("e1"),
    )
    expect(second.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(prisma.journey.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.journey.updateMany).toHaveBeenCalledWith({
      where: { id: "j1", organizationId: "org-1" },
      data: { activeCount: { decrement: 1 }, completedCount: { increment: 1 } },
    })
  })

  it("fails cancellation atomically when the journey counter row is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue({
      id: "e1",
      journeyId: "j1",
      status: "active",
    } as any)
    vi.mocked(prisma.journeyEnrollment.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.journey.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await enrollmentPATCH(
      jsonReq("http://localhost/api/v1/journeys/enrollments/e1", { action: "cancel" }),
      params("e1"),
    )

    expect(res.status).toBe(500)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.journey.updateMany).toHaveBeenCalledWith({
      where: { id: "j1", organizationId: "org-1" },
      data: { activeCount: { decrement: 1 }, completedCount: { increment: 1 } },
    })
  })
})

/* ================================================================== */
/*  Journey Process POST (cron)                                        */
/* ================================================================== */

describe("Journey Process — POST /api/v1/journeys/process", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireCronAuth).mockReturnValue(null)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-1" } as any)
  })

  it("returns the cron auth error before scanning enrollments", async () => {
    vi.mocked(requireCronAuth).mockReturnValue(new Response(null, { status: 401 }) as any)
    const req = new NextRequest("http://localhost/api/v1/journeys/process", { method: "POST" })
    const res = await processPOST(req)
    expect(res.status).toBe(401)
    expect(prisma.journeyEnrollment.findMany).not.toHaveBeenCalled()
  })

  it("re-enters the owning tenant, re-reads the row, and dispatches the claimed engine", async () => {
    const discovered = {
      id: "enr-1",
      organizationId: "org-1",
      journeyId: "journey-1",
      currentStepId: "step-1",
      status: "active",
      leadId: "lead-1",
      contactId: null,
      enrolledAt: new Date("2026-08-10T00:00:00Z"),
    }
    vi.mocked(prisma.journeyEnrollment.findMany).mockResolvedValue([discovered] as any)
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue(discovered as any)

    const req = new NextRequest("http://localhost/api/v1/journeys/process", { method: "POST" })
    const res = await processPOST(req)

    expect(res.status).toBe(200)
    expect(prisma.journeyEnrollment.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        nextActionAt: { lte: expect.any(Date) },
        currentStepId: { not: null },
        OR: [
          { processingLeaseUntil: null },
          { processingLeaseUntil: { lte: expect.any(Date) } },
        ],
      },
      orderBy: [
        { nextActionAt: "asc" },
        { enrolledAt: "asc" },
        { id: "asc" },
      ],
      take: expect.any(Number),
    })
    expect(prisma.journeyEnrollment.findFirst).toHaveBeenCalledWith({
      where: {
        id: "enr-1",
        organizationId: "org-1",
        status: "active",
        nextActionAt: { lte: expect.any(Date) },
      },
    })
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: { id: "org-1", isActive: true },
      select: { id: true },
    })
    expect(processEnrollmentStep).toHaveBeenCalledWith("enr-1", "org-1")
  })

  it("terminalizes an inactive tenant without invoking the engine", async () => {
    const discovered = {
      id: "enr-1",
      organizationId: "org-1",
      journeyId: "journey-1",
      currentStepId: "step-1",
      status: "active",
      leadId: "lead-1",
      contactId: null,
      enrolledAt: new Date("2026-08-10T00:00:00Z"),
    }
    vi.mocked(prisma.journeyEnrollment.findMany).mockResolvedValue([discovered] as any)
    vi.mocked(prisma.journeyEnrollment.findFirst).mockResolvedValue(discovered as any)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.journeyEnrollment.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await processPOST(new NextRequest("http://localhost/api/v1/journeys/process", { method: "POST" }))

    expect(res.status).toBe(200)
    expect(prisma.journeyEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "enr-1", organizationId: "org-1", status: "active" },
      data: {
        status: "failed",
        exitReason: "inactive_organization",
        completedAt: expect.any(Date),
        currentStepId: null,
        nextActionAt: null,
        processingToken: null,
        processingLeaseUntil: null,
      },
    })
    expect(processEnrollmentStep).not.toHaveBeenCalled()
  })

  it("gives another tenant a fair-share slot before one tenant's overflow", async () => {
    const due = new Date("2026-08-11T00:00:00Z")
    const orgOne = Array.from({ length: 12 }, (_, index) => ({
      id: `org-1-enr-${index}`,
      organizationId: "org-1",
      journeyId: "journey-1",
      currentStepId: "step-1",
      status: "active",
      leadId: `lead-${index}`,
      contactId: null,
      nextActionAt: due,
      enrolledAt: due,
    }))
    const orgTwo = {
      ...orgOne[0],
      id: "org-2-enr-0",
      organizationId: "org-2",
      journeyId: "journey-2",
    }
    const discovered = [...orgOne, orgTwo]
    vi.mocked(prisma.journeyEnrollment.findMany).mockResolvedValue(discovered as any)
    vi.mocked(prisma.journeyEnrollment.findFirst).mockImplementation(async ({ where }: any) =>
      discovered.find((row) => row.id === where.id) as any,
    )
    vi.mocked(prisma.organization.findFirst).mockImplementation(async ({ where }: any) => ({ id: where.id }) as any)

    const res = await processPOST(new NextRequest("http://localhost/api/v1/journeys/process", { method: "POST" }))

    expect(res.status).toBe(200)
    expect(vi.mocked(processEnrollmentStep).mock.calls[10]).toEqual(["org-2-enr-0", "org-2"])
    expect(processEnrollmentStep).toHaveBeenCalledTimes(13)
  })
})

/* ================================================================== */
/*  Report Builder Preview POST                                        */
/* ================================================================== */

describe("Report Builder Preview — POST /api/v1/reports/builder/preview", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await reportPreviewPOST(jsonReq("http://localhost/api/v1/reports/builder/preview", {}))
    expect(res.status).toBe(401)
  })

  it("returns 400 when entity/entityType missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await reportPreviewPOST(jsonReq("http://localhost/api/v1/reports/builder/preview", { columns: [] }))
    expect(res.status).toBe(400)
  })

  it("executes report and returns rows", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(executeReport).mockResolvedValue({ data: [{ id: "1", name: "Test" }], type: "flat" } as any)
    const res = await reportPreviewPOST(jsonReq("http://localhost/api/v1/reports/builder/preview", {
      entityType: "contact",
      columns: ["id", "name"],
    }))
    const json = await res.json()
    expect(json.rows).toHaveLength(1)
    expect(json.total).toBe(1)
  })
})

/* ================================================================== */
/*  Segment [id] — GET / PUT / DELETE                                  */
/* ================================================================== */

describe("Segment [id] — GET/PUT/DELETE /api/v1/segments/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("GET returns 404 when segment not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.findFirst).mockResolvedValue(null)
    const req = new NextRequest("http://localhost/api/v1/segments/s1")
    const res = await segmentGET(req, params("s1"))
    expect(res.status).toBe(404)
  })

  it("PUT updates a segment", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.contactSegment.findFirst).mockResolvedValue({ id: "s1", name: "Updated" } as any)
    const req = new NextRequest("http://localhost/api/v1/segments/s1", {
      method: "PUT",
      body: JSON.stringify({ name: "Updated" }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await segmentPUT(req, params("s1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Updated")
  })

  it("DELETE removes a segment", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contactSegment.deleteMany).mockResolvedValue({ count: 1 } as any)
    const req = new NextRequest("http://localhost/api/v1/segments/s1", { method: "DELETE" })
    const res = await segmentDELETE(req, params("s1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("s1")
  })
})

/* ================================================================== */
/*  Segment Preview POST                                               */
/* ================================================================== */

describe("Segment Preview — POST /api/v1/segments/preview", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns contact count for conditions", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.contact.count).mockResolvedValue(42)
    const res = await segmentPreviewPOST(jsonReq("http://localhost/api/v1/segments/preview", { conditions: {} }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.count).toBe(42)
  })
})
