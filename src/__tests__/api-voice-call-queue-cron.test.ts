import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  queueFindMany: vi.fn(),
  itemFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  // The cron now sweeps abandoned dispatches on every tick, before any gate.
  sessionUpdateMany: vi.fn(async () => ({ count: 0 })),
  processOrganization: vi.fn(),
  reconcileFinality: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceCallQueue: { findMany: mocks.queueFindMany },
    voiceCallQueueItem: { findMany: mocks.itemFindMany },
    voiceCallSession: { findMany: mocks.sessionFindMany, updateMany: mocks.sessionUpdateMany },
  },
}))

vi.mock("@/lib/voice-agent/queue-worker", () => ({
  processSequentialVoiceQueueOrganization: mocks.processOrganization,
}))

vi.mock("@/lib/voice-agent/provider-finality", () => ({
  reconcileUncertainVoiceSessionFinality: mocks.reconcileFinality,
}))

import { POST } from "@/app/api/cron/voice-call-queues/route"

function request(secret?: string) {
  return new NextRequest("http://localhost/api/cron/voice-call-queues", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", "queue-cron-test-secret")
  vi.stubEnv("VOICE_CALL_QUEUE_EXECUTION_ENABLED", "false")
  vi.stubEnv("VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED", "false")
  vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "false")
  vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "org-1")
  mocks.queueFindMany.mockResolvedValue([])
  mocks.itemFindMany.mockResolvedValue([])
  mocks.sessionFindMany.mockResolvedValue([])
  mocks.processOrganization.mockResolvedValue({ status: "disabled" })
  mocks.reconcileFinality.mockResolvedValue({ status: "idle" })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/cron/voice-call-queues", () => {
  it.each([
    ["missing", undefined],
    ["wrong", "not-the-cron-secret"],
  ])("rejects %s cron authorization before reading or dispatching", async (_case, secret) => {
    const response = await POST(request(secret))

    expect(response.status).toBe(401)
    expect(mocks.queueFindMany).not.toHaveBeenCalled()
    expect(mocks.itemFindMany).not.toHaveBeenCalled()
    expect(mocks.sessionFindMany).not.toHaveBeenCalled()
    expect(mocks.reconcileFinality).not.toHaveBeenCalled()
    expect(mocks.processOrganization).not.toHaveBeenCalled()
  })

  it("is a zero-total no-op with valid auth while execution is disabled and no queues exist", async () => {
    const response = await POST(request("queue-cron-test-secret"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        organizationsChecked: 0,
        // The sweep runs before every gate, so it reports on every tick.
        reaped: { finished: 0, locksReleased: 0 },
        totals: {
          disabled: 0,
          idle: 0,
          waiting_terminal: 0,
          terminal_reconciled: 0,
          blocked: 0,
          deferred: 0,
          dispatching: 0,
          provider_failed: 0,
          dispatch_uncertain: 0,
        },
        finalityTotals: {
          disabled: 0,
          idle: 0,
          active: 0,
          unknown: 0,
          stale: 0,
          not_accepted: 0,
          terminal: 0,
        },
      },
    })
    expect(mocks.queueFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.itemFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.sessionFindMany).not.toHaveBeenCalled()
    expect(mocks.reconcileFinality).not.toHaveBeenCalled()
    expect(mocks.processOrganization).not.toHaveBeenCalled()
  })

  it("does not reconcile queue organizations outside the exact finality pilot", async () => {
    vi.stubEnv("VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED", "true")
    vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "true")
    mocks.queueFindMany.mockResolvedValue([{ organizationId: "org-2" }])

    const response = await POST(request("queue-cron-test-secret"))

    expect(response.status).toBe(200)
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        provider: "asterisk",
        status: "dispatch_uncertain",
        activeOrganizationKey: "org-1",
      }),
    }))
    expect(mocks.reconcileFinality).not.toHaveBeenCalled()
    expect(mocks.processOrganization).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-2",
    }))
  })

  it("reconciles only the pilot uncertain session and reports its typed state", async () => {
    vi.stubEnv("VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED", "true")
    vi.stubEnv("VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED", "true")
    mocks.queueFindMany.mockResolvedValue([{ organizationId: "org-2" }])
    mocks.sessionFindMany.mockResolvedValue([{ organizationId: "org-1" }])
    mocks.reconcileFinality.mockResolvedValue({ status: "terminal", outcome: "no_answer" })

    const response = await POST(request("queue-cron-test-secret"))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.organizationsChecked).toBe(2)
    expect(payload.data.finalityTotals).toEqual(expect.objectContaining({ terminal: 1 }))
    expect(mocks.reconcileFinality).toHaveBeenCalledTimes(1)
    expect(mocks.reconcileFinality).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
    }))
    expect(mocks.processOrganization).toHaveBeenCalledTimes(2)
  })
})
