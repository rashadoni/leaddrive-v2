import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/with-workforce-rls-auth", () => ({
  withWorkforceSessionEmploymentConfigurationAuth: vi.fn((handler) => handler),
}))
vi.mock("@/lib/workforce/employment-history", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workforce/employment-history")>("@/lib/workforce/employment-history")
  return { ...actual, resolveWorkforceHistoricalAssignment: vi.fn(), recordWorkforceEmploymentEvent: vi.fn() }
})

import { GET, POST } from "@/app/api/v1/workforce/configuration/employment-events/route"
import {
  recordWorkforceEmploymentEvent,
  resolveWorkforceHistoricalAssignment,
  WorkforceEmploymentHistoryError,
} from "@/lib/workforce/employment-history"

const AUTH = { orgId: "org-workforce", userId: "admin-1", role: "admin" }
const callGet = GET as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>
const callPost = POST as unknown as (request: NextRequest, auth: typeof AUTH) => Promise<Response>

function post(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/workforce/configuration/employment-events", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest-employment-history" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => vi.clearAllMocks())

describe("Workforce employment history configuration API", () => {
  it("reads a delayed claim from explicit Workforce facts only", async () => {
    vi.mocked(resolveWorkforceHistoricalAssignment).mockResolvedValue({
      employment: { state: "TERMINATED", event: { id: "termination-1", kind: "TERMINATION", effectiveAt: new Date("2026-08-31T17:00:00.000Z") } },
      teamMembership: null,
      siteAssignments: [],
    } as never)

    const response = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/configuration/employment-events?agentId=agent-1&occurredAt=2026-09-01T09:00:00Z&workDate=2026-09-01"), AUTH)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { assignment: { employment: { state: "TERMINATED" } } } })
    expect(resolveWorkforceHistoricalAssignment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId: AUTH.orgId,
      agentId: "agent-1",
      workDate: "2026-09-01",
    }))
  })

  it("records a validated append-only lifecycle fact through the session-admin boundary", async () => {
    vi.mocked(recordWorkforceEmploymentEvent).mockResolvedValue({
      id: "hire-1", kind: "HIRE", effectiveAt: new Date("2026-09-01T09:00:00.000Z"), source: "HR_RECORDED", recordedAt: new Date(),
    } as never)

    const response = await callPost(post({
      agentId: "agent-1", kind: "HIRE", effectiveAt: "2026-09-01T09:00:00.000Z",
    }), AUTH)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { event: { id: "hire-1", kind: "HIRE" } } })
    expect(recordWorkforceEmploymentEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: AUTH.orgId,
      recordedByUserId: AUTH.userId,
      event: expect.objectContaining({ agentId: "agent-1", kind: "HIRE" }),
    }))
  })

  it("rejects malformed reads and invalid lifecycle transitions without a write", async () => {
    const malformed = await callGet(new NextRequest("http://localhost:3000/api/v1/workforce/configuration/employment-events?agentId=agent-1&occurredAt=tomorrow&workDate=2026-09-01"), AUTH)
    expect(malformed.status).toBe(400)
    expect(resolveWorkforceHistoricalAssignment).not.toHaveBeenCalled()

    vi.mocked(recordWorkforceEmploymentEvent).mockRejectedValue(new WorkforceEmploymentHistoryError(
      "WORKFORCE_EMPLOYMENT_EVENT_TRANSITION_INVALID",
      "Lifecycle transition is invalid",
    ))
    const invalid = await callPost(post({
      agentId: "agent-1", kind: "REHIRE", effectiveAt: "2026-09-01T09:00:00.000Z",
    }), AUTH)
    expect(invalid.status).toBe(409)
    await expect(invalid.json()).resolves.toMatchObject({ code: "WORKFORCE_EMPLOYMENT_EVENT_TRANSITION_INVALID" })
  })
})
