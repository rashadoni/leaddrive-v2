import { createHash, createHmac } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  sessionCount: vi.fn(),
  callCount: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    voiceCallSession: { count: mocks.sessionCount },
    callLog: { count: mocks.callCount },
  }
  return {
    prisma: {
      $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  }
})

import { POST } from "@/app/api/internal/voice-agent/maintenance-attestation/route"

const token = "pbx-runtime-test-token"
const deploymentSha = "a".repeat(40)
const challenge = "b".repeat(64)
const now = new Date("2026-08-10T09:00:00.000Z")

function request(
  receivedToken = token,
  body: Record<string, unknown> = {
    protocol: "leaddrive-voice-maintenance-request-v1",
    challenge,
    expectedDeploymentSha: deploymentSha,
  },
  contentType = "application/json",
) {
  return new NextRequest("http://localhost/api/internal/voice-agent/maintenance-attestation", {
    method: "POST",
    headers: {
      authorization: `Bearer ${receivedToken}`,
      "content-type": contentType,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/internal/voice-agent/maintenance-attestation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    process.env.FANUM_VOICE_RUNTIME_TOKEN = token
    process.env.VOICE_AGENT_ORGANIZATION_ID = "org-pilot"
    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = "true"
    process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED = "false"
    mocks.readFile.mockResolvedValue(`${deploymentSha}\n`)
    mocks.executeRaw.mockResolvedValue(1)
    mocks.queryRaw
      .mockResolvedValueOnce([{
        settings: {
          provider: "asterisk",
          outboundCallDispatchPaused: true,
          voiceAttemptRegistryEnabled: false,
        },
      }])
    mocks.sessionCount.mockResolvedValue(0)
    mocks.callCount.mockResolvedValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.FANUM_VOICE_RUNTIME_TOKEN
    delete process.env.VOICE_AGENT_ORGANIZATION_ID
    delete process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED
    delete process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED
  })

  it("returns a byte-exact signed no-call maintenance proof", async () => {
    const response = await POST(request())
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(JSON.parse(body)).toEqual({
      protocol: "leaddrive-voice-maintenance-v1",
      challenge,
      deploymentSha,
      issuedAt: "2026-08-10T09:00:00.000Z",
      expiresAt: "2026-08-10T09:00:30.000Z",
      dispatchPaused: true,
      registryEnabled: false,
      activeSessions: 0,
      activeCalls: 0,
      callsPlaced: 0,
    })
    const message = [
      "fanum-crm-maintenance-response-v1",
      "POST",
      "/api/internal/voice-agent/maintenance-attestation",
      "200",
      createHash("sha256").update(body, "utf8").digest("hex"),
    ].join("\n")
    expect(response.headers.get("x-fanum-maintenance-signature")).toBe(
      `v1=${createHmac("sha256", token).update(message, "utf8").digest("hex")}`,
    )
  })

  it("rejects a wrong bearer before reading the deployed revision or database", async () => {
    const response = await POST(request("wrong-token"))

    expect(response.status).toBe(401)
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it.each([
    ["missing JSON content type", undefined, "text/plain"],
    ["uppercase challenge", { protocol: "leaddrive-voice-maintenance-request-v1", challenge: "B".repeat(64), expectedDeploymentSha: deploymentSha }, "application/json"],
    ["unexpected field", { protocol: "leaddrive-voice-maintenance-request-v1", challenge, expectedDeploymentSha: deploymentSha, extra: true }, "application/json"],
    ["wrong request protocol", { protocol: "wrong", challenge, expectedDeploymentSha: deploymentSha }, "application/json"],
  ])("rejects %s before reading revision or database", async (_label, body, contentType) => {
    const response = await POST(request(token, body || {}, contentType))

    expect(response.status).toBe(400)
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it("binds the proof to the exact reviewed deployment revision", async () => {
    const response = await POST(request(token, {
      protocol: "leaddrive-voice-maintenance-request-v1",
      challenge,
      expectedDeploymentSha: "c".repeat(40),
    }))

    expect(response.status).toBe(409)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it.each([
    ["process pause is absent", "false", "false"],
    ["registry is still active", "true", "true"],
    ["process pause is ambiguous", "typo", "false"],
  ])("fails before DB proof when %s", async (_label, pause, registry) => {
    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED = pause
    process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED = registry

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it("fails closed when the bundled deployed revision marker is missing or invalid", async () => {
    mocks.readFile.mockResolvedValue("not-a-sha")

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })

  it("fails closed when durable pause, registry, or zero-active proof does not match", async () => {
    mocks.queryRaw.mockReset()
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        settings: {
          provider: "asterisk",
          outboundCallDispatchPaused: false,
          voiceAttemptRegistryEnabled: false,
        },
      }])

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(mocks.sessionCount).not.toHaveBeenCalled()
    expect(mocks.callCount).not.toHaveBeenCalled()
  })

  it("does not attest while an outbound call remains open or uncertain", async () => {
    mocks.callCount.mockResolvedValue(1)

    const response = await POST(request())

    expect(response.status).toBe(409)
  })
})
