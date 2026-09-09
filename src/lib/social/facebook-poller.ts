import { prisma } from "@/lib/prisma"
import { decryptToken } from "@/lib/secure-token"
import { ingestMention, findMatchedKeyword } from "@/lib/social/ingest-mention"
import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"
import { classifyMetaGraphHttpFailure, collectMetaGraphCommentThreads, collectMetaGraphConnection, metaGraphCursorFetchUrl, sanitizeMetaGraphCursorUrl, type MetaGraphConnectionPage } from "@/lib/social/meta-graph-pagination"
import {
  META_GRAPH_CURSOR_COMPLETE,
  applyMetaGraphQuarantines,
  clearMetaGraphCommentBatchCursors,
  loadMetaGraphCursors,
  metaGraphReplyCursorKey,
  metaGraphStoredPendingReplies,
  metaGraphStoredTargets,
  metaGraphStoredWatchTargets,
  metaGraphTargetCursorKey,
  metaGraphTargetCursorValue,
  metaGraphTopCursorKey,
  planMetaGraphCommentCursorUpdates,
  rotateMetaGraphTargets,
  saveMetaGraphCursor,
  saveMetaGraphCursorUpdates,
  metaGraphWatchTargetCursorKey,
} from "@/lib/social/meta-graph-cursor"
import crypto from "crypto"

const GRAPH = "https://graph.facebook.com/v21.0"
const META_COMMENT_MAX_TOTAL_PAGES = 100
const META_COMMENT_MAX_PAGES_PER_CONNECTION = 10
const META_COMMENT_MAX_TOTAL_ITEMS = 1_000
const META_PARENT_MAX_PAGES = 10
const META_PARENT_MAX_ITEMS = 500

type NativeMetaPollResult = {
  ingested: number
  error?: string
  partialCoverage?: boolean
  parentCoverage?: {
    pages: number
    records: number
    itemLimit: number
    pageLimit: number
    capped: boolean
    complete: boolean
  }
  commentCoverage?: {
    pages: number
    records: number
    replies: number
    itemLimit: number
    pageLimit: number
    capped: boolean
    complete: boolean
  }
}

type FacebookGraphComment = {
  id: string
  message?: string
  from?: { id?: string; name?: string }
  created_time?: string
  like_count?: number
  permalink_url?: string
  parent?: { id?: string }
  comments?: MetaGraphConnectionPage<FacebookGraphComment>
  replies?: MetaGraphConnectionPage<FacebookGraphComment>
}

type InstagramGraphComment = {
  id: string
  text?: string
  username?: string
  timestamp?: string
  like_count?: number
  parent_id?: string
  replies?: MetaGraphConnectionPage<InstagramGraphComment>
  comments?: MetaGraphConnectionPage<InstagramGraphComment>
}

type FacebookGraphPost = {
  id: string
  message?: string
  story?: string
  created_time?: string
  permalink_url?: string
  reactions?: { summary?: { total_count: number } }
  comments?: { summary?: { total_count: number } }
  shares?: { count: number }
}

type InstagramGraphMedia = {
  id: string
  caption?: string
  permalink?: string
  timestamp?: string
  username?: string
  like_count?: number
  comments_count?: number
}

/**
 * Meta requires `appsecret_proof` (HMAC-SHA256 of the access token, keyed by
 * the app secret) on every server-side call when the app is configured with
 * "Require App Secret" — the new default for Business Login apps. Missing or
 * wrong proof surfaces as OAuth error #10 on /posts even when the token is
 * fine.
 */
function appsecretProof(token: string): string | null {
  const secret = process.env.FACEBOOK_APP_SECRET
  if (!secret) return null
  return crypto.createHmac("sha256", secret).update(token).digest("hex")
}

function graphAuthInit(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } }
}

function instagramMediaContentKind(mediaType: unknown): "POST" | "VIDEO" | "IMAGE" | "AUDIO" {
  const normalized = typeof mediaType === "string" ? mediaType.trim().toUpperCase() : ""
  if (normalized.includes("VIDEO") || normalized.includes("REEL")) return "VIDEO"
  if (normalized.includes("AUDIO")) return "AUDIO"
  if (normalized.includes("IMAGE") || normalized.includes("CAROUSEL")) return "IMAGE"
  return "POST"
}

/**
 * Poll a Facebook Page's feed and capture every post as a mention.
 * The page access token is stored encrypted on the SocialAccount row.
 *
 * For richer "brand monitoring" we'd also pull page.tagged, but /tagged
 * requires `pages_read_user_content` which is App-Review-gated — we keep
 * this poller to the page's own posts for the first iteration.
 */
export async function pollFacebookAccount(accountId: string): Promise<NativeMetaPollResult> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } })
  if (!account || account.platform !== "facebook") return { ingested: 0, error: "not_found" }
  if (!account.accessToken) return { ingested: 0, error: "no_token" }

  let token: string
  try {
    token = decryptToken(account.accessToken, `oauth:facebook:${account.handle}`)
  } catch (e) {
    console.error("[facebook-poller] decrypt failed:", e)
    return { ingested: 0, error: "token_decrypt_failed" }
  }

  const sinceParam = account.lastPolledAt
    ? `&since=${Math.floor(account.lastPolledAt.getTime() / 1000)}`
    : ""
  const proof = appsecretProof(token)
  const proofParam = proof ? `&appsecret_proof=${proof}` : ""
  const cursorAccount = { id: account.id, organizationId: account.organizationId }
  const cursorPrefix = "legacy:facebook:"
  const parentCursorKey = `${cursorPrefix}parents`
  const parentResetCursorKey = `${cursorPrefix}reset:parents`
  const cycleCutoffCursorKey = `${cursorPrefix}cycle_cutoff`
  const rotationCursorKey = `${cursorPrefix}rotation`
  const loadedCursorState = await loadMetaGraphCursors(cursorAccount, cursorPrefix)
  const cursorState = applyMetaGraphQuarantines(loadedCursorState, cursorPrefix)
  const storedCycleCutoff = new Date(cursorState.get(cycleCutoffCursorKey) ?? "")
  const cycleCutoff = Number.isFinite(storedCycleCutoff.getTime())
    ? storedCycleCutoff
    : new Date(Math.floor(Date.now() / 1_000) * 1_000)
  if (!Number.isFinite(storedCycleCutoff.getTime())) {
    await saveMetaGraphCursor(cursorAccount, cycleCutoffCursorKey, cycleCutoff.toISOString())
  }
  // /me/posts — /me resolves to the page when using a page access token.
  // /posts returns only the page's own posts (pages_read_engagement is enough),
  // unlike /feed which also needs pages_read_user_content. Using /me bypasses
  // a Meta quirk where /{page_id}/posts errors with #10 even for page admins.
  // Extra fields like reactions.summary / comments.summary re-trigger #10 on
  // some dev-mode Pages — stick to the minimum that worked in probe calls.
  const url = metaGraphCursorFetchUrl(cursorState.get(parentCursorKey), GRAPH, proof)
    ?? `${GRAPH}/me/posts?fields=id,message,story,created_time,permalink_url&limit=50${sinceParam}&until=${Math.floor(cycleCutoff.getTime() / 1000)}${proofParam}`

  const posts = await collectMetaGraphConnection<FacebookGraphPost>({
    graphBaseUrl: GRAPH,
    appSecretProof: proof,
    initialUrl: url,
    fetchPage: async pageUrl => {
      try {
        const response = await fetch(pageUrl, graphAuthInit(token))
        if (!response.ok) {
          const body = await response.text()
          return {
            ok: false as const,
            error: `meta_parent_fetch_failed_${response.status}`,
            failureClass: classifyMetaGraphHttpFailure(response.status, pageUrl, body),
          }
        }
        return { ok: true as const, data: await response.json() as MetaGraphConnectionPage<FacebookGraphPost> }
      } catch {
        return { ok: false as const, error: "meta_parent_fetch_failed" }
      }
    },
    maxPages: META_PARENT_MAX_PAGES,
    maxItems: META_PARENT_MAX_ITEMS,
  })
  let ingested = 0

  // We deliberately do NOT ingest our own posts — they add noise to the
  // monitoring inbox and never turn into leads. We only fetch them here so
  // we can walk each post's comments below.

  // Pull comments on each recent post — these are the real "mentions" where
  // leads come from. Requires pages_read_user_content.
  const recentPostsById = new Map(posts.items.map(post => [post.id, post]))
  for (const stored of [...metaGraphStoredTargets(cursorState, cursorPrefix), ...metaGraphStoredWatchTargets(cursorState, cursorPrefix)]) {
    const current = recentPostsById.get(stored.id)
    if (!current) {
      recentPostsById.set(stored.id, { id: stored.id, permalink_url: stored.url ?? undefined })
    } else if (!current.permalink_url && stored.url) {
      recentPostsById.set(stored.id, { ...current, permalink_url: stored.url })
    }
  }
  const recentPosts = Array.from(recentPostsById.values())
  if (posts.error && recentPosts.length === 0) {
    if (posts.failureClass === "invalid_cursor" && cursorState.get(parentCursorKey) && !cursorState.get(parentResetCursorKey)) {
      await saveMetaGraphCursor(cursorAccount, parentCursorKey, null)
      await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, "1")
    }
    return { ingested: 0, error: posts.error }
  }
  const parentContexts = await parentMatchContextsForComments(
    account.organizationId,
    "facebook",
    recentPosts.map(post => post.permalink_url).filter((url): url is string => Boolean(url)),
    recentPosts.map(post => post.id),
  )
  let partialError: string | null = posts.error
  const fetchCommentPage = async (pageUrl: string) => {
    try {
      const response = await fetch(pageUrl, graphAuthInit(token))
      if (!response.ok) {
        const body = await response.text()
        return {
          ok: false as const,
          error: `meta_comments_fetch_failed_${response.status}`,
          failureClass: classifyMetaGraphHttpFailure(response.status, pageUrl, body),
        }
      }
      return {
        ok: true as const,
        data: await response.json() as MetaGraphConnectionPage<FacebookGraphComment>,
      }
    } catch {
      return { ok: false as const, error: "meta_comments_fetch_failed" }
    }
  }
  const fields = "id,message,from,created_time,like_count,permalink_url,parent{id},comments.limit(50){id,message,from,created_time,like_count,permalink_url,parent{id}}"
  const topCursorValue = (postId: string) => cursorState.get(metaGraphTopCursorKey(cursorPrefix, postId))
  const activePosts = recentPosts.filter(post => topCursorValue(post.id) !== META_GRAPH_CURSOR_COMPLETE)
  const orderedPosts = rotateMetaGraphTargets(activePosts, cursorState.get(rotationCursorKey), post => post.id)
  const pendingFacebookReplies = metaGraphStoredPendingReplies(cursorState, cursorPrefix).flatMap(pending => {
    const post = recentPostsById.get(pending.targetId)
    return post ? [{ target: post, item: { id: pending.itemId } as FacebookGraphComment }] : []
  })
  const embeddedFacebookReplies = (comment: FacebookGraphComment) => comment.comments ?? comment.replies
  const facebookCommentsUrl = (post: FacebookGraphPost) => `${GRAPH}/${post.id}/comments?fields=${encodeURIComponent(fields)}&limit=50${proofParam}`
  const replyFields = "id,message,from,created_time,like_count,permalink_url,parent{id}"
  const facebookRepliesUrl = (comment: FacebookGraphComment) => `${GRAPH}/${comment.id}/comments?fields=${encodeURIComponent(replyFields)}&limit=50${proofParam}`
  const comments = await collectMetaGraphCommentThreads<
    (typeof recentPosts)[number],
    FacebookGraphComment
  >({
    targets: orderedPosts,
    graphBaseUrl: GRAPH,
    appSecretProof: proof,
    initialUrl: facebookCommentsUrl,
    fetchPage: fetchCommentPage,
    embeddedReplies: (comment, post) => {
      const replyKey = metaGraphReplyCursorKey(cursorPrefix, post.id, comment.id)
      return cursorState.get(replyKey) === META_GRAPH_CURSOR_COMPLETE ? null : embeddedFacebookReplies(comment)
    },
    itemId: comment => comment.id,
    replyParentId: reply => reply.parent?.id,
    topLevelResumeUrl: post => {
      const value = topCursorValue(post.id)
      return value && value !== META_GRAPH_CURSOR_COMPLETE
        ? metaGraphCursorFetchUrl(value, GRAPH, proof)
        : null
    },
    replyResumeUrl: (comment, post) => {
      const value = cursorState.get(metaGraphReplyCursorKey(cursorPrefix, post.id, comment.id))
      return value && value !== META_GRAPH_CURSOR_COMPLETE
        ? metaGraphCursorFetchUrl(value, GRAPH, proof)
        : null
    },
    pendingReplies: pendingFacebookReplies,
    maxPages: META_COMMENT_MAX_TOTAL_PAGES,
    maxPagesPerConnection: META_COMMENT_MAX_PAGES_PER_CONNECTION,
    maxItems: META_COMMENT_MAX_TOTAL_ITEMS,
  })
  if (comments.error) partialError = comments.error

  let commentIngestSucceeded = true
  for (const { target: post, item: c, replyToExternalId } of comments.records) {
    const parentMatchContext = parentContexts.get(post.id)
      ?? (post.permalink_url ? parentContexts.get(post.permalink_url) : null)
      ?? null
    const cText = (c.message || "").trim()
    if (!cText) continue
    try {
      const isNew = await ingestMention({
        organizationId: account.organizationId,
        accountId: account.id,
        platform: "facebook",
        externalId: `c:${c.id}`,
        sourceType: replyToExternalId ? "reply" : "comment",
        contentKind: replyToExternalId ? "REPLY" : "COMMENT",
        postExternalId: post.id,
        parentExternalId: replyToExternalId ?? post.id,
        threadExternalId: post.id,
        replyToExternalId,
        depth: replyToExternalId ? 1 : 0,
        sourceProvider: "native",
        sourceMetadata: {
          postId: post.id,
          ...(replyToExternalId ? { parentCommentId: replyToExternalId } : {}),
        },
        text: cText,
        sentiment: null,
        matchedTerm: findMatchedKeyword(cText, account.keywords),
        engagement: c.like_count || 0,
        url: post.permalink_url || null,
        canonicalUrl: c.permalink_url || null,
        parentPostUrl: post.permalink_url || null,
        parentMatchContext,
        authorName: c.from?.name || null,
        authorHandle: c.from?.id || null,
        publishedAt: c.created_time ? new Date(c.created_time) : null,
      })
      if (isNew) ingested++
    } catch {
      commentIngestSucceeded = false
      if (!partialError) partialError = "meta_comment_ingest_failed"
    }
  }

  if (commentIngestSucceeded) {
    const cursorPlan = planMetaGraphCommentCursorUpdates({
      cursorPrefix,
      allTargets: recentPosts,
      orderedActiveTargets: orderedPosts,
      existing: cursorState,
      result: comments,
      targetId: post => post.id,
      itemId: comment => comment.id,
      embeddedReplies: embeddedFacebookReplies,
      initialTopLevelCursor: post => sanitizeMetaGraphCursorUrl(facebookCommentsUrl(post), GRAPH) ?? "",
      initialReplyCursor: comment => sanitizeMetaGraphCursorUrl(facebookRepliesUrl(comment), GRAPH) ?? "",
    })
    for (const post of recentPosts) {
      cursorPlan.updates.set(
        metaGraphTargetCursorKey(cursorPrefix, post.id),
        metaGraphTargetCursorValue(post.permalink_url),
      )
      const context = parentContexts.get(post.id)
        ?? (post.permalink_url ? parentContexts.get(post.permalink_url) : null)
        ?? null
      if (context?.inheritAllCommentSubjectIds?.length) {
        cursorPlan.updates.set(
          metaGraphWatchTargetCursorKey(cursorPrefix, post.id),
          metaGraphTargetCursorValue(post.permalink_url),
        )
      }
    }
    await saveMetaGraphCursorUpdates(cursorAccount, cursorPlan.updates)
    const canAdvanceParentCursor = cursorPlan.allTargetsComplete
      && (!posts.error || (Boolean(posts.resumeUrl) && !posts.failureClass))
    if (canAdvanceParentCursor) {
      await clearMetaGraphCommentBatchCursors(cursorAccount, cursorPrefix)
      await saveMetaGraphCursor(cursorAccount, parentCursorKey, posts.resumeUrl)
      await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, null)
      if (!posts.resumeUrl) await saveMetaGraphCursor(cursorAccount, cycleCutoffCursorKey, null)
    } else if (
      cursorPlan.allTargetsComplete
      && posts.failureClass === "invalid_cursor"
      && !cursorState.get(parentResetCursorKey)
    ) {
      await clearMetaGraphCommentBatchCursors(cursorAccount, cursorPrefix)
      await saveMetaGraphCursor(cursorAccount, parentCursorKey, null)
      await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, "1")
    } else {
      await saveMetaGraphCursor(cursorAccount, rotationCursorKey, cursorPlan.nextRotationTargetId)
    }
    if (!cursorPlan.allTargetsComplete && !partialError) partialError = "meta_comments_resume_pending"
  }

  // Fetch posts where this page is tagged — these are true external mentions.
  const taggedUrl = `${GRAPH}/me/tagged?fields=id,message,story,created_time,permalink_url,from&limit=25${proofParam}`
  const tRes = await fetch(taggedUrl, graphAuthInit(token))
  if (tRes.ok) {
    const tJson = await tRes.json() as {
      data: Array<{ id: string; message?: string; story?: string; created_time: string; permalink_url?: string; from?: { id: string; name: string } }>
    }
    for (const tp of tJson.data || []) {
      const tText = (tp.message || tp.story || "").trim()
      if (!tText) continue
      try {
        const isNew = await ingestMention({
          organizationId: account.organizationId,
          accountId: account.id,
          platform: "facebook",
          externalId: `t:${tp.id}`,
          sourceType: "mention",
          sourceProvider: "native",
          sourceMetadata: { taggedPostId: tp.id },
          text: tText,
          sentiment: null,
          matchedTerm: findMatchedKeyword(tText, account.keywords),
          url: tp.permalink_url || null,
          authorName: tp.from?.name || null,
          authorHandle: tp.from?.id || null,
          publishedAt: new Date(tp.created_time),
        })
        if (isNew) ingested++
      } catch {}
    }
  }

  // A capped/failed traversal must not advance the account watermark and
  // silently strand comments that were not reached.
  if (!partialError) {
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { lastPolledAt: cycleCutoff },
    })
  }

  return {
    ingested,
    ...(partialError ? { error: partialError, partialCoverage: true } : {}),
    parentCoverage: {
      pages: posts.pages,
      records: posts.items.length,
      itemLimit: META_PARENT_MAX_ITEMS,
      pageLimit: META_PARENT_MAX_PAGES,
      capped: posts.capped,
      complete: !posts.error,
    },
    commentCoverage: {
      pages: comments.pages,
      records: comments.records.length,
      replies: comments.replies,
      itemLimit: META_COMMENT_MAX_TOTAL_ITEMS,
      pageLimit: META_COMMENT_MAX_TOTAL_PAGES,
      capped: comments.capped,
      complete: !partialError,
    },
  }
}

/**
 * Poll an Instagram Business account for recent media + comments on that media.
 * The page token grants access to the linked IG business account.
 */
export async function pollInstagramAccount(accountId: string): Promise<NativeMetaPollResult> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } })
  if (!account || account.platform !== "instagram") return { ingested: 0, error: "not_found" }
  if (!account.accessToken) return { ingested: 0, error: "no_token" }

  let token: string
  try {
    token = decryptToken(account.accessToken, `oauth:instagram:${account.handle}`)
  } catch (e) {
    console.error("[instagram-poller] decrypt failed:", e)
    return { ingested: 0, error: "token_decrypt_failed" }
  }

  // First — recent media on the IG business account.
  const proof = appsecretProof(token)
  const proofParam = proof ? `&appsecret_proof=${proof}` : ""
  const cursorAccount = { id: account.id, organizationId: account.organizationId }
  const cursorPrefix = "legacy:instagram:"
  const parentCursorKey = `${cursorPrefix}parents`
  const parentResetCursorKey = `${cursorPrefix}reset:parents`
  const rotationCursorKey = `${cursorPrefix}rotation`
  const cursorState = applyMetaGraphQuarantines(
    await loadMetaGraphCursors(cursorAccount, cursorPrefix),
    cursorPrefix,
  )
  const mediaUrl = metaGraphCursorFetchUrl(cursorState.get(parentCursorKey), GRAPH, proof)
    ?? `${GRAPH}/${account.handle}/media?fields=id,caption,permalink,timestamp,username,like_count,comments_count&limit=25${proofParam}`
  const media = await collectMetaGraphConnection<InstagramGraphMedia>({
    graphBaseUrl: GRAPH,
    appSecretProof: proof,
    initialUrl: mediaUrl,
    fetchPage: async pageUrl => {
      try {
        const response = await fetch(pageUrl, graphAuthInit(token))
        if (!response.ok) {
          const body = await response.text()
          return {
            ok: false as const,
            error: `meta_parent_fetch_failed_${response.status}`,
            failureClass: classifyMetaGraphHttpFailure(response.status, pageUrl, body),
          }
        }
        return { ok: true as const, data: await response.json() as MetaGraphConnectionPage<InstagramGraphMedia> }
      } catch {
        return { ok: false as const, error: "meta_parent_fetch_failed" }
      }
    },
    maxPages: META_PARENT_MAX_PAGES,
    maxItems: META_PARENT_MAX_ITEMS,
  })
  let ingested = 0

  // Own captions are not useful in the monitoring inbox — skip them. We walk
  // the media list only to pull comments and tags underneath each item.

  // Pull comments on each recent media. Requires instagram_manage_comments.
  const recentMediaById = new Map(media.items.map(item => [item.id, item]))
  for (const stored of [...metaGraphStoredTargets(cursorState, cursorPrefix), ...metaGraphStoredWatchTargets(cursorState, cursorPrefix)]) {
    const current = recentMediaById.get(stored.id)
    if (!current) {
      recentMediaById.set(stored.id, { id: stored.id, permalink: stored.url ?? undefined })
    } else if (!current.permalink && stored.url) {
      recentMediaById.set(stored.id, { ...current, permalink: stored.url })
    }
  }
  const recentMedia = Array.from(recentMediaById.values())
  if (media.error && recentMedia.length === 0) {
    if (media.failureClass === "invalid_cursor" && cursorState.get(parentCursorKey) && !cursorState.get(parentResetCursorKey)) {
      await saveMetaGraphCursor(cursorAccount, parentCursorKey, null)
      await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, "1")
    }
    return { ingested: 0, error: media.error }
  }
  const parentContexts = await parentMatchContextsForComments(
    account.organizationId,
    "instagram",
    recentMedia.map(media => media.permalink).filter((url): url is string => Boolean(url)),
    recentMedia.map(media => media.id),
  )
  let partialError: string | null = media.error
  const fetchCommentPage = async (pageUrl: string) => {
    try {
      const response = await fetch(pageUrl, graphAuthInit(token))
      if (!response.ok) {
        const body = await response.text()
        return {
          ok: false as const,
          error: `meta_comments_fetch_failed_${response.status}`,
          failureClass: classifyMetaGraphHttpFailure(response.status, pageUrl, body),
        }
      }
      return {
        ok: true as const,
        data: await response.json() as MetaGraphConnectionPage<InstagramGraphComment>,
      }
    } catch {
      return { ok: false as const, error: "meta_comments_fetch_failed" }
    }
  }
  const fields = "id,text,username,timestamp,like_count,replies.limit(50){id,text,username,timestamp,like_count}"
  const topCursorValue = (mediaId: string) => cursorState.get(metaGraphTopCursorKey(cursorPrefix, mediaId))
  const activeMedia = recentMedia.filter(item => topCursorValue(item.id) !== META_GRAPH_CURSOR_COMPLETE)
  const orderedMedia = rotateMetaGraphTargets(activeMedia, cursorState.get(rotationCursorKey), item => item.id)
  const pendingInstagramReplies = metaGraphStoredPendingReplies(cursorState, cursorPrefix).flatMap(pending => {
    const mediaItem = recentMediaById.get(pending.targetId)
    return mediaItem ? [{ target: mediaItem, item: { id: pending.itemId } as InstagramGraphComment }] : []
  })
  const embeddedInstagramReplies = (comment: InstagramGraphComment) => comment.replies ?? comment.comments
  const instagramCommentsUrl = (mediaItem: InstagramGraphMedia) => `${GRAPH}/${mediaItem.id}/comments?fields=${encodeURIComponent(fields)}&limit=50${proofParam}`
  const replyFields = "id,text,username,timestamp,like_count"
  const instagramRepliesUrl = (comment: InstagramGraphComment) => `${GRAPH}/${comment.id}/replies?fields=${encodeURIComponent(replyFields)}&limit=50${proofParam}`
  const comments = await collectMetaGraphCommentThreads<
    (typeof recentMedia)[number],
    InstagramGraphComment
  >({
    targets: orderedMedia,
    graphBaseUrl: GRAPH,
    appSecretProof: proof,
    initialUrl: instagramCommentsUrl,
    fetchPage: fetchCommentPage,
    embeddedReplies: (comment, mediaItem) => {
      const replyKey = metaGraphReplyCursorKey(cursorPrefix, mediaItem.id, comment.id)
      return cursorState.get(replyKey) === META_GRAPH_CURSOR_COMPLETE ? null : embeddedInstagramReplies(comment)
    },
    itemId: comment => comment.id,
    replyParentId: reply => reply.parent_id,
    topLevelResumeUrl: mediaItem => {
      const value = topCursorValue(mediaItem.id)
      return value && value !== META_GRAPH_CURSOR_COMPLETE
        ? metaGraphCursorFetchUrl(value, GRAPH, proof)
        : null
    },
    replyResumeUrl: (comment, mediaItem) => {
      const value = cursorState.get(metaGraphReplyCursorKey(cursorPrefix, mediaItem.id, comment.id))
      return value && value !== META_GRAPH_CURSOR_COMPLETE
        ? metaGraphCursorFetchUrl(value, GRAPH, proof)
        : null
    },
    pendingReplies: pendingInstagramReplies,
    maxPages: META_COMMENT_MAX_TOTAL_PAGES,
    maxPagesPerConnection: META_COMMENT_MAX_PAGES_PER_CONNECTION,
    maxItems: META_COMMENT_MAX_TOTAL_ITEMS,
  })
  if (comments.error) partialError = comments.error

  let commentIngestSucceeded = true
  for (const { target: m, item: c, replyToExternalId } of comments.records) {
    const parentMatchContext = parentContexts.get(m.id)
      ?? (m.permalink ? parentContexts.get(m.permalink) : null)
      ?? null
    const cText = (c.text || "").trim()
    if (!cText) continue
    try {
      const isNew = await ingestMention({
        organizationId: account.organizationId,
        accountId: account.id,
        platform: "instagram",
        externalId: `c:${c.id}`,
        sourceType: replyToExternalId ? "reply" : "comment",
        contentKind: replyToExternalId ? "REPLY" : "COMMENT",
        postExternalId: m.id,
        parentExternalId: replyToExternalId ?? m.id,
        threadExternalId: m.id,
        replyToExternalId,
        depth: replyToExternalId ? 1 : 0,
        sourceProvider: "native",
        sourceMetadata: {
          mediaId: m.id,
          ...(replyToExternalId ? { parentCommentId: replyToExternalId } : {}),
        },
        text: cText,
        sentiment: null,
        matchedTerm: findMatchedKeyword(cText, account.keywords),
        engagement: c.like_count || 0,
        url: m.permalink || null,
        parentPostUrl: m.permalink || null,
        parentMatchContext,
        authorHandle: c.username || null,
        publishedAt: c.timestamp ? new Date(c.timestamp) : null,
      })
      if (isNew) ingested++
    } catch {
      commentIngestSucceeded = false
      if (!partialError) partialError = "meta_comment_ingest_failed"
    }
  }

  if (commentIngestSucceeded) {
    const cursorPlan = planMetaGraphCommentCursorUpdates({
      cursorPrefix,
      allTargets: recentMedia,
      orderedActiveTargets: orderedMedia,
      existing: cursorState,
      result: comments,
      targetId: mediaItem => mediaItem.id,
      itemId: comment => comment.id,
      embeddedReplies: embeddedInstagramReplies,
      initialTopLevelCursor: mediaItem => sanitizeMetaGraphCursorUrl(instagramCommentsUrl(mediaItem), GRAPH) ?? "",
      initialReplyCursor: comment => sanitizeMetaGraphCursorUrl(instagramRepliesUrl(comment), GRAPH) ?? "",
    })
    for (const mediaItem of recentMedia) {
      cursorPlan.updates.set(
        metaGraphTargetCursorKey(cursorPrefix, mediaItem.id),
        metaGraphTargetCursorValue(mediaItem.permalink),
      )
      const context = parentContexts.get(mediaItem.id)
        ?? (mediaItem.permalink ? parentContexts.get(mediaItem.permalink) : null)
        ?? null
      if (context?.inheritAllCommentSubjectIds?.length) {
        cursorPlan.updates.set(
          metaGraphWatchTargetCursorKey(cursorPrefix, mediaItem.id),
          metaGraphTargetCursorValue(mediaItem.permalink),
        )
      }
    }
    await saveMetaGraphCursorUpdates(cursorAccount, cursorPlan.updates)
    const canAdvanceParentCursor = cursorPlan.allTargetsComplete
      && (!media.error || (Boolean(media.resumeUrl) && !media.failureClass))
    if (canAdvanceParentCursor) {
      await clearMetaGraphCommentBatchCursors(cursorAccount, cursorPrefix)
      await saveMetaGraphCursor(cursorAccount, parentCursorKey, media.resumeUrl)
      await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, null)
    } else if (
      cursorPlan.allTargetsComplete
      && media.failureClass === "invalid_cursor"
      && !cursorState.get(parentResetCursorKey)
    ) {
      await clearMetaGraphCommentBatchCursors(cursorAccount, cursorPrefix)
      await saveMetaGraphCursor(cursorAccount, parentCursorKey, null)
      await saveMetaGraphCursor(cursorAccount, parentResetCursorKey, "1")
    } else {
      await saveMetaGraphCursor(cursorAccount, rotationCursorKey, cursorPlan.nextRotationTargetId)
    }
    if (!cursorPlan.allTargetsComplete && !partialError) partialError = "meta_comments_resume_pending"
  }

  // Fetch media where this account is tagged (brand mentions). Same scope.
  const tagsUrl = `${GRAPH}/${account.handle}/tags?fields=id,caption,permalink,timestamp,username,media_type&limit=25${proofParam}`
  const tRes = await fetch(tagsUrl, graphAuthInit(token))
  if (tRes.ok) {
    const tJson = await tRes.json() as {
      data: Array<{ id: string; caption?: string; permalink?: string; timestamp: string; username?: string; media_type?: string }>
    }
    for (const tm of tJson.data || []) {
      const tText = (tm.caption || "").trim()
      if (!tText) continue
      try {
        const isNew = await ingestMention({
          organizationId: account.organizationId,
          accountId: account.id,
          platform: "instagram",
          externalId: `t:${tm.id}`,
          sourceType: "mention",
          contentKind: instagramMediaContentKind(tm.media_type),
          sourceProvider: "native",
          sourceMetadata: {
            taggedMediaId: tm.id,
            mediaType: instagramMediaContentKind(tm.media_type),
          },
          text: tText,
          sentiment: null,
          matchedTerm: findMatchedKeyword(tText, account.keywords),
          url: tm.permalink || null,
          authorHandle: tm.username || null,
          publishedAt: new Date(tm.timestamp),
        })
        if (isNew) ingested++
      } catch {}
    }
  }

  if (!partialError) {
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { lastPolledAt: new Date() },
    })
  }

  return {
    ingested,
    ...(partialError ? { error: partialError, partialCoverage: true } : {}),
    parentCoverage: {
      pages: media.pages,
      records: media.items.length,
      itemLimit: META_PARENT_MAX_ITEMS,
      pageLimit: META_PARENT_MAX_PAGES,
      capped: media.capped,
      complete: !media.error,
    },
    commentCoverage: {
      pages: comments.pages,
      records: comments.records.length,
      replies: comments.replies,
      itemLimit: META_COMMENT_MAX_TOTAL_ITEMS,
      pageLimit: META_COMMENT_MAX_TOTAL_PAGES,
      capped: comments.capped,
      complete: !partialError,
    },
  }
}
