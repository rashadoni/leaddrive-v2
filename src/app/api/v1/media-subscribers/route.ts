/**
 * R11 Media — subscriber roster / create (slice-2-mini).
 *
 * Sixteenth route-layer consumer. Media subscribers carry PII
 * (displayName + email + tier + billingRegion) — every read/write
 * audits via `recordPiiAccessFromRequest`.
 *
 * Status lifecycle (slice-1 `transitionSubscriber` helper):
 *   trial → active → paused → active (resume) | churned | banned
 *   churned → active (win-back) | banned
 *   banned — terminal
 *
 * trial is the default status; create auto-stamps `trialStartedAt =
 * now()` to satisfy DB CHECK `trial_coherence_check`.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { createNotification } from "@/lib/notifications"
import {
  encryptForTenantBound,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the
// single PII column — `displayName` (required). AAD binds to
// (orgId, media_subscribers, "displayName"). Email is NOT wrapped on
// R11 per the slice-2 design (lighter PII surface — no SSN/DOB; email
// may be needed by transactional channels). Soft-decrypt fallback in
// the helper handles slice-2 ciphertext + pre-wrap plaintext rows.
const TABLE = "media_subscribers"
const MAX_PAGE_SIZE = 200
const MAX_NAME_LEN = 200

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

export const GET = withRlsAuth("media", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const tierSlug = searchParams.get("tierSlug")
  const billingRegion = searchParams.get("billingRegion")
  const search = searchParams.get("search")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    tierSlug?: string
    billingRegion?: string
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }
  if (status) where.status = status
  if (tierSlug) where.tierSlug = tierSlug
  if (billingRegion) where.billingRegion = billingRegion
  // displayName is encrypted (slice-2 column wrap) — substring
  // search against ciphertext returns zero results. Slice-3 will add
  // a blind-index hash column. Until then search hits email +
  // subscriberNumber only.
  if (search && search.length >= 2) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { subscriberNumber: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const subscribers = await prisma.mediaSubscriber.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        subscriberNumber: true,
        contactId: true,
        userId: true,
        subscriptionId: true,
        displayName: true,
        email: true,
        tierSlug: true,
        billingRegion: true,
        status: true,
        trialStartedAt: true,
        activatedAt: true,
        churnedAt: true,
        lifetimeRevenueCents: true,
        createdAt: true,
      },
    })
    const hasMore = subscribers.length > limit
    const rows = hasMore ? subscribers.slice(0, limit) : subscribers
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        tierSlug: tierSlug ?? null,
        billingRegion: billingRegion ?? null,
        searchHit: search !== null && search.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({
      subscribers: rows.map((s: { lifetimeRevenueCents: bigint; displayName: string } & Record<string, unknown>) => ({
        ...s,
        displayName: softDecryptForTenantBound(orgId, TABLE, "displayName", s.displayName),
        lifetimeRevenueCents: s.lifetimeRevenueCents.toString(),
      })),
      hasMore,
      nextCursor,
    })
  } catch (err) {
    console.error("[media-subscribers] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load subscribers" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  subscriberNumber?: unknown
  displayName?: unknown
  email?: unknown
  tierSlug?: unknown
  billingRegion?: unknown
  contactId?: unknown
  userId?: unknown
  subscriptionId?: unknown
  preferences?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("media", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const subscriberNumber = trimOrNull(body.subscriberNumber, 64)
  if (!subscriberNumber) {
    return NextResponse.json(
      { error: "`subscriberNumber` is required" },
      { status: 400 },
    )
  }
  const displayName = trimOrNull(body.displayName, MAX_NAME_LEN)
  if (!displayName) {
    return NextResponse.json(
      { error: "`displayName` is required" },
      { status: 400 },
    )
  }

  const email = trimOrNull(body.email, MAX_NAME_LEN)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid `email`" },
      { status: 400 },
    )
  }

  let billingRegion: string | null = null
  if (body.billingRegion !== undefined && body.billingRegion !== null) {
    if (
      typeof body.billingRegion !== "string" ||
      !/^[A-Z]{2}$/.test(body.billingRegion.toUpperCase())
    ) {
      return NextResponse.json(
        {
          error: "`billingRegion` must be a 2-letter ISO 3166-1 alpha-2 code",
        },
        { status: 400 },
      )
    }
    billingRegion = body.billingRegion.toUpperCase()
  }

  if (
    body.preferences !== undefined &&
    body.preferences !== null &&
    (typeof body.preferences !== "object" || Array.isArray(body.preferences))
  ) {
    return NextResponse.json(
      { error: "Invalid `preferences` — must be plain object" },
      { status: 400 },
    )
  }
  if (
    body.metadata !== undefined &&
    body.metadata !== null &&
    (typeof body.metadata !== "object" || Array.isArray(body.metadata))
  ) {
    return NextResponse.json(
      { error: "Invalid `metadata` — must be plain object" },
      { status: 400 },
    )
  }

  try {
    const subscriber = await prisma.mediaSubscriber.create({
      data: {
        organizationId: orgId,
        subscriberNumber,
        // Slice-2 PII column wrap: displayName encrypted at the
        // route boundary.
        displayName: encryptForTenantBound(orgId, TABLE, "displayName", displayName),
        email,
        tierSlug: trimOrNull(body.tierSlug, 64) ?? "free",
        billingRegion,
        contactId: trimOrNull(body.contactId, 64),
        userId: trimOrNull(body.userId, 64),
        subscriptionId: trimOrNull(body.subscriptionId, 64),
        // Default status is `trial` — DB CHECK `trial_coherence_check`
        // requires `trialStartedAt NOT NULL` for that status. Auto-stamp
        // here so the row passes constraint validation immediately.
        trialStartedAt: new Date(),
        preferences: (body.preferences ?? {}) as Prisma.InputJsonValue,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        subscriberNumber: true,
        displayName: true,
        email: true,
        tierSlug: true,
        billingRegion: true,
        status: true,
        trialStartedAt: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: subscriber.id,
      action: "write",
      metadata: {
        subscriberNumber: subscriber.subscriberNumber,
        tierSlug: subscriber.tierSlug,
        billingRegion: subscriber.billingRegion,
      },
    })

    // Phase 2d notification — org-wide in-app only, PII-safe (no displayName/email in message).
    createNotification({
      organizationId: orgId,
      userId: "",
      type: "info",
      title: "New subscriber added",
      message: "A new media subscriber has been added",
      entityType: "media_subscriber",
      entityId: subscriber.id,
      kind: "subscriber.created",
    }).catch(() => {})

    return NextResponse.json(
      {
        subscriber: {
          ...subscriber,
          displayName: softDecryptForTenantBound(orgId, TABLE, "displayName", subscriber.displayName),
        },
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          {
            error:
              "A subscriber with this `subscriberNumber` already exists",
          },
          { status: 409 },
        )
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Invalid foreign key (`subscriptionId` / `contactId`)" },
          { status: 400 },
        )
      }
    }
    console.error("[media-subscribers] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create subscriber" },
      { status: 500 },
    )
  }
})
