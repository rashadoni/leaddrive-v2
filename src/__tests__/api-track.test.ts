import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { contact: { findFirst: vi.fn() } },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}))

vi.mock("@/lib/account-engagement/contact-event-signal", () => ({
  recordAccountIntentSignal: vi.fn(),
}))

import { POST, OPTIONS } from "@/app/api/v1/public/track/route"
import { prisma } from "@/lib/prisma"
import { recordAccountIntentSignal } from "@/lib/account-engagement/contact-event-signal"

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

function makeRequest(
  body: unknown,
  opts: { ua?: string; ip?: string; realIp?: string } = {},
) {
  const url = new URL("/api/v1/public/track", "http://localhost:3000")
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "user-agent": opts.ua ?? BROWSER_UA,
  }
  if (opts.ip) headers["x-forwarded-for"] = opts.ip
  if (opts.realIp) headers["x-real-ip"] = opts.realIp
  return new NextRequest(url, {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(recordAccountIntentSignal as any).mockResolvedValue({
    recorded: true,
    signalId: "sig-1",
    signalKind: "page_view_high_intent",
    marketingAccountId: "acc-1",
  })
})

describe("OPTIONS /api/v1/public/track", () => {
  it("answers the CORS preflight", async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })
})

describe("POST /api/v1/public/track", () => {
  it("drops bots before any work", async () => {
    const res = await POST(
      makeRequest({ orgId: "org-1", url: "/pricing", visitorEmail: "a@b.com" }, {
        ua: "Mozilla/5.0 (compatible; Googlebot/2.1)",
        ip: "1.0.0.1",
      }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe("bot")
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(recordAccountIntentSignal).not.toHaveBeenCalled()
  })

  it("400s without orgId", async () => {
    const res = await POST(makeRequest({ url: "/pricing" }, { ip: "1.0.0.2" }))
    expect(res.status).toBe(400)
  })

  it("accepts an anonymous view but does not attribute it", async () => {
    const res = await POST(makeRequest({ orgId: "org-1", url: "/pricing" }, { ip: "1.0.0.3" }))
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe("anonymous")
    expect(recordAccountIntentSignal).not.toHaveBeenCalled()
  })

  it("accepts an unknown visitor email but does not record", async () => {
    ;(prisma.contact.findFirst as any).mockResolvedValue(null)
    const res = await POST(
      makeRequest({ orgId: "org-1", url: "/pricing", visitorEmail: "ghost@x.com" }, { ip: "1.0.0.4" }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe("unknown_visitor")
    expect(recordAccountIntentSignal).not.toHaveBeenCalled()
  })

  it("records a high-intent signal for an identified visitor on /pricing", async () => {
    ;(prisma.contact.findFirst as any).mockResolvedValue({ id: "c-1" })
    const res = await POST(
      makeRequest({ orgId: "org-1", url: "https://acme.com/pricing", visitorEmail: "jane@acme.com" }, { ip: "1.0.0.5" }),
    )
    expect(res.status).toBe(200)
    const arg = (recordAccountIntentSignal as any).mock.calls[0][0]
    expect(arg.contactId).toBe("c-1")
    expect(arg.eventType).toBe("page_view")
    expect(arg.signalKind).toBe("page_view_high_intent")
    expect(arg.resourceRef).toBe("https://acme.com/pricing")
    // occurredAt is minute-bucketed so the recorder dedup bounds pixel floods
    expect(arg.occurredAt.getTime() % 60000).toBe(0)
  })

  it("classifies a non-intent URL as research", async () => {
    ;(prisma.contact.findFirst as any).mockResolvedValue({ id: "c-2" })
    await POST(
      makeRequest({ orgId: "org-1", url: "/blog/post-1", visitorEmail: "jane@acme.com" }, { ip: "1.0.0.6" }),
    )
    expect((recordAccountIntentSignal as any).mock.calls[0][0].signalKind).toBe("page_view_research")
  })

  it("rate-limits a flood from the same org+IP", async () => {
    const ip = "9.9.9.9"
    let last: Response | undefined
    for (let i = 0; i < 61; i++) {
      last = await POST(makeRequest({ orgId: "rl-test" }, { ip }))
    }
    expect(last!.status).toBe(429)
  })

  it("keys the rate-limit on real IP — rotating X-Forwarded-For does not bypass", async () => {
    const realIp = "5.5.5.5"
    let last: Response | undefined
    for (let i = 0; i < 61; i++) {
      // Same x-real-ip (Nginx-set) but a fresh, attacker-controlled XFF each call.
      last = await POST(makeRequest({ orgId: "rl-xff" }, { realIp, ip: `7.7.7.${i}` }))
    }
    expect(last!.status).toBe(429)
  })
})
