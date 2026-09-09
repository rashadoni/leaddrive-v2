export type MentionSurfaceCounts = {
  all: number
  posts: number
  comments: number
  media: number
  unknown: number
}

export type CombinedMentionSurfaceCounts = MentionSurfaceCounts

export function mentionSurfaceCounts(
  bySourceType: Record<string, number> | null | undefined,
  withMedia: number | null | undefined,
  bySurface?: Partial<MentionSurfaceCounts> | null,
): MentionSurfaceCounts {
  if (bySurface) {
    return {
      all: bySurface.all ?? 0,
      posts: bySurface.posts ?? 0,
      comments: bySurface.comments ?? 0,
      media: bySurface.media ?? 0,
      unknown: bySurface.unknown ?? 0,
    }
  }
  const counts = bySourceType ?? {}
  const posts = (counts.post ?? 0) + (counts.mention ?? 0)
  const comments = (counts.comment ?? 0) + (counts.reply ?? 0)
  const media = withMedia ?? 0

  // Compatibility for older API responses. New responses provide disjoint
  // bySurface counts so media never appears in Posts as well.
  return { all: posts + comments + media, posts, comments, media, unknown: 0 }
}

export function combineMentionAndReviewSurfaceCounts(
  accepted: MentionSurfaceCounts,
  review: { all: number; posts: number; comments: number; media: number; unknown: number },
): CombinedMentionSurfaceCounts {
  return {
    all: accepted.all + review.all,
    posts: accepted.posts + review.posts,
    comments: accepted.comments + review.comments,
    media: accepted.media + review.media,
    unknown: accepted.unknown + review.unknown,
  }
}
