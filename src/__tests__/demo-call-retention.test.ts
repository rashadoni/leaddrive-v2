/**
 * A demo call's words are kept for 90 days — the agent's first sentence says
 * so and the prospect agreed to exactly that (owner decision 2026-09-21).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRunWithTenant = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    callLog: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: mockRunWithTenant,
}))

import { prisma } from "@/lib/prisma"
import {
  DEMO_CALL_TEXT_RETENTION_DAYS,
  purgeExpiredDemoCallText,
  redactDemoCallInsight,
} from "@/lib/demo-center/call-retention"

const SALES_ORG = "org-leaddrive-inc"
const NOW = new Date("2026-12-21T03:17:00.000Z")

const insight = {
  version: 1,
  sentiment: "positive",
  sentimentScore: 0.7,
  summary: "Nigar dedi ki, Instagram müraciətlərini itirirlər.",
  topics: ["instagram", "sales-team"],
  actionItems: [{ text: "Menecer zəng etsin", owner: "agent", dueDateHint: "sabah" }],
  competitorMentions: ["AmoCRM"],
  coachingHints: ["Qiyməti daha tez soruş"],
  model: "claude",
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VOICE_AGENT_ORGANIZATION_ID = SALES_ORG
  delete process.env.DEMO_LEAD_ORGANIZATION_ID
  mockRunWithTenant.mockImplementation((_org: string, fn: () => unknown) => Promise.resolve().then(fn))
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: SALES_ORG } as never)
  vi.mocked(prisma.callLog.updateMany).mockResolvedValue({ count: 1 })
})

describe("redactDemoCallInsight", () => {
  it("removes every retelling of the conversation and keeps what carries no one's words", () => {
    const redacted = redactDemoCallInsight(insight, NOW) as Record<string, unknown>
    expect(redacted).toEqual({
      version: 1,
      sentiment: "positive",
      sentimentScore: 0.7,
      summary: "",
      topics: ["instagram", "sales-team"],
      actionItems: [],
      competitorMentions: [],
      coachingHints: [],
      model: "claude",
      redactedAt: NOW.toISOString(),
    })
    expect(JSON.stringify(redacted)).not.toMatch(/Nigar|Menecer|AmoCRM|Qiyməti/)
  })

  it("leaves nothing to write when there was no analysis", () => {
    expect(redactDemoCallInsight(null, NOW)).toBeUndefined()
    expect(redactDemoCallInsight([] as never, NOW)).toBeUndefined()
  })
})

describe("purgeExpiredDemoCallText", () => {
  it("looks only at the demo's own calls, older than the promise, that still hold words", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([])

    await purgeExpiredDemoCallText(NOW)

    expect(mockRunWithTenant.mock.calls[0][0]).toBe(SALES_ORG)
    expect(prisma.callLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: SALES_ORG,
        consentAudit: { path: ["via"], equals: "demo_center" },
        createdAt: { lt: new Date(NOW.getTime() - DEMO_CALL_TEXT_RETENTION_DAYS * 86_400_000) },
        OR: [{ transcription: { not: null } }, { notes: { not: null } }],
      },
    }))
  })

  it("removes the transcript, the notes and the retold analysis", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([
      { id: "call-1", transcription: "Agent: Salam…", notes: "qısa qeyd", insights: insight },
    ] as never)

    await expect(purgeExpiredDemoCallText(NOW)).resolves.toEqual({ redacted: 1 })

    expect(prisma.callLog.updateMany).toHaveBeenCalledWith({
      where: { id: "call-1", organizationId: SALES_ORG },
      data: {
        transcription: null,
        notes: null,
        insights: expect.objectContaining({ summary: "", actionItems: [], redactedAt: NOW.toISOString() }),
      },
    })
  })

  it("does nothing when no sales organisation is configured", async () => {
    delete process.env.VOICE_AGENT_ORGANIZATION_ID
    await expect(purgeExpiredDemoCallText(NOW)).resolves.toEqual({ redacted: 0 })
    expect(prisma.callLog.findMany).not.toHaveBeenCalled()
  })
})

describe("the cron route", () => {
  it("refuses without the cron secret", async () => {
    process.env.CRON_SECRET = "cron-secret-for-test"
    const { POST } = await import("@/app/api/cron/demo-call-retention/route")
    const { NextRequest } = await import("next/server")
    const response = await POST(new NextRequest("http://localhost:3001/api/cron/demo-call-retention", { method: "POST" }))
    expect(response.status).toBeGreaterThanOrEqual(401)
    expect(prisma.callLog.findMany).not.toHaveBeenCalled()
  })
})
