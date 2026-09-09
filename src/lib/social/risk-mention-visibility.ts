import type { Prisma } from "@prisma/client"

const COMMENT_KINDS = ["COMMENT", "REPLY", "comment", "reply"]
const COMMENT_SOURCE_TYPES = ["comment", "reply", "COMMENT", "REPLY"]

/**
 * Brand-protection surfaces keep publications intact but expose a comment or
 * reply only after it has been classified as negative or neutral. This is a
 * fail-closed boundary for legacy null/unknown values; future positives and
 * unresolved comments are rejected or queued before SocialMention creation.
 */
export function riskRelevantMentionWhere(): Prisma.SocialMentionWhereInput {
  const commentLike: Prisma.SocialMentionWhereInput = {
    OR: [
      { contentKind: { in: COMMENT_KINDS } },
      { sourceType: { in: COMMENT_SOURCE_TYPES } },
    ],
  }
  return {
    OR: [
      {
        AND: [
          { contentKind: { notIn: COMMENT_KINDS } },
          { sourceType: { notIn: COMMENT_SOURCE_TYPES } },
        ],
      },
      {
        AND: [
          commentLike,
          { sentiment: { in: ["negative", "neutral"], mode: "insensitive" } },
        ],
      },
    ],
  }
}
