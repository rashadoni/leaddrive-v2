import type { Prisma } from "@prisma/client"

export type MentionSurface = "posts" | "comments" | "media" | "unknown"

const COMMENT_KINDS = ["COMMENT", "REPLY"]
const COMMENT_SOURCE_TYPES = ["comment", "reply"]
const POST_KINDS = ["POST", "MENTION", "ARTICLE"]
const POST_SOURCE_TYPES = ["post", "mention"]
const MEDIA_KINDS = ["VIDEO", "IMAGE", "AUDIO"]

const commentWhere: Prisma.SocialMentionWhereInput = {
  OR: [
    { contentKind: { in: COMMENT_KINDS } },
    { sourceType: { in: COMMENT_SOURCE_TYPES } },
  ],
}

const mediaEvidenceWhere: Prisma.SocialMentionWhereInput = {
  OR: [
    { contentKind: { in: MEDIA_KINDS } },
    { mediaObservations: { some: { purgedAt: null, mediaType: { in: MEDIA_KINDS } } } },
    {
      AND: [
        { platform: { in: ["youtube", "tiktok"] } },
        { contentKind: { notIn: COMMENT_KINDS } },
        { sourceType: { notIn: COMMENT_SOURCE_TYPES } },
      ],
    },
    {
      AND: [
        { platform: { in: ["facebook", "instagram"] } },
        {
          OR: [
            { url: { contains: "/reel" } },
            { url: { contains: "/videos/" } },
            { url: { contains: "/photos/" } },
            { canonicalUrl: { contains: "/reel" } },
            { canonicalUrl: { contains: "/videos/" } },
            { canonicalUrl: { contains: "/photos/" } },
            { sourceMetadata: { path: ["mediaType"], equals: "VIDEO" } },
            { sourceMetadata: { path: ["mediaType"], equals: "IMAGE" } },
            { sourceMetadata: { path: ["mediaType"], equals: "AUDIO" } },
          ],
        },
      ],
    },
  ],
}

const explicitPostWhere: Prisma.SocialMentionWhereInput = {
  AND: [
    { contentKind: "POST" },
    // Legacy YouTube/TikTok rows are video surfaces even when their provider
    // stamped a generic POST kind.
    { platform: { notIn: ["youtube", "tiktok"] } },
  ],
}

const mediaWhere: Prisma.SocialMentionWhereInput = {
  AND: [
    { NOT: commentWhere },
    { NOT: explicitPostWhere },
    mediaEvidenceWhere,
  ],
}

const postWhere: Prisma.SocialMentionWhereInput = {
  AND: [
    {
      OR: [
        // A normalized content kind is authoritative. Keeping this explicit
        // branch outside the legacy media negation also avoids PostgreSQL's
        // three-valued NULL result when an older Meta row has no mediaType
        // JSON key. Those rows are ordinary posts, not an uncounted gap.
        explicitPostWhere,
        {
          AND: [
            {
              OR: [
                { contentKind: { in: POST_KINDS.filter(kind => kind !== "POST") } },
                { sourceType: { in: POST_SOURCE_TYPES } },
              ],
            },
            { NOT: mediaEvidenceWhere },
          ],
        },
      ],
    },
    { NOT: commentWhere },
  ],
}

const unknownWhere: Prisma.SocialMentionWhereInput = {
  AND: [
    { NOT: commentWhere },
    { NOT: mediaEvidenceWhere },
    { NOT: postWhere },
  ],
}

export function socialMentionSurfaceWhere(surface: MentionSurface): Prisma.SocialMentionWhereInput {
  if (surface === "comments") return commentWhere
  if (surface === "media") return mediaWhere
  if (surface === "posts") return postWhere
  return unknownWhere
}
