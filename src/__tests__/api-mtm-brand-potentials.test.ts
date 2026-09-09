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

import { GET as getPotentials, POST as createPotential } from "@/app/api/v1/mtm/contacts/[id]/brand-potentials/route"
import { POST as decidePotential } from "@/app/api/v1/mtm/field-potentials/[id]/decision/route"
import { POST as endPotential } from "@/app/api/v1/mtm/field-potentials/[id]/end/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const CONTACT = "cm000000000000000000201"
const POTENTIAL = "cm000000000000000000202"
const VISIT = "cm000000000000000000203"
const AGENT_AUTH: AuthResult = { orgId: ORG, userId: "agent-user", role: "sales", email: "agent@example.com", name: "Agent" }
const ADMIN_AUTH: AuthResult = { orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }
const GOVERNED_FORMULA = {
  id: "formula-1",
  version: "2026.1",
  definitionHash: "a".repeat(64),
  glossarySchemaVersion: 1,
  approvalReference: "SWM-CAB-041",
  sourceSystem: "SwissMed approved master data",
  sourceReference: "SWM-04/2026.1",
  sourceObservedAt: new Date("2026-07-01T09:00:00.000Z"),
}

function request(path: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    clientPotentialId: "device-potential-0001",
    brandExternalId: "brand-acc",
    brandName: "ACC",
    productExternalId: "product-acc-200",
    productName: "ACC 200 mg tablet",
    categoryLabel: "B2",
    potentialValue: 80,
    coverageValue: 25,
    periodStart: "2026-07-01",
    source: "FIELD_INTERVIEW",
    provenance: { method: "doctor interview" },
    evidenceVisitIds: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-22T10:00:00.000Z"))
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
  vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: CONTACT, displayName: "Doctor One" } as never)
  vi.mocked(prisma.mtmFieldPotential.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmDoctorScoringFormula.findFirst).mockResolvedValue(GOVERNED_FORMULA as never)
})

describe("GAP-005 brand potential workflow", () => {
  it("lets an in-scope Agent append a pending doctor × agent × brand measurement", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT", status: "ACTIVE" } as never)
    vi.mocked(prisma.mtmFieldPotential.create).mockResolvedValue({ id: POTENTIAL, status: "PENDING", brandName: "ACC" } as never)

    const response = await createPotential(
      request(`/api/v1/mtm/contacts/${CONTACT}/brand-potentials`, "POST", body()),
      { params: Promise.resolve({ id: CONTACT }) },
    )

    expect(response.status).toBe(201)
    expect(prisma.mtmFieldPotential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        contactId: CONTACT,
        agentId: "agent-1",
        enteredByAgentId: "agent-1",
        brandExternalId: "brand-acc",
        brandName: "ACC",
        productName: "ACC 200 mg tablet",
        formulaVersion: "2026.1",
        provenance: expect.objectContaining({
          method: "doctor interview",
          professionalGlossary: expect.objectContaining({ definitionHash: "a".repeat(64) }),
        }),
        status: "PENDING",
      }),
      include: expect.any(Object),
    })
  })

  it("makes an authorized manager entry verified and preserves evidence links", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "manager-1", role: "MANAGER", status: "ACTIVE" } as never)
    vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue({ id: "manager-1", teamId: null } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ id: VISIT }] as never)
    vi.mocked(prisma.mtmFieldPotential.create).mockResolvedValue({ id: POTENTIAL, status: "VERIFIED" } as never)

    const response = await createPotential(
      request(`/api/v1/mtm/contacts/${CONTACT}/brand-potentials`, "POST", body({ agentId: "agent-1", evidenceVisitIds: [VISIT] })),
      { params: Promise.resolve({ id: CONTACT }) },
    )

    expect(response.status).toBe(201)
    expect(prisma.mtmFieldPotential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: "agent-1",
        status: "VERIFIED",
        evidenceVisits: { create: [{ organizationId: ORG, visitId: VISIT }] },
      }),
      include: expect.any(Object),
    })
  })

  it("rejects an idempotency key reused with different content", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as never)
    vi.mocked(prisma.mtmFieldPotential.findFirst).mockResolvedValue({ id: POTENTIAL, contactId: CONTACT, requestHash: "different" } as never)
    const response = await createPotential(
      request(`/api/v1/mtm/contacts/${CONTACT}/brand-potentials`, "POST", body()),
      { params: Promise.resolve({ id: CONTACT }) },
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_BRAND_POTENTIAL_IDEMPOTENCY_CONFLICT" })
    expect(prisma.mtmFieldPotential.create).not.toHaveBeenCalled()
  })

  it("rejects evidence that is not a completed scoped visit for the doctor", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT", status: "ACTIVE" } as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    const response = await createPotential(
      request(`/api/v1/mtm/contacts/${CONTACT}/brand-potentials`, "POST", body({ evidenceVisitIds: [VISIT] })),
      { params: Promise.resolve({ id: CONTACT }) },
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_BRAND_POTENTIAL_EVIDENCE_INVALID" })
  })

  it("lets a scoped manager validate a pending row without changing its values", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "manager-1", role: "MANAGER" } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }] as never)
    vi.mocked(prisma.mtmFieldPotential.findFirst)
      .mockResolvedValueOnce({ id: POTENTIAL, status: "PENDING", potentialValue: "80" } as never)
      .mockResolvedValueOnce({ id: POTENTIAL, status: "VERIFIED", potentialValue: "80" } as never)
    vi.mocked(prisma.mtmFieldPotential.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await decidePotential(
      request(`/api/v1/mtm/field-potentials/${POTENTIAL}/decision`, "POST", { decision: "VERIFIED", comment: "Visit evidence checked" }),
      { params: Promise.resolve({ id: POTENTIAL }) },
    )
    expect(response.status).toBe(200)
    expect(prisma.mtmFieldPotential.updateMany).toHaveBeenCalledWith({
      where: { id: POTENTIAL, organizationId: ORG, status: "PENDING", deletedAt: null },
      data: expect.not.objectContaining({ potentialValue: expect.anything(), coverageValue: expect.anything() }),
    })
  })

  it("returns history, visit drill-down data, and role capabilities", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([{ id: POTENTIAL, status: "VERIFIED" }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([{ id: VISIT, status: "CHECKED_OUT" }] as never)

    const response = await getPotentials(
      request(`/api/v1/mtm/contacts/${CONTACT}/brand-potentials`),
      { params: Promise.resolve({ id: CONTACT }) },
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.capabilities).toEqual({ canRecord: true, canReview: true, perAgentDimension: true })
    expect(json.data.potentials).toHaveLength(1)
    expect(json.data.eligibleVisits).toHaveLength(1)
  })

  it("limits Agent history to shared and self-owned potential rows", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as never)
    vi.mocked(prisma.mtmFieldPotential.findMany).mockResolvedValue([])
    const response = await getPotentials(
      request(`/api/v1/mtm/contacts/${CONTACT}/brand-potentials`),
      { params: Promise.resolve({ id: CONTACT }) },
    )
    expect(response.status).toBe(200)
    expect(prisma.mtmFieldPotential.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ agentId: null }, { agentId: { in: ["agent-1"] } }] }),
    }))
  })

  it("ends the recorder's own period without deleting history", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as never)
    vi.mocked(prisma.mtmFieldPotential.findFirst)
      .mockResolvedValueOnce({ id: POTENTIAL, status: "VERIFIED", enteredByAgentId: "agent-1", periodStart: new Date("2026-07-01") } as never)
      .mockResolvedValueOnce({ id: POTENTIAL, status: "ENDED" } as never)
    vi.mocked(prisma.mtmFieldPotential.updateMany).mockResolvedValue({ count: 1 } as never)
    const response = await endPotential(
      request(`/api/v1/mtm/field-potentials/${POTENTIAL}/end`, "POST", { periodEnd: "2026-07-31", reason: "New cycle" }),
      { params: Promise.resolve({ id: POTENTIAL }) },
    )
    expect(response.status).toBe(200)
    expect(prisma.mtmFieldPotential.updateMany).toHaveBeenCalledWith({
      where: { id: POTENTIAL, organizationId: ORG, status: { not: "ENDED" }, deletedAt: null },
      data: expect.objectContaining({ status: "ENDED", reviewComment: "New cycle" }),
    })
  })
})
