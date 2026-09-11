import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * "Messages go to another workspace" — the settings screen must say exactly what the webhooks do.
 *
 * 2026-09-11: Instagram account 17841410801241198 (@leaddrive.az) had ACTIVE channel configs in three
 * organizations. The Facebook webhook routes a contested pageId to the oldest claim (deliberately — a
 * later tenant must not capture DMs by pasting a public id), so Fanumsec, which connected it that day,
 * received nothing while its card said «Подключено». The fixtures below are that table's real shapes
 * (types, igLogin flags, dates, which rows carry appSecret/verifyToken), read from prod.
 *
 * Nothing here mocks the ranking. One in-memory channel_configs table feeds BOTH the real webhooks and the
 * real `channelIdsClaimedElsewhere`, and the central assertion is parity: a row is flagged exactly when a
 * DM for its pageId lands in some other organization. Every fixture runs in both scan orders, because the
 * DB gives no order without ORDER BY and the mock deliberately applies none.
 */

type Row = {
  id: string
  organizationId: string
  channelType: string
  configName: string
  pageId: string | null
  isActive: boolean
  settings: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
  apiKey: string | null
  appSecret: string | null
  verifyToken: string | null
}

let rows: Row[] = []
let bypassDepth = 0
const findManyCalls: Array<{ where: Record<string, unknown>; bypass: boolean }> = []

const mocks = vi.hoisted(() => ({
  gateOrg: { orgId: "" },
}))

type Where = Record<string, unknown>

function fieldMatches(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
    const c = cond as { in?: unknown[]; not?: unknown }
    if (Array.isArray(c.in)) return c.in.includes(value)
    if ("not" in c) return c.not === null ? value !== null && value !== undefined : value !== c.not
    return true
  }
  return value === cond
}

function matches(where: Where, row: Row): boolean {
  return Object.entries(where).every(([key, cond]) => fieldMatches((row as Record<string, unknown>)[key], cond))
}

function project(row: Row, select?: Record<string, boolean>): Partial<Row> {
  if (!select) return { ...row }
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (row as Record<string, unknown>)[k]]))
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn(async () => null) }, // no ?t= in these tests → shared-app path
    channelConfig: {
      findMany: vi.fn(async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
        findManyCalls.push({ where, bypass: bypassDepth > 0 })
        return rows.filter((r) => matches(where, r)).map((r) => project(r, select))
      }),
      findFirst: vi.fn(async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
        const row = rows.find((r) => matches(where, r))
        return row ? project(row, select) : null
      }),
    },
    channelMessage: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "msg-1", ...data })),
    },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn(async (_org: string, fn: () => unknown) => fn()),
  runWithRlsBypass: vi.fn(async (fn: () => unknown) => {
    bypassDepth++
    try {
      return await fn()
    } finally {
      bypassDepth--
    }
  }),
}))
vi.mock("@/lib/channels-access", () => ({
  gateChannelsAccess: vi.fn(async () => ({ orgId: mocks.gateOrg.orgId })),
}))
vi.mock("@/lib/facebook", () => ({
  upsertSocialConversation: vi.fn(async () => ({ id: "conv-1", assignedTo: null, wasCreated: true })),
  sendFacebookMessage: vi.fn(async () => true),
  sendInstagramMessage: vi.fn(async () => true),
}))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(async () => undefined) }))
// The webhooks look the sender's @username up at Meta; routing does not depend on it, and a test must not call Graph.
vi.mock("@/lib/social/meta-sender-profile", () => ({
  resolveMetaSenderName: vi.fn(async ({ senderId }: { senderId: string }) => senderId),
}))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: vi.fn(async () => undefined) }))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn(async () => ({ replied: false })),
  chatbotTookOwnership: vi.fn(() => false),
}))

import { channelIdsClaimedElsewhere } from "@/lib/channels/inbound-claim"
import { POST as fbWebhook } from "@/app/api/v1/webhooks/facebook/route"
import { POST as igWebhook } from "@/app/api/v1/webhooks/instagram/route"
import { GET as listChannels } from "@/app/api/v1/channels/route"
import { prisma } from "@/lib/prisma"

const IG_ID = "17841410801241198"
const FB_SECRET = "SHARED_FB_APP_SECRET"
const IG_SECRET = "SHARED_IG_APP_SECRET"

function row(partial: Partial<Row> & Pick<Row, "id" | "organizationId" | "createdAt">): Row {
  return {
    channelType: "instagram",
    configName: "Instagram",
    pageId: IG_ID,
    isActive: true,
    settings: {},
    updatedAt: partial.createdAt,
    apiKey: "page-token",
    appSecret: null,
    verifyToken: null,
    ...partial,
  }
}

// The three claimants of IG_ID on 2026-09-11, as stored on prod.
const leaddrive = row({
  id: "cfg_leaddrive_ig",
  organizationId: "org_leaddrive",
  createdAt: new Date("2026-06-07T08:24:13Z"),
  appSecret: "env-polluted-secret", // an old page row: appSecret but no verifyToken — NOT an own Meta app
})
const brandprotection = row({
  id: "cfg_brandprotection_ig",
  organizationId: "org_brandprotection",
  createdAt: new Date("2026-07-10T14:09:09Z"),
  settings: { igLogin: true },
})
// Brand Protection's own Facebook-Login Meta app (Model B) — no pageId, carries the app pair.
const brandprotectionFbApp = row({
  id: "cfg_brandprotection_fb_app",
  organizationId: "org_brandprotection",
  channelType: "facebook",
  pageId: null,
  apiKey: null,
  appSecret: "bp-app-secret",
  verifyToken: "bp-verify",
  createdAt: new Date("2026-07-01T00:00:00Z"),
})
const fanumsec = row({
  id: "cfg_fanumsec_ig",
  organizationId: "org_fanumsec",
  createdAt: new Date("2026-09-11T11:56:36Z"),
})

function sign(body: string, secret: string) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex")
}

function webhookRequest(url: string, body: string, secret: string): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
    text: async () => body,
    headers: { get: (k: string) => (k === "x-hub-signature-256" ? sign(body, secret) : null) },
  } as unknown as NextRequest
}

function dmPayload(object: "instagram" | "page", pageId: string): string {
  return JSON.stringify({
    object,
    entry: [{ id: pageId, messaging: [{ sender: { id: "user-9" }, recipient: { id: pageId }, message: { mid: "mid-1", text: "Salam" } }] }],
  })
}

/** The org the real webhook writes a DM for `pageId` into, or null when it drops it. */
async function deliveredTo(endpoint: "facebook" | "instagram", pageId: string, object: "instagram" | "page" = "instagram") {
  vi.mocked(prisma.channelMessage.create).mockClear()
  const body = dmPayload(object, pageId)
  const res = endpoint === "facebook"
    ? await fbWebhook(webhookRequest("https://app.leaddrivecrm.org/api/v1/webhooks/facebook", body, FB_SECRET))
    : await igWebhook(webhookRequest("https://app.leaddrivecrm.org/api/v1/webhooks/instagram", body, IG_SECRET))
  expect(res.status).toBe(200)
  const calls = vi.mocked(prisma.channelMessage.create).mock.calls
  return calls.length ? (calls[0][0] as { data: { organizationId: string } }).data.organizationId : null
}

/** What the settings screen computes for one org: the ids of its rows flagged as claimed elsewhere. */
async function flaggedFor(orgId: string): Promise<string[]> {
  const own = rows.filter((r) => r.organizationId === orgId)
  return [...(await channelIdsClaimedElsewhere(orgId, own))].sort()
}

function bothOrders(fixture: Row[]): Row[][] {
  return [fixture, [...fixture].reverse()]
}

let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  findManyCalls.length = 0
  bypassDepth = 0
  process.env.FACEBOOK_APP_SECRET = FB_SECRET
  process.env.INSTAGRAM_APP_SECRET = IG_SECRET
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  warnSpy.mockRestore()
  errorSpy.mockRestore()
  delete process.env.FACEBOOK_APP_SECRET
  delete process.env.INSTAGRAM_APP_SECRET
})

describe("claimed elsewhere — the 2026-09-11 @leaddrive.az table", () => {
  it("flags Fanumsec's row, whose DMs the Facebook webhook delivers to LeadDrive Inc.'s older claim", async () => {
    for (const fixture of bothOrders([leaddrive, brandprotection, brandprotectionFbApp, fanumsec])) {
      rows = fixture
      expect(await deliveredTo("facebook", IG_ID)).toBe("org_leaddrive")
      expect(await flaggedFor("org_fanumsec")).toEqual(["cfg_fanumsec_ig"])
    }
  })

  it("does not flag the winner — LeadDrive Inc. holds the oldest claim", async () => {
    for (const fixture of bothOrders([leaddrive, brandprotection, brandprotectionFbApp, fanumsec])) {
      rows = fixture
      expect(await flaggedFor("org_leaddrive")).toEqual([])
    }
  })

  it("judges an Instagram-Login row by the IG-Login webhook, which prefers it — Brand Protection is not flagged", async () => {
    for (const fixture of bothOrders([leaddrive, brandprotection, brandprotectionFbApp, fanumsec])) {
      rows = fixture
      expect(await deliveredTo("instagram", IG_ID)).toBe("org_brandprotection")
      expect(await flaggedFor("org_brandprotection")).toEqual([])
    }
  })

  it("stops flagging once the other claims are switched off (the owner's fix that day)", async () => {
    rows = [{ ...leaddrive, isActive: false }, { ...brandprotection, isActive: false }, brandprotectionFbApp, fanumsec]
    expect(await deliveredTo("facebook", IG_ID)).toBe("org_fanumsec")
    expect(await flaggedFor("org_fanumsec")).toEqual([])
  })
})

describe("claimed elsewhere — ranking cases", () => {
  it("an inactive claim in another org, however old, is not a rival", async () => {
    const old = row({ id: "cfg_old", organizationId: "org_old", createdAt: new Date("2025-01-01T00:00:00Z"), isActive: false })
    const mine = row({ id: "cfg_mine", organizationId: "org_mine", createdAt: new Date("2026-09-01T00:00:00Z") })
    rows = [old, mine]
    expect(await flaggedFor("org_mine")).toEqual([])
  })

  it("a later claimant (a pasted public id) is flagged; the incumbent is not", async () => {
    const incumbent = row({ id: "cfg_incumbent", organizationId: "org_incumbent", createdAt: new Date("2026-01-10T00:00:00Z") })
    const latecomer = row({ id: "cfg_latecomer", organizationId: "org_latecomer", createdAt: new Date("2026-08-20T00:00:00Z") })
    for (const fixture of bothOrders([incumbent, latecomer])) {
      rows = fixture
      expect(await deliveredTo("facebook", IG_ID)).toBe("org_incumbent")
      expect(await flaggedFor("org_latecomer")).toEqual(["cfg_latecomer"])
      expect(await flaggedFor("org_incumbent")).toEqual([])
    }
  })

  it("is not flagged when this org's OWN older row wins — a same-org duplicate still delivers here", async () => {
    const mineOld = row({ id: "cfg_mine_old", organizationId: "org_mine", createdAt: new Date("2026-01-01T00:00:00Z") })
    const other = row({ id: "cfg_other", organizationId: "org_other", createdAt: new Date("2026-03-01T00:00:00Z") })
    const mineNew = row({ id: "cfg_mine_new", organizationId: "org_mine", createdAt: new Date("2026-06-01T00:00:00Z") })
    for (const fixture of bothOrders([mineOld, other, mineNew])) {
      rows = fixture
      expect(await deliveredTo("facebook", IG_ID)).toBe("org_mine")
      expect(await flaggedFor("org_mine")).toEqual([])
      expect(await flaggedFor("org_other")).toEqual(["cfg_other"])
    }
  })

  it("between two Instagram-Login claims the older wins on the IG-Login webhook, and the newer is flagged", async () => {
    const first = row({ id: "cfg_ig_first", organizationId: "org_first", settings: { igLogin: true }, createdAt: new Date("2026-02-01T00:00:00Z") })
    const second = row({ id: "cfg_ig_second", organizationId: "org_second", settings: { igLogin: true }, createdAt: new Date("2026-05-01T00:00:00Z") })
    for (const fixture of bothOrders([first, second])) {
      rows = fixture
      expect(await deliveredTo("instagram", IG_ID)).toBe("org_first")
      expect(await flaggedFor("org_second")).toEqual(["cfg_ig_second"])
      expect(await flaggedFor("org_first")).toEqual([])
    }
  })

  it("covers Facebook Pages too — the Messenger rows Fanumsec also holds against older LeadDrive claims", async () => {
    const PAGE = "1078733058880813"
    const older = row({ id: "cfg_ld_page", organizationId: "org_leaddrive", channelType: "facebook", pageId: PAGE, createdAt: new Date("2026-06-07T08:24:12Z") })
    const newer = row({ id: "cfg_fs_page", organizationId: "org_fanumsec", channelType: "facebook", pageId: PAGE, createdAt: new Date("2026-09-11T11:56:35Z") })
    for (const fixture of bothOrders([older, newer])) {
      rows = fixture
      expect(await deliveredTo("facebook", PAGE, "page")).toBe("org_leaddrive")
      expect(await flaggedFor("org_fanumsec")).toEqual(["cfg_fs_page"])
    }
  })

  it("an org running its own Meta app is not flagged — its ?t= deliveries are scoped to it alone", async () => {
    const incumbent = row({ id: "cfg_incumbent", organizationId: "org_incumbent", createdAt: new Date("2026-01-10T00:00:00Z") })
    const ownApp = row({
      id: "cfg_own_app", organizationId: "org_modelb", channelType: "facebook", pageId: null,
      appSecret: "own-secret", verifyToken: "own-verify", createdAt: new Date("2026-08-01T00:00:00Z"),
    })
    const page = row({ id: "cfg_modelb_ig", organizationId: "org_modelb", createdAt: new Date("2026-08-20T00:00:00Z") })
    rows = [incumbent, ownApp, page]
    expect(await flaggedFor("org_modelb")).toEqual([])
  })

  it("fails soft to 'not flagged' when the lookup errors", async () => {
    rows = [leaddrive, fanumsec]
    vi.mocked(prisma.channelConfig.findMany).mockRejectedValueOnce(new Error("db down"))
    expect(await flaggedFor("org_fanumsec")).toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe("claimed elsewhere — tenant boundary", () => {
  it("reads other orgs' claims only under RLS bypass; every tenant-scoped read is filtered to the caller", async () => {
    rows = [leaddrive, brandprotection, brandprotectionFbApp, fanumsec]
    await flaggedFor("org_fanumsec")
    expect(findManyCalls.some((c) => c.bypass)).toBe(true)
    for (const call of findManyCalls.filter((c) => !c.bypass)) {
      expect(call.where.organizationId).toBe("org_fanumsec")
    }
  })

  it("GET /api/v1/channels ships the boolean and nothing of the organization that won", async () => {
    rows = [leaddrive, brandprotection, brandprotectionFbApp, fanumsec]
    mocks.gateOrg.orgId = "org_fanumsec"
    const res = await listChannels(new NextRequest("http://localhost:3000/api/v1/channels"))
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0]).toMatchObject({ id: "cfg_fanumsec_ig", claimedElsewhere: true })
    const text = JSON.stringify(json)
    for (const leak of ["org_leaddrive", "cfg_leaddrive_ig", "org_brandprotection", "cfg_brandprotection", "2026-06-07", "2026-07-10"]) {
      expect(text).not.toContain(leak)
    }
  })

  it("GET /api/v1/channels says false for the winning organization", async () => {
    rows = [leaddrive, brandprotection, brandprotectionFbApp, fanumsec]
    mocks.gateOrg.orgId = "org_leaddrive"
    const res = await listChannels(new NextRequest("http://localhost:3000/api/v1/channels"))
    const json = await res.json()
    expect(json.data.map((c: { id: string; claimedElsewhere: boolean }) => [c.id, c.claimedElsewhere])).toEqual([
      ["cfg_leaddrive_ig", false],
    ])
  })
})
