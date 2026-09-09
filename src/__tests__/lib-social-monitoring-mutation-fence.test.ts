import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type Handler = (
  req: NextRequest,
  auth: { orgId: string; userId: string; role: string },
  ctx: unknown,
) => Promise<Response>

const { fence } = vi.hoisted(() => ({
  fence: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: Handler) =>
    (req: NextRequest, ctx?: unknown) =>
      handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }, ctx),
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: fence,
}))

import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("withSocialMonitoringMutationFence", () => {
  it("runs the complete mutation inside the tenant fence", async () => {
    fence.mockImplementation(async (_organizationId: string, mutate: () => Promise<Response>) => ({
      allowed: true,
      value: await mutate(),
    }))
    const handler = vi.fn(async () => Response.json({ success: true }))
    const route = withSocialMonitoringMutationFence("social", "write", handler)

    const response = await route(new NextRequest("http://localhost/api/v1/social/test", {
      method: "POST",
    }))

    expect(response.status).toBe(200)
    expect(fence).toHaveBeenCalledWith("org-1", expect.any(Function))
    expect(handler).toHaveBeenCalledOnce()
  })

  it("returns conflict without entering the mutation while clean-slate is blocked", async () => {
    fence.mockResolvedValue({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const handler = vi.fn(async () => Response.json({ success: true }))
    const route = withSocialMonitoringMutationFence("social", "write", handler)

    const response = await route(new NextRequest("http://localhost/api/v1/social/test", {
      method: "POST",
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: "social_monitoring_collection_blocked",
    })
    expect(handler).not.toHaveBeenCalled()
  })
})
