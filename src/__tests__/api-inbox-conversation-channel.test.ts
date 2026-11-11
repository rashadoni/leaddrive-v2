/**
 * Which of our accounts a conversation reached, and which address the customer writes from.
 *
 * On 2026-11-10 LeadDrive Inc. had three WhatsApp channels connected at once — one of them a
 * coexistence number whose inbound the webhook deliberately holds — and an inbox thread said
 * «WhatsApp» and nothing more (owner: «в омни канале не показывает на какой ватсап номер пишут и с
 * какого пишут, также и другие платформы»). Several Meta pages raise the same question.
 *
 * Behaviour, not shape: every case here drives the real GET handler and reads what a conversation
 * carries to the screen. The channel table answers by the handler's own `select`, so a column the
 * route forgets to fetch comes back missing here instead of being quietly supplied by the stub —
 * that is how «deaktiv» once stood under every working employee (#577).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelMessage: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    contact: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    socialConversation: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    conversationParticipant: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findFirst: vi.fn() },
    conversationNote: { findMany: vi.fn(), create: vi.fn() },
    inboxFolder: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    channelConfig: { findFirst: vi.fn(), findMany: vi.fn() },
    webChatSession: { findMany: vi.fn().mockResolvedValue([]) },
    callLog: { findMany: vi.fn().mockResolvedValue([]) },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/constants", () => ({ PAGE_SIZE: { DEFAULT: 50, INBOX: 100 } }))

import { GET as GET_INBOX } from "@/app/api/v1/inbox/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { channelAccountLine, sameChannelAddress } from "@/lib/inbox/conversation-channel"

const ORG_ID = "org-1"

/** Only what these cases read back off a conversation. */
type InboxThread = {
  contactName: string
  channels: string[]
  channelAccount?: {
    channelType: string | null
    name: string | null
    number: string | null
    numberIsMetaId: boolean
  } | null
  channelAddress: string | null
}

/** The workspace of 2026-11-10: three WhatsApp numbers, two Meta pages, one SMS sender. */
const CHANNELS: Array<{
  id: string; organizationId: string; channelType: string; configName: string; displayName: null
  phoneNumber: string | null; settings: Record<string, unknown>; isActive?: boolean
  accessToken: string; appSecret: string; verifyToken: string
}> = [
  {
    id: "wa-coexistence",
    organizationId: ORG_ID,
    channelType: "whatsapp",
    configName: "Lead Drive",
    displayName: null,
    phoneNumber: "984538588084578",
    settings: { displayPhoneNumber: "+994 77 320 10 00" },
    accessToken: "EAA-secret-coexistence",
    appSecret: "app-secret",
    verifyToken: "verify-secret",
  },
  {
    id: "wa-fanum",
    organizationId: ORG_ID,
    channelType: "whatsapp",
    configName: "Fanum Sec",
    displayName: null,
    phoneNumber: "771122334455667",
    settings: { displayPhoneNumber: "+994 10 531 80 49" },
    accessToken: "EAA-secret-fanum",
    appSecret: "app-secret",
    verifyToken: "verify-secret",
  },
  {
    id: "wa-legacy",
    organizationId: ORG_ID,
    channelType: "whatsapp",
    configName: "LeadDrive WhatsApp",
    displayName: null,
    // Connected by hand, before Embedded Signup wrote the number Meta displays.
    phoneNumber: "123456789012345",
    settings: {},
    accessToken: "EAA-secret-legacy",
    appSecret: "app-secret",
    verifyToken: "verify-secret",
  },
  {
    id: "wa-switched-off",
    organizationId: ORG_ID,
    channelType: "whatsapp",
    configName: "Lead Drive (old)",
    displayName: null,
    phoneNumber: "1334335789757477",
    settings: { displayPhoneNumber: "+994 51 206 08 38" },
    isActive: false,
    accessToken: "EAA-secret-old",
    appSecret: "app-secret",
    verifyToken: "verify-secret",
  },
  {
    id: "fb-shop",
    organizationId: ORG_ID,
    channelType: "facebook",
    configName: "LeadDrive Shop",
    displayName: null,
    phoneNumber: null,
    settings: {},
    accessToken: "page-token",
    appSecret: "app-secret",
    verifyToken: "verify-secret",
  },
]

function makeRequest(url = "http://localhost:3000/api/v1/inbox") {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(null as never)
  const resolveTestOperator = async (req: NextRequest) => {
    const session = await getSession(req)
    if (session) return session
    const orgId = await getOrgId(req)
    return orgId
      ? { orgId, userId: "support-1", role: "support", email: "support@example.test", name: "Support" }
      : NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  vi.mocked(requireAuth).mockImplementation(resolveTestOperator as never)
  vi.mocked(requireSessionAuth).mockImplementation(resolveTestOperator as never)
  vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
  vi.mocked(prisma.contact.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.socialConversation.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.webChatSession.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.callLog.findMany).mockResolvedValue([] as never)

  // Prisma hands back only the columns the handler selects, and only this org's rows.
  vi.mocked(prisma.channelConfig.findMany).mockImplementation((async (args: {
    where: { id?: { in: string[] }; organizationId: string; isActive?: boolean; channelType?: { in: string[] } }
    select?: Record<string, boolean>
  }) => CHANNELS
    .filter((row) => row.organizationId === args.where.organizationId)
    .filter((row) => !args.where.id || args.where.id.in.includes(row.id))
    .filter((row) => args.where.isActive === undefined || (row.isActive ?? true) === args.where.isActive)
    .filter((row) => !args.where.channelType || args.where.channelType.in.includes(row.channelType))
    .map((row) => (args.select
      ? Object.fromEntries(Object.entries(row).filter(([column]) => args.select?.[column]))
      : row))) as never)
})

const message = (over: Record<string, unknown>) => ({
  id: "m1",
  organizationId: ORG_ID,
  channelConfigId: null,
  direction: "inbound",
  channelType: "whatsapp",
  contactId: null,
  from: "Fərid",
  to: "system",
  body: "Salam",
  status: "delivered",
  conversationId: null,
  metadata: {},
  createdAt: new Date("2026-11-10T08:00:00Z"),
  ...over,
})

async function conversations(rows: Record<string, unknown>[]) {
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue(rows as never)
  const res = await GET_INBOX(makeRequest())
  expect(res.status).toBe(200)
  return (await res.json()).data.conversations as InboxThread[]
}

describe("GET /api/v1/inbox — which account the thread reached", () => {
  it("names the channel the messages actually arrived on, not the first one connected", async () => {
    const [thread] = await conversations([
      message({ id: "m-fanum", channelConfigId: "wa-fanum", metadata: { waPhone: "994501234567" } }),
    ])

    expect(thread.channelAccount).toEqual({
      id: "wa-fanum",
      channelType: "whatsapp",
      name: "Fanum Sec",
      number: "+994 10 531 80 49",
      numberIsMetaId: false,
    })
    // The workspace's first WhatsApp row must not stand in for it.
    expect(JSON.stringify(thread)).not.toContain("Lead Drive")
  })

  it("follows the thread's most recent message when one contact wrote to two of our numbers", async () => {
    const [thread] = await conversations([
      message({
        id: "m-new", contactId: "c-1", channelConfigId: "wa-coexistence",
        createdAt: new Date("2026-11-10T12:00:00Z"),
      }),
      message({
        id: "m-old", contactId: "c-1", channelConfigId: "wa-fanum",
        createdAt: new Date("2026-11-01T12:00:00Z"),
      }),
    ])

    expect(thread.channelAccount).toMatchObject({ name: "Lead Drive", number: "+994 77 320 10 00" })
  })

  it("says that Meta's id is an id, instead of passing it off as a number", async () => {
    const [thread] = await conversations([message({ channelConfigId: "wa-legacy" })])

    expect(thread.channelAccount).toMatchObject({
      name: "LeadDrive WhatsApp",
      number: "123456789012345",
      numberIsMetaId: true,
    })
  })

  it("names the Facebook page a thread arrived on, where there is no number at all", async () => {
    const [thread] = await conversations([
      message({ channelType: "facebook", channelConfigId: "fb-shop", from: "7351022398851234", to: "page-77" }),
    ])

    expect(thread.channelAccount).toMatchObject({ channelType: "facebook", name: "LeadDrive Shop", number: null })
  })

  it("shows the number an SMS arrived on, which no channel row carries", async () => {
    const [thread] = await conversations([
      message({ channelType: "sms", channelConfigId: null, from: "+994701112233", to: "+994553334455" }),
    ])

    expect(thread.channelAccount).toMatchObject({ number: "+994553334455", numberIsMetaId: false })
  })

  it("leaves a thread with no channel of its own alone, and does not fall over", async () => {
    const [thread] = await conversations([
      message({ id: "m-orphan", channelType: "email", channelConfigId: null, from: "client@test.com", to: "crm" }),
    ])

    expect(thread.channelAccount).toBeNull()
    expect(thread.channels).toEqual(["email"])
  })

  it("keeps the inbox standing when the channel table cannot be read", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockRejectedValue(new Error("DB down") as never)
    const [thread] = await conversations([message({ channelConfigId: "wa-fanum" })])

    expect(thread.contactName).toBeTruthy()
    expect(thread.channelAccount).toBeUndefined()
  })

  it("never carries a channel's credentials into the conversation listing", async () => {
    const [thread] = await conversations([message({ channelConfigId: "wa-coexistence" })])

    const payload = JSON.stringify(thread)
    expect(payload).not.toContain("EAA-secret-coexistence")
    expect(payload).not.toContain("app-secret")
    expect(payload).not.toContain("verify-secret")
  })
})

describe("GET /api/v1/inbox — which address the customer writes from", () => {
  it("reads the WhatsApp number out of metadata, where the webhook keeps it", async () => {
    const [thread] = await conversations([
      message({ channelConfigId: "wa-fanum", from: "Fərid", metadata: { waPhone: "994501234567" } }),
    ])

    expect(thread.channelAddress).toBe("994501234567")
  })

  it("shows the Telegram handle, not the sender's display name", async () => {
    const [thread] = await conversations([
      message({ channelType: "telegram", from: "Fərid", to: "bot", metadata: { chatId: "55", username: "farid_v" } }),
    ])

    expect(thread.channelAddress).toBe("@farid_v")
  })

  it("shows the sending number of an SMS and the sending address of an e-mail", async () => {
    const [sms] = await conversations([
      message({ channelType: "sms", from: "+994701112233", to: "+994553334455" }),
    ])
    expect(sms.channelAddress).toBe("+994701112233")

    const [mail] = await conversations([
      message({ channelType: "email", from: "client@test.com", to: "crm@leaddrive.az" }),
    ])
    expect(mail.channelAddress).toBe("client@test.com")
  })

  it("offers no address where the platform records only an opaque sender id", async () => {
    const [thread] = await conversations([
      message({ channelType: "instagram", channelConfigId: null, from: "17841400000000000", to: "ig-account" }),
    ])

    // Sixteen digits that read like a phone number and are not one: better said than printed.
    expect(thread.channelAddress).toBeNull()
  })
})

describe("what the card prints", () => {
  it("writes the account the way «Ayarlar → Kanallar» writes it", () => {
    expect(channelAccountLine(
      { channelType: "whatsapp", name: "Lead Drive", number: "+994 77 320 10 00", numberIsMetaId: false },
      "ID в Meta",
    )).toBe("Lead Drive · +994 77 320 10 00")
  })

  it("puts the «Meta ID» word in front of an id, the same word that screen uses", () => {
    expect(channelAccountLine(
      { channelType: "whatsapp", name: "LeadDrive WhatsApp", number: "984538588084578", numberIsMetaId: true },
      "ID в Meta",
    )).toBe("LeadDrive WhatsApp · ID в Meta 984538588084578")
  })

  it("prints a page that has no number as just its name, and an unknown account as nothing", () => {
    expect(channelAccountLine({ channelType: "facebook", name: "LeadDrive Shop", number: null, numberIsMetaId: false }, "Meta ID"))
      .toBe("LeadDrive Shop")
    expect(channelAccountLine(null, "Meta ID")).toBeNull()
  })

  it("treats the local and international spelling of one number as the same address", () => {
    // The card hides «writes from» when it would only repeat the phone in the details above.
    expect(sameChannelAddress("994773201000", "+994 77 320 10 00")).toBe(true)
    expect(sameChannelAddress("0773201000", "+994773201000")).toBe(true)
    expect(sameChannelAddress("994501234567", "994773201000")).toBe(false)
    expect(sameChannelAddress("client@test.com", "CLIENT@test.com")).toBe(true)
    expect(sameChannelAddress("client@test.com", null)).toBe(false)
  })
})

describe("GET /api/v1/inbox — the workspace's numbers and pages for the rail", () => {
  async function railChannels() {
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([] as never)
    const res = await GET_INBOX(makeRequest())
    expect(res.status).toBe(200)
    return (await res.json()).data.channels as Array<Record<string, unknown>>
  }

  it("lists every live number and page, each with the id the rail filters by", async () => {
    const channels = await railChannels()
    expect(channels.map((c) => [c.id, c.channelType, c.name, c.number])).toEqual([
      ["wa-coexistence", "whatsapp", "Lead Drive", "+994 77 320 10 00"],
      ["wa-fanum", "whatsapp", "Fanum Sec", "+994 10 531 80 49"],
      ["wa-legacy", "whatsapp", "LeadDrive WhatsApp", "123456789012345"],
      ["fb-shop", "facebook", "LeadDrive Shop", null],
    ])
  })

  it("leaves out a switched-off number", async () => {
    expect((await railChannels()).map((c) => c.id)).not.toContain("wa-switched-off")
  })

  it("carries no credentials", async () => {
    const text = JSON.stringify(await railChannels())
    expect(text).not.toMatch(/EAA-secret|app-secret|verify-secret|page-token/)
  })
})

describe("GET /api/v1/inbox — numbers and pages hidden from this person (lib/inbox/channel-access)", () => {
  async function asSupportHiding(hidden: string[]) {
    // The session carries the list, as api-auth builds it from the user row.
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG_ID, userId: "support-1", role: "support", email: "s@x", name: "S", hiddenChannelConfigIds: hidden } as never)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      message({ id: "m-fanum", contactId: "c-fanum", channelConfigId: "wa-fanum", body: "Fanum" }),
      message({ id: "m-coex", contactId: "c-coex", channelConfigId: "wa-coexistence", body: "Coex" }),
      message({ id: "m-fb", contactId: "c-fb", channelType: "facebook", channelConfigId: "fb-shop", body: "Shop" }),
    ] as never)
    const res = await GET_INBOX(makeRequest())
    expect(res.status).toBe(200)
    return { data: (await res.json()).data, where: vi.mocked(prisma.channelMessage.findMany).mock.calls.at(-1)?.[0] as { where: Record<string, unknown> } }
  }

  it("does not read the hidden channels' messages at all", async () => {
    const { where } = await asSupportHiding(["wa-fanum", "fb-shop"])
    expect(where.where.AND).toEqual([{ OR: [{ channelConfigId: null }, { channelConfigId: { notIn: ["wa-fanum", "fb-shop"] } }] }])
  })

  it("and leaves no thread of theirs even if the database returned one", async () => {
    const { data } = await asSupportHiding(["wa-fanum", "fb-shop"])
    const ids = (data.conversations as InboxThread[]).map((c) => c.channelAccount?.number ?? c.channelAccount?.name)
    expect(ids).toEqual(["+994 77 320 10 00"])
  })

  it("lists only the visible numbers and pages for the rail", async () => {
    const { data } = await asSupportHiding(["wa-fanum", "fb-shop"])
    expect((data.channels as Array<{ id: string }>).map((c) => c.id)).toEqual(["wa-coexistence", "wa-legacy"])
  })

  it("changes nothing for a person with nothing hidden", async () => {
    const { data, where } = await asSupportHiding([])
    expect(where.where.AND).toBeUndefined()
    expect((data.conversations as unknown[]).length).toBe(3)
  })
})
