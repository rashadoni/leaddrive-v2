import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
  PHOTO_TAMPER_DETECTED: "PHOTO_TAMPER_DETECTED",
  PHOTO_GPS_VS_CUSTOMER_MISMATCH: "PHOTO_GPS_VS_CUSTOMER_MISMATCH",
  PHOTO_ANOMALY_CHECK_FAILED: "PHOTO_ANOMALY_CHECK_FAILED",
  PHOTO_BURST_SUSPICIOUS: "PHOTO_BURST_SUSPICIOUS",
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }))
vi.mock("heic-convert", () => ({ default: vi.fn() }))
vi.mock("fs/promises", () => ({
  mkdir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
}))

import { POST as saveAction } from "@/app/api/v1/mtm/visits/[id]/actions/route"
import { PUT as saveResult } from "@/app/api/v1/mtm/visits/[id]/result/route"
import { POST as uploadPhoto } from "@/app/api/v1/mtm/photos/route"
import { DELETE as deletePhoto, PATCH as reviewPhoto } from "@/app/api/v1/mtm/photos/[id]/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { writeFile } from "fs/promises"

const ORG = "org-1"
const WEB_AUTH = {
  orgId: ORG,
  userId: "manager-user",
  role: "manager",
  email: "manager@example.com",
  name: "Manager",
}
const PARTICIPANT = { agentId: "participant-1", role: "AGENT", scopedAgentIds: ["participant-1"] } as const
const MANAGER = { agentId: "manager-1", role: "MANAGER", scopedAgentIds: ["manager-1", "agent-1"] } as const

function jsonRequest(path: string, method: string, body: unknown) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function photoRequest(agentId: string, visitId?: string) {
  const form = new FormData()
  form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0, 0, 0, 0, 0])], "photo.jpg", { type: "image/jpeg" }))
  form.append("agentId", agentId)
  if (visitId) form.append("visitId", visitId)
  return new NextRequest(new URL("http://localhost:3000/api/v1/mtm/photos"), { method: "POST", body: form })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(WEB_AUTH as never)
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(MANAGER as never)
})

describe("direct visit mutation scope", () => {
  it("does not let a participant-only agent create a visit action", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(PARTICIPANT as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const response = await saveAction(
      jsonRequest("/api/v1/mtm/visits/visit-foreign/actions", "POST", {
        actionKey: "PRESENTATION",
        status: "COMPLETED",
      }),
      params("visit-foreign"),
    )

    expect(response.status).toBe(404)
    expect(prisma.mtmVisit.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: ORG,
        deletedAt: null,
        id: "visit-foreign",
        agentId: { in: ["participant-1"] },
      },
    }))
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("does not let a participant-only agent save the result", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(PARTICIPANT as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const response = await saveResult(
      jsonRequest("/api/v1/mtm/visits/visit-foreign/result", "PUT", {
        outcome: "SUCCESSFUL",
        potential: "UNKNOWN",
        discussedTopics: [],
      }),
      params("visit-foreign"),
    )

    expect(response.status).toBe(404)
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })

  it("keeps an outside-current-scope visit absent for a manager action", async () => {
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const response = await saveAction(
      jsonRequest("/api/v1/mtm/visits/visit-outside/actions", "POST", {
        actionKey: "PRESENTATION",
        status: "COMPLETED",
      }),
      params("visit-outside"),
    )

    expect(response.status).toBe(404)
    const query = vi.mocked(prisma.mtmVisit.findFirst).mock.calls[0]?.[0] as any
    expect(query.where).toMatchObject({ organizationId: ORG, agentId: { in: ["manager-1", "agent-1"] } })
    expect(query.where).not.toHaveProperty("OR")
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
  })

  it("keeps the legitimate primary-agent action flow and atomic org fence", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      agentId: "agent-1",
      status: "CHECKED_IN",
      requirementSnapshot: {
        requirements: [{ id: "requirement-1", actionKey: "PRESENTATION", mode: "REQUIRED", allowWaiver: false }],
      },
      actionResults: [],
    } as never)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmVisitActionResult.create).mockResolvedValue({
      id: "result-1",
      actionKey: "PRESENTATION",
      status: "COMPLETED",
    } as never)

    const response = await saveAction(
      jsonRequest("/api/v1/mtm/visits/visit-1/actions", "POST", {
        actionKey: "PRESENTATION",
        status: "COMPLETED",
      }),
      params("visit-1"),
    )

    expect(response.status).toBe(201)
    expect(prisma.mtmVisit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "visit-1",
        organizationId: ORG,
        status: "CHECKED_IN",
        agentId: { in: ["agent-1"] },
      }),
    }))
    expect(prisma.mtmVisitActionResult.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: ORG, visitId: "visit-1", completedByAgentId: "agent-1" }),
    }))
  })

  it("rolls back result descendants when the atomic visit fence loses the race", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({
      agentId: "agent-1",
      role: "AGENT",
      scopedAgentIds: ["agent-1"],
    } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue({
      id: "visit-1",
      agentId: "agent-1",
      customerId: "customer-1",
      status: "CHECKED_IN",
      requirementSnapshot: { requirements: [{ id: "req-note", actionKey: "VISIT_NOTE", mode: "OPTIONAL" }] },
    } as never)
    vi.mocked(prisma.mtmVisit.updateMany).mockResolvedValue({ count: 0 } as never)

    const response = await saveResult(
      jsonRequest("/api/v1/mtm/visits/visit-1/result", "PUT", {
        outcome: "SUCCESSFUL",
        potential: "UNKNOWN",
        discussedTopics: ["Stock"],
      }),
      params("visit-1"),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_VISIT_MUTATION_CONFLICT" })
    expect(prisma.mtmVisitActionResult.create).not.toHaveBeenCalled()
    expect(prisma.mtmVisitActionResult.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmTask.create).not.toHaveBeenCalled()
  })
})

describe("photo mutation identity and scope", () => {
  it("rejects a mobile caller-selected foreign agent before any file or DB write", async () => {
    const mobile = {
      orgId: ORG,
      agentId: "agent-1",
      userId: "agent-user",
      role: "AGENT",
      email: "agent@example.com",
      name: "Agent",
      tenantCapabilities: { routeField: true, workforceHrm: true },
    }
    vi.mocked(getMobileAuth).mockReturnValue(mobile)
    vi.mocked(resolveMobileAuth).mockResolvedValue(mobile)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-1", role: "AGENT", scopedAgentIds: ["agent-1"] } as never)

    const response = await uploadPhoto(photoRequest("victim-agent"))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_PHOTO_AGENT_OUT_OF_SCOPE" })
    expect(requireAuth).not.toHaveBeenCalled()
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("rejects a web caller-selected in-org agent outside current manager scope", async () => {
    const response = await uploadPhoto(photoRequest("agent-outside"))

    expect(response.status).toBe(404)
    expect(prisma.mtmAgent.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("does not let a participant upload against another primary agent's visit", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(PARTICIPANT as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "participant-1" } as never)
    vi.mocked(prisma.mtmVisit.findFirst).mockResolvedValue(null)

    const response = await uploadPhoto(photoRequest("participant-1", "visit-foreign"))

    expect(response.status).toBe(404)
    const query = vi.mocked(prisma.mtmVisit.findFirst).mock.calls[0]?.[0] as any
    expect(query.where).toMatchObject({
      id: "visit-foreign",
      organizationId: ORG,
      agentId: "participant-1",
    })
    expect(query.where).not.toHaveProperty("OR")
    expect(prisma.mtmPhoto.create).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it("does not let a participant delete their old photo from another primary visit", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(PARTICIPANT as never)
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({
      id: "photo-foreign",
      url: "/uploads/foreign.jpg",
      status: "PENDING",
      agentId: "participant-1",
      visitId: "visit-foreign",
      visit: { agentId: "primary-foreign" },
    } as never)

    const response = await deletePhoto(
      new NextRequest(new URL("http://localhost:3000/api/v1/mtm/photos/photo-foreign"), { method: "DELETE" }),
      params("photo-foreign"),
    )

    expect(response.status).toBe(404)
    expect(prisma.mtmPhoto.deleteMany).not.toHaveBeenCalled()
  })

  it("does not let a field agent review a photo", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(PARTICIPANT as never)

    const response = await reviewPhoto(
      jsonRequest("/api/v1/mtm/photos/photo-1", "PATCH", { status: "APPROVED", reviewedBy: "spoofed-user" }),
      params("photo-1"),
    )

    expect(response.status).toBe(403)
    expect(prisma.mtmPhoto.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmPhoto.updateMany).not.toHaveBeenCalled()
  })

  it("derives photo reviewer identity from auth and keeps the atomic scope predicate", async () => {
    vi.mocked(prisma.mtmPhoto.findFirst)
      .mockResolvedValueOnce({
        id: "photo-1",
        url: "/uploads/photo.jpg",
        status: "PENDING",
        agentId: "agent-1",
        visitId: "visit-1",
        visit: { agentId: "agent-1" },
      } as never)
      .mockResolvedValueOnce({ id: "photo-1", status: "APPROVED" } as never)
    vi.mocked(prisma.mtmPhoto.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await reviewPhoto(
      jsonRequest("/api/v1/mtm/photos/photo-1", "PATCH", { status: "APPROVED", reviewedBy: "spoofed-user" }),
      params("photo-1"),
    )

    expect(response.status).toBe(200)
    expect(prisma.mtmPhoto.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "photo-1",
        organizationId: ORG,
        visitId: "visit-1",
        visit: expect.objectContaining({
          id: "visit-1",
          organizationId: ORG,
          agentId: { in: ["manager-1", "agent-1"] },
        }),
      }),
      data: expect.objectContaining({ reviewedBy: WEB_AUTH.userId }),
    }))
  })

  it("deletes a visit photo for the resolved primary recipient", async () => {
    vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({
      id: "photo-1",
      url: "/uploads/photo.jpg",
      status: "PENDING",
      agentId: "uploader-1",
      visitId: "visit-1",
      visit: { agentId: "agent-1" },
    } as never)
    vi.mocked(prisma.mtmPhoto.deleteMany).mockResolvedValue({ count: 1 } as never)

    const response = await deletePhoto(
      new NextRequest(new URL("http://localhost:3000/api/v1/mtm/photos/photo-1"), { method: "DELETE" }),
      params("photo-1"),
    )

    expect(response.status).toBe(200)
  })
})
