/**
 * Resend delivery reports reach the campaign's counters — once per email.
 *
 * Until 2026-09-21 the webhook marked the EmailLog row «bounced» and stopped
 * there: nothing in the codebase wrote Campaign.totalBounced, so the campaign
 * page showed 0 bounces for every campaign while production held 39 bounced
 * campaign emails across three campaigns.
 *
 * Svix redelivers an event until it gets a 2xx, and may deliver it twice at
 * once. The counters must move on a log's FIRST bounce or complaint only, and
 * a later event (a late «delivered») must not reopen the log for a second
 * count. The database below applies `updateMany` the way Postgres does — the
 * WHERE is re-checked on the row as it is when the update runs.
 */
import crypto from "crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

type Log = { id: string; organizationId: string; toEmail: string; messageId: string; status: string; campaignId: string | null; variantId: string | null; errorMessage?: string | null }
type Campaign = { id: string; organizationId: string; totalBounced: number; totalSpam: number }
type Variant = { id: string; campaignId: string; totalBounced: number }

const db = vi.hoisted(() => ({
  logs: [] as Log[],
  campaigns: [] as Campaign[],
  variants: [] as Variant[],
  unsubscribes: [] as { organizationId: string; email: string }[],
}))

vi.mock("@/lib/prisma", () => {
  type Where = Record<string, unknown>
  const matches = (row: Record<string, unknown>, where: Where) =>
    Object.entries(where).every(([key, cond]) => {
      if (cond && typeof cond === "object" && "notIn" in cond) return !(cond.notIn as unknown[]).includes(row[key])
      return row[key] === cond
    })
  const apply = (row: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value) row[key] = (row[key] as number) + (value.increment as number)
      else row[key] = value
    }
  }
  const table = (rows: () => Record<string, unknown>[]) => ({
    findFirst: vi.fn(async ({ where }: { where: Where }) => rows().find((r) => matches(r, where)) ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const hit = rows().filter((r) => matches(r, where))
      hit.forEach((r) => apply(r, data))
      return { count: hit.length }
    }),
    update: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const row = rows().find((r) => matches(r, where))
      if (!row) throw new Error("not found")
      apply(row, data)
      return row
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      rows().push({ ...data })
      return data
    }),
  })
  return {
    prisma: {
      emailLog: table(() => db.logs as unknown as Record<string, unknown>[]),
      campaign: table(() => db.campaigns as unknown as Record<string, unknown>[]),
      campaignVariant: table(() => db.variants as unknown as Record<string, unknown>[]),
      surveyUnsubscribe: table(() => db.unsubscribes as unknown as Record<string, unknown>[]),
    },
  }
})

import { POST } from "@/app/api/v1/public/resend-webhook/route"

const SECRET = "whsec_" + Buffer.from("resend-webhook-campaign-counter-test-secret").toString("base64")
let delivery = 0

function event(type: string, emailId: string, svixId = `msg_${type}_${emailId}`) {
  const body = JSON.stringify({ type, created_at: "2026-09-21T10:00:00Z", data: { email_id: emailId, bounce: { message: "550 mailbox unavailable" } } })
  const ts = String(Math.floor(Date.now() / 1000))
  const key = Buffer.from(SECRET.slice("whsec_".length), "base64")
  const sig = crypto.createHmac("sha256", key).update(`${svixId}.${ts}.${body}`).digest("base64")
  delivery++
  return new NextRequest("http://localhost/api/v1/public/resend-webhook", {
    method: "POST",
    body,
    headers: {
      "svix-id": svixId,
      "svix-timestamp": ts,
      "svix-signature": `v1,${sig}`,
      // A fresh peer per delivery keeps the IP rate limit out of the way.
      "x-real-ip": `10.9.${Math.floor(delivery / 250)}.${delivery % 250}`,
    },
  })
}

const campaign = (id: string) => db.campaigns.find((c) => c.id === id)!
const log = (id: string) => db.logs.find((l) => l.id === id)!

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  db.logs = [
    { id: "l1", organizationId: "org-1", toEmail: "a@example.az", messageId: "re_1", status: "sent", campaignId: "c1", variantId: "v1" },
    { id: "l2", organizationId: "org-1", toEmail: "b@example.az", messageId: "re_2", status: "delivered", campaignId: "c1", variantId: null },
    { id: "l3", organizationId: "org-1", toEmail: "c@example.az", messageId: "re_3", status: "sent", campaignId: null, variantId: null },
  ]
  db.campaigns = [{ id: "c1", organizationId: "org-1", totalBounced: 0, totalSpam: 0 }]
  db.variants = [{ id: "v1", campaignId: "c1", totalBounced: 0 }]
  db.unsubscribes = []
})

describe("Resend webhook → campaign bounce and spam counters", () => {
  it("counts a campaign email's bounce on the campaign and its A/B variant", async () => {
    const res = await POST(event("email.bounced", "re_1"))
    expect(res.status).toBe(200)
    expect(log("l1").status).toBe("bounced")
    expect(campaign("c1").totalBounced).toBe(1)
    expect(db.variants[0].totalBounced).toBe(1)
    expect(campaign("c1").totalSpam).toBe(0)
  })

  it("counts a redelivered bounce once, even when both deliveries arrive together", async () => {
    await POST(event("email.bounced", "re_1"))
    await POST(event("email.bounced", "re_1"))
    await Promise.all([POST(event("email.bounced", "re_1")), POST(event("email.bounced", "re_1"))])
    expect(campaign("c1").totalBounced).toBe(1)
    expect(db.variants[0].totalBounced).toBe(1)
  })

  it("keeps a bounced log bounced, so a late event cannot open it to a second count", async () => {
    await POST(event("email.bounced", "re_1"))
    const late = await POST(event("email.delivered", "re_1"))
    expect(late.status).toBe(200)
    expect(log("l1").status).toBe("bounced")
    await POST(event("email.bounced", "re_1", "msg_redelivered"))
    expect(campaign("c1").totalBounced).toBe(1)
  })

  it("counts a spam complaint as spam, not as a bounce", async () => {
    await POST(event("email.complained", "re_2"))
    await POST(event("email.complained", "re_2"))
    expect(log("l2").status).toBe("complained")
    expect(campaign("c1").totalSpam).toBe(1)
    expect(campaign("c1").totalBounced).toBe(0)
  })

  it("leaves campaigns alone for an email that belongs to none, and for other events", async () => {
    await POST(event("email.bounced", "re_3"))
    await POST(event("email.delivered", "re_2"))
    await POST(event("email.opened", "re_1"))
    expect(log("l3").status).toBe("bounced")
    expect(campaign("c1")).toMatchObject({ totalBounced: 0, totalSpam: 0 })
    // The bounced address is still suppressed from future sends.
    expect(db.unsubscribes).toEqual([expect.objectContaining({ organizationId: "org-1", email: "c@example.az" })])
  })
})
