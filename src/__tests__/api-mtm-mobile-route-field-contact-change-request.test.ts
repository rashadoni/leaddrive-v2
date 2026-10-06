import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn(() => Promise.resolve()) }))

import { POST } from "@/app/api/v2/mtm/mobile/route-field/contacts/[id]/change-requests/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { prisma } from "@/lib/prisma"

/**
 * The field app's "propose a change" on a client card. An agent never changes
 * a client; the request waits for a manager exactly like one filed on the
 * website. The app's door is narrower than the website's: only what the app's
 * card shows, only what the organization offers.
 */
const ORG = "org-1"
const AGENT = "agent-1"
const CONTACT = "contact-1"
const UPDATED_AT = new Date("2026-10-01T08:00:00.000Z")

function submit(body: unknown, id = CONTACT) {
  return POST(
    new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/route-field/contacts/${id}/change-requests`, {
      method: "POST",
      headers: { Authorization: "Bearer mobile", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

const request = (changes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  idempotencyKey: "phone-change-0001",
  reason: "Сам врач сказал на визите",
  expectedContactUpdatedAt: UPDATED_AT.toISOString(),
  changes,
  ...extra,
})

function settings(rows: { key: string; value: unknown }[]) {
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue(rows as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({
    orgId: ORG, agentId: AGENT, userId: "user-1", role: "AGENT", email: "agent@test", name: "Agent",
    tenantCapabilities: { routeField: true, workforceHrm: false },
  } as never)
  settings([])
  // First read resolves the actor, the second the requester and their manager.
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: AGENT, role: "AGENT", canPlanOwnRoutes: true, name: "Field Agent", managerId: "manager-1",
  } as never)
  vi.mocked(prisma.mtmContactChangeRequest.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
    id: CONTACT, firstName: "One", lastName: "Doctor", displayName: "Doctor One",
    category: "B", specialtyName: "Kardioloq", updatedAt: UPDATED_AT,
  } as never)
  vi.mocked(prisma.mtmContactChangeRequest.create).mockResolvedValue({
    id: "request-1", contactId: CONTACT, requestedByAgentId: AGENT, kind: "CONTACT_UPDATE", status: "SUBMITTED",
  } as never)
  vi.mocked(prisma.mtmNotification.create).mockResolvedValue({ id: "notification-1" } as never)
})

describe("POST /api/v2/mtm/mobile/route-field/contacts/:id/change-requests", () => {
  it("leaves the request pending for a manager and changes nothing on the client", async () => {
    settings([{ key: "contactClasses", value: ["A", "B", "C", "VIP"] }])

    const response = await submit(request({ category: "VIP" }))

    expect(response.status).toBe(201)
    expect(prisma.mtmContactChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        contactId: CONTACT,
        requestedByAgentId: AGENT,
        kind: "CONTACT_UPDATE",
        reason: "Сам врач сказал на визите",
        payload: { category: "VIP" },
      }),
    }))
    expect(prisma.mtmContact.update).not.toHaveBeenCalled()
    expect(prisma.mtmContact.updateMany).not.toHaveBeenCalled()
    // The agent's manager is told, and the request is in the audit log.
    expect(prisma.mtmNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentId: "manager-1", metadata: { contactChangeRequestId: "request-1", contactId: CONTACT } }),
    }))
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "CONTACT_CHANGE_REQUEST_SUBMIT", entityId: "request-1", agentId: AGENT,
    }))
  })

  it("only looks at a client inside the agent's own field scope", async () => {
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue(null)

    const response = await submit(request({ firstName: "Two" }), "someone-elses")

    expect(response.status).toBe(404)
    const where = vi.mocked(prisma.mtmContact.findFirst).mock.calls[0][0]?.where as Record<string, unknown>
    expect(where).toMatchObject({ id: "someone-elses", organizationId: ORG, deletedAt: null })
    expect(where.AND).toEqual(expect.any(Array))
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("refuses once the organization switches change requests off for its agents", async () => {
    settings([{ key: "agentContactChangeRequests", value: false }])

    const response = await submit(request({ category: "A" }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "MTM_AGENT_PERMISSION_DISABLED",
      permission: "contactChangeRequest",
    })
    expect(prisma.mtmContact.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("is the agent's own door: a manager's token is refused", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue({
      orgId: ORG, agentId: AGENT, userId: "user-1", role: "MANAGER", email: "m@test", name: "Manager",
      tenantCapabilities: { routeField: true, workforceHrm: false },
    } as never)
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "MANAGER", canPlanOwnRoutes: true } as never)

    const response = await submit(request({ category: "A" }))

    expect(response.status).toBe(403)
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it.each([
    ["a field the app's card never shows", { mobilePhone: "+994501112233" }],
    ["a status change", { status: "INACTIVE" }],
    ["no change at all", {}],
    ["an unknown class", { category: "S" }],
    ["an empty name", { firstName: "   " }],
  ])("rejects %s without storing anything", async (_label, changes) => {
    const response = await submit(request(changes))

    expect(response.status).toBe(400)
    expect(prisma.mtmContact.findFirst).not.toHaveBeenCalled()
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("rejects extra top-level keys instead of passing them to the broad website schema", async () => {
    const response = await submit(request({ category: "A" }, { kind: "DUPLICATE_REPORT", payload: { targetContactId: "x" } }))

    expect(response.status).toBe(400)
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("takes a class only from the organization's own list", async () => {
    settings([{ key: "contactClasses", value: ["A", "B", "C", "VIP"] }])

    const response = await submit(request({ category: "D" }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_CLASS_NOT_OFFERED", field: "category" })
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("takes a specialty only from the organization's list and stores its spelling", async () => {
    settings([{ key: "contactSpecialties", value: ["Kardioloq", "Nevroloq"] }])

    const unknown = await submit(request({ specialtyName: "Astroloq" }))
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toMatchObject({ code: "MTM_CONTACT_SPECIALTY_NOT_OFFERED", field: "specialtyName" })
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()

    const listed = await submit(request({ specialtyName: "  nevroloq " }))
    expect(listed.status).toBe(201)
    expect(prisma.mtmContactChangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payload: { specialtyName: "Nevroloq" } }),
    }))
  })

  it("does not take a field the organization switched off for its clients", async () => {
    settings([{ key: "contactHiddenFields", value: ["specialtyName"] }])

    const response = await submit(request({ specialtyName: "Kardioloq" }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_FIELD_NOT_OFFERED", field: "specialtyName" })
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("refuses a form opened before somebody else changed the client", async () => {
    const response = await submit(request({ lastName: "Doktor" }, { expectedContactUpdatedAt: "2026-09-30T08:00:00.000Z" }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_CONFLICT" })
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("answers a repeated send with the request it already stored", async () => {
    await submit(request({ category: "A" }))
    const stored = vi.mocked(prisma.mtmContactChangeRequest.create).mock.calls[0][0].data as { requestHash: string }
    vi.mocked(prisma.mtmContactChangeRequest.create).mockClear()
    vi.mocked(prisma.mtmContactChangeRequest.findUnique).mockResolvedValue({
      id: "request-1", requestHash: stored.requestHash, status: "SUBMITTED",
    } as never)

    const again = await submit(request({ category: "A" }))

    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ success: true, idempotent: true, data: { id: "request-1" } })
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })

  it("names the required fields a card lacks instead of storing a request nobody could approve", async () => {
    // The shared core checks the card as it would be after the change. The app
    // cannot fill this field, so it tells the agent who can: the manager.
    settings([{ key: "contactRequiredFields", value: ["firstName", "lastName", "mobilePhone"] }])
    vi.mocked(prisma.mtmContact.findFirst).mockResolvedValue({
      id: CONTACT, firstName: "One", lastName: "Doctor", displayName: "Doctor One",
      category: "B", specialtyName: "Kardioloq", mobilePhone: null, updatedAt: UPDATED_AT,
    } as never)

    const response = await submit(request({ category: "A" }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: "MTM_CONTACT_REQUIRED_FIELDS", data: { fields: ["mobilePhone"] } })
    expect(prisma.mtmContactChangeRequest.create).not.toHaveBeenCalled()
  })
})
