export type MetaGraphConnectionPage<T> = {
  data?: T[]
  paging?: { next?: string }
}

export type MetaGraphFailureClass = "invalid_cursor" | "terminal_target" | "retryable_target" | "retryable"

export type MetaGraphPageFetch<T> =
  | { ok: true; data: MetaGraphConnectionPage<T> }
  | { ok: false; error: string; failureClass?: MetaGraphFailureClass }

export type MetaGraphConnectionResult<T> = {
  items: T[]
  pages: number
  capped: boolean
  error: string | null
  /** Credential-free URL for the first page that was not covered. */
  resumeUrl: string | null
  failureClass?: MetaGraphFailureClass
}

export type MetaGraphThreadRecord<TTarget, TItem> = {
  target: TTarget
  item: TItem
  replyToExternalId: string | null
}

export type MetaGraphThreadResult<TTarget, TItem> = {
  records: Array<MetaGraphThreadRecord<TTarget, TItem>>
  topLevelResults: Array<{ target: TTarget; result: MetaGraphConnectionResult<TItem> }>
  replyResults: Array<{ target: TTarget; item: TItem; result: MetaGraphConnectionResult<TItem> }>
  pages: number
  replies: number
  capped: boolean
  error: string | null
  attemptedTargets: number
}

export function sanitizeMetaGraphCursorUrl(raw: string | undefined, graphBaseUrl: string): string | null {
  if (!raw) return null
  try {
    const base = new URL(graphBaseUrl)
    const url = new URL(raw, base)
    if (url.protocol !== "https:" || url.origin !== base.origin) return null
    url.searchParams.delete("access_token")
    url.searchParams.delete("appsecret_proof")
    return url.toString()
  } catch {
    return null
  }
}

export function metaGraphCursorFetchUrl(
  raw: string | undefined,
  graphBaseUrl: string,
  appSecretProof: string | null,
): string | null {
  const sanitized = sanitizeMetaGraphCursorUrl(raw, graphBaseUrl)
  if (!sanitized) return null
  const url = new URL(sanitized)
  if (appSecretProof) url.searchParams.set("appsecret_proof", appSecretProof)
  return url.toString()
}

/** Classify transport failures without treating auth/rate/server faults as data completion. */
export function classifyMetaGraphHttpFailure(
  status: number,
  requestUrl: string,
  responseBody = "",
): MetaGraphFailureClass {
  if (status === 404 || status === 410) return "terminal_target"
  const body = responseBody.toLowerCase()
  const ambiguousObject = /"error_subcode"\s*:\s*33\b|unsupported get request.*object with id/.test(body)
  // OAuth, permissions and rate-limit errors are frequently returned as HTTP
  // 400 by Graph. Ambiguous 400s must remain retryable; quarantining them would
  // silently convert a global outage into false coverage.
  if (
    /"code"\s*:\s*(190|4|10|17|32|200|613)\b/.test(body)
    || /oauth|rate.?limit/.test(body)
    || (!ambiguousObject && /permission/.test(body))
  ) {
    return "retryable"
  }
  if (status === 400) {
    if (/comments? (?:are|is) disabled|commenting (?:has been|is) (?:disabled|turned off)|object (?:was|has been|is) deleted/.test(body)) {
      return "terminal_target"
    }
    if (ambiguousObject) {
      // Graph's code=100/subcode=33 text is intentionally ambiguous (deleted
      // object vs per-object access). Give it bounded target-local retries;
      // planner quarantine happens only after repeated identical failures.
      return "retryable_target"
    }
    try {
      const url = new URL(requestUrl)
      const paged = url.searchParams.has("after") || url.searchParams.has("before")
      // Once auth/permission/rate errors are excluded above, a 400 on an
      // opaque provider paging URL is safe to restart from the first page.
      if (paged) return "invalid_cursor"
    } catch {
      return "retryable"
    }
  }
  return "retryable"
}

/**
 * Walk one Meta Graph connection with hard page/item limits. The first page
 * may already be embedded on a parent comment (for nested replies), otherwise
 * it is fetched from initialUrl. Provider paging URLs are never trusted for
 * credentials or cross-origin navigation.
 */
export async function collectMetaGraphConnection<T>(input: {
  graphBaseUrl: string
  appSecretProof: string | null
  initialUrl?: string
  initialPage?: MetaGraphConnectionPage<T>
  fetchPage: (url: string) => Promise<MetaGraphPageFetch<T>>
  maxPages: number
  maxItems: number
}): Promise<MetaGraphConnectionResult<T>> {
  const maxPages = Math.max(1, Math.trunc(input.maxPages))
  const maxItems = Math.max(0, Math.trunc(input.maxItems))
  if (maxItems === 0) return {
    items: [],
    pages: 0,
    capped: true,
    error: "meta_comments_max_items",
    resumeUrl: sanitizeMetaGraphCursorUrl(input.initialUrl, input.graphBaseUrl),
  }

  const items: T[] = []
  const seen = new Set<string>()
  let pages = 0
  let page = input.initialPage
  let url = input.initialUrl ?? null

  while (page || url) {
    if (pages >= maxPages) {
      return {
        items,
        pages,
        capped: true,
        error: "meta_comments_max_pages",
        resumeUrl: sanitizeMetaGraphCursorUrl(url ?? undefined, input.graphBaseUrl),
      }
    }
    if (!page) {
      if (!url || seen.has(url)) {
        return { items, pages, capped: true, error: "meta_comments_pagination_loop", resumeUrl: null, failureClass: "invalid_cursor" }
      }
      seen.add(url)
      const fetched = await input.fetchPage(url)
      if (!fetched.ok) {
        return {
          items,
          pages,
          capped: false,
          error: fetched.error,
          resumeUrl: sanitizeMetaGraphCursorUrl(url, input.graphBaseUrl),
          failureClass: fetched.failureClass ?? "retryable",
        }
      }
      page = fetched.data
    }

    pages += 1
    const pageItems = Array.isArray(page.data) ? page.data : []
    // Meta honors the requested 25/50 page size. Keep a fetched page atomic so
    // an item cap never drops the tail of that page; the bounded overshoot is
    // at most one provider page and resume starts at paging.next.
    items.push(...pageItems)

    const rawNext = page.paging?.next
    if (!rawNext) return { items, pages, capped: false, error: null, resumeUrl: null }
    const resumeUrl = sanitizeMetaGraphCursorUrl(rawNext, input.graphBaseUrl)
    if (!resumeUrl) {
      return { items, pages, capped: true, error: "meta_comments_pagination_url_rejected", resumeUrl: null, failureClass: "invalid_cursor" }
    }
    if (items.length >= maxItems) {
      return { items, pages, capped: true, error: "meta_comments_max_items", resumeUrl }
    }
    const next = metaGraphCursorFetchUrl(resumeUrl, input.graphBaseUrl, input.appSecretProof)
    if (!next) return { items, pages, capped: true, error: "meta_comments_pagination_url_rejected", resumeUrl: null, failureClass: "invalid_cursor" }
    page = undefined
    url = next
  }

  return { items, pages, capped: false, error: null, resumeUrl: null }
}

/** Walk top-level comment connections and any embedded reply connections. */
export async function collectMetaGraphCommentThreads<TTarget, TItem>(input: {
  targets: TTarget[]
  initialUrl: (target: TTarget) => string
  graphBaseUrl: string
  appSecretProof: string | null
  fetchPage: (url: string) => Promise<MetaGraphPageFetch<TItem>>
  embeddedReplies: (item: TItem, target: TTarget) => MetaGraphConnectionPage<TItem> | null | undefined
  itemId: (item: TItem) => string
  replyParentId?: (reply: TItem, topLevel: TItem) => string | null | undefined
  topLevelResumeUrl?: (target: TTarget) => string | null | undefined
  replyResumeUrl?: (item: TItem, target: TTarget) => string | null | undefined
  /** Previously persisted reply work whose top-level item shifted off-page. */
  pendingReplies?: Array<{ target: TTarget; item: TItem }>
  maxPages: number
  maxPagesPerConnection: number
  maxItems: number
}): Promise<MetaGraphThreadResult<TTarget, TItem>> {
  const records: Array<MetaGraphThreadRecord<TTarget, TItem>> = []
  const topLevelResults: Array<{ target: TTarget; result: MetaGraphConnectionResult<TItem> }> = []
  const replyResults: Array<{ target: TTarget; item: TItem; result: MetaGraphConnectionResult<TItem> }> = []
  const seenItemIds = new Set<string>()
  const maxPages = Math.max(1, Math.trunc(input.maxPages))
  const maxItems = Math.max(1, Math.trunc(input.maxItems))
  // Reserve capacity for both phases. Without a separate top-level budget, a
  // large first page can consume the entire record budget and starve replies
  // forever on every retry.
  const maxTopLevelItems = Math.max(1, Math.floor(maxItems / 2))
  const maxReplyItems = Math.max(1, maxItems - maxTopLevelItems)
  const maxTopLevelPages = Math.max(1, Math.floor(maxPages / 2))
  let pages = 0
  let replies = 0
  let capped = false
  let error: string | null = null
  let attemptedTargets = 0
  let attemptedReplyConnections = 0
  const topLevelRecords: Array<{ target: TTarget; item: TItem }> = []
  const mark = (nextError: string | null, nextCapped: boolean) => {
    if (nextError && !error) error = nextError
    if (nextCapped) capped = true
  }

  for (const target of input.targets) {
    if (topLevelRecords.length >= maxTopLevelItems || pages >= maxTopLevelPages || attemptedTargets >= maxTopLevelPages) {
      mark(topLevelRecords.length >= maxTopLevelItems ? "meta_comments_max_items" : "meta_comments_max_pages", true)
      break
    }
    attemptedTargets += 1
    const topLevelResumeUrl = input.topLevelResumeUrl?.(target)
    const topLevel = await collectMetaGraphConnection<TItem>({
      graphBaseUrl: input.graphBaseUrl,
      appSecretProof: input.appSecretProof,
      initialUrl: topLevelResumeUrl || input.initialUrl(target),
      fetchPage: input.fetchPage,
      maxPages: Math.min(input.maxPagesPerConnection, maxTopLevelPages - pages),
      maxItems: maxTopLevelItems - topLevelRecords.length,
    })
    pages += topLevel.pages
    mark(topLevel.error, topLevel.capped)
    topLevelResults.push({ target, result: topLevel })

    for (const item of topLevel.items) {
      const topLevelId = input.itemId(item)
      if (!topLevelId || seenItemIds.has(topLevelId)) continue
      seenItemIds.add(topLevelId)
      records.push({ target, item, replyToExternalId: null })
      topLevelRecords.push({ target, item })
    }
    if (topLevelRecords.length >= maxTopLevelItems) break
  }

  // Replies are deliberately a second pass: an early high-volume thread must
  // not consume the item budget before already-fetched top-level comments and
  // later parent targets are recorded.
  const replyCandidates: Array<{ target: TTarget; item: TItem }> = []
  const seenReplyCandidates = new Set<string>()
  for (const candidate of [...(input.pendingReplies ?? []), ...topLevelRecords]) {
    const key = input.itemId(candidate.item)
    if (!key || seenReplyCandidates.has(key)) continue
    seenReplyCandidates.add(key)
    replyCandidates.push(candidate)
  }
  for (const { target, item } of replyCandidates) {
    const embedded = input.embeddedReplies(item, target)
    const replyResumeUrl = input.replyResumeUrl?.(item, target)
    if (!replyResumeUrl && (!embedded || (!(embedded.data?.length) && !embedded.paging?.next))) continue
    if (replies >= maxReplyItems || pages >= maxPages || attemptedReplyConnections >= maxPages - maxTopLevelPages) {
      mark(replies >= maxReplyItems ? "meta_comments_max_items" : "meta_comments_max_pages", true)
      break
    }
    attemptedReplyConnections += 1
    const nested = await collectMetaGraphConnection<TItem>({
      graphBaseUrl: input.graphBaseUrl,
      appSecretProof: input.appSecretProof,
      ...(replyResumeUrl ? { initialUrl: replyResumeUrl } : { initialPage: embedded ?? undefined }),
      fetchPage: input.fetchPage,
      maxPages: Math.min(input.maxPagesPerConnection, maxPages - pages),
      maxItems: maxReplyItems - replies,
    })
    pages += nested.pages
    mark(nested.error, nested.capped)
    replyResults.push({ target, item, result: nested })
    for (const reply of nested.items) {
      const replyId = input.itemId(reply)
      if (!replyId || seenItemIds.has(replyId)) continue
      seenItemIds.add(replyId)
      records.push({
        target,
        item: reply,
        replyToExternalId: input.replyParentId?.(reply, item) || input.itemId(item),
      })
      replies += 1
    }
  }

  return { records, topLevelResults, replyResults, pages, replies, capped, error, attemptedTargets }
}
