import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/**
 * The channel list tells each Facebook/Instagram row whether Social Monitoring collects that page
 * (lib/channels/meta-monitoring-state), so Settings → Channels can show one row per page with both of its jobs.
 * Rows read from prod on 2026-10-27, tenant LeadDrive Inc: Andrologiya.az collected, the LeadDrive Page's
 * monitoring switched off with its token cleared, an Instagram account never monitored.
 */

const mocks = vi.hoisted(() => ({
  channels: [] as Array<Record<string, unknown>>,
  accounts: [] as Array<Record<string, unknown>>,
  hasSocial: true,
  accountQueries: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findMany: vi.fn(async () => mocks.channels) },
    socialAccount: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        mocks.accountQueries.push(where)
        return mocks.accounts
      }),
    },
  },
}))
vi.mock("@/lib/channels-access", () => ({
  gateChannelsAccess: vi.fn(async () => ({ orgId: "org-leaddrive", userId: "admin" })),
}))
vi.mock("@/lib/rls-context", () => ({ runWithTenant: (_org: string, fn: () => unknown) => fn() }))
vi.mock("@/lib/channels/inbound-claim", () => ({ channelIdsClaimedElsewhere: vi.fn(async () => new Set()) }))
vi.mock("@/lib/api-auth", () => ({ orgHasModule: vi.fn(async () => mocks.hasSocial) }))

import { GET } from "@/app/api/v1/channels/route"
import { metaMonitoringStates } from "@/lib/channels/meta-monitoring-state"

const channel = (id: string, channelType: string, pageId: string | null) => ({
  id, channelType, configName: id, pageId, isActive: true, settings: {}, apiKey: "x", accessToken: null,
})

beforeEach(() => {
  mocks.hasSocial = true
  mocks.accountQueries = []
  mocks.channels = [
    channel("andrologiya", "facebook", "182013225466892"),
    channel("leaddrive", "facebook", "373662722735767"),
    channel("ig-new", "instagram", "17841405965503896"),
    channel("number", "whatsapp", null),
  ]
  mocks.accounts = [
    { platform: "facebook", handle: "182013225466892", isActive: true, accessToken: "enc", lastPolledAt: new Date("2026-10-27T07:17:42Z") },
    { platform: "facebook", handle: "373662722735767", isActive: false, accessToken: null, lastPolledAt: new Date("2026-10-27T06:47:44Z") },
  ]
})

async function list() {
  const res = await GET(new NextRequest("http://localhost/api/v1/channels"))
  expect(res).toBeInstanceOf(NextResponse)
  const body = await res.json()
  return Object.fromEntries((body.data as Array<{ id: string; monitoring?: unknown }>).map((row) => [row.id, row.monitoring]))
}

describe("GET /api/v1/channels — Social Monitoring state on Meta rows", () => {
  it("says which pages are collected, which stopped, and which were never monitored", async () => {
    expect(await list()).toEqual({
      andrologiya: { state: "on", lastPolledAt: "2026-10-27T07:17:42.000Z" },
      leaddrive: { state: "off", lastPolledAt: "2026-10-27T06:47:44.000Z" },
      "ig-new": { state: "awaiting_meta", lastPolledAt: null },
      number: undefined,
    })
    // One query, this organization's Meta accounts for exactly these pages.
    expect(mocks.accountQueries).toEqual([{
      organizationId: "org-leaddrive",
      platform: { in: ["facebook", "instagram"] },
      handle: { in: ["182013225466892", "373662722735767", "17841405965503896"] },
    }])
  })

  it("adds nothing for a workspace without Social Monitoring", async () => {
    mocks.hasSocial = false
    expect(Object.values(await list()).every((value) => value === undefined)).toBe(true)
    expect(mocks.accountQueries).toEqual([])
  })

  it("still lists the channels when the monitoring read fails", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.socialAccount.findMany).mockRejectedValueOnce(new Error("db down"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(Object.keys(await list())).toEqual(["andrologiya", "leaddrive", "ig-new", "number"])
  })
})

describe("metaMonitoringStates", () => {
  it("never matches an Instagram row to a Facebook account of the same id, nor counts a token on a switched-off account", async () => {
    mocks.accounts = [
      { platform: "facebook", handle: "1", isActive: true, accessToken: "enc", lastPolledAt: null },
      { platform: "instagram", handle: "2", isActive: false, accessToken: "enc", lastPolledAt: null },
    ]
    const states = await metaMonitoringStates("org", [
      { id: "ig-same-id", channelType: "instagram", pageId: "1" },
      { id: "ig-off", channelType: "instagram", pageId: "2" },
      { id: "no-page", channelType: "facebook", pageId: null },
    ])
    expect(Object.fromEntries(states)).toEqual({
      "ig-same-id": { state: "awaiting_meta", lastPolledAt: null },
      "ig-off": { state: "off", lastPolledAt: null },
    })
  })
})
