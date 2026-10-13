import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: (callback: (req: NextRequest) => unknown) => callback }))
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/rate-limit")>(),
  checkRateLimit: vi.fn(() => true),
}))
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/mobile-auth", async () => (await import("./mocks/mobile-auth")).makeMobileAuthMock())

import proxy from "@/proxy"
import { checkRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { getRlsContext } from "@/lib/rls-context"
import { isMtmApiPath, isMtmMobileApiPath } from "@/lib/mtm/mobile-api-path"
import { POST } from "@/app/api/v2/mtm/mobile/route-field/attendance/requests/route"

const runProxy = proxy as unknown as (req: NextRequest) => Promise<Response>
const prefix = "/api/v2/mtm/mobile/route-field/attendance"
const oldPrefix = "/api/v1/mtm/mobile/attendance"
const fixtureId = "00000000-0000-4000-8000-000000000001"
const self = { organizationId: "routing-fixture-org", agentId: "routing-fixture-agent", role: "AGENT" }
const endpoints = [
  ["GET", "/requests"], ["POST", "/requests"], ["DELETE", `/requests/${fixtureId}`],
  ["GET", "/request-limits?month=2026-11"], ["POST", "/attachments"], ["GET", `/attachments/${fixtureId}`],
  ["GET", "/location-consent"], ["POST", "/location-consent"],
  ["GET", "/installation"], ["POST", "/installation"],
] as const

function request(path: string, method: string, body?: unknown) {
  const payload = Buffer.from(JSON.stringify({ agentId: self.agentId })).toString("base64url")
  return new NextRequest(`http://localhost${path}`, { method, headers: {
    host: "localhost", authorization: `Bearer header.${payload}.signature`, "content-type": "application/json",
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const submission = () => request(`${prefix}/requests`, "POST", {
  clientRequestId: randomUUID(), kind: "HOURLY_ABSENCE", unit: "HOURS", startDate: "2026-11-02",
  endDate: "2026-11-02", startTime: "09:00", endTime: "11:00", reason: "Fictional routing check",
})
// Exercise the actual edge decision before dispatching the actual route. A
// direct route-only test passed while the old address was returning 410.
async function submitThroughProxy(req: NextRequest) {
  const admission = await runProxy(req)
  return admission.headers.get("x-middleware-next") === "1" ? POST(req) : admission
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkRateLimit).mockReturnValue(true)
  process.env.NEXT_PUBLIC_MARKETING_URL = "https://leaddrivecrm.org"
  process.env.NEXT_PUBLIC_APP_URL = "https://app.leaddrivecrm.org"
  vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: self.organizationId, agentId: self.agentId, role: self.role,
    tenantCapabilities: { routeField: true, workforceHrm: false } } as never)
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "Asia/Baku" }] as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.user.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: self.agentId } as never)
  vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAttendanceAttachment.count).mockResolvedValue(0)
})

describe("attendance uses reachable Route & Field mobile routes", () => {
  it.each(endpoints)("forwards %s %s without reviving its withdrawn predecessor", async (method, suffix) => {
    const response = await runProxy(request(`${prefix}${suffix}`, method))
    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()

    const retired = await runProxy(request(`${oldPrefix}${suffix}`, method))
    expect(retired.status).toBe(410)
    expect(retired.headers.get("x-middleware-next")).toBeNull()
    expect(retired.headers.get("cache-control")).toBe("private, no-store")
    expect(await retired.json()).toMatchObject({ code: "CRM_MODULE_UNAVAILABLE" })
  })

  it.each(["/unknown", "/requests/id/decision", "/requests/a%2Fb", "/attachments/id/extra", "/installation/id"])(
    "does not grant mobile entry to an unreviewed suffix %s", async (suffix) => {
      expect(isMtmApiPath(`${prefix}${suffix}`)).toBe(false)
      expect(isMtmMobileApiPath(`${prefix}${suffix}`)).toBe(false)
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      try {
        const response = await runProxy(request(`${prefix}${suffix}`, "POST"))
        expect(response.status).toBe(401)
        expect(response.headers.get("x-middleware-next")).toBeNull()
      } finally { warn.mockRestore() }
    },
  )

  it("reaches the real request handler and creates only this owner's request in their RLS context", async () => {
    vi.mocked(prisma.mtmHrmRequest.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => {
      expect(getRlsContext()).toMatchObject({ orgId: self.organizationId })
      expect(data).toMatchObject({ organizationId: self.organizationId, agentId: self.agentId })
      return { ...data, status: "PENDING", updatedAt: new Date(), decisionNote: null, decidedAt: null, cancelledAt: null }
    }) as never)
    const response = await submitThroughProxy(submission())
    expect(response.status).toBe(201)
    expect((await response.json()).data.request).toMatchObject({ agentId: self.agentId, status: "PENDING" })
    expect(prisma.mtmHrmRequest.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
  })

  it.each(["attendance", "capability"])("preserves %s disabled denial after the proxy forwards", async (disabled) => {
    if (disabled === "attendance") vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
    else vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: self.organizationId, agentId: self.agentId, role: self.role,
      tenantCapabilities: { routeField: false, workforceHrm: false } } as never)
    const response = await submitThroughProxy(submission())
    expect(response.status).toBe(disabled === "attendance" ? 404 : 403)
    expect((await response.json()).code).toBe(disabled === "attendance" ? "MTM_ATTENDANCE_DISABLED" : "TENANT_CAPABILITY_DISABLED")
    expect(resolveMobileAuth).toHaveBeenCalledTimes(1)
    expect(prisma.mtmHrmRequest.create).not.toHaveBeenCalled()
    expect(prisma.mtmAttendanceAttachment.create).not.toHaveBeenCalled()
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
  })
})
