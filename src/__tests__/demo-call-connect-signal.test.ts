/**
 * The PBX names a connecting call in call-source and call-continuation; for a
 * call the demo placed, that is the signal runtime-config matches its burst
 * against (src/lib/demo-center/call-prompt-match.ts). Any other call's
 * answer is unchanged and writes nothing.
 */
import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
    callEvent: { createMany: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))

import { prisma } from "@/lib/prisma"
import { GET as callSource } from "@/app/api/internal/voice-agent/call-source/route"

const CALL_ID = "0b7c1c52-6c1e-4b3a-9d55-7c7e6a2f1a10"

function request() {
  return new NextRequest(`http://localhost/api/internal/voice-agent/call-source?callId=${CALL_ID}`, {
    headers: { authorization: "Bearer runtime-token" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FANUM_VOICE_RUNTIME_TOKEN = "runtime-token"
  process.env.VOICE_AGENT_ORGANIZATION_ID = "org-1"
  vi.mocked(prisma.lead.findFirst).mockResolvedValue({ source: "instagram" } as never)
  vi.mocked(prisma.callEvent.createMany).mockResolvedValue({ count: 1 })
})

describe("call-source during a connect burst", () => {
  it("marks a demo call as connecting and still answers the source", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({ id: "log-demo", leadId: "lead-1", consentAudit: { via: "demo_center" } } as never)
    const body = await (await callSource(request())).json()
    expect(body).toEqual({ source: "instagram" })
    expect(prisma.callEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ callLogId: "log-demo", eventType: "voice_demo_call_connecting" })],
    }))
  })

  it("writes nothing for a working call", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue({ id: "log-sales", leadId: "lead-1", consentAudit: { via: "manual_ai_call" } } as never)
    const body = await (await callSource(request())).json()
    expect(body).toEqual({ source: "instagram" })
    expect(prisma.callEvent.createMany).not.toHaveBeenCalled()
  })
})

describe("call-continuation during a connect burst", () => {
  it("passes the call it already looked up, so it adds no query of its own", () => {
    const route = readFileSync("src/app/api/internal/voice-agent/call-continuation/route.ts", "utf8")
    expect(route).toContain("consentAudit: true")
    expect(route).toContain("await noteDemoCallConnecting(organizationId, callId, call)")
  })
})
