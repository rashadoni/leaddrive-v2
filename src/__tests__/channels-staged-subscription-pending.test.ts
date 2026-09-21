import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

/**
 * A staged (App Review) Meta connect, followed through every writer that touches its row and read back the
 * way the channel screens read it.
 *
 * A staged connect (`?app=<id>`) deliberately subscribes nothing: it stores the Page and its token, writes
 * `inboxSubscribed: false` with `appReviewOnly` and `subscriptionPending`, and leaves the subscription to an
 * explicit per-Page call (`api/v1/social/oauth/subscribe`). Until 2026-09-21 no screen read the marker, so
 * every staged row said "Meta refused the message subscription — run Connect with Meta again" — right after
 * a connect that had asked Meta for nothing, and on the very screens recorded for App Review.
 *
 * Nothing here is a hand-written settings object: the rows are what `ensureInboxChannelForPage` and the
 * subscribe route actually store, shaped by `publicChannelConfig` exactly as `/api/v1/channels` ships them,
 * then judged by the one predicate all four screens use.
 */

type StoredRow = {
  id: string
  organizationId: string
  channelType: string
  configName: string
  pageId: string | null
  apiKey: string | null
  isActive: boolean
  settings: Record<string, unknown> | null
  createdAt: Date
}

const store = vi.hoisted(() => ({
  rows: new Map<string, StoredRow>(),
  clock: 0,
  subscribe: vi.fn(),
}))

/** Just enough of prisma.channelConfig for the two writers under test, backed by one in-memory table. */
vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: async ({ where }: { where: { organizationId: string; channelType: string; pageId: string } }) =>
        [...store.rows.values()]
          .filter((r) => r.organizationId === where.organizationId && r.channelType === where.channelType && r.pageId === where.pageId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((r) => ({ id: r.id, settings: r.settings })),
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
        const row = store.rows.get(where.id)
        return row && row.organizationId === where.organizationId ? { ...row } : null
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<StoredRow> }) => {
        const row = store.rows.get(where.id)
        if (!row) throw new Error(`no row ${where.id}`)
        Object.assign(row, data)
        return { ...row }
      },
      create: async ({ data }: { data: Omit<StoredRow, "id" | "createdAt"> }) => {
        store.clock += 1
        const id = `cc_${store.clock}`
        store.rows.set(id, { ...data, id, createdAt: new Date(Date.UTC(2026, 8, 21, 12, 0, store.clock)) })
        return { id }
      },
    },
  },
}))
vi.mock("@/lib/social/meta-subscribe", () => ({
  subscribePageToMessages: (...args: unknown[]) => store.subscribe(...args),
}))
// The auth wrapper has its own tests; here it only supplies the caller's organization.
vi.mock("@/lib/social/oauth-access", () => ({
  withSocialConnectAuth: (_action: string, handler: (req: NextRequest, auth: unknown) => unknown) =>
    (req: NextRequest) => handler(req, { orgId: "org_1", role: "admin" }),
}))

import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"
import { POST as subscribePage } from "@/app/api/v1/social/oauth/subscribe/route"
import { publicChannelConfig } from "@/lib/channels/public-channel-config"
import { channelConnectionState, channelIsLiveConnection } from "@/lib/channels/live-connection"

beforeEach(() => {
  store.rows.clear()
  store.clock = 0
  store.subscribe.mockReset()
  store.subscribe.mockResolvedValue({ success: true })
})

function stagedConnect(channelType: "facebook" | "instagram" = "facebook", pageId = "PAGE_1") {
  return ensureInboxChannelForPage("org_1", channelType, pageId, "Test Page", "staged-token", { staged: true })
}

function ordinaryConnect(channelType: "facebook" | "instagram" = "facebook", pageId = "PAGE_1") {
  return ensureInboxChannelForPage("org_1", channelType, pageId, "Test Page", "live-token")
}

async function subscribeExplicitly(configId: string) {
  return subscribePage({ json: async () => ({ configId }) } as unknown as NextRequest)
}

/** The state every channel screen shows for this row — the row as /api/v1/channels ships it. */
function screenState(id: string) {
  const row = store.rows.get(id)
  if (!row) throw new Error(`no row ${id}`)
  return channelConnectionState(publicChannelConfig(row))
}

function settingsOf(id: string) {
  return store.rows.get(id)?.settings || {}
}

describe("a staged App Review connect, as the screens read it", () => {
  it("reads as not-requested-yet — neither a refusal nor a working connection", async () => {
    const { channelId } = await stagedConnect()
    expect(store.subscribe).not.toHaveBeenCalled()
    expect(screenState(channelId!)).toBe("subscriptionPending")
    expect(channelIsLiveConnection(publicChannelConfig(store.rows.get(channelId!)!))).toBe(false)
  })

  it("turns live once the Page is subscribed explicitly and Meta accepts", async () => {
    const { channelId } = await stagedConnect()
    const res = await subscribeExplicitly(channelId!)
    expect(res.status).toBe(200)
    expect(store.subscribe).toHaveBeenCalledWith("PAGE_1", "staged-token")
    expect(screenState(channelId!)).toBe("live")
    // Still staged — subscribing does not promote the row to the tenant's default app.
    expect(settingsOf(channelId!).appReviewOnly).toBe(true)
  })

  it("shows a refusal as a refusal once the explicit subscribe has actually asked Meta", async () => {
    const { channelId } = await stagedConnect()
    store.subscribe.mockResolvedValueOnce({ success: false, error: "(#200) permission missing" })
    const res = await subscribeExplicitly(channelId!)
    expect(res.status).toBe(502)
    // "Not requested yet" would now be false: it was requested, and Meta said no.
    expect(screenState(channelId!)).toBe("needsReconnect")
  })

  it("goes back to not-requested when the row is staged again after a refusal", async () => {
    const { channelId } = await stagedConnect()
    store.subscribe.mockResolvedValueOnce({ success: false, error: "refused" })
    await subscribeExplicitly(channelId!)
    expect(screenState(channelId!)).toBe("needsReconnect")

    const again = await stagedConnect()
    expect(again.channelId).toBe(channelId)
    expect(screenState(channelId!)).toBe("subscriptionPending")
  })

  it("lets a later ordinary connect of the same Page answer the question, whatever Meta says", async () => {
    // The ordinary connect updates the oldest row for the Page — here the staged one — and really asks
    // Meta. The marker from the staged connect must not survive that and relabel Meta's refusal.
    const { channelId } = await stagedConnect()
    store.subscribe.mockResolvedValueOnce({ success: false, error: "missing pages_messaging" })
    const ordinary = await ordinaryConnect()
    expect(ordinary.channelId).toBe(channelId)
    expect(store.subscribe).toHaveBeenCalledWith("PAGE_1", "live-token")
    expect(screenState(channelId!)).toBe("needsReconnect")
    expect(settingsOf(channelId!)).not.toHaveProperty("subscriptionPending")

    await ordinaryConnect()
    expect(screenState(channelId!)).toBe("live")
  })

  it("leaves a live row for the same Page exactly as it was", async () => {
    const live = await ordinaryConnect()
    const staged = await stagedConnect()
    expect(staged.channelId).not.toBe(live.channelId)
    expect(screenState(live.channelId!)).toBe("live")
    expect(settingsOf(live.channelId!)).toEqual({ inboxSubscribed: true })
    expect(screenState(staged.channelId!)).toBe("subscriptionPending")
  })

  it("reads the Instagram half of a staged Facebook-login connect as not-requested too", async () => {
    const page = await stagedConnect("facebook", "PAGE_1")
    const ig = await stagedConnect("instagram", "IG_1")
    expect(screenState(ig.channelId!)).toBe("subscriptionPending")

    // An IG account cannot be subscribed itself — the endpoint sends you to the linked Page, and the
    // Instagram row is left untouched.
    const refused = await subscribeExplicitly(ig.channelId!)
    expect(refused.status).toBe(400)
    expect(screenState(ig.channelId!)).toBe("subscriptionPending")

    // Recorded limitation (lib/channels/live-connection, KNOWN LIMITATION 2): subscribing the linked Page
    // writes the Page row only, so the Instagram row keeps saying "delivery not confirmed". It errs towards
    // doubt, never towards a delivery the row cannot see.
    await subscribeExplicitly(page.channelId!)
    expect(screenState(page.channelId!)).toBe("live")
    expect(screenState(ig.channelId!)).toBe("subscriptionPending")
  })
})
