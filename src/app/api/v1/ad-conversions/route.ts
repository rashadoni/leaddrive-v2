/**
 * Settings → «Reklam konversiyaları»: the Meta destination and the latest
 * events (sent, waiting, skipped with the reason, failed with Meta's words).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { metaDestinationView } from "@/lib/ad-conversions/destination"

export const GET = withRlsAuth("settings", "read", async (_req, { orgId }) => {
  const [meta, recent] = await Promise.all([
    metaDestinationView(orgId),
    prisma.adConversionEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, eventName: true, recordLabel: true, status: true, reason: true, createdAt: true, sentAt: true },
    }),
  ])
  return NextResponse.json({
    success: true,
    data: {
      destinations: { meta },
      recent: (recent as { id: string; eventName: string; recordLabel: string; status: string; reason: string | null; createdAt: Date; sentAt: Date | null }[])
        .map((row) => ({
          id: row.id,
          platform: "meta",
          eventName: row.eventName,
          recordLabel: row.recordLabel,
          status: row.status,
          reason: row.reason,
          at: (row.sentAt ?? row.createdAt).toISOString(),
        })),
    },
  })
})
