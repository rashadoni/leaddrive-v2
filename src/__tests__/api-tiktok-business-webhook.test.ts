import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = {
  connection: {
    id: "cc_business",
    organizationId: "org_1",
    platform: "tiktok",
    surface: "lead_ad",
    provider: "tiktok_business",
    status: "connected",
    capabilities: { read: true, reply: false, webhook: true, importLead: true },
    settings: { webhookSecret: "business_secret" },
  },
  mentionLeadId: null as string | null,
  existingLeadId: null as string | null,
  existingTikTokLeadId: null as string | null,
  existingTikTokActivityLeadId: null as string | null,
}

const ingestSpy = vi.fn(async () => ({ id: "mention_1", created: true }))
const leadCreateSpy = vi.fn(async ({ data }) => ({ id: "lead_1", companyName: null, ...data }))
const mentionUpdateSpy = vi.fn(async () => ({ count: 1 }))
const mentionFindSpy = vi.fn(async () => ({ id: "mention_1", leadId: state.mentionLeadId, sourceMetadata: {} }))
const activityCreateSpy = vi.fn(async () => ({}))
const activityFindSpy = vi.fn(async () => (
  state.existingTikTokActivityLeadId
    ? { relatedId: state.existingTikTokActivityLeadId }
    : null
))
const leadFindSpy = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
  if ("scoreDetails" in where) {
    return state.existingTikTokLeadId ? { id: state.existingTikTokLeadId } : null
  }
  if (where.id === state.existingTikTokActivityLeadId) {
    return { id: state.existingTikTokActivityLeadId }
  }
  return state.existingLeadId ? { id: state.existingLeadId } : null
})
const advisoryLockSpy = vi.fn(async () => 1)
const withTenantFence = vi.fn()
const executeWorkflowsSpy = vi.fn(async () => ({}))
const fireWebhooksSpy = vi.fn(async () => ({}))
const runWithTenantSpy = vi.fn((_organizationId: string, fn: () => unknown) => fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (
      callback: (tx: { $executeRawUnsafe: typeof advisoryLockSpy }) => Promise<unknown>,
    ) => callback({ $executeRawUnsafe: advisoryLockSpy })),
    channelConnection: {
      findFirst: vi.fn(async () => state.connection),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    socialMention: {
      findUnique: mentionFindSpy,
      updateMany: mentionUpdateSpy,
    },
    lead: {
      findFirst: leadFindSpy,
      create: leadCreateSpy,
    },
    activity: {
      findFirst: activityFindSpy,
      create: activityCreateSpy,
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: runWithTenantSpy,
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMentionWithResult: ingestSpy,
}))

vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: withTenantFence,
}))

vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: executeWorkflowsSpy }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => ({})) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: fireWebhooksSpy }))
vi.mock("@/lib/unified-profile/profile-builder", () => ({ refreshProfileForSource: vi.fn(async () => ({})) }))

function req(body: unknown, token = "business_secret") {
  return new NextRequest(`http://localhost/api/v1/webhooks/tiktok-business?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.mentionLeadId = null
  state.existingLeadId = null
  state.existingTikTokLeadId = null
  state.existingTikTokActivityLeadId = null
  state.connection = {
    id: "cc_business",
    organizationId: "org_1",
    platform: "tiktok",
    surface: "lead_ad",
    provider: "tiktok_business",
    status: "connected",
    capabilities: { read: true, reply: false, webhook: true, importLead: true },
    settings: { webhookSecret: "business_secret" },
  }
  ingestSpy.mockResolvedValue({ id: "mention_1", created: true })
  withTenantFence.mockImplementation(async (
    _organizationId: string,
    collect: () => Promise<unknown>,
  ) => ({ allowed: true, value: await collect() }))
  leadCreateSpy.mockResolvedValue({
    id: "lead_1",
    organizationId: "org_1",
    contactName: "Aysel Aliyeva",
    companyName: null,
    email: "aysel@example.com",
    phone: "+994501112233",
  })
})

describe("POST /api/v1/webhooks/tiktok-business", () => {
  it("imports TikTok Lead Ads into CRM leads through the Business provider boundary", async () => {
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-business/route")
    const res = await POST(req({
      event: "lead.created",
      data: {
        lead_id: "lead_tiktok_1",
        form_id: "form_1",
        campaign_id: "camp_1",
        adgroup_id: "ag_1",
        ad_id: "ad_1",
        fields: [
          { name: "full_name", value: "Aysel Aliyeva" },
          { name: "email", value: "aysel@example.com" },
          { name: "phone", value: "+994501112233" },
        ],
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.ingested).toBe(1)
    expect(ingestSpy).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      platform: "tiktok",
      externalId: "tiktok_business:lead_ad:lead_tiktok_1",
      sourceType: "lead_ad",
      sourceProvider: "tiktok_business",
      sourceMetadata: expect.objectContaining({
        platform: "tiktok",
        surface: "lead_ad",
        provider: "tiktok_business",
        tiktokLeadId: "lead_tiktok_1",
        campaignId: "camp_1",
      }),
    }))
    expect(leadCreateSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org_1",
        contactName: "Aysel Aliyeva",
        email: "aysel@example.com",
        phone: "+994501112233",
        source: "tiktok:lead_ad",
      }),
    }))
    expect(mentionUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "mention_1", organizationId: "org_1", leadId: null },
      data: expect.objectContaining({ leadId: "lead_1" }),
    }))
    expect(executeWorkflowsSpy).toHaveBeenCalledWith(
      "org_1",
      "lead",
      "created",
      expect.objectContaining({ id: "lead_1" }),
      { awaitExternalSideEffects: true },
    )
    expect(fireWebhooksSpy).toHaveBeenCalledWith(
      "org_1",
      "lead.created",
      expect.objectContaining({ id: "lead_1" }),
      { awaitDelivery: true },
    )
  })

  it("ignores Lead Ads payloads when importLead is disabled", async () => {
    state.connection = { ...state.connection, capabilities: { read: true, reply: false, webhook: true, importLead: false } }
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-business/route")
    const res = await POST(req({ event: "lead.created", data: { lead_id: "lead_tiktok_1" } }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ignored).toBe("no-connected-tiktok-business-lead-ads-connection")
    expect(ingestSpy).not.toHaveBeenCalled()
    expect(leadCreateSpy).not.toHaveBeenCalled()
  })

  it("keeps CRM lead intake live without a SocialMention when clean-slate collection is blocked", async () => {
    withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-business/route")

    const res = await POST(req({
      event: "lead.created",
      data: {
        lead_id: "lead_tiktok_blocked",
        fields: [
          { name: "full_name", value: "Aysel Aliyeva" },
          { name: "email", value: "aysel@example.com" },
          { name: "phone", value: "+994501112233" },
        ],
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.monitoringSkipped).toBe("social_monitoring_collection_blocked")
    expect(json.data.results).toEqual([{
      mentionId: null,
      leadId: "lead_1",
      status: "lead_created",
    }])
    expect(leadCreateSpy).toHaveBeenCalledOnce()
    expect(executeWorkflowsSpy).toHaveBeenCalledWith(
      "org_1",
      "lead",
      "created",
      expect.objectContaining({ id: "lead_1" }),
      { awaitExternalSideEffects: true },
    )
    expect(ingestSpy).not.toHaveBeenCalled()
    expect(mentionFindSpy).not.toHaveBeenCalled()
    expect(mentionUpdateSpy).not.toHaveBeenCalled()
  })

  it("deduplicates blocked Lead Ads against CRM leads without touching SocialMention", async () => {
    state.existingLeadId = "lead_existing"
    withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-business/route")

    const res = await POST(req({
      event: "lead.created",
      data: {
        lead_id: "lead_tiktok_duplicate",
        fields: [
          { name: "full_name", value: "Existing Lead" },
          { name: "phone", value: "+994501112233" },
        ],
      },
    }))
    const json = await res.json()

    expect(json.data.results).toEqual([{
      mentionId: null,
      leadId: "lead_existing",
      status: "duplicate_linked",
    }])
    expect(activityCreateSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        relatedType: "lead",
        relatedId: "lead_existing",
      }),
    }))
    expect(leadCreateSpy).not.toHaveBeenCalled()
    expect(ingestSpy).not.toHaveBeenCalled()
    expect(mentionFindSpy).not.toHaveBeenCalled()
    expect(mentionUpdateSpy).not.toHaveBeenCalled()
  })

  it("deduplicates blocked retries by TikTok lead id even without phone or email", async () => {
    state.existingTikTokLeadId = "lead_from_first_delivery"
    withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-business/route")

    const res = await POST(req({
      event: "lead.created",
      data: {
        lead_id: "lead_tiktok_retry",
        fields: [{ name: "full_name", value: "No Contact Details" }],
      },
    }))
    const json = await res.json()

    expect(json.data.results).toEqual([{
      mentionId: null,
      leadId: "lead_from_first_delivery",
      status: "already_linked",
    }])
    expect(advisoryLockSpy).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      "tiktok-business-lead-ad:org_1:lead_tiktok_retry",
    )
    expect(runWithTenantSpy).toHaveBeenCalledTimes(2)
    expect(leadCreateSpy).not.toHaveBeenCalled()
    expect(activityCreateSpy).not.toHaveBeenCalled()
    expect(ingestSpy).not.toHaveBeenCalled()
    expect(mentionFindSpy).not.toHaveBeenCalled()
    expect(mentionUpdateSpy).not.toHaveBeenCalled()
  })

  it("reuses the durable duplicate marker for a pre-existing CRM lead", async () => {
    state.existingTikTokActivityLeadId = "lead_matched_on_first_delivery"
    withTenantFence.mockResolvedValueOnce({
      allowed: false,
      reason: "social_monitoring_collection_blocked",
    })
    const { POST } = await import("@/app/api/v1/webhooks/tiktok-business/route")

    const res = await POST(req({
      event: "lead.created",
      data: {
        lead_id: "lead_tiktok_preexisting_retry",
        fields: [{ name: "full_name", value: "Existing CRM Lead" }],
      },
    }))
    const json = await res.json()

    expect(json.data.results).toEqual([{
      mentionId: null,
      leadId: "lead_matched_on_first_delivery",
      status: "already_linked",
    }])
    expect(leadCreateSpy).not.toHaveBeenCalled()
    expect(activityCreateSpy).not.toHaveBeenCalled()
    expect(ingestSpy).not.toHaveBeenCalled()
  })
})
