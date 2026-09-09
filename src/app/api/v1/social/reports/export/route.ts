import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { buildSocialMonitoringDocx, buildSocialMonitoringXlsx } from "@/lib/social/social-monitoring-report-export"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"
import { socialReportVisibleMentionWhere } from "@/lib/social/report-visibility"

const querySchema = z.object({
  format: z.enum(["docx", "xlsx"]),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

type ReportMention = {
  platform: string
  externalId: string
  postExternalId: string | null
  contentKind: string
  sourceProvider: string
  authorName: string | null
  authorHandle: string | null
  publishedAt: Date | null
  text: string
  url: string | null
  parentPostUrl: string | null
  mediaObservations: Array<{ sourceUrl: string; thumbnailUrl: string | null }>
}

export const GET = withRlsAuth("social", "read", async (request: NextRequest, auth) => {
  const parsed = querySchema.safeParse({
    format: request.nextUrl.searchParams.get("format"),
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: "Invalid report format or limit" }, { status: 400 })
  const mentions = await prisma.socialMention.findMany({
    where: {
      organizationId: auth.orgId,
      purgedAt: null,
      deletedAtSource: null,
      AND: [riskRelevantMentionWhere(), socialReportVisibleMentionWhere()],
    },
    orderBy: { publishedAt: "desc" },
    take: parsed.data.limit,
    select: {
      platform: true,
      externalId: true,
      postExternalId: true,
      contentKind: true,
      sourceProvider: true,
      authorName: true,
      authorHandle: true,
      publishedAt: true,
      text: true,
      url: true,
      parentPostUrl: true,
      mediaObservations: {
        where: { purgedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { sourceUrl: true, thumbnailUrl: true },
      },
    },
  })
  const reportMentions = mentions as ReportMention[]
  const commentsByPost = new Map<string, string[]>()
  for (const mention of reportMentions) {
    if (!["COMMENT", "REPLY"].includes(mention.contentKind) || !mention.postExternalId) continue
    const comments = commentsByPost.get(mention.postExternalId) ?? []
    if (comments.length < 5 && mention.text.trim()) comments.push(mention.text.trim())
    commentsByPost.set(mention.postExternalId, comments)
  }
  const rows = reportMentions.map(mention => ({
    platform: mention.platform,
    contentKind: mention.contentKind,
    provider: mention.sourceProvider,
    author: mention.authorName || mention.authorHandle || "Anonymous",
    publishedAt: mention.publishedAt,
    text: mention.text,
    url: mention.url,
    parentPostUrl: mention.parentPostUrl,
    coverUrl: mention.mediaObservations[0]?.thumbnailUrl ?? mention.mediaObservations[0]?.sourceUrl ?? null,
    topComments: commentsByPost.get(mention.externalId) ?? [],
  }))
  const buffer = parsed.data.format === "xlsx"
    ? await buildSocialMonitoringXlsx(rows)
    : await buildSocialMonitoringDocx(rows)
  const date = new Date().toISOString().slice(0, 10)
  const contentType = parsed.data.format === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="social-monitoring-${date}.${parsed.data.format}"`,
      "Cache-Control": "private, no-store",
    },
  })
})
