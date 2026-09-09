import { afterAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { enqueueOutboundSocialReply, reviewOutboundSocialReply } from "@/lib/social/outbound-service"
import { processOutboundSocialReplies } from "@/lib/social/outbound-worker"
import type { OutboundPublisherAdapter } from "@/lib/social/outbound-publisher"

const enabled = process.env.PR6_DB_E2E === "1"
const orgId = "pr3-org-a"
const accountId = "pr3-fb-page"
const subjectId = "pr3-subject-a"
const externalId = `pr6-db-e2e-${Date.now()}`

describe.skipIf(!enabled)("PR6 outbound DB e2e", () => {
  let mentionId: string | null = null
  let previousAccount: Record<string, unknown> | null = null
  let previousChannel: Record<string, unknown> | null = null
  let previousPolicy: Record<string, unknown> | null = null

  afterAll(async () => {
    if (!enabled) return
    await runWithTenant(orgId, async () => {
      if (mentionId) await prisma.socialMention.deleteMany({ where: { organizationId: orgId, id: mentionId } })
      if (previousAccount) {
        await prisma.socialAccount.update({
          where: { organizationId_id: { organizationId: orgId, id: accountId } },
          data: previousAccount,
        })
      }
      if (previousChannel) {
        await prisma.socialReplyChannelSetting.update({
          where: { organizationId_platform: { organizationId: orgId, platform: "facebook" } },
          data: previousChannel,
        })
      } else {
        await prisma.socialReplyChannelSetting.deleteMany({ where: { organizationId: orgId, platform: "facebook" } })
      }
      if (previousPolicy) {
        await prisma.socialOutboundPolicy.update({
          where: { organizationId: orgId },
          data: previousPolicy,
        })
      }
    })
    await prisma.$disconnect()
  })

  it("deduplicates, requires separate approval and sends once through an injected sandbox adapter", async () => {
    process.env.SOCIAL_OUTBOUND_LIVE_ENABLED = "1"
    process.env.SOCIAL_OUTBOUND_KILL_SWITCH = "0"
    const fixture = await runWithTenant(orgId, async () => {
      const [account, channel, policy, identity] = await Promise.all([
        prisma.socialAccount.findFirstOrThrow({ where: { organizationId: orgId, id: accountId } }),
        prisma.socialReplyChannelSetting.findFirst({ where: { organizationId: orgId, platform: "facebook" } }),
        prisma.socialOutboundPolicy.findFirstOrThrow({ where: { organizationId: orgId } }),
        prisma.socialReplyIdentity.findFirstOrThrow({ where: { organizationId: orgId, subjectId, socialAccountId: accountId } }),
      ])
      previousAccount = {
        accessToken: account.accessToken,
        outboundLiveEnabled: account.outboundLiveEnabled,
        outboundEmergencyStopped: account.outboundEmergencyStopped,
        outboundCapability: account.outboundCapability,
        outboundVerifiedAt: account.outboundVerifiedAt,
      }
      previousChannel = channel ? {
        senderAccountId: channel.senderAccountId,
        sendMode: channel.sendMode,
        liveEnabled: channel.liveEnabled,
        updatedBy: channel.updatedBy,
      } : null
      previousPolicy = {
        liveEnabled: policy.liveEnabled,
        emergencyStopped: policy.emergencyStopped,
        allowedPlatforms: policy.allowedPlatforms,
        maxPerHour: policy.maxPerHour,
        releaseReviewedAt: policy.releaseReviewedAt,
        releaseReviewedBy: policy.releaseReviewedBy,
        updatedBy: policy.updatedBy,
      }
      await prisma.socialAccount.update({
        where: { organizationId_id: { organizationId: orgId, id: accountId } },
        data: {
          accessToken: "pr6-sandbox-token-not-used",
          outboundLiveEnabled: true,
          outboundEmergencyStopped: false,
          outboundCapability: "DIRECT",
          outboundVerifiedAt: new Date(),
        },
      })
      await prisma.socialReplyChannelSetting.upsert({
        where: { organizationId_platform: { organizationId: orgId, platform: "facebook" } },
        create: { organizationId: orgId, platform: "facebook", senderAccountId: accountId, sendMode: "approval", liveEnabled: true },
        update: { senderAccountId: accountId, sendMode: "approval", liveEnabled: true },
      })
      await prisma.socialOutboundPolicy.update({
        where: { organizationId: orgId },
        data: {
          liveEnabled: true,
          emergencyStopped: false,
          allowedPlatforms: ["facebook"],
          maxPerHour: 10,
          releaseReviewedAt: new Date(),
          releaseReviewedBy: "release-admin",
        },
      })
      const mention = await prisma.socialMention.create({
        data: {
          organizationId: orgId,
          accountId,
          platform: "facebook",
          externalId,
          sourceType: "comment",
          contentKind: "COMMENT",
          sourceProvider: "native",
          sourceMetadata: { ownership: "owned" },
          text: "A safe owned-page comment",
          contentVersion: 1,
        },
      })
      mentionId = mention.id
      await prisma.socialMentionSubjectMatch.create({
        data: {
          organizationId: orgId,
          mentionId: mention.id,
          subjectId,
          status: "MATCHED",
          reason: "pr6_db_e2e",
          confidence: 1,
          matchedAliasIds: [],
          contextSignals: {},
          matcherVersion: "pr6-e2e-v1",
        },
      })
      return { mention, identity }
    })

    const enqueued = await runWithTenant(orgId, () => enqueueOutboundSocialReply({
      organizationId: orgId,
      mentionId: fixture.mention.id,
      requestedBy: "requester-user",
      replyText: "Thank you for your comment.",
      platform: "facebook",
      externalId,
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: { ownership: "owned" },
    }))
    expect(enqueued).toMatchObject({ ok: true, status: 201, data: { state: "PENDING" } })
    if (!enqueued.ok) throw new Error("enqueue failed")

    const pending = await runWithTenant(orgId, () => prisma.outboundSocialReply.findFirstOrThrow({
      where: { organizationId: orgId, id: enqueued.data.id },
      select: { replyTextSha256: true },
    }))
    await expect(runWithTenant(orgId, () => prisma.outboundSocialReplyApproval.create({
      data: {
        organizationId: orgId,
        outboundReplyId: enqueued.data.id,
        decision: "APPROVED",
        contentSha256: pending.replyTextSha256,
        approvedBy: "requester-user",
        approverRole: "admin",
      },
    }))).rejects.toThrow(/requester cannot approve their own request/i)

    await expect(runWithTenant(orgId, () => reviewOutboundSocialReply({
      organizationId: orgId,
      outboundReplyId: enqueued.data.id,
      reviewerId: "requester-user",
      reviewerRole: "admin",
      decision: "APPROVED",
    }))).rejects.toMatchObject({ code: "separate_approver_required" })

    await expect(runWithTenant(orgId, () => reviewOutboundSocialReply({
      organizationId: orgId,
      outboundReplyId: enqueued.data.id,
      reviewerId: "reviewer-user",
      reviewerRole: "admin",
      decision: "APPROVED",
    }))).resolves.toMatchObject({ state: "QUEUED" })

    let publishCalls = 0
    const adapter: OutboundPublisherAdapter = {
      publish: async () => {
        publishCalls += 1
        return { outcome: "SENT", externalReplyId: "sandbox-reply-1", provider: "sandbox" }
      },
      reconcile: async () => ({ outcome: "UNKNOWN", evidence: {} }),
    }
    const processed = await runWithRlsBypass(() => processOutboundSocialReplies({ adapter, now: new Date() }))
    expect(processed).toMatchObject({ sent: 1, reconciliationRequired: 0 })
    expect(publishCalls).toBe(1)

    const duplicate = await runWithTenant(orgId, () => enqueueOutboundSocialReply({
      organizationId: orgId,
      mentionId: fixture.mention.id,
      requestedBy: "requester-user",
      replyText: "Thank you for your comment.",
      platform: "facebook",
      externalId,
      sourceType: "comment",
      sourceProvider: "native",
      sourceMetadata: { ownership: "owned" },
    }))
    expect(duplicate).toMatchObject({ ok: true, code: "outbound_already_exists", data: { state: "SENT" } })
    expect(publishCalls).toBe(1)

    const persisted = await runWithTenant(orgId, () => prisma.outboundSocialReply.findFirstOrThrow({
      where: { organizationId: orgId, id: enqueued.data.id },
      include: { approval: true, events: true },
    }))
    expect(persisted).toMatchObject({ state: "SENT", externalReplyId: "sandbox-reply-1" })
    expect(persisted.approval?.approvedBy).toBe("reviewer-user")
    expect(persisted.events.map((event: { eventType: string }) => event.eventType)).toEqual(expect.arrayContaining([
      "OUTBOUND_REQUESTED", "OUTBOUND_APPROVED_AND_QUEUED", "OUTBOUND_CLAIMED", "OUTBOUND_SENT",
    ]))
  }, 30_000)
})
