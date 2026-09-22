import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Scheduled campaigns go out at their time — and never twice.
 *
 * These are real messages to customers' contacts, so the tests drive the real
 * job, the real send logic and the real manual route against an in-memory
 * campaigns table whose `updateMany` behaves like the database's conditional
 * UPDATE: it checks and writes in one step, so of two concurrent claims
 * exactly one flips the row. What is counted is what matters — emails handed
 * to the sender.
 */

type Row = {
  id: string
  organizationId: string
  name: string
  type: string
  status: string
  scheduledAt: Date | null
  sentAt?: Date | null
  subject: string | null
  templateId: string | null
  recipientMode: string
  recipientIds: unknown
  recipientSource: string | null
  segmentId: string | null
  flowData: unknown
  isAbTest: boolean
  testPercentage: number | null
  totalSent?: number
}

type Where = {
  id?: string
  organizationId?: string
  status?: string
  scheduledAt?: { lte?: Date }
}

const db = vi.hoisted(() => ({
  campaigns: [] as Row[],
  contacts: [] as Array<{ id: string; organizationId: string; email: string | null; fullName: string }>,
  emails: [] as Array<{ to: string; campaignId?: string; organizationId?: string }>,
  claimContexts: [] as Array<{ orgId?: string; bypass?: boolean }>,
  failSendFor: null as string | null,
}))

function matches(row: Row, where: Where): boolean {
  if (where.id !== undefined && row.id !== where.id) return false
  if (where.organizationId !== undefined && row.organizationId !== where.organizationId) return false
  if (where.status !== undefined && row.status !== where.status) return false
  if (where.scheduledAt?.lte !== undefined && !(row.scheduledAt && row.scheduledAt <= where.scheduledAt.lte)) return false
  return true
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

vi.mock("@/lib/prisma", async () => {
  const { getRlsContext } = await import("@/lib/rls-context")
  return {
    prisma: {
      campaign: {
        findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) => {
          await tick()
          const rows = db.campaigns
            .filter((r) => matches(r, where))
            .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))
            .map((r) => ({ id: r.id, organizationId: r.organizationId }))
          return take ? rows.slice(0, take) : rows
        }),
        findFirst: vi.fn(async ({ where }: { where: Where }) => {
          await tick()
          const row = db.campaigns.find((r) => matches(r, where))
          return row ? { ...row } : null
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
          await tick()
          if (data.status === "sending") db.claimContexts.push({ ...getRlsContext() })
          // Check-and-write with no await in between: one atomic UPDATE.
          const hit = db.campaigns.filter((r) => matches(r, where))
          for (const r of hit) Object.assign(r, data)
          return { count: hit.length }
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          await tick()
          const row = db.campaigns.find((r) => r.id === where.id)
          if (row) Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)))
          return row
        }),
      },
      contact: {
        findMany: vi.fn(async ({ where }: { where: { organizationId: string } }) => {
          await tick()
          return db.contacts.filter((c) => c.organizationId === where.organizationId && c.email)
        }),
      },
      lead: { findMany: vi.fn(async () => []) },
      contactSegment: { findFirst: vi.fn(async () => null) },
      campaignVariant: { findMany: vi.fn(async () => []) },
      emailTemplate: { findFirst: vi.fn(async () => null) },
    },
  }
})

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async (opts: { to: string; campaignId?: string; organizationId?: string }) => {
    await tick()
    if (db.failSendFor && opts.campaignId === db.failSendFor) throw new Error("provider connection reset")
    db.emails.push(opts)
    return { success: true }
  }),
  renderTemplate: vi.fn((tpl: string) => tpl),
}))

vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async () => ({ success: true })),
  isSmsConfigured: vi.fn(async () => false),
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => "org_a"),
  getSession: vi.fn(async () => ({ userId: "u1", orgId: "org_a", role: "admin" })),
  requireAuth: vi.fn(async () => ({ userId: "u1", orgId: "org_a", role: "admin", email: "a@b.com", name: "Test" })),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
}))

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent: vi.fn(async () => {}) }))
vi.mock("@/lib/marketing-attribution/touchpoint-recorder", () => ({
  recordTouchpointsSafe: vi.fn(),
  touchpointSourceKey: { smsSent: (c: string, k: string) => `sms:${c}:${k}:sent` },
}))

import { runScheduledCampaignSends } from "@/lib/campaigns/scheduled-send-job"
import { POST as manualSend } from "@/app/api/v1/campaigns/[id]/send/route"
import { POST as cronRoute } from "@/app/api/cron/campaign-scheduled-send/route"
import { createNotification } from "@/lib/notifications"

const NOW = new Date("2026-09-22T09:00:00Z")
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000)

function campaign(over: Partial<Row> & { id: string }): Row {
  return {
    organizationId: "org_a",
    name: `Campaign ${over.id}`,
    type: "email",
    status: "scheduled",
    scheduledAt: minutes(-1),
    subject: "Hello",
    templateId: null,
    recipientMode: "contacts",
    recipientIds: [],
    recipientSource: null,
    segmentId: null,
    flowData: null,
    isAbTest: false,
    testPercentage: null,
    ...over,
  }
}

const emailsFor = (campaignId: string) => db.emails.filter((e) => e.campaignId === campaignId)
const statusOf = (id: string) => db.campaigns.find((c) => c.id === id)?.status

beforeEach(() => {
  vi.clearAllMocks()
  db.campaigns = []
  db.emails = []
  db.claimContexts = []
  db.failSendFor = null
  db.contacts = [
    { id: "a1", organizationId: "org_a", email: "one@a.test", fullName: "One" },
    { id: "a2", organizationId: "org_a", email: "two@a.test", fullName: "Two" },
    { id: "b1", organizationId: "org_b", email: "one@b.test", fullName: "B One" },
  ]
})

describe("scheduled campaign send", () => {
  it("sends a due campaign once, to every recipient, and marks it sent", async () => {
    db.campaigns = [campaign({ id: "due" })]

    const summary = await runScheduledCampaignSends(NOW)

    expect(emailsFor("due").map((e) => e.to).sort()).toEqual(["one@a.test", "two@a.test"])
    expect(statusOf("due")).toBe("sent")
    expect(summary).toMatchObject({ due: 1, sent: 1 })

    // The next minute's tick finds nothing left to send.
    await runScheduledCampaignSends(minutes(1))
    expect(emailsFor("due")).toHaveLength(2)
  })

  it("does not send a campaign whose time has not come", async () => {
    db.campaigns = [campaign({ id: "future", scheduledAt: minutes(30) })]

    const summary = await runScheduledCampaignSends(NOW)

    expect(db.emails).toEqual([])
    expect(statusOf("future")).toBe("scheduled")
    expect(summary.due).toBe(0)
  })

  it("does not send drafts, even with a date in the past", async () => {
    db.campaigns = [campaign({ id: "draft", status: "draft", scheduledAt: minutes(-60) })]

    await runScheduledCampaignSends(NOW)

    expect(db.emails).toEqual([])
    expect(statusOf("draft")).toBe("draft")
  })

  it("two overlapping runs send the campaign once", async () => {
    db.campaigns = [campaign({ id: "due" })]

    const [first, second] = await Promise.all([runScheduledCampaignSends(NOW), runScheduledCampaignSends(NOW)])

    // Both runs saw the campaign as due; only one of them got to claim it.
    expect(first.due + second.due).toBe(2)
    expect(first.sent + second.sent).toBe(1)
    expect(first.skipped + second.skipped).toBe(1)
    expect(emailsFor("due")).toHaveLength(2)
  })

  it("a manual send racing the cron sends the campaign once", async () => {
    db.campaigns = [campaign({ id: "due" })]
    const req = new NextRequest("https://example.com/api/v1/campaigns/due/send", { method: "POST" })

    const [, manual] = await Promise.all([
      runScheduledCampaignSends(NOW),
      manualSend(req, { params: Promise.resolve({ id: "due" }) }),
    ])

    expect(emailsFor("due")).toHaveLength(2)
    expect(statusOf("due")).toBe("sent")
    expect([200, 409]).toContain(manual.status)
  })

  it("claims and sends inside the campaign's own tenant scope", async () => {
    db.campaigns = [
      campaign({ id: "a", organizationId: "org_a", scheduledAt: minutes(-2) }),
      campaign({ id: "b", organizationId: "org_b", scheduledAt: minutes(-1) }),
    ]

    await runScheduledCampaignSends(NOW)

    expect(db.claimContexts).toEqual([{ orgId: "org_a" }, { orgId: "org_b" }])
    expect(emailsFor("a").map((e) => e.to).sort()).toEqual(["one@a.test", "two@a.test"])
    expect(emailsFor("b").map((e) => e.to)).toEqual(["one@b.test"])
    expect(db.emails.every((e) => e.organizationId === (e.campaignId === "a" ? "org_a" : "org_b"))).toBe(true)
  })

  it("a campaign refused before sending becomes a draft with a notice, and is not retried", async () => {
    // SMS provider not configured → refused before a single message.
    db.campaigns = [campaign({ id: "sms", type: "sms" })]

    const summary = await runScheduledCampaignSends(NOW)

    expect(summary.refused).toBe(1)
    expect(statusOf("sms")).toBe("draft")
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a", entityId: "sms", type: "warning" }),
    )

    const next = await runScheduledCampaignSends(minutes(1))
    expect(next.due).toBe(0)
  })

  it("a failure while sending leaves the campaign in «sending» — never re-sent by the next tick", async () => {
    db.campaigns = [campaign({ id: "boom" })]
    db.failSendFor = "boom"

    const summary = await runScheduledCampaignSends(NOW)
    expect(summary.failed).toBe(1)
    expect(statusOf("boom")).toBe("sending")

    db.failSendFor = null
    await runScheduledCampaignSends(minutes(1))
    expect(emailsFor("boom")).toEqual([])
  })
})

describe("manual send and the scheduled status", () => {
  const req = () => new NextRequest("https://example.com/api/v1/campaigns/x/send", { method: "POST" })

  it("refuses a campaign that is already being sent", async () => {
    db.campaigns = [campaign({ id: "busy", status: "sending" })]

    const res = await manualSend(req(), { params: Promise.resolve({ id: "busy" }) })

    expect(res.status).toBe(409)
    expect(db.emails).toEqual([])
  })

  it("a refused manual send of a scheduled campaign keeps its plan", async () => {
    db.campaigns = [campaign({ id: "sms", type: "sms", scheduledAt: minutes(60) })]

    const res = await manualSend(req(), { params: Promise.resolve({ id: "sms" }) })

    expect(res.status).toBe(422)
    expect(statusOf("sms")).toBe("scheduled")
  })
})

describe("cron route", () => {
  it("smoke mode answers without sending anything", async () => {
    process.env.CRON_SECRET = "s3cret"
    db.campaigns = [campaign({ id: "due" })]

    const res = await cronRoute(new NextRequest("http://localhost/api/cron/campaign-scheduled-send?smoke=1", {
      method: "POST",
      headers: { "x-cron-secret": "s3cret" },
    }))

    expect(await res.json()).toMatchObject({ success: true, data: { smoke: true } })
    expect(db.emails).toEqual([])
    expect(statusOf("due")).toBe("scheduled")
  })

  it("rejects a call without the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret"
    db.campaigns = [campaign({ id: "due" })]

    const res = await cronRoute(new NextRequest("http://localhost/api/cron/campaign-scheduled-send", { method: "POST" }))

    expect(res.status).toBe(401)
    expect(db.emails).toEqual([])
  })
})
