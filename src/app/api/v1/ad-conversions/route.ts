/**
 * Settings → «Reklam konversiyaları»: the Meta and GA4 destinations and the
 * latest events of both (sent, waiting, skipped with the reason, failed with
 * the platform's words).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { destinationView } from "@/lib/ad-conversions/destination"

export const GET = withRlsAuth("settings", "read", async (_req, { orgId }) => {
  const [meta, ga4, recent] = await Promise.all([
    destinationView(orgId, "meta"),
    destinationView(orgId, "ga4"),
    prisma.adConversionEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, eventName: true, recordLabel: true, status: true, reason: true, createdAt: true, sentAt: true, destination: { select: { platform: true } } },
    }),
  ])
  return NextResponse.json({
    success: true,
    data: {
      destinations: { meta, ga4 },
      recent: (recent as { id: string; eventName: string; recordLabel: string; status: string; reason: string | null; createdAt: Date; sentAt: Date | null; destination: { platform: string } }[])
        .map((row) => ({
          id: row.id,
          platform: row.destination.platform,
          eventName: row.eventName,
          recordLabel: row.recordLabel,
          status: row.status,
          reason: row.reason,
          at: (row.sentAt ?? row.createdAt).toISOString(),
        })),
    },
  })
})
