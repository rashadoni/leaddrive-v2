import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * Caller lookup for the 3CX CRM template. 3CX hits this on every ringing call, so
 * it is a public endpoint that turns a phone number into a person — the secret
 * gate and the "miss returns nothing" contract are the load-bearing parts.
 */

const ORG = "org_3cx"
// Word-shaped on purpose: a random hex string here reads as a real key to
// the gitleaks gate in CI. Only the length has to be stable.
const SECRET = "threecx-test-secret-not-a-real-key"

const state: {
  voipConfigs: { id: string; isActive: boolean; settings: unknown }[]
  contact: unknown
  lead: unknown
} = { voipConfigs: [], contact: null, lead: null }

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findMany: vi.fn(async () => state.voipConfigs) },
    contact: { findFirst: vi.fn(async () => state.contact) },
    lead: { findFirst: vi.fn(async () => state.lead) },
  },
}))

import { GET } from "@/app/api/v1/calls/threecx/lookup/route"

function lookup(params: Record<string, string>) {
  const query = new URLSearchParams(params)
  return new NextRequest(`https://app.leaddrivecrm.org/api/v1/calls/threecx/lookup?${query}`)
}

beforeEach(() => {
  // Call counts are asserted below, so they must not accumulate across cases.
  vi.clearAllMocks()
  state.voipConfigs = [{ id: "cfg_1", isActive: true, settings: { provider: "threecx", webhookSecret: SECRET } }]
  state.contact = null
  state.lead = null
})

describe("GET /api/v1/calls/threecx/lookup", () => {
  it("refuses to answer without a secret", async () => {
    const res = await GET(lookup({ orgId: ORG, number: "994501234567" }))
    expect(res.status).toBe(401)
  })

  it("refuses a wrong secret", async () => {
    const res = await GET(lookup({ orgId: ORG, secret: "f".repeat(SECRET.length), number: "994501234567" }))
    expect(res.status).toBe(401)
  })

  it("refuses when the org configured no secret", async () => {
    state.voipConfigs = [{ id: "cfg_1", isActive: true, settings: { provider: "threecx" } }]
    const res = await GET(lookup({ orgId: ORG, secret: SECRET, number: "994501234567" }))
    expect(res.status).toBe(401)
  })

  it("authorises against the row owning the secret, not an arbitrary voip row", async () => {
    // Reproduces the prod failure: switching Twilio → 3CX leaves the old row
    // behind, and it is returned first. Picking one row by ordering 401'd every
    // real 3CX request while the settings screen showed a working secret.
    state.voipConfigs = [
      { id: "cfg_twilio_old", isActive: true, settings: { provider: "twilio" } },
      { id: "cfg_3cx", isActive: true, settings: { provider: "threecx", webhookSecret: SECRET } },
    ]
    state.contact = { id: "c1", fullName: "Rashad", email: null, phone: "994501234567", company: null }

    const res = await GET(lookup({ orgId: ORG, secret: SECRET, number: "994501234567" }))
    expect(res.status).toBe(200)
    expect((await res.json()).contacts[0].id).toBe("c1")
  })

  it("says the integration is disabled when the owning row is switched off", async () => {
    state.voipConfigs = [
      { id: "cfg_3cx", isActive: false, settings: { provider: "threecx", webhookSecret: SECRET } },
    ]

    const res = await GET(lookup({ orgId: ORG, secret: SECRET, number: "994501234567" }))
    // 403, not 401: the secret proved ownership, so the real reason is safe to name.
    expect(res.status).toBe(403)
  })

  it("returns the contact in the shape the template parses", async () => {
    state.contact = {
      id: "contact_1",
      fullName: "Rashad Rahimov",
      email: "r@example.com",
      phone: "+994501234567",
      company: { name: "Fanum" },
    }

    const res = await GET(lookup({ orgId: ORG, secret: SECRET, number: "+994501234567" }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.contacts).toHaveLength(1)
    expect(body.contacts[0]).toMatchObject({
      id: "contact_1",
      entityType: "Contact",
      firstName: "Rashad",
      lastName: "Rahimov",
      companyName: "Fanum",
      email: "r@example.com",
    })
    expect(String(body.contacts[0].url)).toContain("/contacts/contact_1")
  })

  it("keeps a multi-word surname intact", async () => {
    state.contact = { id: "c2", fullName: "Ali Mammad Aliyev", email: null, phone: null, company: null }

    const body = await (await GET(lookup({ orgId: ORG, secret: SECRET, number: "994501234567" }))).json()
    expect(body.contacts[0].firstName).toBe("Ali")
    expect(body.contacts[0].lastName).toBe("Mammad Aliyev")
  })

  it("falls back to a lead when no contact matches", async () => {
    state.lead = {
      id: "lead_7",
      contactName: "Yeni Müştəri",
      companyName: "ACME",
      email: null,
      phone: "994501234567",
    }

    const body = await (await GET(lookup({ orgId: ORG, secret: SECRET, number: "994501234567" }))).json()
    expect(body.contacts[0]).toMatchObject({ id: "lead_7", entityType: "Lead", companyName: "ACME" })
    expect(String(body.contacts[0].url)).toContain("/leads/lead_7")
  })

  it("returns no contacts key on a miss so 3CX treats it as not found", async () => {
    const res = await GET(lookup({ orgId: ORG, secret: SECRET, number: "994559999999" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it("returns nothing for an empty number instead of scanning", async () => {
    const { prisma } = await import("@/lib/prisma")
    const res = await GET(lookup({ orgId: ORG, secret: SECRET, number: "" }))
    expect(await res.json()).toEqual({})
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
  })
})
