/**
 * R11 Media — content inventory roster / create (slice-2-mini).
 *
 * Seventeenth route-layer consumer. Content rows are editorial
 * inventory — not PII per se, but route audits ride on `media` module
 * permissions and we log via `recordPiiAccessFromRequest` for parity
 * with subscribers (same compliance posture: who read what).
 *
 * Status lifecycle (slice-1 `transitionContent` helper):
 *   draft → scheduled | published
 *   scheduled → published | draft (un-schedule)
 *   published → unpublished | archived
 *   unpublished → published (re-publish) | archived
 *   archived — terminal
 *
 * scheduledAt required when transitioning to `scheduled` (caller
 * supplies it, then DB CHECK passes).
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import {
  CONTENT_KINDS,
  MONETIZATION_KINDS,
} from "@/lib/media/types"

const TABLE = "media_content_inventory"
const MAX_PAGE_SIZE = 200
const MAX_TITLE_LEN = 500

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

function parseInt32(v: unknown): number | null | "invalid" {
  if (v === undefined || v === null) return null
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
): string[] | "invalid" {
  if (v === undefined || v === null) return []
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

export const GET = withRlsAuth("media", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const contentKind = searchParams.get("contentKind")
  const monetization = searchParams.get("monetization")
  const genreSlug = searchParams.get("genreSlug")
  const languageCode = searchParams.get("languageCode")
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
    contentKind?: string
    monetization?: string
    genreSlug?: string
    languageCode?: string
    OR?: Array<Record<string, { contains: string; mode: "insensitive" }>>
  } = { organizationId: orgId }
  if (status) where.status = status
  if (contentKind) where.contentKind = contentKind
  if (monetization) where.monetization = monetization
  if (genreSlug) where.genreSlug = genreSlug
  if (languageCode) where.languageCode = languageCode
  if (search && search.length >= 2) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { contentSlug: { contains: search, mode: "insensitive" } },
      { byline: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const items = await prisma.mediaContentInventory.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
        scheduledAt: true,
        publishedAt: true,
        archivedAt: true,
        createdAt: true,
      },
    })
    const hasMore = items.length > limit
    const rows = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        contentKind: contentKind ?? null,
        monetization: monetization ?? null,
        genreSlug: genreSlug ?? null,
        languageCode: languageCode ?? null,
        searchHit: search !== null && search.length >= 2,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ items: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[media-content-inventory] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load content inventory" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  contentSlug?: unknown
  contentKind?: unknown
  title?: unknown
  byline?: unknown
  monetization?: unknown
  durationSeconds?: unknown
  wordCount?: unknown
  genreSlug?: unknown
  languageCode?: unknown
  licensedRegions?: unknown
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

  const contentSlug = trimOrNull(body.contentSlug, 200)
  if (!contentSlug) {
    return NextResponse.json(
      { error: "`contentSlug` is required" },
      { status: 400 },
    )
  }
  if (
    typeof body.contentKind !== "string" ||
    !(CONTENT_KINDS as readonly string[]).includes(body.contentKind)
  ) {
    return NextResponse.json(
      {
        error: `\`contentKind\` is required and must be one of: ${CONTENT_KINDS.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const contentKind = body.contentKind
  const title = trimOrNull(body.title, MAX_TITLE_LEN)
  if (!title) {
    return NextResponse.json(
      { error: "`title` is required" },
      { status: 400 },
    )
  }

  let monetization: string = "free"
  if (body.monetization !== undefined && body.monetization !== null) {
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
    monetization = body.monetization
  }

  const durationSeconds = parseInt32(body.durationSeconds)
  if (durationSeconds === "invalid") {
    return NextResponse.json(
      { error: "Invalid `durationSeconds` (non-negative integer)" },
      { status: 400 },
    )
  }
  const wordCount = parseInt32(body.wordCount)
  if (wordCount === "invalid") {
    return NextResponse.json(
      { error: "Invalid `wordCount` (non-negative integer)" },
      { status: 400 },
    )
  }

  let languageCode: string | null = null
  if (body.languageCode !== undefined && body.languageCode !== null) {
    if (
      typeof body.languageCode !== "string" ||
      !/^[a-z]{2}$/.test(body.languageCode.toLowerCase())
    ) {
      return NextResponse.json(
        { error: "`languageCode` must be a 2-letter ISO 639-1 code" },
        { status: 400 },
      )
    }
    languageCode = body.languageCode.toLowerCase()
  }

  const licensedRegions = parseStringArray(body.licensedRegions, 64, 32)
  if (licensedRegions === "invalid") {
    return NextResponse.json(
      {
        error:
          "`licensedRegions` must be an array of strings (max 64 items, max 32 chars each)",
      },
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
    const item = await prisma.mediaContentInventory.create({
      data: {
        organizationId: orgId,
        contentSlug,
        contentKind,
        title,
        byline: trimOrNull(body.byline, MAX_TITLE_LEN),
        monetization,
        durationSeconds,
        wordCount,
        genreSlug: trimOrNull(body.genreSlug, 64),
        languageCode,
        licensedRegions,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        contentSlug: true,
        contentKind: true,
        title: true,
        status: true,
        monetization: true,
        createdAt: true,
      },
    })

    void recordPiiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: item.id,
      action: "write",
      metadata: {
        contentSlug: item.contentSlug,
        contentKind: item.contentKind,
        monetization: item.monetization,
      },
    })

    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error:
            "A content item with this `contentSlug` already exists",
        },
        { status: 409 },
      )
    }
    console.error("[media-content-inventory] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create content item" },
      { status: 500 },
    )
  }
})
