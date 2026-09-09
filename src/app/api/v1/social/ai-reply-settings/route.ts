import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { LIVE_REPLY_PLATFORMS, SOCIAL_REPLY_PLATFORMS } from "@/lib/social/publishers"
import {
  featuresIncludeBrandProtectionOnly,
  isSocialBrandProtectionOnly,
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_MESSAGE,
} from "@/lib/social/brand-protection"
import { getOrCreateSocialOutboundPolicy } from "@/lib/social/outbound-service"
import { featureFlagsToArray } from "@/lib/modules"

const LIVE_FLAG = "ai_auto_social_reply"
const SHADOW_FLAG = "ai_auto_social_reply_shadow"

const SEND_MODES = ["approval", "auto", "dry_run"] as const

const putSchema = z.object({
  platform: z.enum(SOCIAL_REPLY_PLATFORMS),
  senderAccountId: z.string().min(1).nullable().optional(),
  sendMode: z.enum(SEND_MODES).optional(),
  liveEnabled: z.boolean().optional(),
  connectionLiveEnabled: z.boolean().optional(),
  connectionEmergencyStopped: z.boolean().optional(),
  outboundCapability: z.enum(["DIRECT", "PROVIDER"]).nullable().optional(),
  capabilityVerified: z.boolean().optional(),
})

export const GET = withRlsAuth("social", "read", async (_req, auth) => {
  const [org, channelSettings, accounts, outboundPolicy] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: auth.orgId },
      select: { features: true },
    }),
    prisma.socialReplyChannelSetting.findMany({
      where: { organizationId: auth.orgId },
      include: {
        senderAccount: {
          select: {
            id: true, handle: true, displayName: true, accessToken: true, isActive: true,
            outboundLiveEnabled: true, outboundEmergencyStopped: true,
            outboundCapability: true, outboundVerifiedAt: true,
          },
        },
      },
    }),
    prisma.socialAccount.findMany({
      where: { organizationId: auth.orgId, isActive: true, platform: { in: [...SOCIAL_REPLY_PLATFORMS] } },
      select: {
        id: true, platform: true, handle: true, displayName: true, accessToken: true,
        outboundLiveEnabled: true, outboundEmergencyStopped: true,
        outboundCapability: true, outboundVerifiedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    getOrCreateSocialOutboundPolicy(auth.orgId),
  ])

  const features = featureFlagsToArray(org?.features)
  const liveFlagEnabled = features.includes(LIVE_FLAG)
  const shadowFlagEnabled = features.includes(SHADOW_FLAG)
  const brandProtectionOnly = featuresIncludeBrandProtectionOnly(features)

  type ChannelSettingRow = (typeof channelSettings)[number]
  const settingByPlatform = new Map<string, ChannelSettingRow>(
    channelSettings.map((s: ChannelSettingRow) => [s.platform, s]),
  )
  const liveSupported = new Set<string>(LIVE_REPLY_PLATFORMS)

  const channels = SOCIAL_REPLY_PLATFORMS.map((platform) => {
    const setting = settingByPlatform.get(platform)
    const sender = setting?.senderAccount
    const senderConnected = Boolean(sender?.accessToken && sender.isActive)
    const connectionReady = Boolean(
      sender?.outboundLiveEnabled &&
      !sender?.outboundEmergencyStopped &&
      sender?.outboundCapability &&
      sender?.outboundVerifiedAt,
    )
    return {
      platform,
      liveSupported: liveSupported.has(platform),
      sendMode: brandProtectionOnly ? "dry_run" : (setting?.sendMode ?? "approval"),
      liveEnabled: !brandProtectionOnly && Boolean(setting?.liveEnabled),
      senderAccountId: setting?.senderAccountId ?? null,
      senderAccount: sender
        ? {
            id: sender.id,
            handle: sender.handle,
            displayName: sender.displayName,
            connected: senderConnected,
            outboundLiveEnabled: sender.outboundLiveEnabled,
            outboundEmergencyStopped: sender.outboundEmergencyStopped,
            outboundCapability: sender.outboundCapability,
            outboundVerifiedAt: sender.outboundVerifiedAt,
          }
        : null,
      liveReady:
        !brandProtectionOnly &&
        process.env.SOCIAL_OUTBOUND_LIVE_ENABLED === "1" &&
        process.env.SOCIAL_OUTBOUND_KILL_SWITCH !== "1" &&
        outboundPolicy.liveEnabled &&
        !outboundPolicy.emergencyStopped &&
        outboundPolicy.allowedPlatforms.includes(platform) &&
        liveSupported.has(platform) &&
        Boolean(setting?.liveEnabled) &&
        senderConnected &&
        connectionReady,
    }
  })

  const senderAccountOptions = accounts.map((a: {
    id: string
    platform: string
    handle: string
    displayName: string | null
    accessToken: string | null
    outboundLiveEnabled: boolean
    outboundEmergencyStopped: boolean
    outboundCapability: string | null
    outboundVerifiedAt: Date | null
  }) => ({
    id: a.id,
    platform: a.platform,
    handle: a.handle,
    displayName: a.displayName,
    connected: Boolean(a.accessToken),
    outboundLiveEnabled: a.outboundLiveEnabled,
    outboundEmergencyStopped: a.outboundEmergencyStopped,
    outboundCapability: a.outboundCapability,
    outboundVerifiedAt: a.outboundVerifiedAt,
  }))

  const anyLiveReady = channels.some((c) => c.liveReady)

  return NextResponse.json({
    success: true,
    data: {
      mode: liveFlagEnabled || shadowFlagEnabled ? "drafts_need_approval" : "off",
      positiveAutoReplyEnabled: false,
      negativeApprovalRequired: true,
      approvalRole: "social_media_manager",
      sendMode: anyLiveReady ? "per_channel" : "dry_run",
      liveExternalSendEnabled: anyLiveReady,
      requiresLiveConfirmation: true,
      brandProtectionOnly,
      features: {
        live: liveFlagEnabled,
        shadow: shadowFlagEnabled,
      },
      channels,
      senderAccountOptions,
      outboundPolicy: {
        liveEnabled: brandProtectionOnly ? false : outboundPolicy.liveEnabled,
        emergencyStopped: brandProtectionOnly ? true : outboundPolicy.emergencyStopped,
        allowedPlatforms: outboundPolicy.allowedPlatforms,
        releaseReviewedAt: outboundPolicy.releaseReviewedAt,
        globalLiveEnabled: !brandProtectionOnly && process.env.SOCIAL_OUTBOUND_LIVE_ENABLED === "1",
        globalKillSwitch: brandProtectionOnly || process.env.SOCIAL_OUTBOUND_KILL_SWITCH === "1",
      },
    },
  })
})

export const PUT = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const {
    platform, senderAccountId, sendMode, liveEnabled,
    connectionLiveEnabled, connectionEmergencyStopped, outboundCapability, capabilityVerified,
  } = parsed.data

  const brandProtectionOnly = await isSocialBrandProtectionOnly(auth.orgId)
  if (brandProtectionOnly && (
    liveEnabled === true ||
    connectionLiveEnabled === true ||
    connectionEmergencyStopped === false ||
    sendMode === "auto"
  )) {
    return NextResponse.json({
      error: SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_MESSAGE,
      code: SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
    }, { status: 409 })
  }

  if (senderAccountId) {
    const account = await prisma.socialAccount.findFirst({
      where: { id: senderAccountId, organizationId: auth.orgId, platform },
      select: { id: true },
    })
    if (!account) {
      return NextResponse.json({ error: "Sender account not found for this platform" }, { status: 404 })
    }
  }

  const existing = await prisma.socialReplyChannelSetting.findFirst({
    where: { organizationId: auth.orgId, platform },
    select: { id: true, senderAccountId: true },
  })

  const connectionPatchRequested =
    connectionLiveEnabled !== undefined ||
    connectionEmergencyStopped !== undefined ||
    outboundCapability !== undefined ||
    capabilityVerified !== undefined
  if (connectionPatchRequested && auth.role !== "admin") {
    return NextResponse.json({ error: "Admin role required for connection outbound gates" }, { status: 403 })
  }

  if (liveEnabled) {
    const effectiveSenderId = senderAccountId !== undefined ? senderAccountId : existing?.senderAccountId
    if (!effectiveSenderId) {
      return NextResponse.json({ error: "Select a sender account before enabling live send" }, { status: 409 })
    }
    const sender = await prisma.socialAccount.findFirst({
      where: { id: effectiveSenderId, organizationId: auth.orgId, platform, isActive: true },
      select: { accessToken: true },
    })
    if (!sender?.accessToken) {
      return NextResponse.json({ error: "Sender account has no connected token" }, { status: 409 })
    }
  }

  const patch = {
    ...(senderAccountId !== undefined ? { senderAccountId } : {}),
    ...(sendMode !== undefined ? { sendMode } : {}),
    ...(liveEnabled !== undefined ? { liveEnabled } : {}),
    updatedBy: auth.userId,
  }

  const effectiveSenderId = senderAccountId !== undefined ? senderAccountId : existing?.senderAccountId
  if (connectionPatchRequested) {
    if (!effectiveSenderId) return NextResponse.json({ error: "Select a sender account first" }, { status: 409 })
    const sender = await prisma.socialAccount.findFirst({
      where: { id: effectiveSenderId, organizationId: auth.orgId, platform, isActive: true },
      select: { outboundCapability: true, outboundVerifiedAt: true, outboundLiveEnabled: true, outboundEmergencyStopped: true },
    })
    if (!sender) return NextResponse.json({ error: "Sender account not found" }, { status: 404 })
    const effectiveCapability = outboundCapability !== undefined ? outboundCapability : sender.outboundCapability
    const effectiveVerifiedAt = capabilityVerified === true ? new Date() : capabilityVerified === false ? null : sender.outboundVerifiedAt
    const effectiveConnectionLive = connectionLiveEnabled ?? sender.outboundLiveEnabled
    const effectiveEmergencyStop = connectionEmergencyStopped ?? sender.outboundEmergencyStopped
    if (effectiveCapability === "PROVIDER" && capabilityVerified === true) {
      const proof = await prisma.socialProviderCapabilityProof.findFirst({
        where: {
          organizationId: auth.orgId,
          platform,
          capability: { in: ["REPLY_EXTERNAL", "REPLY_OWNED"] },
          status: "VERIFIED",
          replyAllowed: true,
          sandboxVerifiedAt: { not: null },
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      })
      if (!proof) return NextResponse.json({ error: "Verified contract and sandbox provider reply proof required" }, { status: 409 })
    }
    if (effectiveConnectionLive && (!effectiveCapability || !effectiveVerifiedAt || effectiveEmergencyStop)) {
      return NextResponse.json({ error: "Verified capability and connectionEmergencyStopped=false are required" }, { status: 409 })
    }
    await prisma.socialAccount.update({
      where: { organizationId_id: { organizationId: auth.orgId, id: effectiveSenderId } },
      data: {
        ...(connectionLiveEnabled !== undefined ? { outboundLiveEnabled: connectionLiveEnabled } : {}),
        ...(connectionEmergencyStopped !== undefined ? { outboundEmergencyStopped: connectionEmergencyStopped } : {}),
        ...(outboundCapability !== undefined ? { outboundCapability } : {}),
        ...(capabilityVerified !== undefined ? { outboundVerifiedAt: capabilityVerified ? new Date() : null } : {}),
      },
    })
  }

  const setting = existing
    ? await prisma.socialReplyChannelSetting.update({ where: { id: existing.id }, data: patch })
    : await prisma.socialReplyChannelSetting.create({
        data: {
          organizationId: auth.orgId,
          platform,
          senderAccountId: senderAccountId ?? null,
          sendMode: sendMode ?? "approval",
          liveEnabled: liveEnabled ?? false,
          updatedBy: auth.userId,
        },
      })

  return NextResponse.json({ success: true, data: setting })
})
