import { readFileSync } from "node:fs"

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: {
    orgId: "org-1",
    userId: "manager-1",
    role: "manager",
  },
  list: vi.fn(),
  claim: vi.fn(),
  checkPermission: vi.fn(),
  orgHasModule: vi.fn(),
  moduleDisabledResponse: vi.fn(),
  mutationGuard: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (
    request: NextRequest,
    auth: typeof mocks.auth,
    context: unknown,
  ) => unknown) => (request: NextRequest, context: unknown) =>
    handler(request, { ...mocks.auth }, context),
}))

vi.mock("@/lib/prisma", () => ({ prisma: { marker: "prisma-client" } }))

vi.mock("@/lib/permissions", () => ({
  checkPermission: mocks.checkPermission,
}))

vi.mock("@/lib/api-auth", () => ({
  orgHasModule: mocks.orgHasModule,
  moduleDisabledResponse: mocks.moduleDisabledResponse,
}))

vi.mock("@/lib/social/review-apply-request", () => ({
  guardInteractiveJsonMutation: mocks.mutationGuard,
}))

vi.mock("@/lib/calls/missed-inbound-queue", () => {
  class MissedInboundQueueError extends Error {
    constructor(public readonly code: "not_found" | "already_claimed") {
      super(code)
    }
  }
  return {
    MissedInboundQueueError,
    listMissedInboundQueue: mocks.list,
    claimMissedInboundQueueTask: mocks.claim,
  }
})

import { GET } from "@/app/api/v1/calls/missed-inbound-queue/route"
import { POST } from "@/app/api/v1/calls/missed-inbound-queue/[taskId]/claim/route"

const item = {
  taskId: "call_missed_inbound_call-1",
  status: "pending",
  missedAt: "2026-08-27T08:30:00.000Z",
  leadId: "lead-1",
}

function getRequest() {
  return new NextRequest("http://localhost/api/v1/calls/missed-inbound-queue")
}

function postRequest(body: unknown = {}) {
  return new NextRequest(
    `http://localhost/api/v1/calls/missed-inbound-queue/${item.taskId}/claim`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        origin: "http://localhost",
      },
      body: JSON.stringify(body),
    },
  )
}

function context(taskId = item.taskId) {
  return { params: Promise.resolve({ taskId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.auth, {
    orgId: "org-1",
    userId: "manager-1",
    role: "manager",
  })
  mocks.list.mockResolvedValue([item])
  mocks.claim.mockResolvedValue({ taskId: item.taskId, leadId: item.leadId })
  mocks.checkPermission.mockReturnValue(true)
  mocks.orgHasModule.mockResolvedValue(true)
  mocks.moduleDisabledResponse.mockImplementation((moduleId: string) =>
    NextResponse.json({ error: "module_disabled", moduleId }, { status: 403 }))
  mocks.mutationGuard.mockReturnValue(null)
})

describe("manager missed inbound queue API", () => {
  it.each(["sales", "support", "viewer"])(
    "denies the %s role before reading queue data",
    async (role) => {
      mocks.auth.role = role

      const response = await GET(getRequest())

      expect(response.status).toBe(403)
      expect(mocks.list).not.toHaveBeenCalled()
      expect(mocks.orgHasModule).not.toHaveBeenCalled()
    },
  )

  it.each(["manager", "admin", "superadmin"])(
    "allows %s to list a minimal, no-store projection",
    async (role) => {
      mocks.auth.role = role

      const response = await GET(getRequest())

      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      await expect(response.json()).resolves.toEqual({ success: true, data: [item] })
      expect(mocks.list).toHaveBeenCalledWith(
        { marker: "prisma-client" },
        expect.objectContaining({
          orgId: "org-1",
          userId: "manager-1",
          role,
        }),
      )
      expect(mocks.checkPermission).toHaveBeenCalledWith(role, "tasks", "read")
      expect(mocks.checkPermission).toHaveBeenCalledWith(role, "voip", "read")
      expect(mocks.checkPermission).toHaveBeenCalledWith(role, "leads", "read")
    },
  )

  it("requires the VoIP, CRM task and Sales lead modules", async () => {
    await GET(getRequest())

    expect(mocks.orgHasModule.mock.calls.map((call) => call[1])).toEqual([
      "voip",
      "crm",
      "sales",
    ])

    mocks.list.mockClear()
    mocks.orgHasModule.mockImplementation(
      async (_orgId: string, moduleId: string) => moduleId !== "crm",
    )
    const response = await GET(getRequest())
    expect(response.status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("uses the established superadmin module bypass", async () => {
    mocks.auth.role = "superadmin"
    mocks.orgHasModule.mockResolvedValue(false)

    const response = await GET(getRequest())

    expect(response.status).toBe(200)
    expect(mocks.orgHasModule).not.toHaveBeenCalled()
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })

  it("fails closed when any explicit list permission is absent", async () => {
    mocks.checkPermission.mockImplementation(
      (_role: string, moduleId: string) => moduleId !== "leads",
    )

    const response = await GET(getRequest())

    expect(response.status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("rejects non-manager claim attempts before the mutation guard or database", async () => {
    mocks.auth.role = "sales"

    const response = await POST(postRequest(), context())

    expect(response.status).toBe(403)
    expect(mocks.mutationGuard).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it("runs the interactive JSON guard and accepts only an empty command body", async () => {
    const blocked = NextResponse.json({ error: "cross_origin_request_rejected" }, { status: 403 })
    mocks.mutationGuard.mockReturnValueOnce(blocked)

    const blockedResponse = await POST(postRequest(), context())
    expect(blockedResponse.status).toBe(403)
    expect(mocks.claim).not.toHaveBeenCalled()

    mocks.mutationGuard.mockReturnValue(null)
    const nonEmpty = await POST(postRequest({ userId: "manager-2" }), context())
    expect(nonEmpty.status).toBe(400)
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it("requires write permissions and all three modules before claiming", async () => {
    const response = await POST(postRequest(), context())

    expect(response.status).toBe(200)
    expect(mocks.checkPermission).toHaveBeenCalledWith("manager", "tasks", "write")
    expect(mocks.checkPermission).toHaveBeenCalledWith("manager", "voip", "write")
    expect(mocks.checkPermission).toHaveBeenCalledWith("manager", "leads", "read")
    expect(mocks.orgHasModule.mock.calls.map((call) => call[1])).toEqual([
      "voip",
      "crm",
      "sales",
    ])
    expect(mocks.claim).toHaveBeenCalledWith(
      { marker: "prisma-client" },
      mocks.auth,
      item.taskId,
    )
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { taskId: item.taskId, leadId: item.leadId },
    })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("maps a lost CAS to 409 and an inaccessible task to a privacy-safe 404", async () => {
    const { MissedInboundQueueError } = await import("@/lib/calls/missed-inbound-queue")
    mocks.claim.mockRejectedValueOnce(new MissedInboundQueueError("already_claimed"))
    const conflict = await POST(postRequest(), context())
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ error: "missed_inbound_already_claimed" })

    mocks.claim.mockRejectedValueOnce(new MissedInboundQueueError("not_found"))
    const missing = await POST(postRequest(), context())
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ error: "missed_inbound_not_found" })
  })

  it("returns generic no-store failures without leaking internal details", async () => {
    mocks.claim.mockRejectedValueOnce(new Error("private database detail"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await POST(postRequest(), context())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(JSON.stringify(body)).not.toContain("private database detail")
  })

  it("is session-only and imports no call, provider, notification or workflow side effects", () => {
    const sources = [
      readFileSync("src/app/api/v1/calls/missed-inbound-queue/route.ts", "utf8"),
      readFileSync(
        "src/app/api/v1/calls/missed-inbound-queue/[taskId]/claim/route.ts",
        "utf8",
      ),
    ]

    for (const source of sources) {
      expect(source).toContain("withRlsSessionAuth")
      expect(source).not.toContain("withRlsAuth(")
      expect(source).not.toMatch(
        /voip\/factory|initiateCall|executeWorkflows|notifications|email|push-send|place-callback/u,
      )
    }
  })
})
