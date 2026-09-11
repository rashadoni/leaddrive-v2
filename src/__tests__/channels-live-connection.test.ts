import { describe, expect, it } from "vitest"
import {
  channelConnectionState,
  channelIsLiveConnection,
  metaInboxSubscribedFlag,
  type ChannelConnectionInput,
  type ChannelConnectionState,
} from "@/lib/channels/live-connection"

/**
 * The predicate that decides whether the UI is allowed to say "Connected". It used to live inline in
 * the catalog page and be covered by `readFileSync(...).toContain("Boolean(channel.pageId) && ...")`,
 * which is a photograph of the implementation: it passes for as long as the source keeps its wording
 * and says nothing about any input. This is the table it should have been.
 *
 * Each row is a real shape from `/api/v1/channels` (i.e. `publicChannelConfig` output: no raw token,
 * a `hasAccessToken` boolean instead).
 */
const liveMetaRow: ChannelConnectionInput = {
  channelType: "facebook",
  pageId: "1122334455",
  isActive: true,
  hasAccessToken: true,
  settings: { inboxSubscribed: true },
}

type Row = {
  name: string
  channel: ChannelConnectionInput
  state: ChannelConnectionState
}

const rows: Row[] = [
  {
    name: "OAuth wrote a page id, a token and a successful subscribe",
    channel: liveMetaRow,
    state: "live",
  },
  {
    name: "subscribe explicitly failed — Meta will not deliver a single DM",
    channel: { ...liveMetaRow, settings: { inboxSubscribed: false } },
    state: "needsReconnect",
  },
  {
    name: "row is switched off — the inbound resolver filters on isActive: true",
    channel: { ...liveMetaRow, isActive: false },
    state: "paused",
  },
  {
    name: "page id but no stored token — nothing can be sent or resolved",
    channel: { ...liveMetaRow, hasAccessToken: false },
    state: "draft",
  },
  {
    name: "token but no page id — the webhook resolves inbound DMs by page id",
    channel: { ...liveMetaRow, pageId: null },
    state: "draft",
  },
  {
    name: "Model B Meta-app config row: credentials, but no page was ever connected",
    channel: {
      channelType: "facebook",
      pageId: null,
      isActive: true,
      hasAccessToken: false,
      settings: {},
    },
    state: "draft",
  },
  {
    name: "empty row straight out of the channel form (created with isActive: true)",
    channel: { channelType: "facebook", isActive: true },
    state: "draft",
  },
  {
    name: "legacy row wired before the inboxSubscribed flag existed",
    channel: { ...liveMetaRow, settings: { pageName: "Acme" } },
    state: "live",
  },
  {
    name: "settings absent entirely",
    channel: { ...liveMetaRow, settings: undefined },
    state: "live",
  },
  {
    name: "instagram row obeys the same three rules",
    channel: { ...liveMetaRow, channelType: "instagram" },
    state: "live",
  },
  {
    name: "instagram row whose subscribe failed",
    channel: { ...liveMetaRow, channelType: "instagram", settings: { inboxSubscribed: false } },
    state: "needsReconnect",
  },
  {
    name: "another workspace's older claim wins the webhook's routing — wired, on, subscribed, and receives nothing",
    channel: { ...liveMetaRow, channelType: "instagram", claimedElsewhere: true },
    state: "claimedElsewhere",
  },
  {
    name: "the API checked and found no winning claim elsewhere",
    channel: { ...liveMetaRow, claimedElsewhere: false },
    state: "live",
  },
  {
    name: "claimedElsewhere is a Meta routing fact — a non-Meta row is never demoted by it",
    channel: { channelType: "telegram", isActive: true, claimedElsewhere: true },
    state: "live",
  },
  {
    name: "channel type casing does not smuggle a Meta row past the check",
    channel: { ...liveMetaRow, channelType: "Facebook", hasAccessToken: false },
    state: "draft",
  },
  {
    name: "non-Meta channel keeps the historical meaning: a saved row is a connection",
    channel: { channelType: "telegram", isActive: true },
    state: "live",
  },
  {
    name: "non-Meta channel is not demoted by a missing page id either",
    channel: { channelType: "whatsapp", isActive: true, pageId: null, hasAccessToken: false },
    state: "live",
  },
  // isActive is not a Meta rule. webhooks/telegram, webhooks/whatsapp and webhooks/vk all resolve
  // their channel with `isActive: true`, exactly like webhooks/facebook — so a switched-off row of ANY
  // type drops every inbound message, and a "Connected" badge on it is the same lie.
  {
    name: "switched-off telegram row — webhooks/telegram filters isActive: true",
    channel: { channelType: "telegram", isActive: false },
    state: "paused",
  },
  {
    name: "switched-off whatsapp row — webhooks/whatsapp filters isActive: true",
    channel: { channelType: "whatsapp", isActive: false, hasAccessToken: true },
    state: "paused",
  },
  {
    name: "switched-off vkontakte row — webhooks/vkontakte filters isActive: true",
    channel: { channelType: "vkontakte", isActive: false, pageId: "group-1" },
    state: "paused",
  },
  {
    name: "switched-off row of an unknown/custom type is paused too",
    channel: { channelType: "chatwoot", isActive: false },
    state: "paused",
  },
  {
    name: "casing does not smuggle a switched-off non-Meta row past the check",
    channel: { channelType: "Telegram", isActive: false },
    state: "paused",
  },
  // Tolerance, in the same direction as the inboxSubscribed flag: only an EXPLICIT false is a pause.
  {
    name: "non-Meta row whose isActive was never selected is not demoted",
    channel: { channelType: "telegram" },
    state: "live",
  },
  {
    name: "non-Meta row with isActive explicitly null is not demoted either",
    channel: { channelType: "telegram", isActive: null },
    state: "live",
  },
]

describe("channelConnectionState", () => {
  for (const row of rows) {
    it(`${row.name} → ${row.state}`, () => {
      expect(channelConnectionState(row.channel)).toBe(row.state)
      expect(channelIsLiveConnection(row.channel)).toBe(row.state === "live")
    })
  }

  it("orders its checks so the FIRST unmet requirement is what the user is told to fix", () => {
    // A row that is both unwired and switched off is a draft, not a paused connection: telling that
    // user to flip a toggle would send them to a screen that cannot help them.
    expect(channelConnectionState({
      channelType: "facebook",
      pageId: null,
      isActive: false,
      hasAccessToken: false,
    })).toBe("draft")
    // Wired, switched off AND unsubscribed: switching it on comes first — while it is off, the
    // subscription state cannot be observed at all.
    expect(channelConnectionState({
      ...liveMetaRow,
      isActive: false,
      settings: { inboxSubscribed: false },
    })).toBe("paused")
    // Claimed elsewhere AND unsubscribed: re-running OAuth cannot bring the DMs here while another
    // workspace's claim wins, so the claim is what the user hears about — and it sends them to support.
    expect(channelConnectionState({
      ...liveMetaRow,
      claimedElsewhere: true,
      settings: { inboxSubscribed: false },
    })).toBe("claimedElsewhere")
    // An unwired or switched-off row still gets the fix it can act on first.
    expect(channelConnectionState({ ...liveMetaRow, hasAccessToken: false, claimedElsewhere: true })).toBe("draft")
    expect(channelConnectionState({ ...liveMetaRow, isActive: false, claimedElsewhere: true })).toBe("paused")
  })
})

describe("what this predicate deliberately cannot see", () => {
  it("calls an Instagram row live even when the linked Page's subscribe failed", () => {
    // Documented in lib/channels/live-connection as KNOWN LIMITATION 2, asserted here so the gap is a
    // recorded fact rather than folklore. An IG account id does not support subscribed_apps, so
    // ensureInboxChannelForPage hardcodes { success: true } for instagram and always writes
    // inboxSubscribed: true. IG DMs actually ride the LINKED Facebook Page's `messages` subscription,
    // which lives on a different row — so this pair is a workspace where nothing can arrive at all,
    // and only the Facebook half of it says so.
    const linkedPageRow: ChannelConnectionInput = {
      channelType: "facebook",
      pageId: "1122334455",
      isActive: true,
      hasAccessToken: true,
      settings: { inboxSubscribed: false },
    }
    const instagramRow: ChannelConnectionInput = {
      channelType: "instagram",
      pageId: "17841400000000000",
      isActive: true,
      hasAccessToken: true,
      settings: { inboxSubscribed: true },
    }
    expect(channelConnectionState(linkedPageRow)).toBe("needsReconnect")
    // Not the truth — the truth needs a second row read, which this module's input shape cannot do.
    expect(channelConnectionState(instagramRow)).toBe("live")
  })
})

describe("metaInboxSubscribedFlag", () => {
  it("reports only a real boolean, so an absent flag can never read as failure", () => {
    expect(metaInboxSubscribedFlag({ inboxSubscribed: true })).toBe(true)
    expect(metaInboxSubscribedFlag({ inboxSubscribed: false })).toBe(false)
    expect(metaInboxSubscribedFlag({})).toBeUndefined()
    expect(metaInboxSubscribedFlag(null)).toBeUndefined()
    expect(metaInboxSubscribedFlag(undefined)).toBeUndefined()
    expect(metaInboxSubscribedFlag("inboxSubscribed")).toBeUndefined()
    expect(metaInboxSubscribedFlag([{ inboxSubscribed: false }])).toBeUndefined()
    // A JSON column can hold the string "false"; that is not the flag this project writes, and
    // guessing at it would demote working legacy rows.
    expect(metaInboxSubscribedFlag({ inboxSubscribed: "false" })).toBeUndefined()
  })

  it("matches how api/v1/social/enable-inbox reads the same field", () => {
    // enable-inbox flags a re-connect only on an EXPLICIT false. Two readers of one field must not
    // disagree about what a missing flag means, or the catalog and the Social Monitoring banner would
    // describe the same tenant differently.
    const rowsToCheck = [
      { settings: { inboxSubscribed: true }, needsReconnect: false },
      { settings: { inboxSubscribed: false }, needsReconnect: true },
      { settings: {}, needsReconnect: false },
    ]
    for (const row of rowsToCheck) {
      expect(metaInboxSubscribedFlag(row.settings) === false).toBe(row.needsReconnect)
    }
  })
})
