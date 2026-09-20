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

import { GET, POST } from "@/app/api/v2/mtm/mobile/route-field/contact-create-requests/route"
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

describe("GET mobile doctor create requests", () => {
  function listRequest(query = "") {
    return new NextRequest(`http://localhost/api/v2/mtm/mobile/route-field/contact-create-requests${query}`, {
      headers: { Authorization: "Bearer mobile" },
    })
  }

  /**
   * A request used to leave the phone and vanish: approved, refused or still
   * waiting looked exactly the same to the agent who filed it.
   */
  it("returns the agent's own requests, newest first, with the manager's decision", async () => {
    vi.mocked(prisma.mtmContactCreateRequest.findMany).mockResolvedValue([
      { id: "request-2", status: "APPROVED", displayName: "Dr Test", clinicName: "Clinic", decisionComment: "ok" },
      { id: "request-1", status: "SUBMITTED", displayName: "Dr Wait", clinicName: "Clinic" },
    ] as never)

    const response = await GET(listRequest())
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.requests.map((item: { id: string }) => item.id)).toEqual(["request-2", "request-1"])
    expect(prisma.mtmContactCreateRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", requestedByAgentId: "agent-1" },
      orderBy: { submittedAt: "desc" },
      take: 20,
    }))
  })

  it("never reads another agent's queue, whatever the query says", async () => {
    vi.mocked(prisma.mtmContactCreateRequest.findMany).mockResolvedValue([] as never)
    await GET(listRequest("?agentId=agent-2&limit=500"))
    const call = vi.mocked(prisma.mtmContactCreateRequest.findMany).mock.calls[0][0]
    expect(call).toMatchObject({ where: { requestedByAgentId: "agent-1" }, take: 50 })
  })

  it("refuses a manager's token on the agent's own endpoint", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "MANAGER" } as never)
    const response = await GET(listRequest())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
  })
})
