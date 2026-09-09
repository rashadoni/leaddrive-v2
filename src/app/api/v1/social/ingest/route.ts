import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { findMatchedKeyword, ingestMentionWithResult } from "@/lib/social/ingest-mention"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

const mentionSchema = z.object({
  platform: z.string().min(1).max(30),
  externalId: z.string().min(1).max(200),
  sourceType: z.enum(["comment", "dm", "mention", "lead_ad", "post", "manual", "unknown"]).optional(),
  sourceProvider: z.enum(["native", "chatwoot", "tiktok_organic", "tiktok_business", "manual", "webhook", "poller"]).optional(),
  sourceMetadata: z.record(z.string(), z.unknown()).optional(),
  text: z.string().min(1).max(10000),
  authorName: z.string().max(200).optional(),
  authorHandle: z.string().max(200).optional(),
  authorAvatar: z.string().max(500).optional(),
  url: z.string().max(2000).optional(),
  matchedTerm: z.string().max(200).optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  reach: z.number().int().min(0).optional(),
  engagement: z.number().int().min(0).optional(),
  publishedAt: z.string().datetime().optional(),
  accountHandle: z.string().max(200).optional(),  // matched against social_accounts.handle
})

const payloadSchema = z.union([
  mentionSchema,
  z.object({ mentions: z.array(mentionSchema).min(1).max(100) }),
])

type IngestRouteResult =
  | { id: string; externalId: string; created: boolean }
  | { externalId: string; error: string }

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json().catch(() => null)
  const parsed = payloadSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 })

  const items = "mentions" in parsed.data ? parsed.data.mentions : [parsed.data]
  const fenced = await withSocialMonitoringTenantCollectionFence(orgId, async () => {
    const results: IngestRouteResult[] = []

    for (const item of items) {
      let account: { id: string; keywords: string[] } | null = null
      if (item.accountHandle) {
        account = await prisma.socialAccount.findFirst({
          where: { organizationId: orgId, platform: item.platform, handle: item.accountHandle },
          select: { id: true, keywords: true },
        })
      }

      try {
        const result = await ingestMentionWithResult({
          organizationId: orgId,
          accountId: account?.id ?? null,
          platform: item.platform,
          externalId: item.externalId,
          sourceType: item.sourceType ?? "manual",
          sourceProvider: item.sourceProvider ?? "manual",
          sourceMetadata: item.sourceMetadata ?? {},
          text: item.text,
          authorName: item.authorName ?? null,
          authorHandle: item.authorHandle ?? null,
          authorAvatar: item.authorAvatar ?? null,
          url: item.url ?? null,
          matchedTerm: item.matchedTerm ?? findMatchedKeyword(item.text, account?.keywords) ?? null,
          sentiment: item.sentiment ?? null,
          reach: item.reach ?? 0,
          engagement: item.engagement ?? 0,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
        })
        results.push({ id: result.id, externalId: item.externalId, created: result.created })
      } catch (e: unknown) {
        results.push({ externalId: item.externalId, error: e instanceof Error ? e.message : "insert failed" })
      }
    }

    return NextResponse.json({ success: true, data: { ingested: results.length, results } })
  })
  if (!fenced.allowed) {
    return NextResponse.json({ error: fenced.reason }, { status: 409 })
  }
  return fenced.value
})
