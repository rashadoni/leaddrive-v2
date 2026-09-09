import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isSocialBrandProtectionOnly } from "@/lib/social/brand-protection"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"

type SocialAccountRow = Prisma.SocialAccountGetPayload<Record<string, never>>
type ConnectedChannelPageRow = Prisma.ChannelConfigGetPayload<{
  select: {
    id: true
    channelType: true
    configName: true
    pageId: true
    isActive: true
    apiKey: true
    createdAt: true
    updatedAt: true
  }
}>

export const GET = withRlsAuth("social", "read", async (_req, auth) => {
  const orgId = auth.orgId

  const [accounts, channelPages] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    }),
    // Instagram Login intentionally stores its token in ChannelConfig rather
    // than SocialAccount because that token cannot drive the legacy poller.
    // Return a redacted display projection so a successfully connected page is
    // still visible to the operator.
    prisma.channelConfig.findMany({
      where: {
        organizationId: orgId,
        channelType: { in: ["facebook", "instagram", "tiktok", "youtube", "twitter"] },
        pageId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        channelType: true,
        configName: true,
        pageId: true,
        isActive: true,
        apiKey: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ])
  // Redact raw accessToken; expose only a boolean "connected" flag
  const sanitized = accounts.map((a: SocialAccountRow) => {
    const { accessToken, ...rest } = a
    return { ...rest, connected: !!accessToken, accessToken: accessToken ? "***" : null }
  })
  const accountKeys = new Set(accounts.map((account: SocialAccountRow) => `${account.platform}:${account.handle}`))
  const connectedPages = channelPages
    .filter(
      (page: ConnectedChannelPageRow) =>
        Boolean(page.pageId) && !accountKeys.has(`${page.channelType}:${page.pageId}`)
    )
    .map((page: ConnectedChannelPageRow) => ({
      id: page.id,
      platform: page.channelType,
      handle: page.pageId || page.configName,
      displayName: page.configName,
      isActive: page.isActive,
      connected: page.isActive && Boolean(page.apiKey),
      connectionSource: "channel_config" as const,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    }))
  return NextResponse.json({ success: true, data: { accounts: sanitized, connectedPages } })
})

const createSchema = z.object({
  platform: z.enum(["twitter", "instagram", "facebook", "telegram", "vkontakte", "youtube", "tiktok"]),
  handle: z.string().min(1).max(200),
  displayName: z.string().max(200).optional(),
  keywords: z.array(z.string().max(100)).optional(),
})

export const POST = withRlsAuth("social", "write", async (req, auth) => {
  const orgId = auth.orgId

  // Brand-protection-only tenants may only WATCH external pages — connecting an
  // owned channel (a SocialAccount) is outside their entitlement.
  if (await isSocialBrandProtectionOnly(orgId)) {
    return NextResponse.json({ error: "brand_protection_only" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const account = await prisma.socialAccount.create({
      data: {
        organizationId: orgId,
        platform: parsed.data.platform,
        handle: parsed.data.handle,
        displayName: parsed.data.displayName,
        keywords: parsed.data.keywords || [],
      },
    })
    await compileOrganizationSourceRoutePlans(orgId)
    logAudit(orgId, "create", "social_account", account.id, `${account.platform}:${account.handle}`)
    // Same reasoning as the contacts POST (F-32): the list path redacts, so
    // this one does too. A freshly created account carries no token yet —
    // the point is that the next person to add one should not have to find
    // every raw-row response by hand.
    const { accessToken: created, ...safeAccount } = account
    return NextResponse.json(
      { success: true, data: { ...safeAccount, connected: Boolean(created), accessToken: created ? "***" : null } },
      { status: 201 },
    )
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return NextResponse.json({ error: "Account already exists" }, { status: 409 })
    }
    throw e
  }
})
