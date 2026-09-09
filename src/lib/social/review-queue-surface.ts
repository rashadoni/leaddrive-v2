import type { Prisma } from "@prisma/client"

export type ReviewQueueSurface = "posts" | "comments" | "media" | "unknown"

export type ReviewQueueSurfaceCounts = {
  all: number
  posts: number
  comments: number
  media: number
  unknown: number
}

const POST_KINDS = new Set(["POST", "MENTION"])
const COMMENT_KINDS = new Set(["COMMENT", "REPLY"])
const MEDIA_KINDS = new Set(["VIDEO", "IMAGE", "AUDIO"])
const VIDEO_PLATFORMS = ["youtube", "tiktok", "YOUTUBE", "TIKTOK"]

const commentWhere: Prisma.IngestEnvelopeWhereInput = {
  contentKind: { in: [...COMMENT_KINDS] },
}

const mediaEvidenceWhere: Prisma.IngestEnvelopeWhereInput = {
  OR: [
    { contentKind: { in: [...MEDIA_KINDS] } },
    {
      AND: [
        { platform: { in: VIDEO_PLATFORMS } },
        { contentKind: { notIn: [...COMMENT_KINDS] } },
      ],
    },
    {
      AND: [
        { platform: { in: ["facebook", "instagram", "FACEBOOK", "INSTAGRAM"] } },
        {
          OR: [
            { url: { contains: "/reel", mode: "insensitive" } },
            { url: { contains: "/videos/", mode: "insensitive" } },
            { url: { contains: "/photos/", mode: "insensitive" } },
            { canonicalUrl: { contains: "/reel", mode: "insensitive" } },
            { canonicalUrl: { contains: "/videos/", mode: "insensitive" } },
            { canonicalUrl: { contains: "/photos/", mode: "insensitive" } },
          ],
        },
      ],
    },
  ],
}

const mediaWhere: Prisma.IngestEnvelopeWhereInput = {
  AND: [
    { NOT: commentWhere },
    mediaEvidenceWhere,
  ],
}

const postWhere: Prisma.IngestEnvelopeWhereInput = {
  AND: [
    { contentKind: { in: [...POST_KINDS] } },
    { NOT: commentWhere },
    { NOT: mediaEvidenceWhere },
  ],
}

const unknownWhere: Prisma.IngestEnvelopeWhereInput = {
  AND: [
    { NOT: commentWhere },
    { NOT: mediaWhere },
    { NOT: postWhere },
  ],
}

export function reviewQueueSurfaceForContentKind(
  contentKind: unknown,
  platform?: unknown,
): ReviewQueueSurface {
  return reviewQueueSurfaceForEnvelope({ contentKind, platform })
}

export function reviewQueueSurfaceForEnvelope(envelope: {
  contentKind: unknown
  platform?: unknown
  url?: unknown
  canonicalUrl?: unknown
}): ReviewQueueSurface {
  const { contentKind, platform } = envelope
  const normalized = typeof contentKind === "string" ? contentKind.trim().toUpperCase() : ""
  const normalizedPlatform = typeof platform === "string" ? platform.trim().toLowerCase() : ""
  const urls = [envelope.url, envelope.canonicalUrl]
    .filter((value): value is string => typeof value === "string")
    .map(value => value.toLowerCase())
  const metaMediaEvidence = ["facebook", "instagram"].includes(normalizedPlatform)
    && urls.some(value => value.includes("/reel") || value.includes("/videos/") || value.includes("/photos/"))
  if (!COMMENT_KINDS.has(normalized) && ["youtube", "tiktok"].includes(normalizedPlatform)) return "media"
  if (!COMMENT_KINDS.has(normalized) && metaMediaEvidence) return "media"
  if (POST_KINDS.has(normalized)) return "posts"
  if (COMMENT_KINDS.has(normalized)) return "comments"
  if (MEDIA_KINDS.has(normalized)) return "media"
  return "unknown"
}

export function reviewQueueSurfaceCounts(
  rows: Array<{ contentKind: unknown; platform?: unknown; _count: number | { _all?: number } }>,
): ReviewQueueSurfaceCounts {
  const result: ReviewQueueSurfaceCounts = {
    all: 0,
    posts: 0,
    comments: 0,
    media: 0,
    unknown: 0,
  }
  for (const row of rows) {
    const count = typeof row._count === "number" ? row._count : row._count._all ?? 0
    const surface = reviewQueueSurfaceForContentKind(row.contentKind, row.platform)
    result[surface] += count
    result.all += count
  }
  return result
}

export function reviewQueueContentKindsForSurface(surface: ReviewQueueSurface): string[] | null {
  if (surface === "posts") return [...POST_KINDS]
  if (surface === "comments") return [...COMMENT_KINDS]
  if (surface === "media") return [...MEDIA_KINDS]
  return null
}

export function knownReviewQueueContentKinds(): string[] {
  return [...POST_KINDS, ...COMMENT_KINDS, ...MEDIA_KINDS]
}

export function reviewQueueSurfaceWhere(surface: ReviewQueueSurface): Prisma.IngestEnvelopeWhereInput {
  if (surface === "comments") return commentWhere
  if (surface === "media") return mediaWhere
  if (surface === "posts") return postWhere
  return unknownWhere
}
