import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const { runSocialTriageForOrganization } = vi.hoisted(() => ({
  runSocialTriageForOrganization: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (
    _organizationId: string,
    mutate: () => Promise<unknown>,
  ) => ({ allowed: true, value: await mutate() }),
}))

vi.mock("@/lib/social/ai-triage", () => ({
  runSocialTriageForOrganization,
}))

import { POST } from "@/app/api/v1/social/mentions/triage/route"

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/mentions/triage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  runSocialTriageForOrganization.mockResolvedValue({ scanned: 2, updated: 2, queued: 1, alerts: 1, hiddenNoise: 1 })
})

describe("POST /api/v1/social/mentions/triage", () => {
  it("runs tenant-scoped social triage and returns queue counts", async () => {
    const res = await POST(request({ limit: 25, force: true }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({
      success: true,
      data: { scanned: 2, updated: 2, queued: 1, alerts: 1, hiddenNoise: 1 },
    })
    expect(runSocialTriageForOrganization).toHaveBeenCalledWith("org-1", { limit: 25, force: true })
  })

  it("rejects unsafe limits", async () => {
    const res = await POST(request({ limit: 1000 }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBeTruthy()
    expect(runSocialTriageForOrganization).not.toHaveBeenCalled()
  })
})
