import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Tests for mass SMS campaigns (TT §7 "Kütləvi SMS").
 *
 * Verifies:
 *   1. Campaigns with type="sms" route through our sendSms() abstraction
 *      (not the email sender) and land on the currently-configured SMS
 *      provider (Twilio, Vonage, or ATL).
 *   2. Contacts without phones are skipped for SMS campaigns.
 *   3. The endpoint returns 422 when no SMS provider is configured.
 *   4. recipientMode="manual" honours campaign.recipientIds.
 */

type TestCampaign = {
  id: string
  organizationId?: string
  type: string
  name: string
  subject?: string | null
  recipientMode?: string
  recipientIds?: string[]
}

type TestContact = {
  id: string
  phone?: string | null
  email?: string | null
  fullName: string
  source?: string | null
}

type TestLead = {
  id: string
  email?: string | null
  contactName: string
}

type SmsCall = {
  to: string
  message: string
  organizationId: string
}

type EmailCall = {
  to: string
  subject?: string
  html?: string
  organizationId?: string
  campaignId?: string
  templateId?: string
  contactId?: string
  variantId?: string
}

type ContactFindManyArgs = {
  where?: {
    phone?: { not?: string | null }
    email?: { not?: string | null }
    id?: { in?: string[] }
  }
}

type ContactUpdateManyArgs = {
  where?: { id?: { in?: string[] } }
  data?: { lastSmsCampaignId?: string }
}

type LeadFindManyArgs = {
  where?: { email?: { not?: string | null } }
}

type TouchpointRow = {
  contactId: string
  campaignId: string
  channel: string
  touchpointType: string
  sourceKey: string
}

const state: {
  campaign: TestCampaign | null
  contacts: TestContact[]
  leads: TestLead[]
  smsCalls: SmsCall[]
  emailCalls: EmailCall[]
} = { campaign: null, contacts: [], leads: [], smsCalls: [], emailCalls: [] }

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  getSession: vi.fn(async () => ({ userId: "u1", orgId: "org_1", role: "admin" })),
  requireAuth: vi.fn(async () => ({
    userId: "u1",
    orgId: "org_1",
    role: "admin",
    email: "a@b.com",
    name: "Test",
  })),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
}))

const attributionUpdates: Array<{ ids: string[]; campaignId: string }> = []

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findFirst: vi.fn(async () => state.campaign),
      update: vi.fn(async () => state.campaign),
    },
    contact: {
      findMany: vi.fn(async ({ where }: ContactFindManyArgs) => {
        let rows = [...state.contacts]
        if (where?.phone?.not === null) rows = rows.filter((c) => c.phone)
        if (where?.email?.not === null) rows = rows.filter((c) => c.email)
        const ids = where?.id?.in
        if (ids) rows = rows.filter((c) => ids.includes(c.id))
        return rows
      }),
      updateMany: vi.fn(async ({ where, data }: ContactUpdateManyArgs) => {
        attributionUpdates.push({
          ids: where?.id?.in || [],
          campaignId: data?.lastSmsCampaignId || "",
        })
        return { count: (where?.id?.in || []).length }
      }),
    },
    lead: {
      findMany: vi.fn(async ({ where }: LeadFindManyArgs) => {
        let rows = [...state.leads]
        if (where?.email?.not === null) rows = rows.filter((lead) => lead.email)
        return rows
      }),
    },
    contactSegment: { findFirst: vi.fn(async () => null) },
    campaignVariant: { findMany: vi.fn(async () => []) },
    emailTemplate: { findFirst: vi.fn(async () => null) },
  },
}))

vi.mock("@/lib/sms", () => ({
  sendSms: vi.fn(async (opts: SmsCall) => {
    state.smsCalls.push(opts)
    return { success: true, messageId: `SM_${state.smsCalls.length}` }
  }),
  isSmsConfigured: vi.fn(async () => true),
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async (opts: EmailCall) => {
    state.emailCalls.push(opts)
    return { success: true }
  }),
  renderTemplate: vi.fn((tpl: string) => tpl),
}))

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent: vi.fn(async () => {}) }))
vi.mock("@/lib/marketing-attribution/touchpoint-recorder", () => ({
  recordTouchpointsSafe: vi.fn(),
  touchpointSourceKey: { smsSent: (c: string, k: string) => `sms:${c}:${k}:sent` },
}))

import { POST } from "@/app/api/v1/campaigns/[id]/send/route"
import { isSmsConfigured, sendSms } from "@/lib/sms"
import { recordTouchpointsSafe } from "@/lib/marketing-attribution/touchpoint-recorder"

function makeReq(): NextRequest {
  return new NextRequest("https://example.com/api/v1/campaigns/c1/send", { method: "POST" })
}

beforeEach(() => {
  state.campaign = null
  state.contacts = []
  state.leads = []
  state.smsCalls = []
  state.emailCalls = []
  attributionUpdates.length = 0
  vi.clearAllMocks()
  vi.mocked(isSmsConfigured).mockResolvedValue(true)
})

describe("POST /api/v1/campaigns/[id]/send — SMS branch (TT §7)", () => {
  it("uses sendSms (not sendEmail) when campaign.type is 'sms'", async () => {
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "sms",
      name: "Flash sale",
      subject: "Flash sale! 30% off today only",
      recipientMode: "all",
    }
    state.contacts = [
      { id: "k1", phone: "+994501234567", email: "a@b.com", fullName: "Ali", source: null },
      { id: "k2", phone: "+994507654321", email: null, fullName: "Bob", source: null },
    ]

    const res = await POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.channel).toBe("sms")
    expect(body.data.sent).toBe(2)
    expect(state.smsCalls).toHaveLength(2)
    expect(state.emailCalls).toHaveLength(0)

    // Each SMS received the campaign subject as the message body
    for (const call of state.smsCalls) {
      expect(call.message).toBe("Flash sale! 30% off today only")
      expect(call.organizationId).toBe("org_1")
    }
  })

  it("skips contacts without phone numbers", async () => {
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "sms",
      name: "Promo",
      subject: "Hi",
      recipientMode: "all",
    }
    state.contacts = [
      { id: "k1", phone: "+994501234567", fullName: "Ali" },
      { id: "k2", phone: null, fullName: "Bob" }, // should be filtered out
    ]

    const res = await POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(state.smsCalls).toHaveLength(1)
    expect(body.data.sent).toBe(1)
    expect(body.data.total).toBe(1)
  })

  it("returns 422 when no SMS provider configured", async () => {
    vi.mocked(isSmsConfigured).mockResolvedValue(false)
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "sms",
      name: "x",
      subject: "y",
      recipientMode: "all",
    }
    state.contacts = [{ id: "k1", phone: "+994501234567", fullName: "Ali" }]

    const res = await POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toMatch(/not configured/i)
    expect(state.smsCalls).toHaveLength(0)
  })

  it("honours recipientMode=manual with explicit recipientIds", async () => {
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "sms",
      name: "VIP blast",
      subject: "hi",
      recipientMode: "manual",
      recipientIds: ["k2"],
    }
    state.contacts = [
      { id: "k1", phone: "+994501234567", fullName: "Ali" },
      { id: "k2", phone: "+994509999999", fullName: "Zoe" },
    ]

    await POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })

    expect(state.smsCalls).toHaveLength(1)
    expect(state.smsCalls[0].to).toBe("+994509999999")
  })

  it("stamps lastSmsCampaignId on every contact that successfully received the SMS (TT §3.3 attribution)", async () => {
    state.campaign = {
      id: "c42",
      organizationId: "org_1",
      type: "sms",
      name: "Attribution test",
      subject: "hi",
      recipientMode: "all",
    }
    state.contacts = [
      { id: "k1", phone: "+994501234567", fullName: "Ali" },
      { id: "k2", phone: "+994507654321", fullName: "Bob" },
    ]

    await POST(makeReq(), { params: Promise.resolve({ id: "c42" }) })

    expect(attributionUpdates).toHaveLength(1)
    expect(attributionUpdates[0].campaignId).toBe("c42")
    expect(attributionUpdates[0].ids.sort()).toEqual(["k1", "k2"])
  })

  it("#16 records sms_sent attribution touchpoints, one per delivered contact", async () => {
    state.campaign = {
      id: "c42",
      organizationId: "org_1",
      type: "sms",
      name: "Attribution test",
      subject: "hi",
      recipientMode: "all",
    }
    state.contacts = [
      { id: "k1", phone: "+994501234567", fullName: "Ali" },
      { id: "k2", phone: "+994507654321", fullName: "Bob" },
    ]

    await POST(makeReq(), { params: Promise.resolve({ id: "c42" }) })

    expect(recordTouchpointsSafe).toHaveBeenCalledTimes(1)
    const [org, rows] = vi.mocked(recordTouchpointsSafe).mock.calls[0] as unknown as [string, TouchpointRow[]]
    expect(org).toBe("org_1")
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.contactId).sort()).toEqual(["k1", "k2"])
    for (const r of rows) {
      expect(r).toMatchObject({ campaignId: "c42", channel: "sms", touchpointType: "sms_sent" })
      expect(r.sourceKey).toBe(`sms:c42:${r.contactId}:sent`)
    }
  })

  it("#16 wraps the link in the SMS body with the per-recipient sms-click tracker", async () => {
    state.campaign = {
      id: "c50", organizationId: "org_1", type: "sms", name: "Promo",
      subject: "Sale! https://shop.example.com/x", recipientMode: "all",
    }
    state.contacts = [{ id: "k1", phone: "+994501234567", fullName: "Ali" }]

    await POST(makeReq(), { params: Promise.resolve({ id: "c50" }) })

    expect(state.smsCalls).toHaveLength(1)
    const msg = state.smsCalls[0].message
    // Original link replaced by the tracker carrying campaign + contact.
    expect(msg).toContain("/api/v1/tracking/sms-click?c=c50&k=k1&url=")
    expect(msg).toContain(encodeURIComponent("https://shop.example.com/x"))
    expect(msg).not.toMatch(/Sale! https:\/\/shop\.example\.com\/x$/) // original raw link gone
  })

  it("records NO sms_sent touchpoints when nothing delivered", async () => {
    vi.mocked(sendSms).mockResolvedValue({ success: false, error: "Carrier rejected" })
    state.campaign = {
      id: "c98", organizationId: "org_1", type: "sms", name: "fail", subject: "hi", recipientMode: "all",
    }
    state.contacts = [{ id: "k1", phone: "+994501234567", fullName: "Ali" }]
    await POST(makeReq(), { params: Promise.resolve({ id: "c98" }) })
    expect(recordTouchpointsSafe).not.toHaveBeenCalled()
  })

  it("does NOT stamp attribution when no SMS delivered successfully", async () => {
    vi.mocked(sendSms).mockResolvedValue({ success: false, error: "Carrier rejected" })
    state.campaign = {
      id: "c99",
      organizationId: "org_1",
      type: "sms",
      name: "all fail",
      subject: "hi",
      recipientMode: "all",
    }
    state.contacts = [{ id: "k1", phone: "+994501234567", fullName: "Ali" }]

    await POST(makeReq(), { params: Promise.resolve({ id: "c99" }) })

    expect(attributionUpdates).toHaveLength(0)
  })

  it("does NOT go through SMS branch when type is 'email' (or missing)", async () => {
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "email",
      name: "Newsletter",
      subject: "Monthly update",
      recipientMode: "all",
    }
    state.contacts = [{ id: "k1", phone: "+994501234567", email: "a@b.com", fullName: "Ali" }]

    await POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })

    expect(state.smsCalls).toHaveLength(0) // SMS branch skipped
    expect(sendSms).not.toHaveBeenCalled()
  })

  it("keeps the email adapter as the fallback for unknown non-SMS campaign types", async () => {
    state.campaign = {
      id: "c1",
      organizationId: "org_1",
      type: "push",
      name: "Future channel",
      subject: "Use existing email path",
      recipientMode: "all",
    }
    state.contacts = [{ id: "k1", phone: "+994501234567", email: "a@b.com", fullName: "Ali" }]
    state.leads = [{ id: "l1", email: "lead@b.com", contactName: "Leyla" }]

    const res = await POST(makeReq(), { params: Promise.resolve({ id: "c1" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ sent: 2, total: 2 })
    expect(body.data.channel).toBeUndefined()
    expect(state.smsCalls).toHaveLength(0)
    expect(state.emailCalls.map((call) => call.to).sort()).toEqual(["a@b.com", "lead@b.com"])
  })
})
