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

import { GET as getFormulas, POST as createFormula } from "@/app/api/v1/mtm/doctor-scoring/formulas/route"
import { POST as activateFormula } from "@/app/api/v1/mtm/doctor-scoring/formulas/[id]/activate/route"
import { GET as getAssessments, POST as createAssessment } from "@/app/api/v1/mtm/contacts/[id]/assessments/route"
import { POST as decideAssessment } from "@/app/api/v1/mtm/doctor-assessments/[id]/decision/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { professionalDefinitionHash } from "@/lib/mtm/professional-glossary"

const ORG = "org-1"
const CONTACT = "cm000000000000000000101"
const FORMULA = "cm000000000000000000102"
const ASSESSMENT = "cm000000000000000000103"
const ADMIN_AUTH: AuthResult = { orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }
const AGENT_AUTH: AuthResult = { orgId: ORG, userId: "agent-user", role: "sales", email: "agent@example.com", name: "Agent" }

const glossaryTerm = (label: string) => ({
  labels: { ru: label, az: label, en: label },
  definitions: { ru: `${label} definition`, az: `${label} definition`, en: `${label} definition` },
})
const GOVERNED_DEFINITION = {
  engine: "server",
  weights: { patientsPerMonth: 0.4, kol: 0.6 },
  glossary: {
    schemaVersion: 1,
    terms: {
      balance: glossaryTerm("Balance"), potential: glossaryTerm("Potential"),
      coverageDisclosure: glossaryTerm("Coverage"), doctorCategory: glossaryTerm("Category"),
      kol: glossaryTerm("KOL"), profile: glossaryTerm("Profile"),
    },
  },
  authority: {
    sourceSystem: "SwissMed approved master data",
    sourceReference: "SWM-04/2026.1",
    sourceObservedAt: "2026-07-01T09:00:00.000Z",
    approvalReference: "SWM-CAB-041",
  },
}
const DEFINITION_HASH = professionalDefinitionHash(GOVERNED_DEFINITION)
const GOVERNED_FORMULA = {
  id: FORMULA,
  version: "2026.1",
  definition: GOVERNED_DEFINITION,
  definitionHash: DEFINITION_HASH,
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

function assessmentBody(overrides: Record<string, unknown> = {}) {
  return {
    clientAssessmentId: "device-assessment-0001",
    formulaId: FORMULA,
    office: "Room 12",
    patientsPerMonth: 320,
    bedCount: 40,
    isKol: true,
    kolLevel: "Regional",
    profile: "Pediatrician",
    psychotype: "Analytical",
    granularCategory: "B2",
    actualScore: 72.5,
    targetScore: 80,
    periodStart: "2026-07-01",
    source: "MANAGER_INTERVIEW",
    provenance: { evidence: "clinic interview", receivedAt: "2026-07-20" },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-21T09:00:00.000Z"))
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
})

describe("GAP-004 doctor scoring formulas", () => {
  it("returns the governed formula history and administrator capability", async () => {
    vi.mocked(prisma.mtmDoctorScoringFormula.findMany).mockResolvedValue([
      { id: FORMULA, version: "2026.1", status: "ACTIVE", signedAt: new Date("2026-07-01T09:00:00.000Z") },
      { id: "formula-retired", version: "2025.4", status: "RETIRED", retiredAt: new Date("2026-07-01T09:00:00.000Z") },
    ] as never)

    const response = await getFormulas(request("/api/v1/mtm/doctor-scoring/formulas"))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        capabilities: { canConfigure: true },
        formulas: [
          { id: FORMULA, status: "ACTIVE" },
          { id: "formula-retired", status: "RETIRED" },
        ],
      },
    })
    expect(prisma.mtmDoctorScoringFormula.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    })
  })

  it("creates an immutable draft formula for an MTM administrator", async () => {
    vi.mocked(prisma.mtmDoctorScoringFormula.create).mockResolvedValue({
      id: FORMULA,
      organizationId: ORG,
      version: "2026.1",
      status: "DRAFT",
    } as never)

    const response = await createFormula(request("/api/v1/mtm/doctor-scoring/formulas", "POST", {
      version: "2026.1",
      name: "Pharma doctor score",
      definition: GOVERNED_DEFINITION,
    }))

    expect(response.status).toBe(201)
    expect(prisma.mtmDoctorScoringFormula.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: ORG, status: "DRAFT", createdBy: "admin-user" }),
    })
  })

  it("keeps formula configuration unavailable to a field agent", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as never)

    const response = await createFormula(request("/api/v1/mtm/doctor-scoring/formulas", "POST", {
      version: "2026.2",
      name: "Unauthorized formula",
      definition: { engine: "server" },
    }))

    expect(response.status).toBe(403)
    expect(prisma.mtmDoctorScoringFormula.create).not.toHaveBeenCalled()
  })

  it("signs one formula and retires the previous active version transactionally", async () => {
    vi.mocked(prisma.mtmDoctorScoringFormula.findFirst)
      .mockResolvedValueOnce({ ...GOVERNED_FORMULA, organizationId: ORG, status: "DRAFT", signedAt: null } as never)
      .mockResolvedValueOnce({ id: FORMULA, organizationId: ORG, status: "ACTIVE" } as never)
    vi.mocked(prisma.mtmDoctorScoringFormula.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)

    const response = await activateFormula(
      request(`/api/v1/mtm/doctor-scoring/formulas/${FORMULA}/activate`, "POST", {
        expectedDefinitionHash: DEFINITION_HASH,
        approvalReference: "SWM-CAB-041",
      }),
      { params: Promise.resolve({ id: FORMULA }) },
    )

    expect(response.status).toBe(200)
    expect(prisma.mtmDoctorScoringFormula.updateMany).toHaveBeenNthCalledWith(1, {
      where: { organizationId: ORG, status: "ACTIVE" },
      data: expect.objectContaining({ status: "RETIRED" }),
    })
    expect(prisma.mtmDoctorScoringFormula.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: FORMULA,
        organizationId: ORG,
        status: "DRAFT",
        definitionHash: DEFINITION_HASH,
        approvalReference: "SWM-CAB-041",
        signedAt: null,
      },
      data: expect.objectContaining({ status: "ACTIVE", signedBy: "admin-user" }),
    })
  })
})

describe("GAP-004 append-only doctor assessments", () => {
  it("keeps the Agent role read-only", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as never)

    const response = await createAssessment(
      request(`/api/v1/mtm/contacts/${CONTACT}/assessments`, "POST", assessmentBody()),
      { params: Promise.resolve({ id: CONTACT }) },
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_DOCTOR_ASSESSMENT_READ_ONLY" })
    expect(prisma.mtmDoctorAssessment.create).not.toHaveBeenCalled()
  })

  it("refuses scoring against an unsigned or retired formula", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: CONTACT, displayName: "Doctor One" } as never)
    vi.mocked(prisma.mtmDoctorAssessment.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmDoctorScoringFormula.findFirst).mockResolvedValue(null)

    const response = await createAssessment(
      request(`/api/v1/mtm/contacts/${CONTACT}/assessments`, "POST", assessmentBody()),
      { params: Promise.resolve({ id: CONTACT }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_PROFESSIONAL_GLOSSARY_NOT_ACTIVE" })
    expect(prisma.mtmDoctorAssessment.create).not.toHaveBeenCalled()
  })

  it("appends the received value and provenance without evaluating a mobile formula", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: CONTACT, displayName: "Doctor One" } as never)
    vi.mocked(prisma.mtmDoctorAssessment.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmDoctorScoringFormula.findFirst).mockResolvedValue(GOVERNED_FORMULA as never)
    vi.mocked(prisma.mtmDoctorAssessment.create).mockResolvedValue({
      id: ASSESSMENT,
      contactId: CONTACT,
      status: "PENDING",
      formulaVersion: "2026.1",
    } as never)

    const response = await createAssessment(
      request(`/api/v1/mtm/contacts/${CONTACT}/assessments`, "POST", assessmentBody()),
      { params: Promise.resolve({ id: CONTACT }) },
    )

    expect(response.status).toBe(201)
    expect(prisma.mtmDoctorAssessment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        contactId: CONTACT,
        formulaVersion: "2026.1",
        status: "PENDING",
        source: "MANAGER_INTERVIEW",
        provenance: expect.objectContaining({
          evidence: "clinic interview",
          receivedAt: "2026-07-20",
          professionalGlossary: expect.objectContaining({
            definitionHash: DEFINITION_HASH,
            approvalReference: "SWM-CAB-041",
          }),
        }),
      }),
    })
  })

  it("rejects an idempotency key reused with different content", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: CONTACT, displayName: "Doctor One" } as never)
    vi.mocked(prisma.mtmDoctorAssessment.findFirst).mockResolvedValue({
      id: ASSESSMENT,
      contactId: CONTACT,
      requestHash: "different-hash",
    } as never)

    const response = await createAssessment(
      request(`/api/v1/mtm/contacts/${CONTACT}/assessments`, "POST", assessmentBody()),
      { params: Promise.resolve({ id: CONTACT }) },
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_DOCTOR_ASSESSMENT_IDEMPOTENCY_CONFLICT" })
  })

  it("lets a scoped manager verify once while preserving assessment content", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "manager-1", role: "MANAGER" } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1" }] as never)
    vi.mocked(prisma.mtmDoctorAssessment.findFirst)
      .mockResolvedValueOnce({ id: ASSESSMENT, organizationId: ORG, status: "PENDING", actualScore: "72.5" } as never)
      .mockResolvedValueOnce({ id: ASSESSMENT, organizationId: ORG, status: "VERIFIED", actualScore: "72.5" } as never)
    vi.mocked(prisma.mtmDoctorAssessment.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await decideAssessment(
      request(`/api/v1/mtm/doctor-assessments/${ASSESSMENT}/decision`, "POST", {
        decision: "VERIFIED",
        comment: "Clinic evidence checked",
      }),
      { params: Promise.resolve({ id: ASSESSMENT }) },
    )
    expect(response.status).toBe(200)
    expect(prisma.mtmDoctorAssessment.updateMany).toHaveBeenCalledWith({
      where: { id: ASSESSMENT, organizationId: ORG, status: "PENDING" },
      data: expect.not.objectContaining({ actualScore: expect.anything() }),
    })
  })

  it("returns assessment history to an in-scope Agent", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as never)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ id: CONTACT, displayName: "Doctor One" } as never)
    vi.mocked(prisma.mtmDoctorAssessment.findMany).mockResolvedValue([{ id: ASSESSMENT, status: "VERIFIED" }] as never)

    const response = await getAssessments(
      request(`/api/v1/mtm/contacts/${CONTACT}/assessments`),
      { params: Promise.resolve({ id: CONTACT }) },
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.capabilities).toEqual({ canAssess: false, canReview: false })
    expect(json.data.assessments).toHaveLength(1)
  })
})
