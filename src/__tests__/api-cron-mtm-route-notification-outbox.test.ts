import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

vi.mock("@/lib/mtm/route-notification-outbox", () => ({
  runMtmRouteNotificationOutboxJob: vi.fn(),
}))

import { POST } from "@/app/api/cron/mtm-route-notification-outbox/route"
import { requireCronAuth } from "@/lib/cron-auth"
import { runMtmRouteNotificationOutboxJob } from "@/lib/mtm/route-notification-outbox"

function request() {
  return new NextRequest("http://localhost/api/cron/mtm-route-notification-outbox", {
    method: "POST",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCronAuth).mockReturnValue(null)
})

describe("POST /api/cron/mtm-route-notification-outbox", () => {
  it("requires cron authentication before it can drain tenant notifications", async () => {
    vi.mocked(requireCronAuth).mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(runMtmRouteNotificationOutboxJob).not.toHaveBeenCalled()
  })

  it("returns a lease skip without treating it as a worker failure", async () => {
    vi.mocked(runMtmRouteNotificationOutboxJob).mockResolvedValue({
      status: "skipped",
      reason: "lease_held",
    } as never)

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      skipped: true,
      reason: "lease_held",
    })
  })

  it("returns the bounded drain result", async () => {
    vi.mocked(runMtmRouteNotificationOutboxJob).mockResolvedValue({
      status: "completed",
      value: { examined: 2, claimed: 2, delivered: 1, suppressed: 1, deferred: 0, failed: 0 },
    } as never)

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { examined: 2, claimed: 2, delivered: 1, suppressed: 1, deferred: 0, failed: 0 },
    })
  })

  it("keeps an unexpected worker error opaque", async () => {
    vi.mocked(runMtmRouteNotificationOutboxJob).mockRejectedValue(new Error("database unavailable"))

    const response = await POST(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" })
  })
})
