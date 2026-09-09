/**
 * The relay's only question, and every way it must be refused.
 *
 * A signature proves the ticket was issued. It does not prove the call exists,
 * belongs to this organisation, is this user's, or is still ringing — and all
 * four have to be true before two strangers are joined on a phone call.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { callLog: { findFirst: vi.fn() } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn(async (fn: () => unknown) => fn()),
}))

import { POST } from "@/app/api/internal/softphone/verify-ticket/route"
import { prisma } from "@/lib/prisma"
import { issueParkTicket } from "@/lib/voip/browser-softphone"

const RELAY_SECRET = "r".repeat(48)
const CLAIMS = { orgId: "org-1", userId: "user-1", callLogId: "call-1" }
const CLAIM_TOKEN = "11111111-1111-4111-8111-111111111111"

function ask(body: unknown, secret: string | null = RELAY_SECRET) {
  return POST(new Request("http://localhost/api/internal/softphone/verify-ticket", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-relay-secret": secret } : {}),
    },
    body: JSON.stringify(body),
  }))
}

function liveCall(overrides: Record<string, unknown> = {}) {
  return {
    id: "call-1",
    direction: "outbound",
    createdAt: new Date(),
    endedAt: null,
    providerCallId: "corr-1",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SOFTPHONE_RELAY_SECRET = RELAY_SECRET
  process.env.BROWSER_SOFTPHONE_TICKET_SECRET = "t".repeat(48)
})

afterEach(() => {
  delete process.env.SOFTPHONE_RELAY_SECRET
  delete process.env.BROWSER_SOFTPHONE_TICKET_SECRET
})

describe("verify-ticket", () => {
  it("answers the relay with the call it may join", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(liveCall() as never)

    const res = await ask({ ticket: issueParkTicket(CLAIMS) })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      orgId: "org-1",
      userId: "user-1",
      callLogId: "call-1",
      correlationId: "corr-1",
    })
    // The lookup is pinned to the SIGNED values, never to anything the caller
    // could choose — that is what makes the RLS bypass safe here.
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "call-1",
        organizationId: "org-1",
        callMode: "human",
        OR: expect.arrayContaining([
          expect.objectContaining({ direction: "outbound", userId: "user-1" }),
        ]),
      }),
    }))
  })

  it("lets the current claimant park a fresh ringing inbound call", async () => {
    const claimExpiresAt = new Date(Date.now() + 30_000)
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(liveCall({
      direction: "inbound",
      status: "ringing",
      claimedByUserId: "user-1",
      userId: "user-1",
      browserAnswerClaimToken: CLAIM_TOKEN,
      browserAnswerClaimExpiresAt: claimExpiresAt,
    }) as never)

    const res = await ask({
      ticket: issueParkTicket({ ...CLAIMS, claimToken: CLAIM_TOKEN }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      correlationId: "corr-1",
      claimToken: CLAIM_TOKEN,
    }))
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "call-1",
        organizationId: "org-1",
        OR: expect.arrayContaining([
          expect.objectContaining({ direction: "outbound", userId: "user-1" }),
          expect.objectContaining({
            direction: "inbound",
            claimedByUserId: "user-1",
            userId: "user-1",
            browserAnswerClaimToken: CLAIM_TOKEN,
            browserAnswerClaimExpiresAt: { gt: expect.any(Date) },
            status: "ringing",
          }),
        ]),
      }),
      select: expect.objectContaining({ direction: true }),
    }))
  })

  it("does not apply the outbound 120-second dial window to a fresh inbound claim", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(liveCall({
      direction: "inbound",
      status: "ringing",
      createdAt: new Date(Date.now() - 10 * 60_000),
      claimedByUserId: "user-1",
      userId: "user-1",
      browserAnswerClaimToken: CLAIM_TOKEN,
      browserAnswerClaimExpiresAt: new Date(Date.now() + 30_000),
    }) as never)

    const res = await ask({
      ticket: issueParkTicket({ ...CLAIMS, claimToken: CLAIM_TOKEN }),
    })

    expect(res.status).toBe(200)
  })

  it("never lets a versionless outbound ticket match an inbound call", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null as never)

    const res = await ask({ ticket: issueParkTicket(CLAIMS) })

    expect(res.status).toBe(404)
    const query = vi.mocked(prisma.callLog.findFirst).mock.calls[0]?.[0]
    expect(query?.where?.OR).toEqual([
      { direction: "outbound", userId: "user-1" },
    ])
  })

  it("refuses a relay that cannot prove it is the relay", async () => {
    const res = await ask({ ticket: issueParkTicket(CLAIMS) }, "wrong-secret")
    expect(res.status).toBe(401)
    expect(prisma.callLog.findFirst).not.toHaveBeenCalled()
  })

  it("refuses everything when the deployment set no relay secret", async () => {
    delete process.env.SOFTPHONE_RELAY_SECRET
    const res = await ask({ ticket: issueParkTicket(CLAIMS) }, null)
    expect(res.status).toBe(401)
  })

  it("gives one answer to every broken ticket", async () => {
    for (const ticket of [undefined, "", "nonsense", "a.b"]) {
      const res = await ask({ ticket })
      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toEqual({ error: "invalid_ticket" })
    }
    expect(prisma.callLog.findFirst).not.toHaveBeenCalled()
  })

  it("refuses a signed ticket for a call that is not there", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null as never)
    const res = await ask({ ticket: issueParkTicket(CLAIMS) })
    expect(res.status).toBe(404)
  })

  it("refuses to join a call that has already ended", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(liveCall({ endedAt: new Date() }) as never)
    const res = await ask({ ticket: issueParkTicket(CLAIMS) })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "call_already_ended" })
  })

  it("refuses a call too old to still be ringing", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(
      liveCall({ createdAt: new Date(Date.now() - 5 * 60_000) }) as never,
    )
    const res = await ask({ ticket: issueParkTicket(CLAIMS) })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: "park_window_expired" })
  })
})
