import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  isSocialBrandProtectionOnly,
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
  SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_MESSAGE,
} from "@/lib/social/brand-protection"
import { getOrCreateSocialOutboundPolicy } from "@/lib/social/outbound-service"

const PLATFORMS = ["instagram", "facebook", "twitter", "tiktok", "youtube", "vkontakte"] as const
const schema = z.object({
  liveEnabled: z.boolean().optional(),
  emergencyStopped: z.boolean().optional(),
  allowedPlatforms: z.array(z.enum(PLATFORMS)).optional(),
  maxPerHour: z.number().int().min(1).max(1000).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
  timeZone: z.string().trim().min(1).max(100).optional(),
  releaseReviewConfirmed: z.literal(true).optional(),
})

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  const [policy, brandProtectionOnly] = await Promise.all([
    getOrCreateSocialOutboundPolicy(auth.orgId),
    isSocialBrandProtectionOnly(auth.orgId),
  ])
  return NextResponse.json({
    success: true,
    data: {
      ...policy,
      liveEnabled: brandProtectionOnly ? false : policy.liveEnabled,
      emergencyStopped: brandProtectionOnly ? true : policy.emergencyStopped,
      brandProtectionOnly,
      globalLiveEnabled: !brandProtectionOnly && process.env.SOCIAL_OUTBOUND_LIVE_ENABLED === "1",
      globalKillSwitch: brandProtectionOnly || process.env.SOCIAL_OUTBOUND_KILL_SWITCH === "1",
    },
  })
})

export const PATCH = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  if (auth.role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid outbound policy" }, { status: 400 })
  const brandProtectionOnly = await isSocialBrandProtectionOnly(auth.orgId)
  if (brandProtectionOnly && (parsed.data.liveEnabled === true || parsed.data.emergencyStopped === false)) {
    return NextResponse.json({
      error: SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_MESSAGE,
      code: SOCIAL_BRAND_PROTECTION_OUTBOUND_BLOCK_CODE,
    }, { status: 409 })
  }
  const current = await getOrCreateSocialOutboundPolicy(auth.orgId)
  const enabling = !brandProtectionOnly && parsed.data.liveEnabled === true
  const effectiveLiveEnabled = brandProtectionOnly ? false : (parsed.data.liveEnabled ?? current.liveEnabled)
  const effectiveEmergencyStop = brandProtectionOnly ? true : (parsed.data.emergencyStopped ?? current.emergencyStopped)
  const effectivePlatforms = parsed.data.allowedPlatforms ?? current.allowedPlatforms
  const releaseReviewAvailable = Boolean(current.releaseReviewedAt) || (enabling && parsed.data.releaseReviewConfirmed === true)
  if (effectiveLiveEnabled && (!releaseReviewAvailable || effectiveEmergencyStop || effectivePlatforms.length === 0)) {
    return NextResponse.json({ error: "Release review, at least one platform, and emergencyStopped=false are required" }, { status: 409 })
  }
  if (parsed.data.timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timeZone }).format(new Date())
    } catch {
      return NextResponse.json({ error: "Invalid IANA time zone" }, { status: 400 })
    }
  }
  const now = new Date()
  const updated = await prisma.socialOutboundPolicy.update({
    where: { organizationId: auth.orgId },
    data: {
      ...(brandProtectionOnly
        ? { liveEnabled: false, emergencyStopped: true }
        : {
            ...(parsed.data.liveEnabled !== undefined ? { liveEnabled: parsed.data.liveEnabled } : {}),
            ...(parsed.data.emergencyStopped !== undefined ? { emergencyStopped: parsed.data.emergencyStopped } : {}),
          }),
      ...(parsed.data.allowedPlatforms ? { allowedPlatforms: parsed.data.allowedPlatforms } : {}),
      ...(parsed.data.maxPerHour !== undefined ? { maxPerHour: parsed.data.maxPerHour } : {}),
      ...(parsed.data.quietHoursStart !== undefined ? { quietHoursStart: parsed.data.quietHoursStart } : {}),
      ...(parsed.data.quietHoursEnd !== undefined ? { quietHoursEnd: parsed.data.quietHoursEnd } : {}),
      ...(parsed.data.timeZone ? { timeZone: parsed.data.timeZone } : {}),
      ...(enabling && parsed.data.releaseReviewConfirmed ? { releaseReviewedAt: now, releaseReviewedBy: auth.userId } : {}),
      requireSeparateApprover: true,
      policyVersion: { increment: 1 },
      updatedBy: auth.userId,
    },
  })
  return NextResponse.json({ success: true, data: updated })
})
