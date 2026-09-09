import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * Cross-tenant routing on the SHARED-LeadDrive-app path (no `?t=`).
 *
 * `pageId` (FB Page id / IG business-account id) is public and NOT unique across tenants — two orgs
 * can each hold an ACTIVE ChannelConfig for the same one. Confirmed on prod 2026-08-26: IG business
 * account 17841410801241198 is claimed by BOTH `leaddrive` (channelType=instagram) and
 * `brandprotection` (channelType=instagram, settings.igLogin=true).
 *
 * With no `?t=` the lookup is deliberately un-scoped (the shared app is the signer; the payload names
 * no org), so the resolution itself decides which tenant reads the DM. These tests pin that decision:
 * it must be a TOTAL order that does not depend on the order the DB happens to hand rows back, and a
 * contested pageId must be reported. `findFirst` with no `orderBy` satisfies neither — the mock below
 * models that by returning rows in fixture order, and every routing assertion is run with the fixture
 * in BOTH orders.
 */

type Row = {
  id: string
  organizationId: string
  channelType: string
  pageId: string
  isActive: boolean
  settings: Record<string, unknown> | null
  createdAt: Date
  apiKey: string
}

// The in-memory channel_configs table the prisma mock reads. Tests replace its contents.
let rows: Row[] = []

const { runWithTenant, runWithRlsBypass, upsertSocialConversation } = vi.hoisted(() => ({
  runWithTenant: vi.fn(async (_org: string, fn: () => unknown) => fn()),
  runWithRlsBypass: vi.fn(async (fn: () => unknown) => fn()),
  upsertSocialConversation: vi.fn(async () => ({ id: "conv-1", assignedTo: null, wasCreated: true })),
}))

type ChannelWhere = {
  organizationId?: string
  pageId?: string
  isActive?: boolean
  channelType?: string | { in?: string[] }
}

function matches(where: ChannelWhere, row: Row): boolean {
  if (where.organizationId && row.organizationId !== where.organizationId) return false
  if (where.pageId && row.pageId !== where.pageId) return false
  if (where.isActive !== undefined && row.isActive !== where.isActive) return false
  const type = where.channelType
  if (typeof type === "string" && row.channelType !== type) return false
  if (type && typeof type === "object" && Array.isArray(type.in) && !type.in.includes(row.channelType)) return false
  return true
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => null) },
    channelConfig: {
      // Fixture order, NOT `orderBy` order: Postgres gives no ordering guarantee without an ORDER BY,
      // and neither mock applies one. The route must impose the order itself.
      findMany: vi.fn(async ({ where }: { where: ChannelWhere }) => rows.filter((r) => matches(where, r))),
      findFirst: vi.fn(async ({ where }: { where: ChannelWhere }) => rows.find((r) => matches(where, r)) ?? null),
    },
    channelMessage: {
      findFirst: vi.fn(async () => null), // no duplicate
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "msg-1", ...data })),
    },
  },
}))
vi.mock("@/lib/rls-context", () => ({ runWithTenant, runWithRlsBypass }))
vi.mock("@/lib/facebook", () => ({
  upsertSocialConversation,
  sendFacebookMessage: vi.fn(async () => true),
  sendInstagramMessage: vi.fn(async () => true),
}))
vi.mock("@/lib/social/notify-recipients", () => ({
  notifyConversationRecipients: vi.fn(async () => undefined),
}))
vi.mock("@/lib/inbox/conversation-events", () => ({
  emitConversationIngestEvents: vi.fn(async () => undefined),
}))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn(async () => ({ replied: false })),
  chatbotTookOwnership: vi.fn(() => false),
}))

import { POST } from "@/app/api/v1/webhooks/facebook/route"
import { prisma } from "@/lib/prisma"

const SECRET = "SHARED_APP_SECRET"
const BASE = "https://app.leaddrivecrm.org/api/v1/webhooks/facebook"
const IG_ID = "17841410801241198" // the contested account, from prod

// Both prod claimants of IG_ID.
const leaddrive: Row = {
  id: "cfg_leaddrive",
  organizationId: "org_leaddrive",
  channelType: "instagram",
  pageId: IG_ID,
  isActive: true,
  settings: {},
  createdAt: new Date("2026-05-01T00:00:00Z"),
  apiKey: "tok_leaddrive",
}
const brandprotection: Row = {
  id: "cfg_brandprotection",
  organizationId: "org_brandprotection",
  channelType: "instagram",
  pageId: IG_ID,
  isActive: true,
  settings: { igLogin: true }, // Instagram-Login surface — served by /api/v1/webhooks/instagram
  createdAt: new Date("2026-07-21T00:00:00Z"),
  apiKey: "tok_brandprotection",
}

function inboundDm(pageId: string): string {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: pageId,
        messaging: [
          { sender: { id: "ig-user-9" }, recipient: { id: pageId }, message: { mid: "mid-1", text: "Salam" } },
        ],
      },
    ],
  })
}

async function deliver(body: string) {
  const req = {
    url: BASE,
    nextUrl: new URL(BASE), // no ?t= → shared LeadDrive app path
    text: async () => body,
    headers: {
      get: (k: string) =>
        k === "x-hub-signature-256" ? "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex") : null,
    },
  } as unknown as NextRequest
  return POST(req)
}

/** Every `channelMessage.create` payload the run produced. */
function created(): Array<Record<string, unknown>> {
  const calls = (prisma.channelMessage.create as unknown as { mock: { calls: Array<[{ data: Record<string, unknown> }]> } }).mock.calls
  return calls.map((c) => c[0].data)
}

/** The org the inbound message was actually written into. */
function ingestedOrgs(): unknown[] {
  return created().map((d) => d.organizationId)
}

let warn: ReturnType<typeof vi.spyOn>

/** Every console.warn line emitted so far. */
function warnLines(): string[] {
  return (warn.mock.calls as unknown as unknown[][]).map((c) => String(c[0]))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FACEBOOK_APP_SECRET = SECRET
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
  delete process.env.FACEBOOK_APP_SECRET
})

describe("FB webhook — contested pageId resolves deterministically (shared-app path)", () => {
  it("routes to the same org whichever order the DB returns the rows in", async () => {
    for (const fixture of [
      [leaddrive, brandprotection],
      [brandprotection, leaddrive], // same table, other scan order
    ]) {
      vi.clearAllMocks()
      rows = fixture
      const res = await deliver(inboundDm(IG_ID))
      expect(res.status).toBe(200)
      // The Instagram-Login row belongs to the tenant's own IG-Login app (/webhooks/instagram), so on
      // this endpoint it never outranks a Facebook-Login row for the same account.
      expect(ingestedOrgs()).toEqual(["org_leaddrive"])
      expect(runWithTenant).toHaveBeenCalledWith("org_leaddrive", expect.any(Function))
      expect(runWithTenant).not.toHaveBeenCalledWith("org_brandprotection", expect.any(Function))
    }
  })

  it("warns naming EVERY org that claims the pageId, plus the winner", async () => {
    rows = [leaddrive, brandprotection]
    await deliver(inboundDm(IG_ID))
    const line = warnLines().find((m) => m.includes("AMBIGUOUS"))
    expect(line).toBeTruthy()
    expect(line).toContain(IG_ID)
    expect(line).toContain("org_leaddrive")
    expect(line).toContain("org_brandprotection")
    expect(line).toContain("cfg_brandprotection") // the config id, so the stale claim is actionable
    expect(line).toContain("CROSS-TENANT")
  })

  it("stays silent when a single org claims the pageId", async () => {
    rows = [leaddrive]
    await deliver(inboundDm(IG_ID))
    expect(ingestedOrgs()).toEqual(["org_leaddrive"])
    expect(warnLines().filter((m) => m.includes("AMBIGUOUS"))).toEqual([])
  })

  it("the OLDEST claim wins between two Facebook-Login orgs — a later paste of a public Page ID cannot capture the DMs", async () => {
    const incumbent: Row = { ...leaddrive, id: "cfg_incumbent", organizationId: "org_incumbent", createdAt: new Date("2026-01-10T00:00:00Z") }
    const latecomer: Row = { ...leaddrive, id: "cfg_latecomer", organizationId: "org_latecomer", createdAt: new Date("2026-08-20T00:00:00Z") }
    for (const fixture of [
      [latecomer, incumbent],
      [incumbent, latecomer],
    ]) {
      vi.clearAllMocks()
      rows = fixture
      await deliver(inboundDm(IG_ID))
      expect(ingestedOrgs()).toEqual(["org_incumbent"])
    }
  })

  it("still ingests when ONLY an Instagram-Login row claims the pageId, and says so", async () => {
    // De-preferred, not excluded: dropping the message would be a silent data loss for the one org
    // that does hold the account.
    rows = [brandprotection]
    await deliver(inboundDm(IG_ID))
    expect(ingestedOrgs()).toEqual(["org_brandprotection"])
    const line = warnLines().find((m) => m.includes("Instagram-Login row"))
    expect(line).toContain(IG_ID)
  })

  it("prefers the instagram row over a facebook row with the same id for an IG payload", async () => {
    const fbRow: Row = { ...leaddrive, id: "cfg_fb", organizationId: "org_leaddrive", channelType: "facebook", createdAt: new Date("2026-01-01T00:00:00Z") }
    for (const fixture of [
      [fbRow, leaddrive],
      [leaddrive, fbRow],
    ]) {
      vi.clearAllMocks()
      rows = fixture
      await deliver(inboundDm(IG_ID))
      expect(created()[0].channelConfigId).toBe("cfg_leaddrive") // surface match beats the older facebook row
    }
  })

  it("resolves the channel under RLS bypass and does all downstream work inside runWithTenant", async () => {
    rows = [leaddrive, brandprotection]
    await deliver(inboundDm(IG_ID))
    expect(runWithRlsBypass).toHaveBeenCalled()
    // The org-resolution lookup is the only bypassed query; the write is tenant-scoped.
    expect(runWithTenant).toHaveBeenCalledWith("org_leaddrive", expect.any(Function))
  })
})
