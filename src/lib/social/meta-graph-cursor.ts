import { prisma } from "@/lib/prisma"
import type {
  MetaGraphConnectionPage,
  MetaGraphThreadResult,
} from "@/lib/social/meta-graph-pagination"

const META_GRAPH_CURSOR_ADAPTER = "META_GRAPH_PAGINATION_V1"
export const META_GRAPH_CURSOR_COMPLETE = "__complete__"
const META_GRAPH_QUARANTINE_REPROBE_MS = 24 * 60 * 60_000

export interface MetaGraphCursorAccount {
  id: string
  organizationId: string
}

export interface MetaGraphCursorStore {
  findUnique(input: Record<string, unknown>): Promise<{ cursorValue: string } | null>
  findMany(input: Record<string, unknown>): Promise<Array<{ cursorKey: string; cursorValue: string }>>
  upsert(input: Record<string, unknown>): Promise<unknown>
  deleteMany(input: Record<string, unknown>): Promise<unknown>
}

const defaultStore: MetaGraphCursorStore = {
  findUnique: input => prisma.socialConnectionCursor.findUnique(input as never),
  findMany: input => prisma.socialConnectionCursor.findMany(input as never),
  upsert: input => prisma.socialConnectionCursor.upsert(input as never),
  deleteMany: input => prisma.socialConnectionCursor.deleteMany(input as never),
}

function cursorIdentity(account: MetaGraphCursorAccount, cursorKey: string) {
  return {
    organizationId: account.organizationId,
    accountId: account.id,
    adapterKey: META_GRAPH_CURSOR_ADAPTER,
    cursorKey,
  }
}

export async function loadMetaGraphCursor(
  account: MetaGraphCursorAccount,
  cursorKey: string,
  store: MetaGraphCursorStore = defaultStore,
): Promise<string | null> {
  const row = await store.findUnique({
    where: { organizationId_accountId_adapterKey_cursorKey: cursorIdentity(account, cursorKey) },
    select: { cursorValue: true },
  })
  return row?.cursorValue?.trim() || null
}

export async function saveMetaGraphCursor(
  account: MetaGraphCursorAccount,
  cursorKey: string,
  cursorValue: string | null,
  store: MetaGraphCursorStore = defaultStore,
): Promise<void> {
  const identity = cursorIdentity(account, cursorKey)
  if (!cursorValue) {
    await store.deleteMany({ where: identity })
    return
  }
  await store.upsert({
    where: { organizationId_accountId_adapterKey_cursorKey: identity },
    create: { ...identity, cursorValue, cursorVersion: 1 },
    update: { cursorValue, cursorVersion: 1 },
  })
}

export async function listMetaGraphCursorKeys(
  account: MetaGraphCursorAccount,
  cursorKeyPrefix: string,
  store: MetaGraphCursorStore = defaultStore,
): Promise<string[]> {
  const rows = await store.findMany({
    where: {
      organizationId: account.organizationId,
      accountId: account.id,
      adapterKey: META_GRAPH_CURSOR_ADAPTER,
      cursorKey: { startsWith: cursorKeyPrefix },
    },
    select: { cursorKey: true, cursorValue: true },
    orderBy: { cursorKey: "asc" },
    take: 50_000,
  })
  return rows.filter(row => row.cursorValue.trim()).map(row => row.cursorKey)
}

export async function loadMetaGraphCursors(
  account: MetaGraphCursorAccount,
  cursorKeyPrefix: string,
  store: MetaGraphCursorStore = defaultStore,
): Promise<Map<string, string>> {
  const rows = await store.findMany({
    where: {
      organizationId: account.organizationId,
      accountId: account.id,
      adapterKey: META_GRAPH_CURSOR_ADAPTER,
      cursorKey: { startsWith: cursorKeyPrefix },
    },
    select: { cursorKey: true, cursorValue: true },
    orderBy: { cursorKey: "asc" },
    take: 50_000,
  })
  return new Map(rows.flatMap(row => {
    const value = row.cursorValue.trim()
    return value ? [[row.cursorKey, value] as const] : []
  }))
}

export async function clearMetaGraphCursorPrefix(
  account: MetaGraphCursorAccount,
  cursorKeyPrefix: string,
  store: MetaGraphCursorStore = defaultStore,
): Promise<void> {
  await store.deleteMany({
    where: {
      organizationId: account.organizationId,
      accountId: account.id,
      adapterKey: META_GRAPH_CURSOR_ADAPTER,
      cursorKey: { startsWith: cursorKeyPrefix },
    },
  })
}

export async function saveMetaGraphCursorUpdates(
  account: MetaGraphCursorAccount,
  updates: ReadonlyMap<string, string | null>,
  store: MetaGraphCursorStore = defaultStore,
): Promise<void> {
  // Keep writes sequential. A crash can cause harmless duplicate reads, but
  // never advances a cursor past records that have not already been ingested.
  const priority = (key: string) => key.includes(":target:") ? 0 : key.includes(":top:") ? 1 : key.includes(":reply:") ? 2 : 3
  const ordered = Array.from(updates.entries()).sort(([left], [right]) => priority(left) - priority(right))
  for (const [cursorKey, cursorValue] of ordered) {
    await saveMetaGraphCursor(account, cursorKey, cursorValue, store)
  }
}

export function metaGraphTopCursorKey(prefix: string, targetId: string): string {
  return `${prefix}top:${encodeURIComponent(targetId)}`
}

export function metaGraphTargetCursorKey(prefix: string, targetId: string): string {
  return `${prefix}target:${encodeURIComponent(targetId)}`
}

export function metaGraphWatchTargetCursorKey(prefix: string, targetId: string): string {
  return `${prefix}watch:${encodeURIComponent(targetId)}`
}

export function metaGraphStoredTargets(
  cursors: ReadonlyMap<string, string>,
  prefix: string,
): Array<{ id: string; url: string | null }> {
  const targetPrefix = `${prefix}target:`
  return Array.from(cursors.entries()).flatMap(([key, value]) => {
    if (!key.startsWith(targetPrefix)) return []
    try {
      const id = decodeURIComponent(key.slice(targetPrefix.length)).trim()
      if (!id) return []
      const parsed = JSON.parse(value) as { url?: unknown }
      return [{ id, url: typeof parsed.url === "string" && parsed.url.trim() ? parsed.url : null }]
    } catch {
      return []
    }
  })
}

export function metaGraphStoredWatchTargets(
  cursors: ReadonlyMap<string, string>,
  prefix: string,
): Array<{ id: string; url: string | null }> {
  const watchPrefix = `${prefix}watch:`
  return Array.from(cursors.entries()).flatMap(([key, value]) => {
    if (!key.startsWith(watchPrefix)) return []
    try {
      const id = decodeURIComponent(key.slice(watchPrefix.length)).trim()
      if (!id) return []
      const parsed = JSON.parse(value) as { url?: unknown }
      return [{ id, url: typeof parsed.url === "string" && parsed.url.trim() ? parsed.url : null }]
    } catch {
      return []
    }
  })
}

export function metaGraphTargetCursorValue(url: string | null | undefined): string {
  return JSON.stringify({ url: url?.trim() || null })
}

export function metaGraphReplyCursorKey(prefix: string, targetId: string, itemId: string): string {
  return `${prefix}reply:${encodeURIComponent(targetId)}:${encodeURIComponent(itemId)}`
}

function metaGraphTopResetCursorKey(prefix: string, targetId: string): string {
  return `${prefix}reset:top:${encodeURIComponent(targetId)}`
}

function metaGraphReplyResetCursorKey(prefix: string, targetId: string, itemId: string): string {
  return `${prefix}reset:reply:${encodeURIComponent(targetId)}:${encodeURIComponent(itemId)}`
}

function metaGraphTopRetryCursorKey(prefix: string, targetId: string): string {
  return `${prefix}retry:top:${encodeURIComponent(targetId)}`
}

function metaGraphReplyRetryCursorKey(prefix: string, targetId: string, itemId: string): string {
  return `${prefix}retry:reply:${encodeURIComponent(targetId)}:${encodeURIComponent(itemId)}`
}

function metaGraphTargetQuarantineCursorKey(prefix: string, targetId: string): string {
  return `${prefix}quarantine:target:${encodeURIComponent(targetId)}`
}

function metaGraphReplyQuarantineCursorKey(prefix: string, targetId: string, itemId: string): string {
  return `${prefix}quarantine:reply:${encodeURIComponent(targetId)}:${encodeURIComponent(itemId)}`
}

function metaGraphQuarantineCursorValue(error: string): string {
  return JSON.stringify({
    error,
    retryAfter: new Date(Date.now() + META_GRAPH_QUARANTINE_REPROBE_MS).toISOString(),
  })
}

function metaGraphQuarantineActive(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false
  try {
    const parsed = JSON.parse(value) as { retryAfter?: unknown }
    if (typeof parsed.retryAfter !== "string") return true
    const retryAfter = new Date(parsed.retryAfter).getTime()
    return Number.isFinite(retryAfter) && retryAfter > now
  } catch {
    // Legacy/plain quarantine rows remain fail-safe until an operator clears them.
    return true
  }
}

export function applyMetaGraphQuarantines(
  cursors: ReadonlyMap<string, string>,
  prefix: string,
): Map<string, string> {
  const effective = new Map(cursors)
  const targetPrefix = `${prefix}quarantine:target:`
  const replyPrefix = `${prefix}quarantine:reply:`
  for (const [key, value] of cursors) {
    try {
      if (key.startsWith(targetPrefix)) {
        const targetId = decodeURIComponent(key.slice(targetPrefix.length))
        if (!targetId) continue
        const topKey = metaGraphTopCursorKey(prefix, targetId)
        if (metaGraphQuarantineActive(value)) {
          effective.set(topKey, META_GRAPH_CURSOR_COMPLETE)
        } else {
          // Quarantine writes COMPLETE so the rest of a large batch can move.
          // Once its cooldown expires, hide that marker and restore enough
          // target metadata to perform the promised re-probe even if the
          // completed working batch was already cleared.
          if (effective.get(topKey) === META_GRAPH_CURSOR_COMPLETE) effective.delete(topKey)
          const targetKey = metaGraphTargetCursorKey(prefix, targetId)
          if (!effective.has(targetKey)) effective.set(targetKey, metaGraphTargetCursorValue(null))
        }
      } else if (key.startsWith(replyPrefix)) {
        const [encodedTargetId, encodedItemId, ...extra] = key.slice(replyPrefix.length).split(":")
        if (!encodedTargetId || !encodedItemId || extra.length > 0) continue
        const targetId = decodeURIComponent(encodedTargetId)
        const itemId = decodeURIComponent(encodedItemId)
        const replyKey = metaGraphReplyCursorKey(prefix, targetId, itemId)
        if (metaGraphQuarantineActive(value)) {
          effective.set(replyKey, META_GRAPH_CURSOR_COMPLETE)
        } else {
          if (effective.get(replyKey) === META_GRAPH_CURSOR_COMPLETE) effective.delete(replyKey)
          const topKey = metaGraphTopCursorKey(prefix, targetId)
          if (effective.get(topKey) === META_GRAPH_CURSOR_COMPLETE) effective.delete(topKey)
          const targetKey = metaGraphTargetCursorKey(prefix, targetId)
          if (!effective.has(targetKey)) effective.set(targetKey, metaGraphTargetCursorValue(null))
        }
      }
    } catch {
      // Ignore malformed operator/state rows; normal cursor validation remains fail-safe.
    }
  }
  return effective
}

export async function clearMetaGraphCommentBatchCursors(
  account: MetaGraphCursorAccount,
  prefix: string,
  store: MetaGraphCursorStore = defaultStore,
): Promise<void> {
  for (const suffix of ["target:", "top:", "reply:", "reset:top:", "reset:reply:", "retry:top:", "retry:reply:"]) {
    await clearMetaGraphCursorPrefix(account, `${prefix}${suffix}`, store)
  }
  await saveMetaGraphCursor(account, `${prefix}rotation`, null, store)
}

export function metaGraphStoredPendingReplies(
  cursors: ReadonlyMap<string, string>,
  prefix: string,
): Array<{ targetId: string; itemId: string; cursor: string }> {
  const replyPrefix = `${prefix}reply:`
  return Array.from(cursors.entries()).flatMap(([key, cursor]) => {
    if (!key.startsWith(replyPrefix) || cursor === META_GRAPH_CURSOR_COMPLETE) return []
    const [encodedTargetId, encodedItemId, ...extra] = key.slice(replyPrefix.length).split(":")
    if (!encodedTargetId || !encodedItemId || extra.length > 0) return []
    try {
      const targetId = decodeURIComponent(encodedTargetId).trim()
      const itemId = decodeURIComponent(encodedItemId).trim()
      return targetId && itemId ? [{ targetId, itemId, cursor }] : []
    } catch {
      return []
    }
  })
}

export function rotateMetaGraphTargets<T>(
  targets: T[],
  rotationTargetId: string | null | undefined,
  targetId: (target: T) => string,
): T[] {
  if (!rotationTargetId || targets.length < 2) return targets
  const start = targets.findIndex(target => targetId(target) === rotationTargetId)
  return start > 0 ? [...targets.slice(start), ...targets.slice(0, start)] : targets
}

export type MetaGraphCommentCursorPlan = {
  updates: Map<string, string | null>
  allTargetsComplete: boolean
  nextRotationTargetId: string | null
  terminalTargetIds: string[]
  terminalReplyIds: string[]
  invalidCursorResets: number
}

/**
 * Plan cursor movement for a fetched comment batch. This function is pure:
 * callers must persist the returned updates only after every returned record
 * has been durably ingested. A top-level page is not advanced until all reply
 * connections embedded in that page are complete, preventing reply loss on a
 * capped or failed nested traversal.
 */
export function planMetaGraphCommentCursorUpdates<TTarget, TItem>(input: {
  cursorPrefix: string
  allTargets: TTarget[]
  orderedActiveTargets: TTarget[]
  existing: ReadonlyMap<string, string>
  result: MetaGraphThreadResult<TTarget, TItem>
  targetId: (target: TTarget) => string
  itemId: (item: TItem) => string
  embeddedReplies: (item: TItem, target: TTarget) => MetaGraphConnectionPage<TItem> | null | undefined
  initialTopLevelCursor: (target: TTarget) => string
  initialReplyCursor: (item: TItem, target: TTarget) => string
}): MetaGraphCommentCursorPlan {
  const updates = new Map<string, string | null>()
  const terminalTargetIds: string[] = []
  const terminalReplyIds: string[] = []
  let invalidCursorResets = 0
  const valueFor = (key: string): string | undefined => {
    if (updates.has(key)) return updates.get(key) ?? undefined
    return input.existing.get(key)
  }
  const replyResultByKey = new Map(input.result.replyResults.map(({ target, item, result }) => [
    metaGraphReplyCursorKey(input.cursorPrefix, input.targetId(target), input.itemId(item)),
    result,
  ] as const))

  // Persist standalone/pending reply progress even when its top-level comment
  // shifted off the currently returned page.
  for (const { target, item, result } of input.result.replyResults) {
    const targetExternalId = input.targetId(target)
    const itemExternalId = input.itemId(item)
    const replyKey = metaGraphReplyCursorKey(input.cursorPrefix, targetExternalId, itemExternalId)
    const resetKey = metaGraphReplyResetCursorKey(input.cursorPrefix, targetExternalId, itemExternalId)
    const quarantineKey = metaGraphReplyQuarantineCursorKey(input.cursorPrefix, targetExternalId, itemExternalId)
    const retryKey = metaGraphReplyRetryCursorKey(input.cursorPrefix, targetExternalId, itemExternalId)
    if (result.failureClass === "terminal_target") {
      updates.set(replyKey, META_GRAPH_CURSOR_COMPLETE)
      updates.set(quarantineKey, metaGraphQuarantineCursorValue(result.error ?? "terminal_target"))
      updates.set(resetKey, null)
      updates.set(retryKey, null)
      terminalReplyIds.push(itemExternalId)
    } else if (result.failureClass === "retryable_target") {
      const attempts = Math.max(0, Number.parseInt(valueFor(retryKey) ?? "0", 10) || 0) + 1
      if (attempts >= 3) {
        updates.set(replyKey, META_GRAPH_CURSOR_COMPLETE)
        updates.set(quarantineKey, metaGraphQuarantineCursorValue(result.error ?? "retryable_target_exhausted"))
        updates.set(retryKey, null)
        terminalReplyIds.push(itemExternalId)
      } else {
        // The top-level comment can shift out of the provider's live first
        // page before the next run. Persist the failed reply page immediately
        // so pendingReplies can resume it independently without replaying past
        // any reply records that were already durably ingested.
        updates.set(replyKey, result.resumeUrl ?? input.initialReplyCursor(item, target))
        updates.set(retryKey, String(attempts))
      }
    } else if (result.failureClass === "invalid_cursor") {
      if (valueFor(resetKey)) {
        updates.set(replyKey, META_GRAPH_CURSOR_COMPLETE)
        updates.set(quarantineKey, metaGraphQuarantineCursorValue(result.error ?? "invalid_cursor_repeated"))
        terminalReplyIds.push(itemExternalId)
      } else {
        updates.set(replyKey, input.initialReplyCursor(item, target))
        updates.set(resetKey, "1")
        invalidCursorResets += 1
      }
      updates.set(retryKey, null)
    } else if (result.resumeUrl) {
      updates.set(replyKey, result.resumeUrl)
    } else if (!result.error) {
      updates.set(replyKey, META_GRAPH_CURSOR_COMPLETE)
      updates.set(resetKey, null)
      updates.set(retryKey, null)
      updates.set(quarantineKey, null)
    }
  }

  // Record an explicit starting point even for targets not reached under this
  // run's global budget. This makes every fetched parent resumable if the live
  // parent listing shifts before the next run.
  for (const target of input.allTargets) {
    const topKey = metaGraphTopCursorKey(input.cursorPrefix, input.targetId(target))
    if (!valueFor(topKey)) updates.set(topKey, input.initialTopLevelCursor(target))
  }

  for (const { target, result } of input.result.topLevelResults) {
    const targetExternalId = input.targetId(target)
    const topKey = metaGraphTopCursorKey(input.cursorPrefix, targetExternalId)
    const topResetKey = metaGraphTopResetCursorKey(input.cursorPrefix, targetExternalId)
    const topRetryKey = metaGraphTopRetryCursorKey(input.cursorPrefix, targetExternalId)
    const topQuarantineKey = metaGraphTargetQuarantineCursorKey(input.cursorPrefix, targetExternalId)
    const targetReplyPrefix = `${input.cursorPrefix}reply:${encodeURIComponent(targetExternalId)}:`
    let repliesComplete = true

    for (const item of result.items) {
      const itemExternalId = input.itemId(item)
      if (!itemExternalId) continue
      const replyKey = metaGraphReplyCursorKey(input.cursorPrefix, targetExternalId, itemExternalId)
      const existingReplyCursor = valueFor(replyKey)
      const embedded = input.embeddedReplies(item, target)
      const hasEmbeddedReplyConnection = Boolean(embedded?.data?.length || embedded?.paging?.next)
      const replyResult = replyResultByKey.get(replyKey)
      const hasReplyWork = Boolean(existingReplyCursor || hasEmbeddedReplyConnection || replyResult)
      if (!hasReplyWork) continue

      if (existingReplyCursor === META_GRAPH_CURSOR_COMPLETE) continue
      repliesComplete = false
    }
    // A reply cursor can outlive the top-level page item when the provider's
    // live ordering changes. It must finish through pendingReplies before the
    // top cursor is allowed to move.
    const targetReplyKeys = new Set([
      ...Array.from(input.existing.keys()).filter(key => key.startsWith(targetReplyPrefix)),
      ...Array.from(updates.keys()).filter(key => key.startsWith(targetReplyPrefix)),
    ])
    for (const replyKey of targetReplyKeys) {
      const value = valueFor(replyKey)
      if (value && value !== META_GRAPH_CURSOR_COMPLETE) repliesComplete = false
    }

    if (result.failureClass === "terminal_target") {
      updates.set(topKey, META_GRAPH_CURSOR_COMPLETE)
      updates.set(topQuarantineKey, metaGraphQuarantineCursorValue(result.error ?? "terminal_target"))
      updates.set(topResetKey, null)
      updates.set(topRetryKey, null)
      terminalTargetIds.push(targetExternalId)
      for (const replyKey of targetReplyKeys) updates.set(replyKey, null)
      continue
    }
    if (result.failureClass === "retryable_target") {
      const attempts = Math.max(0, Number.parseInt(valueFor(topRetryKey) ?? "0", 10) || 0) + 1
      if (attempts >= 3) {
        updates.set(topKey, META_GRAPH_CURSOR_COMPLETE)
        updates.set(topQuarantineKey, metaGraphQuarantineCursorValue(result.error ?? "retryable_target_exhausted"))
        updates.set(topRetryKey, null)
        terminalTargetIds.push(targetExternalId)
        for (const replyKey of targetReplyKeys) updates.set(replyKey, null)
      } else {
        updates.set(topRetryKey, String(attempts))
      }
      continue
    }
    if (result.failureClass === "invalid_cursor") {
      if (valueFor(topResetKey)) {
        updates.set(topKey, META_GRAPH_CURSOR_COMPLETE)
        updates.set(topQuarantineKey, metaGraphQuarantineCursorValue(result.error ?? "invalid_cursor_repeated"))
        terminalTargetIds.push(targetExternalId)
        for (const replyKey of targetReplyKeys) updates.set(replyKey, null)
      } else {
        updates.set(topKey, input.initialTopLevelCursor(target))
        updates.set(topResetKey, "1")
        invalidCursorResets += 1
      }
      updates.set(topRetryKey, null)
      continue
    }
    if (result.failureClass === "retryable" || !repliesComplete) continue
    if (result.resumeUrl) {
      updates.set(topKey, result.resumeUrl)
    } else if (!result.error) {
      updates.set(topKey, META_GRAPH_CURSOR_COMPLETE)
    } else {
      continue
    }
    updates.set(topResetKey, null)
    updates.set(topRetryKey, null)
    updates.set(topQuarantineKey, null)
    // Once the top cursor leaves this page, its per-comment completion markers
    // are no longer needed. Clearing after ingest only causes safe duplicates
    // if a process exits between these idempotent writes.
    for (const replyKey of targetReplyKeys) updates.set(replyKey, null)
  }

  const pendingTargets = input.allTargets.filter(target => {
    const key = metaGraphTopCursorKey(input.cursorPrefix, input.targetId(target))
    return valueFor(key) !== META_GRAPH_CURSOR_COMPLETE
  })
  const allReplyKeys = new Set([
    ...Array.from(input.existing.keys()).filter(key => key.startsWith(`${input.cursorPrefix}reply:`)),
    ...Array.from(updates.keys()).filter(key => key.startsWith(`${input.cursorPrefix}reply:`)),
  ])
  const hasPendingReplies = Array.from(allReplyKeys).some(key => {
    const value = valueFor(key)
    return Boolean(value && value !== META_GRAPH_CURSOR_COMPLETE)
  })
  const allTargetsComplete = pendingTargets.length === 0 && !hasPendingReplies

  let nextRotationTargetId: string | null = null
  if (pendingTargets.length > 0) {
    const attemptedIds = new Set(input.result.topLevelResults.map(({ target }) => input.targetId(target)))
    const unattempted = input.orderedActiveTargets.find(target => (
      !attemptedIds.has(input.targetId(target))
      && pendingTargets.some(pending => input.targetId(pending) === input.targetId(target))
    ))
    nextRotationTargetId = input.targetId(unattempted ?? pendingTargets[0])
  }

  return {
    updates,
    allTargetsComplete,
    nextRotationTargetId,
    terminalTargetIds,
    terminalReplyIds,
    invalidCursorResets,
  }
}
