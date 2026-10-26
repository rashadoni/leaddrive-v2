import { beforeEach, describe, expect, it, vi } from "vitest"

// LeadDrive's own Messenger conversation «1431458576943213» (2026-09-21) kept its digits: its sender now writes to
// a page another workspace claimed first, so no webhook ever retries the name. The backfill asks Meta once per
// such conversation through the channel that received it, and replaces digits only.
const m = vi.hoisted(() => ({
  conversations: vi.fn(),
  channel: vi.fn(),
  update: vi.fn(),
  resolve: vi.fn(),
  tenants: [] as string[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findMany: m.conversations, updateMany: m.update },
    channelConfig: { findFirst: m.channel },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => fn(),
  runWithTenant: (orgId: string, fn: () => unknown) => { m.tenants.push(orgId); return fn() },
}))
vi.mock("@/lib/social/meta-sender-profile", () => ({ resolveMetaSenderName: m.resolve }))

import { backfillMetaSenderNames } from "@/lib/social/meta-sender-names-backfill"

const rows = [
  { id: "c1", organizationId: "org-leaddrive", platform: "facebook", externalId: "1431458576943213", contactName: "1431458576943213", channelConfigId: "fb-1" },
  { id: "c2", organizationId: "org-zeytun", platform: "instagram", externalId: "4621512548170901", contactName: "@sev_mova", channelConfigId: "ig-1" },
  { id: "c3", organizationId: "org-zeytun", platform: "instagram", externalId: "2981264768873200", contactName: "2981264768873200", channelConfigId: "ig-1" },
  { id: "c4", organizationId: "org-x", platform: "facebook", externalId: "5550001112223334", contactName: "5550001112223334", channelConfigId: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.tenants = []
  m.conversations.mockResolvedValue(rows)
  m.channel.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === "fb-1" ? { apiKey: "page-token", pageId: "373662722735767", settings: {} }
      : where.id === "ig-1" ? { apiKey: "ig-token", pageId: "17841400000000000", settings: { igLogin: true } } : null)
  m.resolve.mockImplementation(async ({ senderId }: { senderId: string }) =>
    senderId === "1431458576943213" ? "Rashad Rahimov" : senderId)
  m.update.mockResolvedValue({ count: 1 })
})

describe("backfillMetaSenderNames", () => {
  it("counts in a dry run and writes nothing", async () => {
    const report = await backfillMetaSenderNames({ dryRun: true, limit: 50 })
    expect(report).toMatchObject({ dryRun: true, scanned: 3, named: 1, stillDigits: 2, noChannel: 1, hasMore: false })
    expect(report.byPlatform).toEqual({ facebook: { named: 1, stillDigits: 1 }, instagram: { named: 0, stillDigits: 1 } })
    expect(m.update).not.toHaveBeenCalled()
  })

  it("replaces digits with the name, in the row's own tenant, and only while the row still shows digits", async () => {
    await backfillMetaSenderNames({ dryRun: false, limit: 50 })
    expect(m.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "c1", organizationId: "org-leaddrive", contactName: "1431458576943213" },
      data: { contactName: "Rashad Rahimov" },
    })
    expect(m.resolve).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-leaddrive", platform: "facebook", senderId: "1431458576943213",
      token: "page-token", accountId: "373662722735767", igLogin: false,
    }))
    // The already-named Instagram conversation is never looked up.
    expect(m.resolve).not.toHaveBeenCalledWith(expect.objectContaining({ senderId: "4621512548170901" }))
    expect(m.tenants).toEqual(["org-leaddrive", "org-zeytun", "org-x"])
  })

  it("stops at the limit and says there is more", async () => {
    const report = await backfillMetaSenderNames({ dryRun: true, limit: 1 })
    expect(report).toMatchObject({ scanned: 1, hasMore: true })
  })
})
