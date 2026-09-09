/**
 * C1 (Creatio 10X roadmap) — web-tracking snippet settings.
 *
 * GET  /api/v1/settings/web-tracking  — config incl. publicKey (created lazily
 *                                       on first read so the UI can always show
 *                                       a copy-paste-ready snippet).
 * PUT  /api/v1/settings/web-tracking  — enabled / allowedOrigins / retentionDays
 *                                       (settings:write — admin surface).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { z } from "zod"
import { generateTrackingKey } from "@/lib/web-tracking"

const putSchema = z.object({
  enabled: z.boolean(),
  // Origins are normalized client-side to scheme://host[:port]; server just bounds them.
  allowedOrigins: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  retentionDays: z.number().int().min(1).max(3650).default(180),
})

// Upsert, not find-then-create: React StrictMode double-mounts the settings
// card, so two concurrent first GETs would otherwise race the organizationId
// unique constraint into a 500.
async function ensureConfig(orgId: string) {
  return prisma.webTrackingConfig.upsert({
    where: { organizationId: orgId },
    update: {},
    create: { organizationId: orgId, publicKey: generateTrackingKey() },
  })
}

export const GET = withRls(async (_req, { orgId }) => {
  const config = await ensureConfig(orgId)
  return NextResponse.json({
    success: true,
    data: {
      enabled: config.enabled,
      publicKey: config.publicKey,
      allowedOrigins: config.allowedOrigins,
      retentionDays: config.retentionDays,
    },
  })
})

export const PUT = withRlsAuth("settings", "write", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId
  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400 },
    )
  }
  const updated = await prisma.webTrackingConfig.upsert({
    where: { organizationId: orgId },
    update: {
      enabled: parsed.data.enabled,
      allowedOrigins: parsed.data.allowedOrigins,
      retentionDays: parsed.data.retentionDays,
    },
    create: {
      organizationId: orgId,
      publicKey: generateTrackingKey(),
      enabled: parsed.data.enabled,
      allowedOrigins: parsed.data.allowedOrigins,
      retentionDays: parsed.data.retentionDays,
    },
  })
  return NextResponse.json({
    success: true,
    data: {
      enabled: updated.enabled,
      publicKey: updated.publicKey,
      allowedOrigins: updated.allowedOrigins,
      retentionDays: updated.retentionDays,
    },
  })
})
