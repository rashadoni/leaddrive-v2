import { describe, it, expect, vi, beforeEach } from "vitest"
import { runInboxFollowups, isDaytimeAZ, DEFAULT_FOLLOWUP, FOLLOWUP_FLAG } from "@/lib/inbox/followup-cron"

/**
 * 24h-silence auto-follow-up core. Mocks a minimal Prisma surface; the mock returns the
 * candidate list directly so these tests exercise the per-conversation logic (last-direction
 * gate, ATOMIC claim, mirror record, text override), not Prisma's WHERE evaluation — though
 * we DO assert the WHERE shape so the 24h/status/platform/followUpSentAt filter can't drift.
 */

// A fixed "now" inside the 09:00–21:00 AZT window: 10:00 UTC = 14:00 Azerbaijan.
const DAYTIME = new Date("2026-06-20T10:00:00Z")
// Outside the window: 20:00 UTC = 00:00 AZT.
const NIGHT = new Date("2026-06-20T20:00:00Z")

type ConvRow = { id: string; externalId: string; channelConfigId: string | null }
/** A stored ChannelConfig row, with the columns the override lookup filters on. */
type ConfigRow = { id: string; organizationId: string; channelType: string; isActive: boolean; settings: unknown }

const state: {
  orgs: { id: string; features: unknown }[]
  channelConfigs: ConfigRow[]
  configWheres: any[]
  conversations: ConvRow[]
  lastDirection: Record<string, "inbound" | "outbound" | undefined>
  claimCount: number // what the atomic claim updateMany returns (1 = won, 0 = lost to a concurrent run)
  claims: any[]
  created: any[]
  updated: any[]
  findManyWhere: any
} = {
  orgs: [],
  channelConfigs: [],
  configWheres: [],
  conversations: [],
  lastDirection: {},
  claimCount: 1,
  claims: [],
  created: [],
  updated: [],
  findManyWhere: null,
}

const db: any = {
  organization: { findMany: vi.fn(async () => state.orgs) },
  channelConfig: {
    // A real lookup: rows are filtered by the where clause the cron actually built.
    // The single shared settings object this replaces answered every lookup with the
    // same override, so it could not tell a per-conversation resolve from the per-org
    // "first active config wins" fallback — which is the whole bug. Same reason the
    // sender's suite grew a filtering mock (lib-chatwoot-send CWL-9).
    findMany: vi.fn(async ({ where }: any) => {
      state.configWheres.push(where)
      return state.channelConfigs.filter((row) => (
        (where.id?.in === undefined || where.id.in.includes(row.id))
        && (where.organizationId === undefined || row.organizationId === where.organizationId)
        && (where.channelType === undefined || row.channelType === where.channelType)
        && (where.isActive === undefined || row.isActive === where.isActive)
      ))
    }),
  },
  socialConversation: {
    findMany: vi.fn(async ({ where }: any) => {
      state.findManyWhere = where
      return state.conversations
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      state.claims.push({ where, data })
      return { count: state.claimCount }
    }),
    update: vi.fn(async ({ where, data }: any) => {
      state.updated.push({ where, data })
      return {}
    }),
  },
  channelMessage: {
    findFirst: vi.fn(async ({ where }: any) => ({ direction: state.lastDirection[where.conversationId] ?? "outbound" })),
    create: vi.fn(async ({ data }: any) => {
      state.created.push(data)
      return {}
    }),
  },
}

const conv = (over: Partial<ConvRow> = {}): ConvRow => ({
  id: "conv_1",
  externalId: "cw_700",
  channelConfigId: "cfg_cw",
  ...over,
})

const cfg = (over: Partial<ConfigRow> = {}): ConfigRow => ({
  id: "cfg_cw",
  organizationId: "org_1",
  channelType: "chatwoot",
  isActive: true,
  settings: {},
  ...over,
})

beforeEach(() => {
  state.orgs = [{ id: "org_1", features: [FOLLOWUP_FLAG] }]
  state.channelConfigs = []
  state.configWheres = []
  state.conversations = []
  state.lastDirection = {}
  state.claimCount = 1
  state.claims = []
  state.created = []
  state.updated = []
  state.findManyWhere = null
  vi.clearAllMocks()
})

describe("isDaytimeAZ", () => {
  it("true inside 09:00–21:00 AZT", () => {
    expect(isDaytimeAZ(new Date("2026-06-20T05:00:00Z"))).toBe(true) // 09:00 AZT (start, inclusive)
    expect(isDaytimeAZ(new Date("2026-06-20T10:00:00Z"))).toBe(true) // 14:00 AZT
    expect(isDaytimeAZ(new Date("2026-06-20T16:00:00Z"))).toBe(true) // 20:00 AZT
  })
  it("false outside the window", () => {
    expect(isDaytimeAZ(new Date("2026-06-20T17:00:00Z"))).toBe(false) // 21:00 AZT (end, exclusive)
    expect(isDaytimeAZ(new Date("2026-06-20T20:00:00Z"))).toBe(false) // 00:00 AZT
    expect(isDaytimeAZ(new Date("2026-06-20T02:00:00Z"))).toBe(false) // 06:00 AZT
  })
})

describe("runInboxFollowups", () => {
  it("skips entirely outside the daytime window (no DB hit)", async () => {
    const send = vi.fn(async () => true)
    const res = await runInboxFollowups(db, { now: NIGHT, send })
    expect(res.skipped).toBe("outside-daytime-window")
    expect(send).not.toHaveBeenCalled()
    expect(db.organization.findMany).not.toHaveBeenCalled()
  })

  it("does nothing for an org without the inboxFollowUp flag", async () => {
    state.orgs = [{ id: "org_1", features: ["aiAutoReply"] }] // flag absent
    const send = vi.fn(async () => true)
    const res = await runInboxFollowups(db, { now: DAYTIME, send })
    expect(res.sent).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it("happy path: last outbound → atomically claims, sends ONE nudge, mirrors it, no lastMessageAt bump", async () => {
    state.conversations = [conv()]
    state.lastDirection = { conv_1: "outbound" }
    const send = vi.fn(async () => true)

    const res = await runInboxFollowups(db, { now: DAYTIME, send })

    expect(res.sent).toBe(1)
    // atomic claim BEFORE send, conditional on followUpSentAt: null
    expect(state.claims).toHaveLength(1)
    expect(state.claims[0].where).toEqual({ id: "conv_1", followUpSentAt: null })
    expect(state.claims[0].data).toEqual({ followUpSentAt: DAYTIME })
    expect(send).toHaveBeenCalledWith({
      conversationId: "cw_700",
      content: DEFAULT_FOLLOWUP,
      organizationId: "org_1",
      channelConfigId: "cfg_cw",
    })
    // mirrored into the inbox, marked followUp
    expect(state.created).toHaveLength(1)
    expect(state.created[0]).toMatchObject({ channelType: "tiktok", direction: "outbound", conversationId: "conv_1", metadata: { followUp: true } })
    // NO lastMessageAt bump / no extra update on success
    expect(state.updated).toHaveLength(0)
    // WHERE shape didn't drift
    expect(state.findManyWhere).toMatchObject({ platform: "tiktok", status: "open", followUpSentAt: null })
    expect(state.findManyWhere.lastMessageAt.lte).toBeInstanceOf(Date)
  })

  it("CONCURRENCY: a parallel run already claimed the row (count 0) → no send, no double-nudge", async () => {
    state.conversations = [conv()]
    state.lastDirection = { conv_1: "outbound" }
    state.claimCount = 0 // the atomic claim lost the race
    const send = vi.fn(async () => true)

    const res = await runInboxFollowups(db, { now: DAYTIME, send })

    expect(res.sent).toBe(0)
    expect(state.claims).toHaveLength(1) // it tried to claim
    expect(send).not.toHaveBeenCalled() // ...but lost, so never sent
    expect(state.created).toHaveLength(0)
  })

  it("does NOT nudge (or even claim) when the customer wrote last", async () => {
    state.conversations = [conv()]
    state.lastDirection = { conv_1: "inbound" }
    const send = vi.fn(async () => true)
    const res = await runInboxFollowups(db, { now: DAYTIME, send })
    expect(res.sent).toBe(0)
    expect(state.claims).toHaveLength(0) // never claimed an unanswered thread
    expect(send).not.toHaveBeenCalled()
  })

  it("send failure → releases the claim (followUpSentAt back to null) so a later run retries", async () => {
    state.conversations = [conv()]
    state.lastDirection = { conv_1: "outbound" }
    const send = vi.fn(async () => false)
    const res = await runInboxFollowups(db, { now: DAYTIME, send })
    expect(res.sent).toBe(0)
    expect(state.claims).toHaveLength(1) // claimed
    expect(state.updated).toHaveLength(1) // ...then released
    expect(state.updated[0].data).toEqual({ followUpSentAt: null })
    expect(state.created).toHaveLength(0) // nothing mirrored
  })

  it("delivery-unknown → keeps the claim and records an operator-visible terminal attempt", async () => {
    state.conversations = [conv()]
    state.lastDirection = { conv_1: "outbound" }
    const send = vi.fn(async () => "unknown" as const)

    const res = await runInboxFollowups(db, { now: DAYTIME, send })

    expect(res.sent).toBe(0)
    expect(state.updated).toHaveLength(0)
    expect(state.created).toHaveLength(1)
    expect(state.created[0]).toMatchObject({
      status: "failed",
      metadata: { followUp: true, deliveryUnknown: true },
    })
  })

  it("nudges each conversation on its OWN Chatwoot config, not the org's first active one", async () => {
    // The route hands `send` straight to sendChatwootMessage, which resolves
    // "any active chatwoot config for this org" when it is given no id. An org
    // running two Chatwoot accounts would then nudge half its customers from
    // the wrong inbox, with the wrong token — see lib-chatwoot-send CWL-9.
    state.conversations = [
      conv({ id: "conv_a", externalId: "cw_700", channelConfigId: "cfg_a" }),
      conv({ id: "conv_b", externalId: "cw_800", channelConfigId: "cfg_b" }),
    ]
    state.lastDirection = { conv_a: "outbound", conv_b: "outbound" }
    const send = vi.fn(async () => true)

    await runInboxFollowups(db, { now: DAYTIME, send })

    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({ conversationId: "cw_700", channelConfigId: "cfg_a" }))
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({ conversationId: "cw_800", channelConfigId: "cfg_b" }))
  })

  describe("the nudge text follows the conversation's own Chatwoot config", () => {
    // Routing was only half the fix. The text was resolved by ONE `findFirst` per org
    // (no id, no orderBy) hoisted above the candidate loop, so every customer of an org
    // running two Chatwoot accounts was nudged with whichever account's wording the
    // database returned first. Now that the send is routed, that message is delivered
    // by the account it was not written for — the mismatch became visible, not smaller.
    // Named, because three tests assert on them and `settings` is `unknown` on the
    // row type — reaching back through ACCOUNT_A.settings.followUpMessage to restate
    // the expectation only re-derives it from the fixture, and does not typecheck.
    const A_TEXT = "Gobustone: qiymət hesablayaq?"
    const B_TEXT = "Kaspi Mebel: kataloqu göndərək?"
    const ACCOUNT_A = cfg({ id: "cfg_a", settings: { followUpMessage: A_TEXT } })
    const ACCOUNT_B = cfg({ id: "cfg_b", settings: { followUpMessage: B_TEXT } })

    const bothOpen = () => {
      state.conversations = [
        conv({ id: "conv_a", externalId: "cw_700", channelConfigId: "cfg_a" }),
        conv({ id: "conv_b", externalId: "cw_800", channelConfigId: "cfg_b" }),
      ]
      state.lastDirection = { conv_a: "outbound", conv_b: "outbound" }
    }

    it("uses the per-channel followUpMessage override when set", async () => {
      state.channelConfigs = [cfg({ settings: { followUpMessage: "Custom Gobustone nudge 🏗️" } })]
      state.conversations = [conv()]
      state.lastDirection = { conv_1: "outbound" }
      const send = vi.fn(async () => true)
      await runInboxFollowups(db, { now: DAYTIME, send })
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: "Custom Gobustone nudge 🏗️" }))
    })

    it("gives each conversation its OWN account's wording, not the first config's", async () => {
      state.channelConfigs = [ACCOUNT_A, ACCOUNT_B]
      bothOpen()
      const send = vi.fn(async () => true)

      await runInboxFollowups(db, { now: DAYTIME, send })

      expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({ channelConfigId: "cfg_a", content: A_TEXT }))
      expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({ channelConfigId: "cfg_b", content: B_TEXT }))
    })

    it("mirrors the same per-conversation text into the inbox it sent", async () => {
      // The ledger row is what an operator reads back. It has to say what the
      // customer actually received, not what the org's other account would have said.
      state.channelConfigs = [ACCOUNT_A, ACCOUNT_B]
      bothOpen()

      await runInboxFollowups(db, { now: DAYTIME, send: vi.fn(async () => true) })

      expect(state.created.map((r) => [r.channelConfigId, r.body])).toEqual([
        ["cfg_a", A_TEXT],
        ["cfg_b", B_TEXT],
      ])
    })

    it("falls back to the default when THIS config has no override but a sibling does", async () => {
      // The sharp case: an org that customised one account and left the other alone.
      // Hoisting the lookup put the customised account's wording on both.
      state.channelConfigs = [ACCOUNT_A, cfg({ id: "cfg_b", settings: {} })]
      bothOpen()
      const send = vi.fn(async () => true)

      await runInboxFollowups(db, { now: DAYTIME, send })

      expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({ content: A_TEXT }))
      expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({ content: DEFAULT_FOLLOWUP }))
    })

    it("falls back to the default for a conversation carrying no config id", async () => {
      state.channelConfigs = [ACCOUNT_A]
      state.conversations = [conv({ channelConfigId: null })]
      state.lastDirection = { conv_1: "outbound" }
      const send = vi.fn(async () => true)

      await runInboxFollowups(db, { now: DAYTIME, send })

      // Nothing names this conversation's account, so nothing licenses another
      // account's wording either.
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: DEFAULT_FOLLOWUP }))
    })

    it("does not read an override from another tenant's config", async () => {
      // This cron runs under runWithRlsBypass, so the `organizationId` predicate in the
      // lookup is the ONLY tenant boundary here — drop it and a stale or foreign config
      // id puts another org's wording in front of this org's customer.
      state.channelConfigs = [{ ...ACCOUNT_A, organizationId: "org_2" }]
      state.conversations = [conv({ channelConfigId: "cfg_a" })]
      state.lastDirection = { conv_1: "outbound" }
      const send = vi.fn(async () => true)

      await runInboxFollowups(db, { now: DAYTIME, send })

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: DEFAULT_FOLLOWUP }))
      expect(state.configWheres[0]).toMatchObject({ organizationId: "org_1" })
    })

    it("ignores an override on a deactivated config", async () => {
      // The operator turned this account off; its wording goes with it.
      state.channelConfigs = [{ ...ACCOUNT_A, isActive: false }]
      state.conversations = [conv({ channelConfigId: "cfg_a" })]
      state.lastDirection = { conv_1: "outbound" }
      const send = vi.fn(async () => true)

      await runInboxFollowups(db, { now: DAYTIME, send })

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: DEFAULT_FOLLOWUP }))
    })

    it("treats a whitespace-only override as no override", async () => {
      state.channelConfigs = [cfg({ settings: { followUpMessage: "   " } })]
      state.conversations = [conv()]
      state.lastDirection = { conv_1: "outbound" }
      const send = vi.fn(async () => true)

      await runInboxFollowups(db, { now: DAYTIME, send })

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: DEFAULT_FOLLOWUP }))
    })

    it("sends the trimmed override, as the per-org lookup did", async () => {
      state.channelConfigs = [cfg({ settings: { followUpMessage: "  Salam!  " } })]
      state.conversations = [conv()]
      state.lastDirection = { conv_1: "outbound" }
      const send = vi.fn(async () => true)

      await runInboxFollowups(db, { now: DAYTIME, send })

      expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: "Salam!" }))
    })

    it("resolves the whole candidate set in ONE query, not one per conversation", async () => {
      // Per-conversation correctness must not cost a query per conversation: the sweep
      // caps at 200 candidates per org.
      state.channelConfigs = [ACCOUNT_A, ACCOUNT_B]
      bothOpen()

      await runInboxFollowups(db, { now: DAYTIME, send: vi.fn(async () => true) })

      expect(state.configWheres).toHaveLength(1)
      expect(state.configWheres[0].id.in.slice().sort()).toEqual(["cfg_a", "cfg_b"])
    })

    it("asks for no configs at all when no candidate names one", async () => {
      state.channelConfigs = [ACCOUNT_A]
      state.conversations = [conv({ channelConfigId: null })]
      state.lastDirection = { conv_1: "outbound" }

      await runInboxFollowups(db, { now: DAYTIME, send: vi.fn(async () => true) })

      expect(state.configWheres).toHaveLength(0)
    })
  })
})
