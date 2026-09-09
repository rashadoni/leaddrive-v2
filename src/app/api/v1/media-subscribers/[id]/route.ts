/**
 * R11 Media — subscriber per-id (slice-2-mini).
 *
 * GET — single read + 404 audit (PII).
 * PATCH — status transitions via `transitionSubscriber` slice-1 helper.
 *   Auto-stamps activatedAt / pausedAt / churnedAt / bannedAt; ban
 *   requires `banReason` (DB CHECK `banned_coherence_check`).
 *
 * Immutable on PATCH:
 *   • subscriberNumber — institutional id
 *
 * DELETE NOT exposed — subscribers are referenced by consumption
 * events; use `status: churned` or `status: banned` to retire.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { transitionSubscriber } from "@/lib/media/state-machine"
import { type SubscriberStatus } from "@/lib/media/types"
import {
  encryptForTenantBound,
  softDecryptForTenantBound,
} from "@/lib/crypto/tenant-pii-encryption"

// Phase 7 slice-3 migration (2026-05-29): column-bound AAD on the
// single PII column — `displayName` (required). See `route.ts`
// header for rationale + email-not-wrapped note.
const TABLE = "media_subscribers"
const MAX_NAME_LEN = 200

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

const STATUS_RANK: Record<SubscriberStatus, number> = {
  trial: 0,
  active: 1,
  paused: 2,
  churned: 3,
  banned: 4,
}

export const GET = withRlsAuth("media", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing subscriber id" },
      { status: 400 },
    )
  }

  try {
    const subscriber = await prisma.mediaSubscriber.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!subscriber) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Subscriber not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: subscriber.id,
      action: "read",
      metadata: {
        subscriberNumber: subscriber.subscriberNumber,
        status: subscriber.status,
        tierSlug: subscriber.tierSlug,
        billingRegion: subscriber.billingRegion,
      },
    })

    return NextResponse.json({
      subscriber: {
        ...subscriber,
        displayName: softDecryptForTenantBound(orgId, TABLE, "displayName", subscriber.displayName),
        lifetimeRevenueCents: subscriber.lifetimeRevenueCents.toString(),
      },
    })
  } catch (err) {
    console.error("[media-subscribers/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load subscriber" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  displayName?: unknown
  email?: unknown
  tierSlug?: unknown
  billingRegion?: unknown
  contactId?: unknown
  userId?: unknown
  subscriptionId?: unknown
  preferences?: unknown
  status?: unknown
  banReason?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("media", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json(
      { error: "Missing subscriber id" },
      { status: 400 },
    )
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.mediaSubscriber.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      activatedAt: true,
      pausedAt: true,
      churnedAt: true,
      bannedAt: true,
      banReason: true,
    },
  })
  if (!existing) {
    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: id,
      action: "write",
      metadata: { result: "not_found" },
    })
    return NextResponse.json(
      { error: "Subscriber not found" },
      { status: 404 },
    )
  }

  const data: {
    displayName?: string
    email?: string | null
    tierSlug?: string
    billingRegion?: string | null
    contactId?: string | null
    userId?: string | null
    subscriptionId?: string | null
    preferences?: unknown
    status?: string
    banReason?: string | null
    activatedAt?: Date
    pausedAt?: Date
    churnedAt?: Date
    bannedAt?: Date
    metadata?: unknown
  } = {}

  if (body.displayName !== undefined) {
    const v = strField(body.displayName, MAX_NAME_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`displayName` cannot be cleared once set" },
        { status: 400 },
      )
    }
    // Slice-2 PII column wrap: encrypt displayName before persisting.
    data.displayName = encryptForTenantBound(orgId, TABLE, "displayName", v)
  }
  if (body.email !== undefined) {
    const v = strField(body.email, MAX_NAME_LEN)
    if (v !== undefined) {
      if (v !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return NextResponse.json(
          { error: "Invalid `email`" },
          { status: 400 },
        )
      }
      data.email = v
    }
  }
  if (body.tierSlug !== undefined) {
    const v = strField(body.tierSlug, 64)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`tierSlug` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.tierSlug = v
  }
  if (body.billingRegion !== undefined) {
    if (body.billingRegion === null) {
      data.billingRegion = null
    } else if (typeof body.billingRegion === "string") {
      const upper = body.billingRegion.toUpperCase()
      if (!/^[A-Z]{2}$/.test(upper)) {
        return NextResponse.json(
          {
            error:
              "`billingRegion` must be a 2-letter ISO 3166-1 alpha-2 code",
          },
          { status: 400 },
        )
      }
      data.billingRegion = upper
    } else {
      return NextResponse.json(
        { error: "Invalid `billingRegion`" },
        { status: 400 },
      )
    }
  }
  if (body.contactId !== undefined) {
    const v = strField(body.contactId, 64)
    if (v !== undefined) data.contactId = v
  }
  if (body.userId !== undefined) {
    const v = strField(body.userId, 64)
    if (v !== undefined) data.userId = v
  }
  if (body.subscriptionId !== undefined) {
    const v = strField(body.subscriptionId, 64)
    if (v !== undefined) data.subscriptionId = v
  }

  if (body.preferences !== undefined) {
    if (
      body.preferences !== null &&
      (typeof body.preferences !== "object" || Array.isArray(body.preferences))
    ) {
      return NextResponse.json(
        { error: "Invalid `preferences` — must be plain object or null" },
        { status: 400 },
      )
    }
    data.preferences = body.preferences ?? {}
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionSubscriber(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }

    // Banning requires banReason.
    if (body.status === "banned") {
      const reason = strField(body.banReason, 1000) ?? existing.banReason
      if (!reason) {
        return NextResponse.json(
          {
            error:
              "`banReason` (non-empty string) is required when transitioning to `banned`",
          },
          { status: 400 },
        )
      }
      const supplied = strField(body.banReason, 1000)
      if (supplied) data.banReason = supplied
    }

    data.status = body.status
    const now = new Date()
    const target = body.status as SubscriberStatus

    // Forward-stamp backfill. active/paused/churned all need
    // `activatedAt` per `active_coherence_check` — even if status
    // skipped directly from `trial` to `churned`.
    if (
      STATUS_RANK[target] >= STATUS_RANK.active &&
      STATUS_RANK[target] <= STATUS_RANK.churned &&
      !existing.activatedAt
    ) {
      data.activatedAt = now
    }
    if (body.status === "paused" && !existing.pausedAt) {
      data.pausedAt = now
    }
    if (body.status === "churned" && !existing.churnedAt) {
      data.churnedAt = now
    }
    if (body.status === "banned" && !existing.bannedAt) {
      data.bannedAt = now
    }
  }

  if (body.metadata !== undefined) {
    if (
      body.metadata !== null &&
      (typeof body.metadata !== "object" || Array.isArray(body.metadata))
    ) {
      return NextResponse.json(
        { error: "Invalid `metadata` — must be plain object or null" },
        { status: 400 },
      )
    }
    data.metadata = body.metadata ?? {}
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    )
  }

  try {
    const subscriber = await prisma.mediaSubscriber.update({
      where: { id },
      data,
      select: {
        id: true,
        subscriberNumber: true,
        displayName: true,
        email: true,
        tierSlug: true,
        billingRegion: true,
        status: true,
        trialStartedAt: true,
        activatedAt: true,
        pausedAt: true,
        churnedAt: true,
        bannedAt: true,
        banReason: true,
        lifetimeRevenueCents: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "activatedAt",
      "pausedAt",
      "churnedAt",
      "bannedAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter((k) => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter((k) => AUTO_STAMP_KEYS.has(k))

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: subscriber.id,
      action: "write",
      metadata: {
        bodyFields,
        autoStampedFields:
          autoStampedFields.length > 0 ? autoStampedFields : undefined,
        statusChange:
          body.status !== undefined
            ? `${existing.status}→${body.status}`
            : undefined,
      },
    })

    return NextResponse.json({
      subscriber: {
        ...subscriber,
        displayName: softDecryptForTenantBound(orgId, TABLE, "displayName", subscriber.displayName),
        lifetimeRevenueCents: subscriber.lifetimeRevenueCents.toString(),
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        return NextResponse.json(
          {
            error: "Invalid foreign key (`subscriptionId` / `contactId`)",
          },
          { status: 400 },
        )
      }
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: "A subscriber with this identifier already exists" },
          { status: 409 },
        )
      }
    }
    console.error("[media-subscribers/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update subscriber" },
      { status: 500 },
    )
  }
})
