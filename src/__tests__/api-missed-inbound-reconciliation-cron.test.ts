import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  prisma: { marker: "prisma-client" },
  requireCronAuth: vi.fn(),
  runWithRlsBypass: vi.fn(),
  withJobLease: vi.fn(),
  reconcileMissedInboundCalls: vi.fn(),
  fetch: vi.fn(),
  getVoipProvider: vi.fn(),
  initiateCall: vi.fn(),
  createNotification: vi.fn(),
  deliverNotificationPush: vi.fn(),
}))

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: mocks.requireCronAuth,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: mocks.runWithRlsBypass,
}))

vi.mock("@/lib/cron/job-lease", () => ({
  withJobLease: mocks.withJobLease,
}))

vi.mock("@/lib/calls/missed-inbound-reconciliation", () => ({
  reconcileMissedInboundCalls: mocks.reconcileMissedInboundCalls,
}))

// A missed-call reconciler turns already-observed database facts into tasks. It
// must never originate another call or send a notification as a side effect.
vi.mock("@/lib/voip/factory", () => ({
  getVoipProvider: mocks.getVoipProvider,
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: mocks.createNotification,
  deliverNotificationPush: mocks.deliverNotificationPush,
}))

import { POST } from "@/app/api/cron/missed-inbound-reconciliation/route"

const completed = {
  selected: 7,
  reconciled: 3,
  alreadyReconciled: 2,
  failed: 2,
}

function request(search = "") {
  return new NextRequest(
    `http://localhost/api/cron/missed-inbound-reconciliation${search}`,
    { method: "POST" },
  )
}

function expectNoExternalEffects() {
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(mocks.getVoipProvider).not.toHaveBeenCalled()
  expect(mocks.initiateCall).not.toHaveBeenCalled()
  expect(mocks.createNotification).not.toHaveBeenCalled()
  expect(mocks.deliverNotificationPush).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", mocks.fetch)

  mocks.requireCronAuth.mockReturnValue(null)
  mocks.getVoipProvider.mockReturnValue({ initiateCall: mocks.initiateCall })
  mocks.reconcileMissedInboundCalls.mockResolvedValue(completed)
  mocks.runWithRlsBypass.mockImplementation(
    async (work: () => Promise<unknown>) => work(),
  )
  mocks.withJobLease.mockImplementation(
    async (_options: unknown, work: () => Promise<unknown>) => ({
      status: "completed",
      value: await work(),
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("POST /api/cron/missed-inbound-reconciliation", () => {
  it("rejects an unauthenticated live tick before bypass, lease, or reconciliation", async () => {
    mocks.requireCronAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const req = request()

    const response = await POST(req)

    expect(response.status).toBe(401)
    expect(mocks.requireCronAuth).toHaveBeenCalledOnce()
    expect(mocks.requireCronAuth).toHaveBeenCalledWith(req)
    expect(mocks.runWithRlsBypass).not.toHaveBeenCalled()
    expect(mocks.withJobLease).not.toHaveBeenCalled()
    expect(mocks.reconcileMissedInboundCalls).not.toHaveBeenCalled()
    expectNoExternalEffects()
  })

  it("does not let smoke mode bypass cron authentication", async () => {
    mocks.requireCronAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(request("?smoke=1"))

    expect(response.status).toBe(401)
    expect(mocks.requireCronAuth).toHaveBeenCalledOnce()
    expect(mocks.runWithRlsBypass).not.toHaveBeenCalled()
    expect(mocks.withJobLease).not.toHaveBeenCalled()
    expect(mocks.reconcileMissedInboundCalls).not.toHaveBeenCalled()
    expectNoExternalEffects()
  })

  it("returns authenticated side-effect-free zeroes in deployment smoke mode", async () => {
    const response = await POST(request("?smoke=1"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        selected: 0,
        reconciled: 0,
        alreadyReconciled: 0,
        failed: 0,
        smoke: true,
      },
    })
    expect(mocks.requireCronAuth).toHaveBeenCalledOnce()
    expect(mocks.runWithRlsBypass).not.toHaveBeenCalled()
    expect(mocks.withJobLease).not.toHaveBeenCalled()
    expect(mocks.reconcileMissedInboundCalls).not.toHaveBeenCalled()
    expectNoExternalEffects()
  })

  it("runs an authenticated live tick inside RLS bypass and one expiring lease", async () => {
    mocks.withJobLease.mockResolvedValueOnce({
      status: "skipped",
      reason: "already_running",
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mocks.requireCronAuth).toHaveBeenCalledOnce()
    expect(mocks.runWithRlsBypass).toHaveBeenCalledOnce()
    expect(mocks.runWithRlsBypass).toHaveBeenCalledWith(expect.any(Function))
    expect(mocks.withJobLease).toHaveBeenCalledOnce()
    expect(mocks.withJobLease).toHaveBeenCalledWith(
      { name: "missed-inbound-reconciliation", ttlMs: 120_000 },
      expect.any(Function),
    )
    expect(mocks.requireCronAuth.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runWithRlsBypass.mock.invocationCallOrder[0],
    )
    expect(mocks.runWithRlsBypass.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.withJobLease.mock.invocationCallOrder[0],
    )
    expectNoExternalEffects()
  })

  it("returns a successful skipped result without invoking the reconciliation helper", async () => {
    mocks.withJobLease.mockResolvedValueOnce({
      status: "skipped",
      reason: "already_running",
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { skipped: "already_running" },
    })
    expect(mocks.runWithRlsBypass).toHaveBeenCalledOnce()
    expect(mocks.withJobLease).toHaveBeenCalledOnce()
    expect(mocks.reconcileMissedInboundCalls).not.toHaveBeenCalled()
    expectNoExternalEffects()
  })

  it("returns the completed reconciliation counters", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: completed,
    })
    expect(mocks.runWithRlsBypass).toHaveBeenCalledOnce()
    expect(mocks.withJobLease).toHaveBeenCalledOnce()
    expect(mocks.reconcileMissedInboundCalls).toHaveBeenCalledOnce()
    expect(mocks.reconcileMissedInboundCalls).toHaveBeenCalledWith(mocks.prisma)
    expectNoExternalEffects()
  })

  it("returns a generic 500 when reconciliation fails", async () => {
    mocks.reconcileMissedInboundCalls.mockRejectedValueOnce(
      new Error("private provider detail must not escape"),
    )
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: expect.any(String) })
    expect(JSON.stringify(body)).not.toContain("private provider detail")
    expect(mocks.runWithRlsBypass).toHaveBeenCalledOnce()
    expect(mocks.withJobLease).toHaveBeenCalledOnce()
    expect(mocks.reconcileMissedInboundCalls).toHaveBeenCalledOnce()
    expectNoExternalEffects()
  })

  it("imports only the cron guard, RLS, lease, database and reconciliation boundaries", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/app/api/cron/missed-inbound-reconciliation/route.ts",
      ),
      "utf8",
    )

    const imports = Array.from(
      source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
      (match) => match[1],
    ).sort()
    expect(imports).toEqual([
      "@/lib/calls/missed-inbound-reconciliation",
      "@/lib/cron-auth",
      "@/lib/cron/job-lease",
      "@/lib/prisma",
      "@/lib/rls-context",
      "next/server",
    ])

    expect(source).not.toMatch(
      /@\/lib\/(?:voip\/factory|voice-agent\/(?:place-callback|callback-trigger)|notifications|email|push-send)/,
    )
  })
})
