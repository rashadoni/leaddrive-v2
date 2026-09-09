/**
 * M3-1c — POST /api/v1/mtm/agents/push-token
 *
 * Acceptance criteria:
 *   AC-7: Mobile agent sends their Expo push token on app startup →
 *         server stores it on MtmAgent.expoPushToken.
 *   AC-8: Missing or empty token body → 400.
 *   AC-9: Unauthenticated request (no mobile JWT) → 401.
 *   AC-10: Token is replaced on re-registration (idempotent PATCH semantics).
 *   AC-11: Invalid Expo token format → 400 with descriptive error.
 *
 * Route under test: src/app/api/v1/mtm/agents/push-token/route.ts
 * (not yet created — these tests are the red phase).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

// Route now uses resolveMobileAuth (DB revocation check), not raw getMobileAuth.
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

// Route under test
import { POST as RegisterPushToken } from "@/app/api/v1/mtm/agents/push-token/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

const AGENT = "agent-1"
const ORG = "org-1"
const VALID_EXPO_TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
const ACTIVE_AUTH = {
  agentId: AGENT,
  orgId: ORG,
  userId: "u1",
  email: "a@t.com",
  name: "Agent",
  role: "AGENT",
  tenantCapabilities: { routeField: true, workforceHrm: true },
}

function makeJsonReq(body: unknown): NextRequest {
  return new NextRequest(
    new URL("/api/v1/mtm/agents/push-token", "http://localhost:3000"),
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/v1/mtm/agents/push-token", () => {
  it("AC-9: returns 401 when no mobile auth (unauthenticated)", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null)

    const res = await RegisterPushToken(makeJsonReq({ token: VALID_EXPO_TOKEN }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toMatch(/unauthorized/i)
  })

  it("SECURITY: returns 401 when agent is SUSPENDED (revocation via resolveMobileAuth)", async () => {
    // resolveMobileAuth returns null for suspended agents (DB revocation check).
    // The route must pass through this 401 — no raw getMobileAuth bypass.
    vi.mocked(resolveMobileAuth).mockResolvedValue(null)

    const res = await RegisterPushToken(makeJsonReq({ token: VALID_EXPO_TOKEN }))
    expect(res.status).toBe(401)
  })

  it("AC-8: returns 400 when token body is missing", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(ACTIVE_AUTH)

    const res = await RegisterPushToken(makeJsonReq({}))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/token/i)
  })

  it("AC-8: returns 400 when token is empty string", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(ACTIVE_AUTH)

    const res = await RegisterPushToken(makeJsonReq({ token: "" }))
    expect(res.status).toBe(400)
  })

  it("AC-11: returns 400 when token format is invalid (not ExponentPushToken[...])", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(ACTIVE_AUTH)

    const res = await RegisterPushToken(makeJsonReq({ token: "invalid-token-format" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/invalid.*token|expo.*token/i)
  })

  it("AC-7: active agent stores expoPushToken — 200 with success", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(ACTIVE_AUTH)
    vi.mocked(prisma.mtmAgent.update).mockResolvedValue({
      id: AGENT,
      expoPushToken: VALID_EXPO_TOKEN,
    } as any)

    const res = await RegisterPushToken(makeJsonReq({ token: VALID_EXPO_TOKEN }))
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)

    // Verify prisma.mtmAgent.update called with correct args
    expect(prisma.mtmAgent.update).toHaveBeenCalledWith({
      where: { id: AGENT },
      data: { expoPushToken: VALID_EXPO_TOKEN },
    })
  })

  it("AC-10: re-registration replaces token (idempotent) — active agent", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(ACTIVE_AUTH)
    vi.mocked(prisma.mtmAgent.update).mockResolvedValue({
      id: AGENT,
      expoPushToken: VALID_EXPO_TOKEN,
    } as any)

    // Call twice — second call should still update with the new token
    await RegisterPushToken(makeJsonReq({ token: VALID_EXPO_TOKEN }))
    const res = await RegisterPushToken(makeJsonReq({ token: VALID_EXPO_TOKEN }))
    expect(res.status).toBe(200)
    expect(prisma.mtmAgent.update).toHaveBeenCalledTimes(2)
  })
})
