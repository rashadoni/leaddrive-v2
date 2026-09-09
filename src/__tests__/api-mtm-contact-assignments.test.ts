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

import { POST as previewAssignment } from "@/app/api/v1/mtm/contact-assignments/preview/route"
import { POST as executeAssignment } from "@/app/api/v1/mtm/contact-assignments/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const TARGET = "cm000000000000000000001"
const CONTACT = "cm000000000000000000002"
const ASSIGNMENT = "cm000000000000000000003"
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

function contact(assignments: unknown[] = []) {
  return {
    id: CONTACT,
    displayName: "Dr Farid",
    status: "ACTIVE",
    agentAssignments: assignments,
  }
}

const assignInput = {
  contactIds: [CONTACT],
  mode: "ASSIGN" as const,
  targetAgentId: TARGET,
  effectiveFrom: "2026-07-30",
  reason: "Published field ownership",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: TARGET,
    name: "Agent Two",
    status: "ACTIVE",
    role: "AGENT",
  } as any)
  vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([contact()] as any)
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContactAssignmentOperation.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmContactAssignmentOperation.create).mockResolvedValue({ id: "operation-1" } as any)
  vi.mocked(prisma.mtmContactAssignmentOperation.update).mockResolvedValue({ id: "operation-1" } as any)
  vi.mocked(prisma.mtmContactAgentAssignment.updateMany).mockResolvedValue({ count: 1 } as any)
  vi.mocked(prisma.mtmContactAgentAssignment.create).mockResolvedValue({ id: "assignment-new" } as any)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as any)
})

describe("MTM governed contact assignment", () => {
  it("previews and assigns an unassigned existing contact", async () => {
    const previewResponse = await previewAssignment(jsonRequest("/preview", assignInput))
    expect(previewResponse.status).toBe(200)
    const preview = (await previewResponse.json()).data
    expect(preview).toMatchObject({
      summary: { selected: 1, assignable: 1, excluded: 0, unassigned: 1 },
      rows: [{ contactId: CONTACT, currentAssignmentIds: [], assignable: true }],
    })

    const response = await executeAssignment(jsonRequest("/execute", {
      ...assignInput,
      previewToken: preview.previewToken,
      idempotencyKey: "contact-assignment-20260730-001",
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { summary: { changed: 1 } },
    })
    expect(prisma.mtmContactAgentAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId: CONTACT,
        agentId: TARGET,
        source: "BULK_ASSIGNMENT",
      }),
      select: { id: true },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CONTACT_BULK_ASSIGN" }),
    })
  })

  it("ends the current primary assignment without deleting the contact", async () => {
    vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([contact([{
      id: ASSIGNMENT,
      agentId: TARGET,
      role: "PRIMARY",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
    }])] as any)
    const input = {
      contactIds: [CONTACT],
      mode: "UNASSIGN" as const,
      targetAgentId: null,
      effectiveFrom: "2026-07-30",
      reason: "Return to the unassigned pool",
    }
    const preview = (await (await previewAssignment(jsonRequest("/preview", input))).json()).data
    const response = await executeAssignment(jsonRequest("/execute", {
      ...input,
      previewToken: preview.previewToken,
      idempotencyKey: "contact-unassignment-20260730-001",
    }))
    expect(response.status).toBe(200)
    expect(prisma.mtmContactAgentAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: ASSIGNMENT, contactId: CONTACT }),
      data: {
        effectiveTo: new Date("2026-07-30T00:00:00.000Z"),
        reason: "Return to the unassigned pool",
      },
    }))
    expect(prisma.mtmContactAgentAssignment.create).not.toHaveBeenCalled()
    expect(prisma.mtmContact.delete).not.toHaveBeenCalled()
  })

  it("excludes operational conflicts and denies field agents", async () => {
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ contactId: CONTACT }] as any)
    vi.mocked(prisma.mtmRoutePoint.findMany).mockResolvedValue([{ contactId: CONTACT }] as any)
    const preview = await previewAssignment(jsonRequest("/preview", assignInput))
    expect((await preview.json()).data.rows[0].issues).toEqual([
      "OPEN_VISIT_CONFLICT",
      "ROUTE_PLAN_CONFLICT",
    ])

    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: TARGET, role: "AGENT" } as any)
    const forbidden = await previewAssignment(jsonRequest("/preview", assignInput))
    expect(forbidden.status).toBe(403)
  })
})
