import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { POST as previewTransfer } from "@/app/api/v1/mtm/contact-transfers/preview/route"
import { GET as reconcileTransfer, POST as executeTransfer } from "@/app/api/v1/mtm/contact-transfers/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const SOURCE = "cm000000000000000000001"
const TARGET = "cm000000000000000000002"
const CONTACT = "cm000000000000000000003"
const ASSIGNMENT = "cm000000000000000000004"
const ADMIN_AUTH: AuthResult = {
  orgId: ORG,
  userId: "admin-user",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}
const AGENT_AUTH: AuthResult = {
  orgId: ORG,
  userId: "agent-user",
  role: "sales",
  email: "agent@example.com",
  name: "Agent",
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    body: JSON.stringify(body),
  })
}

function getRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), { method: "GET" })
}

function eligibleContact() {
  return {
    id: CONTACT,
    displayName: "Dr Farid",
    status: "ACTIVE",
    agentAssignments: [{
      id: ASSIGNMENT,
      agentId: SOURCE,
      role: "PRIMARY",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
    }],
  }
}

const baseInput = {
  contactIds: [CONTACT],
  sourceAgentId: SOURCE,
  targetAgentId: TARGET,
  effectiveFrom: "2026-07-22",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
    { id: SOURCE, name: "Old Agent", status: "INACTIVE", role: "AGENT" },
    { id: TARGET, name: "New Agent", status: "ACTIVE", role: "AGENT" },
  ] as any)
  vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([eligibleContact()] as any)
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContactTransferOperation.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmContactTransferOperation.create).mockResolvedValue({ id: "operation-1" } as any)
  vi.mocked(prisma.mtmContactTransferOperation.update).mockResolvedValue({ id: "operation-1", status: "COMPLETED" } as any)
  vi.mocked(prisma.mtmContactAgentAssignment.updateMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.mtmContactAgentAssignment.create).mockResolvedValue({ id: "assignment-new" } as any)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as any)
})

describe("MTM bulk contact transfer", () => {
  it("previews an inactive source warning without blocking an eligible handover", async () => {
    const response = await previewTransfer(jsonRequest("/api/v1/mtm/contact-transfers/preview", baseInput))
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data).toMatchObject({
      warnings: ["SOURCE_AGENT_INACTIVE"],
      summary: { selected: 1, transferable: 1, excluded: 0 },
      rows: [{ contactId: CONTACT, currentAssignmentId: ASSIGNMENT, transferable: true, issues: [] }],
    })
    expect(payload.data.previewToken).toMatch(/^[a-f0-9]{64}$/)
  })

  it("excludes open-visit and published-route conflicts from the preview", async () => {
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ contactId: CONTACT }] as any)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{ contactId: CONTACT }] as any)
    const response = await previewTransfer(jsonRequest("/api/v1/mtm/contact-transfers/preview", baseInput))
    const payload = await response.json()
    expect(payload.data.summary).toMatchObject({ transferable: 0, excluded: 1, openVisitConflicts: 1, routePlanConflicts: 1 })
    expect(payload.data.rows[0].issues).toEqual(["OPEN_VISIT_CONFLICT", "ROUTE_PLAN_CONFLICT"])
  })

  it("shows open task impact without silently reassigning those tasks", async () => {
    vi.mocked(prisma.mtmTask.findMany).mockResolvedValue([
      { visit: { contactId: CONTACT } },
      { visit: { contactId: CONTACT } },
    ] as any)
    const response = await previewTransfer(jsonRequest("/api/v1/mtm/contact-transfers/preview", baseInput))
    const payload = await response.json()
    expect(payload.data.summary).toMatchObject({
      transferable: 1,
      openTasks: 2,
      contactsWithOpenTasks: 1,
    })
    expect(payload.data.rows[0]).toMatchObject({
      contactId: CONTACT,
      openTaskCount: 2,
      transferable: true,
    })
    expect(prisma.mtmTask.updateMany).not.toHaveBeenCalled()
  })

  it("executes the reviewed batch transactionally and writes the result audit", async () => {
    const previewResponse = await previewTransfer(jsonRequest("/api/v1/mtm/contact-transfers/preview", baseInput))
    const preview = (await previewResponse.json()).data
    const response = await executeTransfer(jsonRequest("/api/v1/mtm/contact-transfers", {
      ...baseInput,
      previewToken: preview.previewToken,
      idempotencyKey: "contact-transfer-20260722-001",
      reason: "Territory ownership changed",
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, data: { summary: { transferred: 1 } } })
    expect(prisma.mtmContactAgentAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: ASSIGNMENT, agentId: SOURCE }),
      data: { effectiveTo: new Date("2026-07-22T00:00:00.000Z"), reason: "Territory ownership changed" },
    }))
    expect(prisma.mtmContactAgentAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contactId: CONTACT, agentId: TARGET, source: "BULK_TRANSFER" }),
      select: { id: true },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CONTACT_BULK_TRANSFER", metadataKind: "contact_bulk_transfer" }),
    })
  })

  it("rejects a stale preview before changing assignment history", async () => {
    const response = await executeTransfer(jsonRequest("/api/v1/mtm/contact-transfers", {
      ...baseInput,
      previewToken: "0".repeat(64),
      idempotencyKey: "contact-transfer-20260722-002",
      reason: "Territory ownership changed",
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_TRANSFER_STALE_PREVIEW" })
    expect(prisma.mtmContactAgentAssignment.updateMany).not.toHaveBeenCalled()
  })

  it("replays a completed operation and rejects reuse for a different request", async () => {
    const previewResponse = await previewTransfer(jsonRequest("/api/v1/mtm/contact-transfers/preview", baseInput))
    const preview = (await previewResponse.json()).data
    const request = {
      ...baseInput,
      previewToken: preview.previewToken,
      idempotencyKey: "contact-transfer-20260722-003",
      reason: "Territory ownership changed",
    }
    const first = await executeTransfer(jsonRequest("/api/v1/mtm/contact-transfers", request))
    const firstPayload = await first.json()
    const createArgs = vi.mocked(prisma.mtmContactTransferOperation.create).mock.calls[0][0] as any
    vi.mocked(prisma.mtmContactTransferOperation.findUnique).mockResolvedValue({
      requestHash: createArgs.data.requestHash,
      status: "COMPLETED",
      result: firstPayload.data,
    } as any)

    const replay = await executeTransfer(jsonRequest("/api/v1/mtm/contact-transfers", request))
    expect(await replay.json()).toMatchObject({ success: true, idempotentReplay: true })

    const mismatch = await executeTransfer(jsonRequest("/api/v1/mtm/contact-transfers", { ...request, reason: "Another batch" }))
    expect(mismatch.status).toBe(409)
    expect(await mismatch.json()).toMatchObject({ code: "MTM_CONTACT_TRANSFER_IDEMPOTENCY_MISMATCH" })
  })

  it("reconciles a stored operation against both effective-dated assignment rows", async () => {
    vi.mocked(prisma.mtmContactTransferOperation.findUnique).mockResolvedValue({
      idempotencyKey: "contact-transfer-20260722-004",
      sourceAgentId: SOURCE,
      targetAgentId: TARGET,
      effectiveFrom: new Date("2026-07-22T00:00:00.000Z"),
      status: "COMPLETED",
      completedAt: new Date("2026-07-22T12:00:00.000Z"),
      result: {
        operationId: "contact-transfer-20260722-004",
        effectiveFrom: "2026-07-22",
        sourceAgent: { id: SOURCE, name: "Old Agent" },
        targetAgent: { id: TARGET, name: "New Agent" },
        summary: { selected: 1, transferred: 1, excluded: 0 },
        transferred: [{
          contactId: CONTACT,
          previousAssignmentId: ASSIGNMENT,
          assignmentId: "assignment-new",
        }],
      },
    } as any)
    vi.mocked(prisma.mtmContactAgentAssignment.findMany).mockResolvedValue([
      {
        id: ASSIGNMENT,
        contactId: CONTACT,
        agentId: SOURCE,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-07-22T00:00:00.000Z"),
        deletedAt: null,
      },
      {
        id: "assignment-new",
        contactId: CONTACT,
        agentId: TARGET,
        effectiveFrom: new Date("2026-07-22T00:00:00.000Z"),
        effectiveTo: null,
        deletedAt: null,
      },
    ] as any)

    const response = await reconcileTransfer(getRequest(
      "/api/v1/mtm/contact-transfers?operationId=contact-transfer-20260722-004",
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        operationId: "contact-transfer-20260722-004",
        summary: { selected: 1, transferred: 1, excluded: 0 },
        reconciliation: { status: "VERIFIED", expected: 1, verified: 1, mismatched: 0 },
      },
    })
    expect(prisma.mtmContactTransferOperation.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_idempotencyKey: {
          organizationId: ORG,
          idempotencyKey: "contact-transfer-20260722-004",
        },
      },
    }))
  })

  it("reports a reconciliation mismatch without rewriting assignment history", async () => {
    vi.mocked(prisma.mtmContactTransferOperation.findUnique).mockResolvedValue({
      idempotencyKey: "contact-transfer-20260722-005",
      sourceAgentId: SOURCE,
      targetAgentId: TARGET,
      effectiveFrom: new Date("2026-07-22T00:00:00.000Z"),
      status: "COMPLETED",
      completedAt: new Date("2026-07-22T12:00:00.000Z"),
      result: {
        sourceAgent: { id: SOURCE, name: "Old Agent" },
        targetAgent: { id: TARGET, name: "New Agent" },
        summary: { selected: 1, transferred: 1, excluded: 0 },
        transferred: [{ contactId: CONTACT, previousAssignmentId: ASSIGNMENT, assignmentId: "assignment-missing" }],
      },
    } as any)
    vi.mocked(prisma.mtmContactAgentAssignment.findMany).mockResolvedValue([])

    const response = await reconcileTransfer(getRequest(
      "/api/v1/mtm/contact-transfers?operationId=contact-transfer-20260722-005",
    ))
    expect(await response.json()).toMatchObject({
      data: { reconciliation: { status: "MISMATCH", expected: 1, verified: 0, mismatched: 1 } },
    })
    expect(prisma.mtmContactAgentAssignment.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmContactAgentAssignment.create).not.toHaveBeenCalled()
  })

  it("does not expose the operation to an agent role", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: SOURCE, role: "AGENT" } as any)
    const response = await previewTransfer(jsonRequest("/api/v1/mtm/contact-transfers/preview", baseInput))
    expect(response.status).toBe(403)
    expect(prisma.mtmContact.findMany).not.toHaveBeenCalled()
  })
})
