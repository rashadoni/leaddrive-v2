import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findMany: vi.fn() },
    marketingAccount: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    accountIntentSignal: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "sig-1" }),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(() => false),
}))

vi.mock("@/lib/audit/compliance-audit", () => ({
  recordPiiAccessFromRequest: vi.fn(),
}))

import { POST } from "@/app/api/v1/account-intent-signals/import/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "u1" }

function makeRequest(body: unknown) {
  const url = new URL("/api/v1/account-intent-signals/import", "http://localhost:3000")
  return new NextRequest(url, {
    method: "POST",
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
      : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue(AUTH)
  ;(prisma.company.findMany as any).mockResolvedValue([
    { id: "co1", name: "Acme", website: "https://acme.com" },
  ])
  ;(prisma.marketingAccount.findMany as any).mockResolvedValue([{ id: "acc1", companyId: "co1" }])
  ;(prisma.accountIntentSignal.findFirst as any).mockResolvedValue(null)
})

describe("POST /api/v1/account-intent-signals/import", () => {
  it("400s without a csv string", async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("413s on an oversized CSV", async () => {
    const res = await POST(makeRequest({ csv: "x".repeat(2_000_001) }))
    expect(res.status).toBe(413)
  })

  it("400s when the header has no topic column", async () => {
    const res = await POST(makeRequest({ csv: "domain,score\nacme.com,90" }))
    expect(res.status).toBe(400)
    expect((await res.json()).parseErrors?.[0]).toMatch(/topic/i)
  })

  it("imports a tracked-company row and records a signal (201)", async () => {
    const csv = "domain,topic,score,date\nacme.com,CRM software,82,2026-06-01"
    const res = await POST(makeRequest({ csv }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.recorded).toBe(1)
    const { data } = (prisma.accountIntentSignal.create as any).mock.calls[0][0]
    expect(data.signalKind).toBe("third_party_intent")
    expect(data.marketingAccountId).toBe("acc1")
    expect(data.contactId).toBeNull()
  })

  it("reports not_tracked (200, recorded 0) when the company isn't a marketing account", async () => {
    ;(prisma.marketingAccount.findMany as any).mockResolvedValue([]) // none tracked
    const csv = "domain,topic\nacme.com,CRM software"
    const res = await POST(makeRequest({ csv }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.recorded).toBe(0)
    expect(json.notTracked).toBe(1)
    expect(prisma.accountIntentSignal.create).not.toHaveBeenCalled()
  })
})
