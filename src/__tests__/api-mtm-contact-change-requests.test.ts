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
import { POST as submitChange } from "@/app/api/v1/mtm/contacts/[id]/change-requests/route"
import { POST as decideChange } from "@/app/api/v1/mtm/contact-change-requests/[id]/decision/route"
import { GET as getContact, PUT as updateContact } from "@/app/api/v1/mtm/contacts/[id]/route"
import { POST as createContact } from "@/app/api/v1/mtm/contacts/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const CONTACT_ID = "cm000000000000000000001"
const DUPLICATE_TARGET_ID = "cm000000000000000000004"
const DUPLICATE_IDEMPOTENCY_KEY = ["duplicate", "operation", "test", "one"].join("-")
const AGENT_ID = "cm000000000000000000002"
const MANAGER_ID = "cm000000000000000000003"
const UPDATED_AT = new Date("2026-07-21T08:00:00.000Z")

const ADMIN_AUTH: AuthResult = { orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" }
const AGENT_AUTH: AuthResult = { orgId: ORG, userId: "agent-user", role: "sales", email: "agent@example.com", name: "Agent" }

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
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
  vi.mocked(prisma.mtmNotification.create).mockResolvedValue({ id: "notification-1" } as never)
})

describe("GAP-003 contact master-data review", () => {
  it("enforces tenant-required fields when an administrator creates a contact", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "contactRequiredFields", value: ["firstName", "lastName", "specialtyName"] },
    ] as never)

    const response = await createContact(jsonRequest("/api/v1/mtm/contacts", "POST", {
      firstName: "One",
      lastName: "Doctor",
    }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: "MTM_CONTACT_REQUIRED_FIELDS",
      data: { fields: ["specialtyName"] },
    })
    expect(prisma.mtmContact.create).not.toHaveBeenCalled()
  })

  it("returns the scoped contact master card with workplace and governance projections", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: CONTACT_ID,
      organizationId: ORG,
      displayName: "Doctor One",
      workplaces: [{
        id: "workplace-1",
        customerId: "customer-1",
        isPrimary: true,
        endedOn: null,
        customer: { id: "customer-1", name: "Clinic One" },
      }],
      agentAssignments: [],
      fieldPotentials: [],
      doctorAssessments: [],
      dictionaryAssignments: [],
      changeRequests: [],
      duplicateOfContact: null,
    } as never)
    vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: AGENT_ID, name: "Field Agent", role: "AGENT" },
    ] as never)

    const response = await getContact(
      new NextRequest(`http://localhost:3000/api/v1/mtm/contacts/${CONTACT_ID}`),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        contact: {
          id: CONTACT_ID,
          workplaces: [{
            id: "workplace-1",
            customer: { id: "customer-1", name: "Clinic One" },
          }],
        },
        brandPotentialAgents: [
          { id: AGENT_ID, name: "Field Agent", role: "AGENT" },
        ],
        capabilities: {
          actorAgentId: null,
          actorRole: "ADMIN",
          canManage: true,
          canRequestChanges: false,
        },
        contactPolicy: {
          requiredFields: ["firstName", "lastName"],
        },
      },
    })
    expect(prisma.mtmContact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: CONTACT_ID, organizationId: ORG, deletedAt: null }),
      include: expect.objectContaining({
        workplaces: expect.any(Object),
        agentAssignments: expect.any(Object),
        changeRequests: expect.any(Object),
        fieldPotentials: expect.objectContaining({
          include: expect.objectContaining({
            agent: expect.any(Object),
            enteredByAgent: expect.any(Object),
            reviewedByAgent: expect.any(Object),
            evidenceVisits: expect.any(Object),
          }),
        }),
        doctorAssessments: expect.objectContaining({
          include: expect.objectContaining({
            formula: expect.any(Object),
            enteredByAgent: expect.any(Object),
            reviewedByAgent: expect.any(Object),
          }),
        }),
      }),
    }))
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: ORG, status: "ACTIVE" },
      select: { id: true, name: true, role: true },
    }))
  })

  it("keeps an Agent field edit pending instead of changing the contact", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst)
      .mockResolvedValueOnce({ id: AGENT_ID, role: "AGENT" } as never)
      .mockResolvedValueOnce({ id: AGENT_ID, name: "Field Agent", managerId: MANAGER_ID } as never)
    vi.mocked(prisma.mtmContactChangeRequest.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: CONTACT_ID,
      firstName: "One",
      lastName: "Doctor",
      displayName: "Doctor One",
      updatedAt: UPDATED_AT,
    } as never)
    vi.mocked(prisma.mtmContactChangeRequest.create).mockResolvedValue({
      id: "request-1",
      organizationId: ORG,
      contactId: CONTACT_ID,
      requestedByAgentId: AGENT_ID,
      kind: "CONTACT_UPDATE",
      status: "SUBMITTED",
    } as never)

    const response = await submitChange(
      jsonRequest(`/api/v1/mtm/contacts/${CONTACT_ID}/change-requests`, "POST", {
        idempotencyKey: "device-op-123456",
        reason: "Phone confirmed during visit",
        expectedContactUpdatedAt: UPDATED_AT.toISOString(),
        kind: "CONTACT_UPDATE",
        payload: { mobilePhone: "+994501112233", contactPreference: "WHATSAPP" },
      }),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(201)
    expect(prisma.mtmContact.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmContactChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contactId: CONTACT_ID,
        requestedByAgentId: AGENT_ID,
        kind: "CONTACT_UPDATE",
        payload: { mobilePhone: "+994501112233", contactPreference: "WHATSAPP" },
      }),
    }))
  })

  it("rejects an Agent proposal that leaves a tenant-required field empty", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "contactRequiredFields", value: ["firstName", "lastName", "mobilePhone"] },
    ] as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT_ID, role: "AGENT" } as never)
    vi.mocked(prisma.mtmContactChangeRequest.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: CONTACT_ID,
      firstName: "One",
      lastName: "Doctor",
      mobilePhone: null,
      displayName: "Doctor One",
      updatedAt: UPDATED_AT,
    } as never)

    const response = await submitChange(
      jsonRequest(`/api/v1/mtm/contacts/${CONTACT_ID}/change-requests`, "POST", {
        idempotencyKey: "required-field-proposal-123",
        reason: "Reviewed during visit",
        expectedContactUpdatedAt: UPDATED_AT.toISOString(),
        kind: "CONTACT_UPDATE",
        payload: { notes: "Reviewed" },
      }),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: "MTM_CONTACT_REQUIRED_FIELDS",
      data: { fields: ["mobilePhone"] },
    })
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("accepts only a scoped canonical contact as a duplicate-report target", async () => {
    vi.mocked(requireAuth).mockResolvedValue(AGENT_AUTH)
    vi.mocked(prisma.mtmAgent.findFirst)
      .mockResolvedValueOnce({ id: AGENT_ID, role: "AGENT" } as never)
      .mockResolvedValueOnce({ id: AGENT_ID, name: "Field Agent", managerId: MANAGER_ID } as never)
    vi.mocked(prisma.mtmContactChangeRequest.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.mtmContact.findFirst)
      .mockResolvedValueOnce({ id: CONTACT_ID, displayName: "Doctor One", updatedAt: UPDATED_AT } as never)
      .mockResolvedValueOnce({ id: DUPLICATE_TARGET_ID } as never)
    vi.mocked(prisma.mtmContactChangeRequest.create).mockResolvedValue({
      id: "request-duplicate-1",
      organizationId: ORG,
      contactId: CONTACT_ID,
      requestedByAgentId: AGENT_ID,
      kind: "DUPLICATE_REPORT",
      status: "SUBMITTED",
    } as never)

    const response = await submitChange(
      jsonRequest(`/api/v1/mtm/contacts/${CONTACT_ID}/change-requests`, "POST", {
        idempotencyKey: DUPLICATE_IDEMPOTENCY_KEY,
        reason: "Same name, phone and workplace",
        expectedContactUpdatedAt: UPDATED_AT.toISOString(),
        kind: "DUPLICATE_REPORT",
        payload: { targetContactId: DUPLICATE_TARGET_ID },
      }),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(201)
    expect(prisma.mtmContact.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        id: DUPLICATE_TARGET_ID,
        organizationId: ORG,
        deletedAt: null,
        status: { notIn: ["DUPLICATE", "MERGED"] },
      }),
    }))
    expect(prisma.mtmContactChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "DUPLICATE_REPORT",
        payload: { targetContactId: DUPLICATE_TARGET_ID },
      }),
    }))
  })

  it("lets a Manager/Admin edit the expanded contact schema directly with audit", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: CONTACT_ID,
      organizationId: ORG,
      firstName: "One",
      lastName: "Doctor",
      middleName: null,
      displayName: "Doctor One",
      updatedAt: UPDATED_AT,
    } as never)
    vi.mocked(prisma.mtmContact.updateMany).mockResolvedValue({ count: 1 } as never)

    const response = await updateContact(
      jsonRequest(`/api/v1/mtm/contacts/${CONTACT_ID}`, "PUT", {
        expectedContactUpdatedAt: UPDATED_AT.toISOString(),
        workPhone: "+994124445566",
        whatsappPhone: "+994501112233",
        addressRegion: "Baku",
        addressStreet: "Nizami 10",
        consentStatus: "GRANTED",
        verificationStatus: "VERIFIED",
      }),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(200)
    expect(prisma.mtmContact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workPhone: "+994124445566",
        whatsappPhone: "+994501112233",
        addressRegion: "Baku",
        addressStreet: "Nizami 10",
        consentStatus: "GRANTED",
        verificationStatus: "VERIFIED",
        verifiedBy: "admin-user",
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalled()
  })

  it("rejects a stale Manager edit before mutating the contact", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: CONTACT_ID,
      organizationId: ORG,
      firstName: "One",
      lastName: "Doctor",
      middleName: null,
      displayName: "Doctor One",
      updatedAt: new Date("2026-07-21T08:30:00.000Z"),
    } as never)

    const response = await updateContact(
      jsonRequest(`/api/v1/mtm/contacts/${CONTACT_ID}`, "PUT", {
        expectedContactUpdatedAt: UPDATED_AT.toISOString(),
        mobilePhone: "+994501112233",
      }),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_CONFLICT" })
    expect(prisma.mtmContact.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a Manager edit that leaves a tenant-required field empty", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "contactRequiredFields", value: ["firstName", "lastName", "mobilePhone"] },
    ] as never)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: CONTACT_ID,
      organizationId: ORG,
      firstName: "One",
      lastName: "Doctor",
      mobilePhone: null,
      updatedAt: UPDATED_AT,
    } as never)

    const response = await updateContact(
      jsonRequest(`/api/v1/mtm/contacts/${CONTACT_ID}`, "PUT", {
        expectedContactUpdatedAt: UPDATED_AT.toISOString(),
        notes: "Reviewed",
      }),
      { params: Promise.resolve({ id: CONTACT_ID }) },
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: "MTM_CONTACT_REQUIRED_FIELDS",
      data: { fields: ["mobilePhone"] },
    })
    expect(prisma.mtmContact.updateMany).not.toHaveBeenCalled()
  })

  it("applies an approved Agent proposal exactly once", async () => {
    const contact = {
      id: CONTACT_ID,
      organizationId: ORG,
      firstName: "One",
      lastName: "Doctor",
      middleName: null,
      displayName: "Doctor One",
      updatedAt: UPDATED_AT,
      deletedAt: null,
    }
    vi.mocked(prisma.mtmContactChangeRequest.findFirst).mockResolvedValue({
      id: "request-1",
      organizationId: ORG,
      contactId: CONTACT_ID,
      requestedByAgentId: AGENT_ID,
      requestedByAgent: { id: AGENT_ID, name: "Field Agent" },
      kind: "CONTACT_UPDATE",
      status: "SUBMITTED",
      expectedContactUpdatedAt: UPDATED_AT,
      payload: { mobilePhone: "+994501112233" },
      contact,
    } as never)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue(contact as never)
    vi.mocked(prisma.mtmContactChangeRequest.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmContact.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmContactChangeRequest.update).mockResolvedValue({ id: "request-1", status: "APPROVED" } as never)

    const response = await decideChange(
      jsonRequest("/api/v1/mtm/contact-change-requests/request-1/decision", "POST", {
        decision: "APPROVED",
        comment: "Verified against the clinic registry",
      }),
      { params: Promise.resolve({ id: "request-1" }) },
    )

    expect(response.status).toBe(200)
    expect(prisma.mtmContact.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.mtmContactChangeRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "APPROVED", reviewedBy: "admin-user" }),
    }))
  })

  it("fails closed when the contact changed after Agent submission", async () => {
    const stale = { id: CONTACT_ID, updatedAt: UPDATED_AT, firstName: "One", lastName: "Doctor", middleName: null, displayName: "Doctor One" }
    vi.mocked(prisma.mtmContactChangeRequest.findFirst).mockResolvedValue({
      id: "request-1",
      organizationId: ORG,
      contactId: CONTACT_ID,
      requestedByAgentId: AGENT_ID,
      requestedByAgent: { id: AGENT_ID, name: "Field Agent" },
      kind: "CONTACT_UPDATE",
      status: "SUBMITTED",
      expectedContactUpdatedAt: UPDATED_AT,
      payload: { mobilePhone: "+994501112233" },
      contact: stale,
    } as never)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({ ...stale, updatedAt: new Date("2026-07-21T08:30:00.000Z") } as never)

    const response = await decideChange(
      jsonRequest("/api/v1/mtm/contact-change-requests/request-1/decision", "POST", {
        decision: "APPROVED",
        comment: "Approve",
      }),
      { params: Promise.resolve({ id: "request-1" }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_CONFLICT" })
    expect(prisma.mtmContact.updateMany).not.toHaveBeenCalled()
  })

  it("revalidates the tenant required-field policy when approving an Agent proposal", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "contactRequiredFields", value: ["firstName", "lastName", "mobilePhone"] },
    ] as never)
    const contact = {
      id: CONTACT_ID,
      organizationId: ORG,
      firstName: "One",
      lastName: "Doctor",
      mobilePhone: null,
      updatedAt: UPDATED_AT,
      deletedAt: null,
    }
    vi.mocked(prisma.mtmContactChangeRequest.findFirst).mockResolvedValue({
      id: "request-required-1",
      organizationId: ORG,
      contactId: CONTACT_ID,
      requestedByAgentId: AGENT_ID,
      requestedByAgent: { id: AGENT_ID, name: "Field Agent" },
      kind: "CONTACT_UPDATE",
      status: "SUBMITTED",
      expectedContactUpdatedAt: UPDATED_AT,
      payload: { notes: "Reviewed" },
      contact,
    } as never)
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue(contact as never)

    const response = await decideChange(
      jsonRequest("/api/v1/mtm/contact-change-requests/request-required-1/decision", "POST", {
        decision: "APPROVED",
        comment: "Approve",
      }),
      { params: Promise.resolve({ id: "request-required-1" }) },
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: "MTM_CONTACT_REQUIRED_FIELDS",
      data: { fields: ["mobilePhone"] },
    })
    expect(prisma.mtmContactChangeRequest.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.mtmContact.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmContactChangeRequest.update).not.toHaveBeenCalled()
  })
})
