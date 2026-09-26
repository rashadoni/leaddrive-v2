/**
 * Matching a runtime-config request that names no call to the demo call
 * connecting in the same PBX burst (src/lib/demo-center/call-prompt-match.ts).
 * Demo calls only; every other call is untouched and waits for nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: { findMany: vi.fn() },
    callEvent: { findMany: vi.fn(), findFirst: vi.fn(), createMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import {
  DEMO_BURST_WAIT_MS,
  DEMO_CALL_CONNECTING_EVENT,
  claimConnectingDemoCall,
  noteDemoCallConnecting,
} from "@/lib/demo-center/call-prompt-match"

const ORG = "org-leaddrive-inc"
const CALL_ID = "0b7c1c52-6c1e-4b3a-9d55-7c7e6a2f1a10"

/** A clock that only moves when the code waits. */
function fakeClock() {
  let t = 1_000_000
  return { now: () => t, wait: vi.fn(async (ms: number) => { t += ms }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.callLog.findMany).mockResolvedValue([{ id: "log-demo", providerCallId: CALL_ID, leadId: "lead-1" }] as never)
  vi.mocked(prisma.callEvent.findMany).mockResolvedValue([])
  vi.mocked(prisma.callEvent.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.callEvent.createMany).mockResolvedValue({ count: 1 })
})

describe("noteDemoCallConnecting", () => {
  it("records the signal for a call the demo placed, once per call", async () => {
    await noteDemoCallConnecting(ORG, CALL_ID, { id: "log-demo", consentAudit: { via: "demo_center" } })
    expect(prisma.callEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ organizationId: ORG, callLogId: "log-demo", providerCallId: CALL_ID, eventType: DEMO_CALL_CONNECTING_EVENT })],
      skipDuplicates: true,
    })
  })

  it("writes nothing for any other call — working tenants are untouched", async () => {
    await noteDemoCallConnecting(ORG, CALL_ID, { id: "log-sales", consentAudit: { via: "manual_ai_call" } })
    await noteDemoCallConnecting(ORG, CALL_ID, null)
    expect(prisma.callEvent.createMany).not.toHaveBeenCalled()
  })

  it("never throws into the endpoint that answers the agent", async () => {
    vi.mocked(prisma.callEvent.createMany).mockRejectedValue(new Error("database away"))
    await expect(noteDemoCallConnecting(ORG, CALL_ID, { id: "log-demo", consentAudit: { via: "demo_center" } })).resolves.toBeUndefined()
  })
})

describe("claimConnectingDemoCall", () => {
  it("returns at once, waiting for nothing, when no demo call is in flight", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([])
    const clock = fakeClock()
    await expect(claimConnectingDemoCall(ORG, clock)).resolves.toBeNull()
    expect(clock.wait).not.toHaveBeenCalled()
    expect(prisma.callEvent.findFirst).not.toHaveBeenCalled()
  })

  it("returns at once when the demo call in flight already has its prompt", async () => {
    vi.mocked(prisma.callEvent.findMany).mockResolvedValue([{ callLogId: "log-demo" }] as never)
    const clock = fakeClock()
    await expect(claimConnectingDemoCall(ORG, clock)).resolves.toBeNull()
    expect(clock.wait).not.toHaveBeenCalled()
  })

  it("claims the demo call whose burst this request belongs to", async () => {
    vi.mocked(prisma.callEvent.findFirst).mockResolvedValue({ callLogId: "log-demo" } as never)
    await expect(claimConnectingDemoCall(ORG, fakeClock())).resolves.toEqual({ callLogId: "log-demo", providerCallId: CALL_ID, leadId: "lead-1" })
    expect(prisma.callEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ callLogId: "log-demo", eventType: "voice_runtime_prompt_served", payload: { variant: "demo", matchedBy: "connect-burst" } })],
      skipDuplicates: true,
    }))
  })

  it("waits briefly for the burst's other half when the prompt request came first", async () => {
    vi.mocked(prisma.callEvent.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ callLogId: "log-demo" } as never)
    const clock = fakeClock()
    await expect(claimConnectingDemoCall(ORG, clock)).resolves.toMatchObject({ callLogId: "log-demo" })
    expect(clock.wait).toHaveBeenCalledTimes(2)
  })

  it("gives up after the short wait, so another call is never held long", async () => {
    const clock = fakeClock()
    await expect(claimConnectingDemoCall(ORG, clock)).resolves.toBeNull()
    const waited = clock.wait.mock.calls.reduce((total, [ms]) => total + (ms as number), 0)
    expect(waited).toBeGreaterThanOrEqual(DEMO_BURST_WAIT_MS)
    expect(waited).toBeLessThan(DEMO_BURST_WAIT_MS + 200)
    expect(prisma.callEvent.createMany).not.toHaveBeenCalled()
  })

  it("lets only one request take the call: a second one gets the line's prompt", async () => {
    vi.mocked(prisma.callEvent.findFirst).mockResolvedValue({ callLogId: "log-demo" } as never)
    vi.mocked(prisma.callEvent.createMany).mockResolvedValue({ count: 0 })
    await expect(claimConnectingDemoCall(ORG, fakeClock())).resolves.toBeNull()
  })
})
