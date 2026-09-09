import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: {
    orgId: "org-1",
    agentId: "agent-1",
    userId: "user-1",
    role: "AGENT",
    tenantCapabilities: { routeField: true, workforceHrm: false },
  },
  withMobileRlsOptions: undefined as unknown,
  requireMobilePermission: vi.fn(),
  executeMtmMobileRouteCommand: vi.fn(),
  writeMtmAudit: vi.fn(),
}))

vi.mock("@/lib/with-mobile-rls", () => ({
  withMobileRls: (handler: (req: NextRequest, auth: typeof mocks.auth) => Promise<Response>, options: unknown) => {
    mocks.withMobileRlsOptions = options
    return (req: NextRequest) => handler(req, mocks.auth)
  },
}))
vi.mock("@/lib/mtm/mobile-capabilities", () => ({ requireMobilePermission: mocks.requireMobilePermission }))
vi.mock("@/lib/mtm/mobile-route-command", () => ({ executeMtmMobileRouteCommand: mocks.executeMtmMobileRouteCommand }))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: mocks.writeMtmAudit }))

import { POST } from "@/app/api/v1/mtm/mobile/route-commands/route"

function request(body: unknown, deviceId = "rf-device-1") {
  return new NextRequest("http://localhost:3000/api/v1/mtm/mobile/route-commands", {
    method: "POST",
    headers: { "content-type": "application/json", ...(deviceId ? { "x-field-device-id": deviceId } : {}) },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireMobilePermission.mockReturnValue(null)
  mocks.executeMtmMobileRouteCommand.mockResolvedValue({
    responseStatus: 201,
    replayed: false,
    result: { success: true, data: { id: "route-1", status: "DRAFT", version: 1 } },
    audit: {
      action: "ROUTE_CREATE",
      routeId: "route-1",
      agentId: "agent-1",
      newData: { status: "DRAFT", version: 1 },
    },
  })
  mocks.writeMtmAudit.mockResolvedValue(undefined)
})

describe("POST /api/v1/mtm/mobile/route-commands", () => {
  it("requires an opaque device ID before admitting a durable command", async () => {
    const response = await POST(request({
      operationId: "route-command-001",
      command: "CREATE_DRAFT",
      payload: { date: "2026-09-02", points: [] },
    }, ""))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MOBILE_ROUTE_COMMAND_DEVICE_ID_REQUIRED" })
    expect(mocks.executeMtmMobileRouteCommand).not.toHaveBeenCalled()
  })

  it("uses the explicit Route Field capability wrapper and self-plan permission", async () => {
    const body = {
      operationId: "route-command-001",
      command: "CREATE_DRAFT",
      payload: { date: "2026-09-02", points: [{ customerId: "customer-1" }] },
    }
    const response = await POST(request(body))

    expect(response.status).toBe(201)
    expect(mocks.withMobileRlsOptions).toEqual({ requiredCapability: "route-field" })
    expect(mocks.requireMobilePermission).toHaveBeenCalledWith(mocks.auth, "ROUTE_SELF_PLAN")
    expect(mocks.executeMtmMobileRouteCommand).toHaveBeenCalledWith({
      auth: mocks.auth,
      deviceId: "rf-device-1",
      command: body,
    })
    expect(mocks.writeMtmAudit).toHaveBeenCalledTimes(1)
  })

  it("delegates dynamic self-publish admission to the durable state machine", async () => {
    mocks.executeMtmMobileRouteCommand.mockResolvedValue({
      responseStatus: 200,
      replayed: false,
      result: { success: true, data: { id: "route-1", status: "PLANNED", version: 2 } },
      audit: {
        action: "ROUTE_PUBLISH",
        routeId: "route-1",
        agentId: "agent-1",
        oldData: { status: "DRAFT", version: 1 },
        newData: { status: "PLANNED", version: 2 },
      },
    })

    const body = {
      operationId: "route-command-publish-001",
      command: "PUBLISH",
      routeId: "route-1",
      payload: { expectedVersion: 1 },
    }
    const response = await POST(request(body))

    expect(response.status).toBe(200)
    expect(mocks.requireMobilePermission).toHaveBeenCalledWith(mocks.auth, "ROUTE_SELF_PLAN")
    expect(mocks.executeMtmMobileRouteCommand).toHaveBeenCalledWith({
      auth: mocks.auth,
      deviceId: "rf-device-1",
      command: body,
    })
    expect(mocks.writeMtmAudit).toHaveBeenCalledTimes(1)
  })

  it("requires route-execute permission for an explicit route start", async () => {
    const body = {
      operationId: "route-command-start-001",
      command: "START",
      routeId: "route-1",
      payload: { expectedVersion: 4 },
    }

    const response = await POST(request(body))

    expect(response.status).toBe(201)
    expect(mocks.requireMobilePermission).toHaveBeenCalledWith(mocks.auth, "ROUTE_EXECUTE")
    expect(mocks.executeMtmMobileRouteCommand).toHaveBeenCalledWith({
      auth: mocks.auth,
      deviceId: "rf-device-1",
      command: body,
    })
  })

  it("marks an exact receipt response idempotent and never duplicates audit", async () => {
    mocks.executeMtmMobileRouteCommand.mockResolvedValue({
      responseStatus: 201,
      replayed: true,
      result: { success: true, data: { id: "route-1", status: "DRAFT", version: 1 } },
    })

    const response = await POST(request({
      operationId: "route-command-001",
      command: "CREATE_DRAFT",
      payload: { date: "2026-09-02", points: [] },
    }))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ success: true, idempotent: true })
    expect(mocks.writeMtmAudit).not.toHaveBeenCalled()
  })

  it("rejects unknown fields instead of silently broadening the command grammar", async () => {
    const response = await POST(request({
      operationId: "route-command-001",
      command: "CREATE_DRAFT",
      agentId: "another-agent",
      payload: { date: "2026-09-02", points: [] },
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "MOBILE_ROUTE_COMMAND_INVALID" })
    expect(mocks.executeMtmMobileRouteCommand).not.toHaveBeenCalled()
  })
})
