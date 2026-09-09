import { prisma } from "@/lib/prisma"
import type { ParentMatchContext } from "@/lib/social/ingest-mention"
import { canonicalProviderUrl } from "@/lib/social/provider-capability-contract"
import { isCondolencePost } from "@/lib/social/condolence-post-signal"

// These parameters identify a comment/share traversal, not the publication
// itself. Keep identity-bearing parameters such as Facebook's `id` and
// `story_fbid`; collapsing those would attach a comment to the wrong post.
const PARENT_NON_IDENTITY_PARAMETERS = new Set([
  "__cft__",
  "__tn__",
  "_r",
  "comment_id",
  "comment_tracking",
  "igsh",
  "is_copy_url",
  "is_from_webapp",
  "mibextid",
  "notif_id",
  "notif_t",
  "reply_comment_id",
  "sender_device",
  "sender_web_id",
  "tt_from",
])

function canonicalParentUrl(platform: string, value: string): string {
  const canonical = canonicalProviderUrl(value)
  try {
    const url = new URL(canonical)
    if (platform.toLowerCase() === "facebook" && url.hostname === "m.facebook.com") {
      url.hostname = "facebook.com"
    }
    for (const parameter of Array.from(url.searchParams.keys())) {
      if (PARENT_NON_IDENTITY_PARAMETERS.has(parameter.toLowerCase())) {
        url.searchParams.delete(parameter)
      }
    }
    return canonicalProviderUrl(url.toString())
  } catch {
    return canonical
  }
}

function parentUrlAliases(platform: string, value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  return Array.from(new Set([
    trimmed,
    canonicalProviderUrl(trimmed),
    canonicalParentUrl(platform, trimmed),
  ]))
}

/**
 * Resolve already-ingested parent publications for comment relevance.
 * A parent contributes brand context when it has a MATCHED subject link or
 * when the same subject rejected the publication only because its author is
 * an official brand account. The latter keeps the owned publication out of
 * external findings while still allowing its comments to be reviewed.
 * Its matched term is retained for audit, but is not sufficient for inheritance
 * because downstream relevance is evaluated against a concrete subject id.
 * A non-deleted, non-purged negative parent additionally authorizes complete
 * comment/reply capture only for its durable MATCHED subject ids.
 */
export async function parentMatchContextsForComments(
  organizationId: string,
  platform: string,
  urls: string[],
  parentExternalIds: string[] = [],
): Promise<Map<string, ParentMatchContext>> {
  const contexts = new Map<string, ParentMatchContext>()
  const requested = Array.from(new Set(urls.map(url => url.trim()).filter(Boolean)))
  const requestedIds = Array.from(new Set(parentExternalIds.map(id => id.trim()).filter(Boolean)))
  const requestedAliasesByIdentity = new Map<string, Set<string>>()
  for (const url of requested) {
    const identity = canonicalParentUrl(platform, url)
    const aliases = requestedAliasesByIdentity.get(identity) ?? new Set<string>()
    for (const alias of parentUrlAliases(platform, url)) aliases.add(alias)
    requestedAliasesByIdentity.set(identity, aliases)
  }
  const wanted = Array.from(new Set(requested.flatMap(url => parentUrlAliases(platform, url))))
  if (wanted.length === 0 && requestedIds.length === 0) return contexts

  const usable = (context: ParentMatchContext) => context.subjectIds.length > 0
  const sortedUnique = (values: string[] | undefined): string[] => (
    Array.from(new Set(values ?? [])).sort()
  )
  const preferredContext = (
    left: ParentMatchContext,
    right: ParentMatchContext,
  ): ParentMatchContext => {
    const score = (context: ParentMatchContext): [number, number, number, string] => [
      context.inheritAllCommentSubjectIds?.length ? 1 : 0,
      context.parentSentiment?.trim().toLowerCase() === "negative" ? 1 : 0,
      context.subjectIds.length,
      context.parentMentionId ?? "",
    ]
    const leftScore = score(left)
    const rightScore = score(right)
    for (let index = 0; index < leftScore.length - 1; index += 1) {
      if (leftScore[index] !== rightScore[index]) {
        return Number(leftScore[index]) > Number(rightScore[index]) ? left : right
      }
    }
    return String(leftScore[3]).localeCompare(String(rightScore[3])) <= 0 ? left : right
  }
  const mergeContexts = (
    left: ParentMatchContext,
    right: ParentMatchContext,
  ): ParentMatchContext => {
    const preferred = preferredContext(left, right)
    const fallback = preferred === left ? right : left
    const inheritAllCommentSubjectIds = sortedUnique([
      ...(left.inheritAllCommentSubjectIds ?? []),
      ...(right.inheritAllCommentSubjectIds ?? []),
    ])
    return {
      ...preferred,
      matchedTerm: preferred.matchedTerm ?? fallback.matchedTerm ?? null,
      subjectIds: sortedUnique([...left.subjectIds, ...right.subjectIds]),
      parentSentiment: inheritAllCommentSubjectIds.length > 0
        ? "negative"
        : preferred.parentSentiment ?? fallback.parentSentiment ?? null,
      inheritAllCommentSubjectIds,
    }
  }
  const remember = (
    urlKeys: Array<string | null>,
    identifierKeys: Array<string | null>,
    context: ParentMatchContext,
  ) => {
    if (!usable(context)) return
    const aliases = new Set<string>()
    for (const key of urlKeys) {
      if (!key) continue
      for (const alias of parentUrlAliases(platform, key)) aliases.add(alias)
    }
    for (const identity of Array.from(aliases, alias => canonicalParentUrl(platform, alias))) {
      aliases.add(identity)
      for (const requestedAlias of requestedAliasesByIdentity.get(identity) ?? []) {
        aliases.add(requestedAlias)
      }
    }
    for (const key of identifierKeys) {
      const identifier = key?.trim()
      if (identifier) aliases.add(identifier)
    }
    let merged = context
    const affectedAliases = new Set(aliases)
    const linkedContexts = new Set<ParentMatchContext>()
    for (const alias of aliases) {
      const existing = contexts.get(alias)
      if (existing) linkedContexts.add(existing)
    }
    for (const existing of linkedContexts) merged = mergeContexts(merged, existing)
    // An existing context can already be reachable through several URL/ID
    // aliases. Carry the merge back to every one of those keys; otherwise a
    // duplicate found through key A would upgrade A but leave its old key B
    // with stale neutral/non-inheritable context.
    if (linkedContexts.size > 0) {
      for (const [alias, existing] of contexts) {
        if (linkedContexts.has(existing)) affectedAliases.add(alias)
      }
    }
    // Propagate the merged result to every known alias. This makes duplicate
    // rows deterministic even when Prisma returns them in a different order.
    for (const alias of affectedAliases) contexts.set(alias, merged)
  }

  const mentions = await prisma.socialMention.findMany({
    where: {
      organizationId,
      platform,
      contentKind: { notIn: ["COMMENT", "REPLY"] },
      deletedAtSource: null,
      purgedAt: null,
      OR: [
        ...(wanted.length > 0 ? [{ url: { in: wanted } }, { canonicalUrl: { in: wanted } }] : []),
        ...(requestedIds.length > 0 ? [
          { externalId: { in: requestedIds } },
          { postExternalId: { in: requestedIds } },
        ] : []),
      ],
    },
    select: {
      id: true,
      externalId: true,
      postExternalId: true,
      url: true,
      canonicalUrl: true,
      matchedTerm: true,
      sentiment: true,
      text: true,
      subjectMatches: {
        where: {
          OR: [
            { status: "MATCHED" },
            { status: "REJECTED", reason: { startsWith: "official_author" } },
          ],
        },
        select: { subjectId: true, status: true },
      },
    },
  })
  // Право раздавать релевантность всем комментариям даёт не любой негатив.
  // Пост-соболезнование получает negative по словам горя, а претензии к бренду в
  // нём нет: видео про зарплату сыну шехида принесло 275 принятых соболезнований.
  // Такой пост остаётся находкой сам, но комментарии под ним проходят обычную
  // проверку по своему тексту. См. condolence-post-signal.ts — там замер.
  for (const mention of mentions) {
    const negativeParent = mention.sentiment?.trim().toLowerCase() === "negative"
      && !isCondolencePost(mention.text)
    remember([mention.url, mention.canonicalUrl], [mention.externalId, mention.postExternalId], {
      parentMentionId: mention.id,
      matchedTerm: mention.matchedTerm ?? null,
      subjectIds: mention.subjectMatches.map((match: { subjectId: string }) => match.subjectId),
      parentSentiment: mention.sentiment ?? null,
      inheritAllCommentSubjectIds: negativeParent
        ? mention.subjectMatches
            .filter((match: { status: string }) => match.status === "MATCHED")
            .map((match: { subjectId: string }) => match.subjectId)
        : [],
    })
  }

  const unresolved = Array.from(new Set(requested
    .filter(url => parentUrlAliases(platform, url).every(alias => !contexts.has(alias)))
    .flatMap(url => parentUrlAliases(platform, url))))
  if (unresolved.length === 0) return contexts
  const evidence = await prisma.mentionEvidence.findMany({
    where: { organizationId, permalink: { in: unresolved } },
    select: {
      permalink: true,
      mention: {
        select: {
          id: true,
          externalId: true,
          postExternalId: true,
          platform: true,
          contentKind: true,
          matchedTerm: true,
          sentiment: true,
          text: true,
          deletedAtSource: true,
          purgedAt: true,
          subjectMatches: {
            where: {
              OR: [
                { status: "MATCHED" },
                { status: "REJECTED", reason: { startsWith: "official_author" } },
              ],
            },
            select: { subjectId: true, status: true },
          },
        },
      },
    },
  })
  for (const row of evidence) {
    if (!row.permalink) continue
    if (row.mention.platform !== platform || ["COMMENT", "REPLY"].includes(row.mention.contentKind)) continue
    if (row.mention.deletedAtSource || row.mention.purgedAt) continue
    // Тот же гейт, что и выше: наследование не выдаётся посту-соболезнованию.
    const negativeParent = row.mention.sentiment?.trim().toLowerCase() === "negative"
      && !isCondolencePost(row.mention.text)
    remember(
      [row.permalink],
      [row.mention.externalId, row.mention.postExternalId],
      {
      parentMentionId: row.mention.id,
      matchedTerm: row.mention.matchedTerm ?? null,
      subjectIds: row.mention.subjectMatches.map((match: { subjectId: string }) => match.subjectId),
      parentSentiment: row.mention.sentiment ?? null,
      inheritAllCommentSubjectIds: negativeParent
        ? row.mention.subjectMatches
            .filter((match: { status: string }) => match.status === "MATCHED")
            .map((match: { subjectId: string }) => match.subjectId)
        : [],
      },
    )
  }
  return contexts
}
