import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  testConnection: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { channelConfig: { findMany: mocks.findMany } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))
vi.mock("@/lib/voip", () => ({
  getVoipProvider: vi.fn(() => ({ testConnection: mocks.testConnection })),
}))

import { POST } from "@/app/api/internal/voice-agent/control-plane-test/route"

const originalEnvironment = {
  token: process.env.FANUM_VOICE_RUNTIME_TOKEN,
  organizationId: process.env.VOICE_AGENT_ORGANIZATION_ID,
  registry: process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED,
  pause: process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED,
}

function request(token = "runtime-token") {
  return new NextRequest("http://localhost/api/internal/voice-agent/control-plane-test", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  })
}

function stagedConfig() {
  return {
    id: "cfg-1",
    configName: "Asterisk",
    phoneNumber: null,
    apiKey: null,
    isActive: true,
    settings: {
      provider: "asterisk",
      ariHost: "pbx.example.com",
      ariPort: 8088,
      username: "ari-user",
      password: "private-password",
      callerExtension: "100",
      voiceAttemptRegistryEnabled: true,
      outboundCallDispatchPaused: true,
    },
  }
}

describe("POST /api/internal/voice-agent/control-plane-test", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FANUM_VOICE_RUNTIME_TOKEN = "runtime-token"
    process.env.VOICE_AGENT_ORGANIZATION_ID = "org-pilot"
    process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED = "false"
    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "true"
    mocks.findMany.mockResolvedValue([stagedConfig()])
    mocks.testConnection.mockResolvedValue({ success: true, message: "verified" })
  })

  afterEach(() => {
    for (const [key, value] of Object.entries({
      FANUM_VOICE_RUNTIME_TOKEN: originalEnvironment.token,
      VOICE_AGENT_ORGANIZATION_ID: originalEnvironment.organizationId,
      VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED: originalEnvironment.registry,
      VOICE_OUTBOUND_CALL_DISPATCH_PAUSED: originalEnvironment.pause,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it("proves the staged control plane without creating a call", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, callsPlaced: 0 })
    expect(mocks.testConnection).toHaveBeenCalledTimes(1)
  })

  it("rejects an invalid bearer before reading provider configuration", async () => {
    const response = await POST(request("wrong-token"))

    expect(response.status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.testConnection).not.toHaveBeenCalled()
  })

  it.each([
    ["dispatch is not paused", "false", "false"],
    ["ambiguous dispatch pause", "false", "typo"],
  ])("fails closed when %s", async (_label, registry, pause) => {
    process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED = registry
    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = pause

    const response = await POST(request())

    expect(response.status).toBe(409)
  })

  it("requires both durable pause and registry capability on the exact pilot row", async () => {
    mocks.findMany.mockResolvedValue([{
      ...stagedConfig(),
      settings: {
        ...stagedConfig().settings,
        outboundCallDispatchPaused: false,
      },
    }])

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(mocks.testConnection).not.toHaveBeenCalled()
  })

  it("does not report success when the signed provider proof fails", async () => {
    mocks.testConnection.mockResolvedValue({ success: false, message: "untrusted" })

    const response = await POST(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: "Voice control plane proof failed" })
  })
})
