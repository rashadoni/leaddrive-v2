import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  invoiceFindFirst: vi.fn(),
  journeyFindFirst: vi.fn(),
  journeyUpdateMany: vi.fn(),
  stepUpdateMany: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  enrollmentCreate: vi.fn(),
  enrollmentUpdateMany: vi.fn(),
  getOrCreateJourney: vi.fn(),
  processEnrollmentStep: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: mocks.requireAuth,
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findFirst: mocks.invoiceFindFirst },
    journey: {
      findFirst: mocks.journeyFindFirst,
      updateMany: mocks.journeyUpdateMany,
    },
    journeyStep: { updateMany: mocks.stepUpdateMany },
    journeyEnrollment: {
      findFirst: mocks.enrollmentFindFirst,
      create: mocks.enrollmentCreate,
      updateMany: mocks.enrollmentUpdateMany,
    },
  },
}))

vi.mock("@/lib/invoice-chain-template", () => ({
  getOrCreateInvoiceChainJourney: mocks.getOrCreateJourney,
}))

vi.mock("@/lib/journey-engine", () => ({
  processEnrollmentStep: mocks.processEnrollmentStep,
}))

import { DELETE, GET, POST } from "@/app/api/v1/invoices/[id]/chain/route"

const AUTH = {
  orgId: "org-1",
  userId: "admin-1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

const context = (id = "invoice-1") => ({ params: Promise.resolve({ id }) })

function request(method: "GET" | "POST" | "DELETE", body?: unknown) {
  return new NextRequest("http://localhost/api/v1/invoices/invoice-1/chain", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue(AUTH)
  mocks.journeyUpdateMany.mockResolvedValue({ count: 1 })
  mocks.stepUpdateMany.mockResolvedValue({ count: 1 })
  mocks.enrollmentUpdateMany.mockResolvedValue({ count: 1 })
  mocks.getOrCreateJourney.mockResolvedValue("journey-1")
  mocks.processEnrollmentStep.mockResolvedValue({ ok: true })
})

describe("invoice-chain RBAC", () => {
  it("requires invoices:read before returning chain data", async () => {
    const req = request("GET")
    mocks.invoiceFindFirst.mockResolvedValue({ chainJourneyId: null })

    const res = await GET(req, context())

    expect(res.status).toBe(200)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "invoices", "read")
  })

  it("blocks a viewer before setup creates any Journey", async () => {
    mocks.requireAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    )
    const req = request("POST", { action: "setup" })

    const res = await POST(req, context())

    expect(res.status).toBe(403)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "invoices", "write")
    expect(mocks.invoiceFindFirst).not.toHaveBeenCalled()
    expect(mocks.getOrCreateJourney).not.toHaveBeenCalled()
    expect(mocks.enrollmentCreate).not.toHaveBeenCalled()
  })

  it("blocks an API key missing write:invoices before cancellation side effects", async () => {
    mocks.requireAuth.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    )
    const req = request("DELETE")

    const res = await DELETE(req, context())

    expect(res.status).toBe(403)
    expect(mocks.requireAuth).toHaveBeenCalledWith(req, "invoices", "write")
    expect(mocks.enrollmentUpdateMany).not.toHaveBeenCalled()
    expect(mocks.journeyUpdateMany).not.toHaveBeenCalled()
  })
})

describe("invoice-chain tenant boundaries", () => {
  it("does not create a chain for an invoice outside the authenticated org", async () => {
    mocks.invoiceFindFirst.mockResolvedValue(null)

    const res = await POST(request("POST", { action: "setup" }), context("foreign-invoice"))

    expect(res.status).toBe(404)
    expect(mocks.invoiceFindFirst).toHaveBeenCalledWith({
      where: { id: "foreign-invoice", organizationId: "org-1" },
      select: { chainJourneyId: true, contactId: true },
    })
    expect(mocks.getOrCreateJourney).not.toHaveBeenCalled()
    expect(mocks.journeyFindFirst).not.toHaveBeenCalled()
  })

  it("scopes Journey and enrollment reads to the invoice tenant", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ chainJourneyId: "journey-1" })
    mocks.journeyFindFirst.mockResolvedValue({ id: "journey-1", steps: [] })
    mocks.enrollmentFindFirst.mockResolvedValue(null)

    const res = await GET(request("GET"), context())

    expect(res.status).toBe(200)
    expect(mocks.journeyFindFirst).toHaveBeenCalledWith({
      where: { id: "journey-1", organizationId: "org-1" },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    })
    expect(mocks.enrollmentFindFirst).toHaveBeenCalledWith({
      where: {
        invoiceId: "invoice-1",
        journeyId: "journey-1",
        organizationId: "org-1",
        status: "active",
      },
    })
  })

  it("scopes start counters and the enrollment reload to the authenticated org", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      chainJourneyId: "journey-1",
      contactId: "contact-1",
    })
    mocks.enrollmentFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "enrollment-1", status: "active" })
    mocks.journeyFindFirst.mockResolvedValue({
      id: "journey-1",
      steps: [{ id: "step-1" }],
    })
    mocks.enrollmentCreate.mockResolvedValue({ id: "enrollment-1" })

    const res = await POST(request("POST", { action: "start" }), context())

    expect(res.status).toBe(200)
    expect(mocks.journeyUpdateMany).toHaveBeenCalledWith({
      where: { id: "journey-1", organizationId: "org-1" },
      data: { entryCount: { increment: 1 }, activeCount: { increment: 1 } },
    })
    expect(mocks.stepUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "step-1",
        journeyId: "journey-1",
        journey: { organizationId: "org-1" },
      },
      data: { statsEntered: { increment: 1 } },
    })
    expect(mocks.enrollmentFindFirst).toHaveBeenLastCalledWith({
      where: {
        id: "enrollment-1",
        invoiceId: "invoice-1",
        organizationId: "org-1",
      },
    })
  })

  it("maps the database active-invoice uniqueness race to 409", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      chainJourneyId: "journey-1",
      contactId: "contact-1",
    })
    mocks.enrollmentFindFirst.mockResolvedValue(null)
    mocks.journeyFindFirst.mockResolvedValue({
      id: "journey-1",
      steps: [{ id: "step-1" }],
    })
    mocks.enrollmentCreate.mockRejectedValue({ code: "P2002" })

    const res = await POST(request("POST", { action: "start" }), context())

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "Chain already active" })
    expect(mocks.journeyUpdateMany).not.toHaveBeenCalled()
    expect(mocks.processEnrollmentStep).not.toHaveBeenCalled()
  })

  it("uses tenant-scoped conditional writes when cancelling", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ id: "invoice-1" })
    mocks.enrollmentFindFirst.mockResolvedValue({
      id: "enrollment-1",
      journeyId: "journey-1",
    })

    const res = await DELETE(request("DELETE"), context())

    expect(res.status).toBe(200)
    expect(mocks.enrollmentUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "enrollment-1",
        invoiceId: "invoice-1",
        organizationId: "org-1",
        status: "active",
      },
      data: { status: "cancelled", completedAt: expect.any(Date) },
    })
    expect(mocks.journeyUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "journey-1",
        organizationId: "org-1",
        activeCount: { gt: 0 },
      },
      data: { activeCount: { decrement: 1 } },
    })
  })
})
