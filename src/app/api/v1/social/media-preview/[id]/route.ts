import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { loadOrCacheSocialMediaPreview } from "@/lib/social/media-preview-cache"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("social", "read", async (
  _req: NextRequest,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const withinUserLimit = checkRateLimit(`social-media-preview:user:${auth.userId}`, {
    maxRequests: 30,
    windowMs: 60_000,
  })
  if (!withinUserLimit) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  const withinOrganizationLimit = checkRateLimit(`social-media-preview:organization:${auth.orgId}`, {
    maxRequests: 120,
    windowMs: 60_000,
  })
  if (!withinOrganizationLimit) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  const { id } = await params
  const now = new Date()
  const observation = await prisma.mediaObservation.findFirst({
    where: {
      id,
      organizationId: auth.orgId,
      purgedAt: null,
      purgeAt: { gt: now },
    },
    select: { id: true, thumbnailUrl: true, sourceUrl: true, mediaType: true },
  })
  if (!observation) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const sourceUrl = observation.thumbnailUrl || (observation.mediaType === "IMAGE" ? observation.sourceUrl : null)
  if (!sourceUrl) return NextResponse.json({ error: "Preview unavailable" }, { status: 404 })

  try {
    const preview = await loadOrCacheSocialMediaPreview({
      organizationId: auth.orgId,
      observationId: observation.id,
      sourceUrl,
      isCurrent: async () => Boolean(await prisma.mediaObservation.findFirst({
        where: {
          id: observation.id,
          organizationId: auth.orgId,
          purgedAt: null,
          purgeAt: { gt: new Date() },
        },
        select: { id: true },
      })),
    })
    return new NextResponse(new Uint8Array(preview.bytes), {
      headers: {
        "Content-Type": preview.mime,
        "Content-Length": String(preview.bytes.length),
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.warn("[social-media-preview] preview unavailable", {
      observationId: observation.id,
      error: error instanceof Error ? error.message : "unknown",
    })
    return NextResponse.json({ error: "Preview unavailable" }, { status: 502 })
  }
})
