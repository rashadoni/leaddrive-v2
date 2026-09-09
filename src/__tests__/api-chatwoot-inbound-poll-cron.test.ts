import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  requireCronAuth: vi.fn(),
  runWithRlsBypass: vi.fn((work: () => Promise<unknown>) => work()),
  poll: vi.fn(),
  withJobLease: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: {}, channelMessage: {} } }))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: mocks.requireCronAuth }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: mocks.runWithRlsBypass }))
vi.mock("@/lib/inbox/chatwoot-polling", () => ({
  pollChatwootTikTokInbounds: mocks.poll,
}))
vi.mock("@/lib/cron/job-lease", () => ({ withJobLease: mocks.withJobLease }))

import { POST } from "@/app/api/cron/chatwoot-inbound-poll/route"

function request() {
  return new NextRequest("http://localhost/api/cron/chatwoot-inbound-poll", { method: "POST" })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCronAuth.mockReturnValue(null)
  mocks.poll.mockResolvedValue({ configurations: 1, ingested: 1 })
  mocks.withJobLease.mockImplementation(async (
    _options: unknown,
    work: () => Promise<unknown>,
  ) => ({ status: "completed", value: await work() }))
})

describe("POST /api/cron/chatwoot-inbound-poll", () => {
  it("authenticates before RLS bypass and runs under one DB singleton lease", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mocks.requireCronAuth.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.runWithRlsBypass.mock.invocationCallOrder[0])
    expect(mocks.withJobLease).toHaveBeenCalledWith(
      { name: "chatwoot-inbound-poll", ttlMs: 120_000 },
      expect.any(Function),
    )
    expect(mocks.poll).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toMatchObject({ ok: true, configurations: 1, ingested: 1 })
  })

  it("rejects an unauthenticated tick before bypass, lease, or polling", async () => {
    mocks.requireCronAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(mocks.runWithRlsBypass).not.toHaveBeenCalled()
    expect(mocks.withJobLease).not.toHaveBeenCalled()
    expect(mocks.poll).not.toHaveBeenCalled()
  })

  it("reports a concurrent worker as a successful no-op", async () => {
    mocks.withJobLease.mockResolvedValueOnce({ status: "skipped", reason: "already_running" })

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, skipped: "already_running" })
    expect(mocks.poll).not.toHaveBeenCalled()
  })
})
