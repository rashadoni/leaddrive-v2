import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const auth = vi.hoisted(() => ({ orgId: "org-1", userId: "admin-1", role: "admin" }))
const organization = vi.hoisted(() => ({ features: [] as string[] }))
const current = vi.hoisted(() => ({
  organizationId: "org-1",
  liveEnabled: false,
  emergencyStopped: true,
  allowedPlatforms: [] as string[],
  maxPerHour: 10,
  quietHoursStart: null,
  quietHoursEnd: null,
  timeZone: "UTC",
  requireSeparateApprover: true,
  policyVersion: 1,
  releaseReviewedAt: null as Date | null,
  releaseReviewedBy: null as string | null,
}))
type RouteHandler = (req: NextRequest, routeAuth: typeof auth) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, auth),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async () => ({ features: [...organization.features] })),
    },
    socialOutboundPolicy: {
      upsert: vi.fn(async () => ({ ...current })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...current, ...data })),
    },
  },
}))

import { PATCH } from "@/app/api/v1/social/outbound-policy/route"
import { prisma } from "@/lib/prisma"

function patch(body: unknown) {
  return PATCH(new NextRequest("http://localhost/api/v1/social/outbound-policy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.role = "admin"
  organization.features = []
  Object.assign(current, {
    liveEnabled: false,
    emergencyStopped: true,
    allowedPlatforms: [],
    releaseReviewedAt: null,
    releaseReviewedBy: null,
  })
})

describe("social outbound policy API", () => {
  it("cannot open tenant live gates in Brand Protection mode", async () => {
    organization.features = ["social_brand_protection_only"]

    const response = await patch({
      liveEnabled: true,
      emergencyStopped: false,
      allowedPlatforms: ["instagram"],
      releaseReviewConfirmed: true,
    })
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.code).toBe("brand_protection_only")
    expect(prisma.socialOutboundPolicy.update).not.toHaveBeenCalled()
  })

  it("normalizes a stale tenant policy closed during benign Brand Protection edits", async () => {
    organization.features = ["social_brand_protection_only"]
    Object.assign(current, {
      liveEnabled: true,
      emergencyStopped: false,
      allowedPlatforms: ["instagram"],
      releaseReviewedAt: new Date("2026-07-12T00:00:00Z"),
    })

    const response = await patch({ maxPerHour: 25 })

    expect(response.status).toBe(200)
    expect(prisma.socialOutboundPolicy.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ liveEnabled: false, emergencyStopped: true, maxPerHour: 25 }),
    }))
  })

  it("keeps policy fail-closed unless release review, a platform and an open emergency gate are supplied together", async () => {
    const response = await patch({ liveEnabled: true, releaseReviewConfirmed: true, allowedPlatforms: ["instagram"] })

    expect(response.status).toBe(409)
    expect(prisma.socialOutboundPolicy.update).not.toHaveBeenCalled()
  })

  it("records release review and permanently enforces separate approval", async () => {
    const response = await patch({
      liveEnabled: true,
      emergencyStopped: false,
      allowedPlatforms: ["instagram"],
      releaseReviewConfirmed: true,
    })

    expect(response.status).toBe(200)
    expect(prisma.socialOutboundPolicy.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
      data: expect.objectContaining({
        liveEnabled: true,
        emergencyStopped: false,
        requireSeparateApprover: true,
        releaseReviewedBy: "admin-1",
      }),
    }))
  })

  it("rejects invalid time zones and non-admin changes", async () => {
    expect((await patch({ timeZone: "Not/A-Timezone" })).status).toBe(400)
    auth.role = "manager"
    expect((await patch({ liveEnabled: false })).status).toBe(403)
  })
})
