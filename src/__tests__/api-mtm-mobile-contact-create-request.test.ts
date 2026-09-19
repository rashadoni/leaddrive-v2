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

import { POST } from "@/app/api/v2/mtm/mobile/route-field/contact-create-requests/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v2/mtm/mobile/route-field/contact-create-requests", {
    method: "POST",
    headers: { Authorization: "Bearer mobile", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const body = {
  idempotencyKey: "doctor-create-123",
  displayName: "Dr Aydin Aliyev",
  specialtyName: "Cardiology",
  phone: "+994 50 111 22 33",
  clinicName: "North Clinic",
  address: "Nizami 10",
  notes: "New doctor",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({
    orgId: "org-1", agentId: "agent-1", userId: "user-1", role: "AGENT",
    email: "agent@test", name: "Agent",
    tenantCapabilities: { routeField: true, workforceHrm: false },
  } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT", canPlanOwnRoutes: true } as never)
  vi.mocked(prisma.mtmContactCreateRequest.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmContact.findMany).mockResolvedValue([{
    id: "contact-1", displayName: "Dr Aydin Aliyev", specialtyName: "Cardiology", phone: "0501112233",
  }] as never)
  vi.mocked(prisma.mtmContactCreateRequest.create).mockResolvedValue({ id: "request-1", status: "SUBMITTED" } as never)
})

describe("POST mobile doctor create request", () => {
  it("submits for manager review and returns possible duplicates", async () => {
    const response = await POST(request(body))
    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      data: { id: "request-1", duplicateCandidates: [{ id: "contact-1", exact: true }] },
    })
    expect(prisma.mtmContactCreateRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        requestedByAgentId: "agent-1",
        displayName: body.displayName,
        clinicName: body.clinicName,
        duplicateSnapshot: expect.any(Array),
      }),
    })
  })

  it("replays the same idempotent request and rejects a changed one", async () => {
    await POST(request(body))
    const firstCreate = (vi.mocked(prisma.mtmContactCreateRequest.create).mock.calls[0][0] as {
      data: { requestHash: string }
    }).data
    vi.mocked(prisma.mtmContactCreateRequest.findFirst).mockResolvedValue({
      id: "request-1", requestHash: firstCreate.requestHash, status: "SUBMITTED", approvedContact: null,
    } as never)
    expect((await POST(request(body))).status).toBe(200)
    expect((await POST(request({ ...body, clinicName: "Other Clinic" }))).status).toBe(409)
  })
})
