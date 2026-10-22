import { beforeEach, describe, expect, it, vi } from "vitest"

// Dynamic Prisma query interpreter used only by this in-memory concurrency test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const db = vi.hoisted(() => ({ deliveries: [] as Row[], campaigns: [] as Row[], inbound: [] as Row[], optedOut: [] as Row[], conversationOptOut: false, logs: [] as Row[] }))
const fetchMock = vi.hoisted(() => vi.fn())
const configMock = vi.hoisted(() => vi.fn())

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part: Row) => matches(row, part))
    if (value instanceof Date) return row[key]?.getTime() === value.getTime()
    if (value && typeof value === "object") {
      if ("in" in value && !value.in.includes(row[key])) return false
      if ("not" in value && (row[key] ?? null) === value.not) return false
      if ("lte" in value && !(row[key] <= value.lte)) return false
      if ("lt" in value && !(row[key] < value.lt)) return false
      if ("gte" in value && !(row[key] >= value.gte)) return false
      if ("path" in value) return row[key]?.[value.path[0]] === value.equals
      return true
    }
    return (row[key] ?? null) === value
  })
}
function update(rows: Row[], { where, data }: Row) {
  const hits = rows.filter(row => matches(row, where))
  for (const row of hits) for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) row[key] = value && typeof value === "object" && "increment" in value ? (row[key] || 0) + (value as Row).increment : value
  }
  return { count: hits.length }
}
vi.mock("@/lib/prisma", () => {
  const prisma = {
    whatsAppCampaignDelivery: {
      createMany: vi.fn(async ({ data }: Row) => {
        for (const row of data) {
          if (db.deliveries.some(d => d.campaignId === row.campaignId && d.recipientPhone === row.recipientPhone)) throw new Error("unique recipient")
          db.deliveries.push({ status: "pending", attempts: 0, nextAttemptAt: new Date(0), claimedAt: null, acceptedAt: null, ...row })
        }
        return { count: data.length }
      }),
      findMany: vi.fn(async ({ where, take }: Row) => db.deliveries.filter(row => matches(row, where)).slice(0, take).map(row => ({ ...row }))),
      findFirst: vi.fn(async ({ where }: Row) => db.deliveries.find(row => matches(row, where)) || null),
      updateMany: vi.fn(async (args: Row) => update(db.deliveries, args)),
      count: vi.fn(async ({ where }: Row) => db.deliveries.filter(row => matches(row, where)).length),
      groupBy: vi.fn(async ({ where }: Row) => {
        const counts: Record<string, number> = {}
        db.deliveries.filter(row => matches(row, where)).forEach(row => { counts[row.status] = (counts[row.status] || 0) + 1 })
        return Object.entries(counts).map(([status, count]) => ({ status, _count: { _all: count } }))
      }),
    },
    organization: { findFirst: vi.fn(async () => ({ id: "org1" })) },
    campaign: {
      findFirst: vi.fn(async ({ where }: Row) => db.campaigns.find(row => matches(row, where)) || null),
      updateMany: vi.fn(async (args: Row) => update(db.campaigns, args)),
    },
    contact: { findMany: vi.fn(async () => db.optedOut) },
    socialConversation: {
      findFirst: vi.fn(async () => db.conversationOptOut ? { id: "conversation" } : null),
      update: vi.fn(async () => ({ id: "conversation" })),
      upsert: vi.fn(async () => ({ id: "conversation" })),
    },
    channelMessage: {
      findFirst: vi.fn(async ({ where }: Row) => db.inbound.find(row => matches(row, where)) || null),
      create: vi.fn(async ({ data }: Row) => { db.logs.push(data); return data }),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone({ deliveries: db.deliveries, campaigns: db.campaigns })
      try { return await fn(prisma) } catch (error) { Object.assign(db, snapshot); throw error }
    }),
  }
  return { prisma }
})
vi.mock("@/lib/whatsapp", () => ({ resolveWhatsAppConfig: configMock }))
import { deliverWhatsAppCampaignRecipient, enqueueWhatsAppCampaign, recordWhatsAppCampaignStatus, runWhatsAppCampaignDispatch } from "@/lib/campaigns/whatsapp-dispatch"
import { prisma } from "@/lib/prisma"
import { getRlsContext } from "@/lib/rls-context"

const payload = { body: "Hello", template: { name: "hello", language: "en", parameters: [] } }
const recipient = (phone = "994501112233") => ({ phone, contactId: "contact1", payload })
const now = new Date()
const directRow = () => ({ organizationId: "org1", channelConfigId: "channel1", recipientPhone: "994501112233", payload, attempts: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  db.deliveries = []; db.campaigns = [{ id: "campaign1", organizationId: "org1", status: "sending", sentAt: null }]
  db.inbound = []; db.optedOut = []; db.logs = []; db.conversationOptOut = false
  configMock.mockResolvedValue({ id: "channel1", phoneNumberId: "phone1", accessToken: "test-only" })
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: `wamid_${fetchMock.mock.calls.length}` }] }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})

describe("durable WhatsApp campaign delivery", () => {
  it("snapshots every recipient beyond the old 500 cap, normalizes and deduplicates phones", async () => {
    const audience = Array.from({ length: 601 }, (_, i) => recipient(`99450${String(i).padStart(7, "0")}`))
    audience.push(recipient("+994 (50) 000-00-00"))
    expect(await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", audience)).toBe(601)
    expect(db.deliveries).toHaveLength(601)
    expect(db.campaigns[0].totalRecipients).toBe(601)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("rolls back the whole audience if the campaign was cancelled while preparing it", async () => {
    db.campaigns[0].status = "cancelled"
    await expect(enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])).rejects.toThrow()
    expect(db.deliveries).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("two workers can claim the same discovery result but send only once, inside the tenant scope", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])
    fetchMock.mockImplementation(async () => {
      expect(getRlsContext()?.orgId).toBe("org1")
      return new Response(JSON.stringify({ messages: [{ id: "wamid_one" }] }))
    })
    await Promise.all([runWhatsAppCampaignDispatch(now), runWhatsAppCampaignDispatch(now)])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(db.deliveries[0].status).toBe("accepted")
    expect(db.campaigns[0]).toMatchObject({ status: "sent", totalSent: 1 })
    await runWhatsAppCampaignDispatch(new Date(now.getTime() + 600_000))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("does not replay an interrupted in-flight request after restart", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])
    Object.assign(db.deliveries[0], { status: "sending", claimedAt: new Date(now.getTime() - 180_000), attempts: 1 })
    await runWhatsAppCampaignDispatch(now)
    await runWhatsAppCampaignDispatch(new Date(now.getTime() + 600_000))
    expect(db.deliveries[0]).toMatchObject({ status: "unknown", errorCode: "worker_interrupted" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("resumes pending rows in later batches instead of dropping the remainder", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", Array.from({ length: 101 }, (_, i) => recipient(`99450${String(i).padStart(7, "0")}`)))
    await runWhatsAppCampaignDispatch(now)
    expect(fetchMock).toHaveBeenCalledTimes(100)
    expect(db.campaigns[0].status).toBe("sending")
    await runWhatsAppCampaignDispatch(now)
    expect(fetchMock).toHaveBeenCalledTimes(101)
    expect(db.campaigns[0]).toMatchObject({ status: "sent", totalSent: 101 })
  })
  it("an ambiguous provider timeout is never automatically resent", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])
    fetchMock.mockRejectedValue(new Error("request timed out after write"))
    await runWhatsAppCampaignDispatch(now)
    await runWhatsAppCampaignDispatch(new Date(now.getTime() + 600_000))
    expect(db.deliveries[0].status).toBe("unknown")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("backs off only an explicit throughput rejection and caps attempts", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 130429 } }), { status: 429 }))
    await runWhatsAppCampaignDispatch(now)
    expect(db.deliveries[0].status).toBe("pending")
    await runWhatsAppCampaignDispatch(new Date(now.getTime() + 1_000))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await runWhatsAppCampaignDispatch(new Date(now.getTime() + 60_000))
    await runWhatsAppCampaignDispatch(new Date(now.getTime() + 180_000))
    expect(db.deliveries[0]).toMatchObject({ status: "failed", attempts: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it("checks a later opt-out and a cancelled campaign before sending", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])
    db.optedOut = [{ id: "another-copy", phone: "+994 (50) 111-22-33" }]
    await runWhatsAppCampaignDispatch(now)
    expect(db.deliveries[0]).toMatchObject({ status: "skipped", errorCode: "recipient_opted_out" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("also suppresses a lead-only STOP conversation and never switches sending numbers", async () => {
    db.conversationOptOut = true
    expect(await deliverWhatsAppCampaignRecipient(directRow())).toMatchObject({ status: "skipped" })
    expect(configMock).toHaveBeenCalledWith("org1", { channelConfigId: "channel1" })
    configMock.mockResolvedValue(null)
    expect(await deliverWhatsAppCampaignRecipient(directRow())).toEqual({ status: "skipped", errorCode: "channel_unavailable" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("free text requires a recent inbound message on the same full phone and sending channel", async () => {
    const row = { ...directRow(), payload: { body: "Hello" } }
    db.inbound = [{ organizationId: "org1", channelConfigId: "other", channelType: "whatsapp", direction: "inbound", from: row.recipientPhone, createdAt: new Date() }]
    expect(await deliverWhatsAppCampaignRecipient(row)).toMatchObject({ errorCode: "outside_window_no_template" })
    db.inbound[0].channelConfigId = "channel1"; db.inbound[0].from = "1994501112233"
    expect(await deliverWhatsAppCampaignRecipient(row)).toMatchObject({ errorCode: "outside_window_no_template" })
    db.inbound[0].from = row.recipientPhone
    expect(await deliverWhatsAppCampaignRecipient(row)).toMatchObject({ status: "accepted" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("provider acceptance is distinct from delivery; early/out-of-order callbacks never downgrade", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])
    const id = db.deliveries[0].id
    fetchMock.mockImplementation(async () => {
      await recordWhatsAppCampaignStatus("org1", "wamid_early", "read", `campaign:${id}`)
      return new Response(JSON.stringify({ messages: [{ id: "wamid_early" }] }))
    })
    await runWhatsAppCampaignDispatch(now)
    expect(db.deliveries[0].status).toBe("read")
    await recordWhatsAppCampaignStatus("org1", "wamid_early", "sent")
    await recordWhatsAppCampaignStatus("org1", "wamid_early", "delivered")
    await recordWhatsAppCampaignStatus("other-org", "wamid_early", "failed", `campaign:${id}`)
    expect(db.deliveries[0].status).toBe("read")
  })
  it("late provider proof resolves an unknown outcome without sending again", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])
    Object.assign(db.deliveries[0], { status: "unknown" }); db.campaigns[0].status = "failed"
    await recordWhatsAppCampaignStatus("org1", "wamid_late", "delivered", `campaign:${db.deliveries[0].id}`)
    expect(db.deliveries[0].status).toBe("delivered")
    expect(db.campaigns[0]).toMatchObject({ status: "sent", totalSent: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("sends image, video and document headers with the approved template", async () => {
    for (const type of ["image", "video", "document"] as const) {
      expect(await deliverWhatsAppCampaignRecipient({ ...directRow(), payload: { ...payload, template: { ...payload.template, header: { type, link: "https://example.com/media" } } } })).toMatchObject({ status: "accepted" })
      const request = JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
      expect(request.template.components).toEqual([{ type: "header", parameters: [{ type, [type]: { link: "https://example.com/media" } }] }])
    }
  })
  it("rejects invalid template media before any provider request", async () => {
    expect(await deliverWhatsAppCampaignRecipient({ ...directRow(), payload: { ...payload, template: { ...payload.template, header: { type: "image", link: "http://example.com/media" } } } })).toMatchObject({ status: "failed", errorCode: "invalid_payload" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("does not dispatch for a deactivated tenant", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValueOnce(null)
    expect(await deliverWhatsAppCampaignRecipient(directRow())).toMatchObject({ status: "skipped", errorCode: "organization_inactive" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("failure to save the message log never turns acceptance into a retry", async () => {
    vi.mocked(prisma.channelMessage.create).mockRejectedValueOnce(new Error("log unavailable"))
    expect(await deliverWhatsAppCampaignRecipient(directRow())).toMatchObject({ status: "accepted" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("treats a provider 5xx as unknown and accepts later delivery proof without a resend", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient()])
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 1 } }), { status: 503 }))
    await runWhatsAppCampaignDispatch(now)
    expect(db.deliveries[0].status).toBe("unknown")
    await recordWhatsAppCampaignStatus("org1", "wamid_late", "delivered", `campaign:${db.deliveries[0].id}`)
    await runWhatsAppCampaignDispatch(new Date(now.getTime() + 600_000))
    expect(db.deliveries[0].status).toBe("delivered")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("honors an opted-out contact's secondary number for a lead-only recipient", async () => {
    db.optedOut = [{ id: "other_contact", phone: "994500000000", phones: ["+994 (50) 111-22-33"] }]
    expect(await deliverWhatsAppCampaignRecipient(directRow())).toMatchObject({ status: "skipped", errorCode: "recipient_opted_out" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("links a newly initiated outbound to the inbox without marking it unread", async () => {
    await deliverWhatsAppCampaignRecipient(directRow())
    expect(db.logs[0]).toMatchObject({ conversationId: "conversation", status: "sent", externalId: expect.any(String) })
    expect(prisma.socialConversation.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ unreadCount: 0, channelConfigId: "channel1" }) }))
  })
  it("does not attach an outbound to an existing conversation on another sending number", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "other_conversation", channelConfigId: "other_channel" } as never)
    await deliverWhatsAppCampaignRecipient(directRow())
    expect(db.logs[0].conversationId).toBeUndefined()
    expect(prisma.socialConversation.update).not.toHaveBeenCalled()
  })
  it("cancellation stops remaining recipients but keeps proof for an already in-flight message", async () => {
    await enqueueWhatsAppCampaign("org1", "campaign1", "channel1", [recipient(), recipient("994500000002")])
    fetchMock.mockImplementation(async () => {
      db.campaigns[0].status = "cancelled"
      return new Response(JSON.stringify({ messages: [{ id: "wamid_inflight" }] }))
    })
    await runWhatsAppCampaignDispatch(now)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(db.deliveries.map(row => row.status)).toEqual(["accepted", "skipped"])
    expect(db.campaigns[0].status).toBe("cancelled")
    expect(db.campaigns[0].totalSent).toBe(1)
  })
})
