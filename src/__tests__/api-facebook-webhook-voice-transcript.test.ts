import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { createHmac } from "crypto"

/**
 * A voice note to a Facebook page or an Instagram account arrives as words (owner, 2026-11-10).
 * Before, Messenger voice notes were never transcribed, and Instagram ones only on an AI-answered
 * channel — a person answering there had to play every one. Now: an AI-answered page transcribes
 * and answers (Messenger too), and any other page still writes the words under the voice note.
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
const audio = vi.hoisted(() => ({
  storeOnly: vi.fn(async () => "Salam, qiymət nədir?"),
  facebookAi: vi.fn(async () => "transcribed"),
  instagramAi: vi.fn(async () => "transcribed"),
}))
vi.mock("@/lib/inbox/inbound-voice-transcript", () => ({ transcribeAndStoreInboundVoice: audio.storeOnly }))
vi.mock("@/lib/social/instagram-inbound-audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/social/instagram-inbound-audio")>()),
  handleFacebookInboundAudio: audio.facebookAi,
  handleInstagramInboundAudio: audio.instagramAi,
}))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn(async () => ({ replied: false })),
  chatbotTookOwnership: vi.fn(() => false),
}))

import { POST } from "@/app/api/v1/webhooks/facebook/route"

const SECRET = "SHARED_APP_SECRET"
const BASE = "https://app.leaddrivecrm.org/api/v1/webhooks/facebook"
const VOICE_URL = "https://cdn.fbsbx.com/v/t59/voice-note.mp4"

const page = (channelType: "facebook" | "instagram", replyMode?: string): Row => ({
  id: `cfg_${channelType}`,
  organizationId: "org_1",
  channelType,
  pageId: "page_1",
  isActive: true,
  settings: replyMode ? { replyMode } : {},
  createdAt: new Date("2026-05-01T00:00:00Z"),
  apiKey: "page-token",
})

function voiceNote(object: "page" | "instagram"): string {
  return JSON.stringify({
    object,
    entry: [{
      id: "page_1",
      messaging: [{
        sender: { id: "user-9" }, recipient: { id: "page_1" },
        message: { mid: "mid-voice", attachments: [{ type: "audio", payload: { url: VOICE_URL } }] },
      }],
    }],
  })
}

async function deliver(body: string) {
  const req = {
    url: BASE,
    nextUrl: new URL(BASE),
    text: async () => body,
    headers: {
      get: (k: string) =>
        k === "x-hub-signature-256" ? "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex") : null,
    },
  } as unknown as NextRequest
  return POST(req)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FACEBOOK_APP_SECRET = SECRET
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.FACEBOOK_APP_SECRET
})

describe("a voice note to a Facebook page", () => {
  it("answered by a person: the words are written under it", async () => {
    rows = [page("facebook")]
    expect((await deliver(voiceNote("page"))).status).toBe(200)
    expect(audio.storeOnly).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_1", audioUrl: VOICE_URL, source: "Facebook" }))
    expect(audio.facebookAi).not.toHaveBeenCalled()
  })

  it("answered by AI: understood and answered, like on Instagram", async () => {
    rows = [page("facebook", "ai")]
    await deliver(voiceNote("page"))
    expect(audio.facebookAi).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_1", audioUrl: VOICE_URL }))
    expect(audio.storeOnly).not.toHaveBeenCalled()
  })
})

describe("a voice note to an Instagram account", () => {
  it("answered by a person: the words are written under it too", async () => {
    rows = [page("instagram")]
    await deliver(voiceNote("instagram"))
    expect(audio.storeOnly).toHaveBeenCalledWith(expect.objectContaining({ audioUrl: VOICE_URL, source: "Instagram" }))
    expect(audio.instagramAi).not.toHaveBeenCalled()
  })

  it("answered by AI: as before", async () => {
    rows = [page("instagram", "ai")]
    await deliver(voiceNote("instagram"))
    expect(audio.instagramAi).toHaveBeenCalledTimes(1)
  })
})
