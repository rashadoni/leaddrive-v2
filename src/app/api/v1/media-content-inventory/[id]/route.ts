/**
 * R11 Media — content inventory per-id (slice-2-mini).
 *
 * GET — single read + 404 audit.
 * PATCH — status transitions via `transitionContent` slice-1 helper.
 *   Auto-stamps publishedAt / unpublishedAt / archivedAt.
 *   `scheduled` requires caller to supply `scheduledAt`.
 *
 * Immutable on PATCH:
 *   • contentSlug — institutional id (canonical URL fragment)
 *   • contentKind — affects monetization rules + ad-placement
 *                    eligibility; not hot-swappable
 *
 * DELETE NOT exposed — content is referenced by consumption events
 * + ad placements; use `archived` status to retire.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { withRlsAuth } from "@/lib/with-rls"
import { transitionContent } from "@/lib/media/state-machine"
import {
  MONETIZATION_KINDS,
  type ContentStatus,
} from "@/lib/media/types"

const TABLE = "media_content_inventory"
const MAX_TITLE_LEN = 500

function strField(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseInt32(
  v: unknown,
): number | null | undefined | "invalid" {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v
  if (typeof v === "string") {
    if (!/^\d+$/.test(v.trim())) return "invalid"
    const n = Number(v.trim())
    if (!Number.isInteger(n) || n < 0) return "invalid"
    return n
  }
  return "invalid"
}

function parseStringArray(
  v: unknown,
  maxItems: number,
  maxItemLen: number,
): string[] | "invalid" | undefined {
  if (v === undefined) return undefined
  if (v === null) return []
  if (!Array.isArray(v)) return "invalid"
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== "string") return "invalid"
    const t = item.trim()
    if (!t) continue
    if (t.length > maxItemLen) return "invalid"
    out.push(t)
    if (out.length > maxItems) return "invalid"
  }
  return out
}

export const GET = withRlsAuth("media", "read", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing content id" }, { status: 400 })
  }

  try {
    const item = await prisma.mediaContentInventory.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!item) {
      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: id,
        action: "read",
        metadata: { result: "not_found" },
      })
      return NextResponse.json(
        { error: "Content item not found" },
        { status: 404 },
      )
    }

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: item.id,
      action: "read",
      metadata: {
        contentSlug: item.contentSlug,
        contentKind: item.contentKind,
        status: item.status,
        monetization: item.monetization,
      },
    })

    return NextResponse.json({ item })
  } catch (err) {
    console.error("[media-content-inventory/:id] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load content item" },
      { status: 500 },
    )
  }
})

interface PatchBody {
  title?: unknown
  byline?: unknown
  monetization?: unknown
  durationSeconds?: unknown
  wordCount?: unknown
  genreSlug?: unknown
  languageCode?: unknown
  licensedRegions?: unknown
  scheduledAt?: unknown
  status?: unknown
  metadata?: unknown
}

export const PATCH = withRlsAuth("media", "write", async (req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing content id" }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const existing = await prisma.mediaContentInventory.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      publishedAt: true,
      unpublishedAt: true,
      archivedAt: true,
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
      { error: "Content item not found" },
      { status: 404 },
    )
  }

  const data: {
    title?: string
    byline?: string | null
    monetization?: string
    durationSeconds?: number | null
    wordCount?: number | null
    genreSlug?: string | null
    languageCode?: string | null
    licensedRegions?: string[]
    scheduledAt?: Date | null
    status?: string
    publishedAt?: Date
    unpublishedAt?: Date
    archivedAt?: Date
    metadata?: unknown
  } = {}

  if (body.title !== undefined) {
    const v = strField(body.title, MAX_TITLE_LEN)
    if (v === null || v === undefined) {
      return NextResponse.json(
        { error: "`title` cannot be cleared once set" },
        { status: 400 },
      )
    }
    data.title = v
  }
  if (body.byline !== undefined) {
    const v = strField(body.byline, MAX_TITLE_LEN)
    if (v !== undefined) data.byline = v
  }
  if (body.monetization !== undefined) {
    if (
      typeof body.monetization !== "string" ||
      !(MONETIZATION_KINDS as readonly string[]).includes(body.monetization)
    ) {
      return NextResponse.json(
        {
          error: `Invalid \`monetization\` — must be one of: ${MONETIZATION_KINDS.join(", ")}`,
        },
        { status: 400 },
      )
    }
    data.monetization = body.monetization
  }
  if (body.durationSeconds !== undefined) {
    const n = parseInt32(body.durationSeconds)
    if (n === "invalid") {
      return NextResponse.json(
        { error: "Invalid `durationSeconds` (non-negative integer)" },
        { status: 400 },
      )
    }
    if (n !== undefined) data.durationSeconds = n
  }
  if (body.wordCount !== undefined) {
    const n = parseInt32(body.wordCount)
    if (n === "invalid") {
      return NextResponse.json(
        { error: "Invalid `wordCount` (non-negative integer)" },
        { status: 400 },
      )
    }
    if (n !== undefined) data.wordCount = n
  }
  if (body.genreSlug !== undefined) {
    const v = strField(body.genreSlug, 64)
    if (v !== undefined) data.genreSlug = v
  }
  if (body.languageCode !== undefined) {
    if (body.languageCode === null) {
      data.languageCode = null
    } else if (typeof body.languageCode === "string") {
      const lower = body.languageCode.toLowerCase()
      if (!/^[a-z]{2}$/.test(lower)) {
        return NextResponse.json(
          { error: "`languageCode` must be a 2-letter ISO 639-1 code" },
          { status: 400 },
        )
      }
      data.languageCode = lower
    } else {
      return NextResponse.json(
        { error: "Invalid `languageCode`" },
        { status: 400 },
      )
    }
  }
  if (body.licensedRegions !== undefined) {
    const arr = parseStringArray(body.licensedRegions, 64, 32)
    if (arr === "invalid") {
      return NextResponse.json(
        {
          error:
            "`licensedRegions` must be an array of strings (max 64 items, max 32 chars each)",
        },
        { status: 400 },
      )
    }
    if (arr !== undefined) data.licensedRegions = arr
  }

  // scheduledAt three-way.
  let nextScheduledAt: Date | null = existing.scheduledAt
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt === null) {
      data.scheduledAt = null
      nextScheduledAt = null
    } else if (typeof body.scheduledAt === "string") {
      const d = new Date(body.scheduledAt)
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Invalid `scheduledAt`" },
          { status: 400 },
        )
      }
      data.scheduledAt = d
      nextScheduledAt = d
    } else {
      return NextResponse.json(
        { error: "Invalid `scheduledAt`" },
        { status: 400 },
      )
    }
  }

  if (body.status !== undefined) {
    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "Invalid `status`" }, { status: 400 })
    }
    const result = transitionContent(existing.status, body.status)
    if (!result.ok) {
      return NextResponse.json(
        { error: `Illegal status transition: ${result.error}` },
        { status: 400 },
      )
    }

    // `scheduled` requires scheduledAt (DB CHECK).
    if (body.status === "scheduled" && !nextScheduledAt) {
      return NextResponse.json(
        {
          error:
            "`scheduledAt` must be set before transitioning to `scheduled`",
        },
        { status: 400 },
      )
    }

    data.status = body.status
    const now = new Date()
    // Forward-stamp on transition to published (also serves later
    // backfill for unpublished / archived because we only get to
    // those AFTER published per state machine).
    if (body.status === "published" && !existing.publishedAt) {
      data.publishedAt = now
    }
    if (body.status === "unpublished" && !existing.unpublishedAt) {
      data.unpublishedAt = now
    }
    if (body.status === "archived" && !existing.archivedAt) {
      data.archivedAt = now
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
    const item = await prisma.mediaContentInventory.update({
      where: { id },
      data,
      select: {
        id: true,
        contentSlug: true,
        contentKind: true,
        title: true,
        byline: true,
        status: true,
        monetization: true,
        durationSeconds: true,
        wordCount: true,
        genreSlug: true,
        languageCode: true,
        licensedRegions: true,
        scheduledAt: true,
        publishedAt: true,
        unpublishedAt: true,
        archivedAt: true,
        updatedAt: true,
      },
    })

    const AUTO_STAMP_KEYS = new Set([
      "publishedAt",
      "unpublishedAt",
      "archivedAt",
    ])
    const allFields = Object.keys(data)
    const bodyFields = allFields.filter((k) => !AUTO_STAMP_KEYS.has(k))
    const autoStampedFields = allFields.filter((k) => AUTO_STAMP_KEYS.has(k))

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: item.id,
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

    return NextResponse.json({ item })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A content item with this identifier already exists" },
        { status: 409 },
      )
    }
    console.error("[media-content-inventory/:id] PATCH error:", err)
    return NextResponse.json(
      { error: "Failed to update content item" },
      { status: 500 },
    )
  }
})
