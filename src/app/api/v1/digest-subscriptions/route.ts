import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/constants"
import { prisma } from "@/lib/prisma"
import {
  DIGEST_TYPES,
  DIGEST_FREQUENCIES,
  DIGEST_CHANNELS,
  type DigestType,
  type DigestFrequency,
  type DigestChannel,
} from "@/lib/digest/subscriptions"

// GET /api/v1/digest-subscriptions
// Returns a matrix of users × digest types with current settings.
// Shape is designed to hydrate the settings UI directly.
export const GET = withRlsAuth("core", "read", async (_req, auth) => {
  const users = await prisma.user.findMany({
    where: { organizationId: auth.orgId, isActive: true },
    select: { id: true, name: true, email: true, role: true, preferredLanguage: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  })

  const subs = await prisma.digestSubscription.findMany({
    where: { organizationId: auth.orgId },
  })

  const byKey = new Map<string, typeof subs[number]>()
  for (const s of subs) byKey.set(`${s.userId}:${s.type}`, s)

  // Default values follow the legacy rule so the UI looks sensible even
  // for brand-new orgs without any saved subscriptions yet.
  const data = users.map((u: (typeof users)[number]) => ({
    user: u,
    subscriptions: DIGEST_TYPES.map((type) => {
      const existing = byKey.get(`${u.id}:${type}`)
      if (existing) {
        return {
          type,
          frequency: existing.frequency as DigestFrequency,
          channels: existing.channels as DigestChannel[],
          isActive: existing.isActive,
          lastSentAt: existing.lastSentAt,
          configured: true,
        }
      }
      // Legacy default: admin/manager → daily via email+in_app; others → off
      const isDefaultRecipient = u.role === "admin" || u.role === "manager"
      return {
        type,
        frequency: (isDefaultRecipient ? "daily" : "off") as DigestFrequency,
        channels: ["email", "in_app"] as DigestChannel[],
        isActive: true,
        lastSentAt: null,
        configured: false,
      }
    }),
  }))

  return NextResponse.json({
    success: true,
    data: {
      users: data,
      types: DIGEST_TYPES,
      frequencies: DIGEST_FREQUENCIES,
      channels: DIGEST_CHANNELS,
    },
  })
})

// PUT /api/v1/digest-subscriptions
// Bulk upsert. Body: { subscriptions: [{ userId, type, frequency, channels, isActive }] }
export const PUT = withRlsAuth("core", "write", async (req, auth) => {
  if (!isAdmin(auth.role)) {
    return NextResponse.json(
      { success: false, error: "Only admins can edit digest subscriptions" },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => ({})) as {
    subscriptions?: Array<{
      userId: string
      type: DigestType
      frequency: DigestFrequency
      channels: DigestChannel[]
      isActive?: boolean
    }>
  }
  const rows = body.subscriptions
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { success: false, error: "subscriptions array required" },
      { status: 400 },
    )
  }

  // Validate + restrict to org users
  const userIds = Array.from(new Set(rows.map((r) => r.userId)))
  const validUsers = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: auth.orgId },
    select: { id: true },
  })
  const validIds = new Set(validUsers.map((u: (typeof validUsers)[number]) => u.id))

  let upserted = 0
  for (const row of rows) {
    if (!validIds.has(row.userId)) continue
    if (!DIGEST_TYPES.includes(row.type)) continue
    if (!DIGEST_FREQUENCIES.includes(row.frequency)) continue
    const cleanChannels = (row.channels || []).filter((c) =>
      DIGEST_CHANNELS.includes(c),
    )

    await prisma.digestSubscription.upsert({
      where: {
        organizationId_userId_type: {
          organizationId: auth.orgId,
          userId: row.userId,
          type: row.type,
        },
      },
      create: {
        organizationId: auth.orgId,
        userId: row.userId,
        type: row.type,
        frequency: row.frequency,
        channels: cleanChannels,
        isActive: row.isActive ?? true,
      },
      update: {
        frequency: row.frequency,
        channels: cleanChannels,
        isActive: row.isActive ?? true,
      },
    })
    upserted++
  }

  return NextResponse.json({ success: true, upserted })
})
