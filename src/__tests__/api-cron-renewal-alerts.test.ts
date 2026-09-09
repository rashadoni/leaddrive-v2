import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractRenewalAlert: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}))

vi.mock("@/lib/rls-context", () => ({
  enterRlsBypass: vi.fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

import { POST } from "@/app/api/cron/renewal-alerts/route"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

const CRON_SECRET = "renewal-cron-secret"

function makeReq(secret = CRON_SECRET) {
  return new NextRequest("http://localhost/api/cron/renewal-alerts", {
    method: "POST",
    headers: { "x-cron-secret": secret },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.mocked(prisma.contractRenewalAlert.findMany).mockResolvedValue([])
  vi.mocked(prisma.contractRenewalAlert.update).mockResolvedValue({} as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "admin-1" }] as never)
  vi.mocked(createNotification).mockResolvedValue({ id: "notif-1" } as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/cron/renewal-alerts", () => {
  it("fetches due alerts only for live active/renewing contracts", async () => {
    const res = await POST(makeReq())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    const call = vi.mocked(prisma.contractRenewalAlert.findMany).mock.calls[0][0]
    expect(call.where.contract.status.in).toEqual(["active", "renewing"])
    expect(createNotification).not.toHaveBeenCalled()
    expect(prisma.contractRenewalAlert.update).not.toHaveBeenCalled()
  })
})
