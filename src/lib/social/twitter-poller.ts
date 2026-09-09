import { prisma } from "@/lib/prisma"
import { ingestMentionWithResult, findMatchedKeyword } from "@/lib/social/ingest-mention"
import { encryptToken, decryptToken } from "@/lib/secure-token"
import { observationContextForCollector, routeExecutionMetadata } from "@/lib/social/collector-observation-context"
import type { MonitoringCollectorResult, MonitoringSourceForRun } from "@/lib/social/monitoring-collector"
import {
  isSocialProviderTimeoutError,
  withSocialProviderTimeout,
} from "@/lib/social/provider-request-timeout"

interface TwitterTweet {
  id: string
  text: string
  created_at?: string
  author_id?: string
  public_metrics?: { retweet_count?: number; like_count?: number; reply_count?: number; quote_count?: number }
}

interface TwitterUser {
  id: string
  username: string
  name: string
  profile_image_url?: string
}

interface TwitterSearchResponse {
  data?: TwitterTweet[]
  includes?: { users?: TwitterUser[] }
  meta?: { next_token?: string; newest_id?: string }
}

type TwitterTokenResult =
  | { token: string; error: null }
  | { token: null; error: string }

type TwitterPollResult = {
  ingested: number
  error?: string
  found?: number
  duplicates?: number
  ignored?: number
  providerRequestDispatched: boolean
  dispatchUnknown: boolean
}

function providerRequestTimeoutMs(source?: MonitoringSourceForRun): number | undefined {
  const seconds = source?.routeExecution?.timeoutSeconds
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? Math.max(1, seconds) * 1_000
    : undefined
}

async function refreshTokenIfNeeded(
  account: { id: string; accessToken: string | null; tokenExpiresAt: Date | null },
  timeoutMs?: number,
  parentSignal?: AbortSignal,
): Promise<TwitterTokenResult> {
  if (!account.accessToken) return { token: null, error: "no token" }
  let decrypted: string
  try {
    decrypted = decryptToken(account.accessToken, "oauth:twitter")
  } catch {
    return { token: null, error: "no token" }
  }
  const [access, refresh] = decrypted.split("::")
  const isExpired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 60_000
  if (!isExpired) return access
    ? { token: access, error: null }
    : { token: null, error: "no token" }
  // If the token is expired and we have no refresh token, the session is unusable —
  // fail fast instead of letting the caller burn quota on a guaranteed-401.
  if (!refresh) return { token: null, error: "no token" }

  const clientId = process.env.TWITTER_CLIENT_ID
  const clientSecret = process.env.TWITTER_CLIENT_SECRET
  if (!clientId) return { token: null, error: "no token" }

  let refreshed:
    | { ok: true; payload: { access_token?: string; refresh_token?: string; expires_in?: number } }
    | { ok: false; status: number; body: string }
  try {
    refreshed = await withSocialProviderTimeout("x_token_refresh", async signal => {
      const response = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(clientSecret ? { Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64") } : {}),
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: clientId,
        }).toString(),
        signal,
      })
      if (!response.ok) {
        return { ok: false as const, status: response.status, body: await response.text() }
      }
      return {
        ok: true as const,
        payload: await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number },
      }
    }, { timeoutMs, signal: parentSignal })
  } catch (error) {
    return {
      token: null,
      error: isSocialProviderTimeoutError(error)
        ? "x_token_refresh_timeout"
        : "x_token_refresh_network",
    }
  }

  if (!refreshed.ok) {
    console.error("[twitter-poller] refresh failed:", refreshed.status, refreshed.body)
    // Mark the account inactive so the operator can reconnect instead of us
    // silently burning API quota every polling cycle.
    await prisma.socialAccount.update({ where: { id: account.id }, data: { isActive: false } }).catch(() => {})
    return { token: null, error: "no token" }
  }
  const json = refreshed.payload
  if (!json.access_token) return { token: null, error: "no token" }
  const newStored = encryptToken(
    [json.access_token, json.refresh_token || refresh].join("::"),
    "oauth:twitter",
  )
  const newExpires = json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: { accessToken: newStored, tokenExpiresAt: newExpires },
  })
  return { token: json.access_token, error: null }
}

/**
 * Poll a single Twitter SocialAccount for recent mentions.
 * Query = @handle + ORs of keywords.
 * Upserts results into SocialMention.
 */
export async function pollTwitterAccount(accountId: string, source?: MonitoringSourceForRun): Promise<TwitterPollResult> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } })
  if (!account || account.platform !== "twitter" || !account.isActive) {
    return {
      ingested: 0,
      error: "not active twitter account",
      providerRequestDispatched: false,
      dispatchUnknown: false,
    }
  }

  const timeoutMs = providerRequestTimeoutMs(source)
  const tokenResult = await refreshTokenIfNeeded(account, timeoutMs, source?.providerRequestSignal)
  if (!tokenResult.token) {
    return {
      ingested: 0,
      error: tokenResult.error,
      providerRequestDispatched: false,
      dispatchUnknown: false,
    }
  }
  const token = tokenResult.token

  // Build recent-search query: mentions of handle + keywords
  const parts = [`@${account.handle}`, ...account.keywords.map((k: string) => `"${k.replace(/"/g, "")}"`)]
  const query = parts.map(p => `(${p})`).join(" OR ")

  const maxItems = Math.max(10, Math.min(source?.routeExecution?.maxItems ?? 100, 1000))
  let ingested = 0
  let found = 0
  let duplicates = 0
  let ignored = 0
  let nextToken: string | undefined
  let pages = 0
  const maxPages = Math.min(100, Math.max(10, Math.ceil(maxItems / 10)))
  const seenNextTokens = new Set<string>()
  do {
    if (pages >= maxPages) {
      return {
        ingested,
        found,
        duplicates,
        ignored,
        error: "x_pagination_max_pages",
        providerRequestDispatched: true,
        dispatchUnknown: false,
      }
    }
    if (source?.providerRequestSignal?.aborted) {
      return {
        ingested,
        found,
        duplicates,
        ignored,
        error: "x_api_timeout",
        providerRequestDispatched: pages > 0,
        dispatchUnknown: pages > 0,
      }
    }
    const url = new URL("https://api.twitter.com/2/tweets/search/recent")
    url.searchParams.set("query", query + " -is:retweet")
    url.searchParams.set("max_results", String(Math.max(10, Math.min(100, maxItems - found))))
    url.searchParams.set("tweet.fields", "created_at,public_metrics,author_id,lang")
    url.searchParams.set("expansions", "author_id")
    url.searchParams.set("user.fields", "username,name,profile_image_url")
    if (nextToken) url.searchParams.set("next_token", nextToken)
    let search:
      | { ok: true; data: TwitterSearchResponse }
      | { ok: false; status: number; body: string }
    try {
      search = await withSocialProviderTimeout("x_api", async signal => {
        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        })
        if (!response.ok) {
          return { ok: false as const, status: response.status, body: await response.text() }
        }
        return { ok: true as const, data: await response.json() as TwitterSearchResponse }
      }, { timeoutMs, signal: source?.providerRequestSignal })
    } catch (error) {
      return {
        ingested,
        found,
        duplicates,
        ignored,
        error: isSocialProviderTimeoutError(error) ? "x_api_timeout" : "x_api_network",
        providerRequestDispatched: true,
        dispatchUnknown: true,
      }
    }
    if (!search.ok) {
      console.error("[twitter-poller] search failed:", search.status, search.body)
      return {
        ingested,
        found,
        duplicates,
        ignored,
        error: `search failed ${search.status}`,
        providerRequestDispatched: true,
        dispatchUnknown: false,
      }
    }
    const data = search.data
    pages += 1
    const users = new Map<string, TwitterUser>()
    for (const user of data.includes?.users || []) users.set(user.id, user)
    for (const t of data.data || []) {
    if (source?.providerRequestSignal?.aborted) {
      return {
        ingested,
        found,
        duplicates,
        ignored,
        error: "x_api_timeout",
        providerRequestDispatched: true,
        dispatchUnknown: true,
      }
    }
    found += 1
    const author = t.author_id ? users.get(t.author_id) : undefined
    const metrics = t.public_metrics || {}
    const engagement =
      (metrics.like_count || 0) +
      (metrics.retweet_count || 0) +
      (metrics.reply_count || 0) +
      (metrics.quote_count || 0)

    try {
      // ingestMention (not a raw upsert) so tweets get a real sourceType and run
      // through scenario keyword matching, clustering, and workflow triggers.
      const result = await ingestMentionWithResult({
        organizationId: account.organizationId,
        accountId: account.id,
        platform: "twitter",
        externalId: t.id,
        sourceType: "mention",
        // NOT "native": these are strangers' tweets found by keyword search, not
        // owned-page content. "native" would put them in the owned stream AND give
        // them reply-policy tier official_owned — one click away from live-replying
        // to a random tweet from the brand account. "manual" matches the schema
        // default these rows always had (reply stays draft-only, triage whitelisted).
        // Official acquisition does not mean the external tweet is owned by the
        // connected brand identity. Keep reply policy separate from read access.
        sourceProvider: "official_api",
        sourceMetadata: source ? { officialCollector: true, ...routeExecutionMetadata(source) } : { officialCollector: true },
        text: t.text,
        sentiment: null,
        // Keywords first: the handle is often a substring of a keyword (brand ⊂ BrandName)
        // and the explicit term is the more meaningful "why did this match" answer.
        matchedTerm: findMatchedKeyword(t.text, [...account.keywords, `@${account.handle}`, account.handle]),
        engagement,
        reach: metrics.retweet_count || 0,
        url: author ? `https://twitter.com/${author.username}/status/${t.id}` : null,
        authorName: author?.name ?? null,
        authorHandle: author?.username ?? null,
        authorAvatar: author?.profile_image_url ?? null,
        publishedAt: t.created_at ? new Date(t.created_at) : new Date(),
        ...(source ? {
          observation: observationContextForCollector(source, {
            providerItemId: t.id,
            rawPayload: { tweet: t, author },
            requireMatchedTerm: true,
          }),
        } : {}),
      })
      if (result.accepted === false) ignored += 1
      else if (result.created) ingested += 1
      else duplicates += 1
    } catch (e) {
      console.error("[twitter-poller] ingest failed for tweet", t.id, e)
    }
    }
    nextToken = data.meta?.next_token
    if (nextToken) {
      if (seenNextTokens.has(nextToken)) {
        return {
          ingested,
          found,
          duplicates,
          ignored,
          error: "x_pagination_token_repeated",
          providerRequestDispatched: true,
          dispatchUnknown: false,
        }
      }
      seenNextTokens.add(nextToken)
    }
  } while (nextToken && found < maxItems)

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: { lastPolledAt: new Date() },
  })

  return {
    ingested,
    found,
    duplicates,
    ignored,
    providerRequestDispatched: true,
    dispatchUnknown: false,
  }
}

export async function runXOfficialCollector(source: MonitoringSourceForRun): Promise<MonitoringCollectorResult> {
  const settings = source.settings && typeof source.settings === "object" && !Array.isArray(source.settings)
    ? source.settings as Record<string, unknown>
    : {}
  const accountId = typeof settings.socialAccountId === "string" ? settings.socialAccountId : null
  const account = await prisma.socialAccount.findFirst({
    where: { organizationId: source.organizationId, platform: "twitter", isActive: true, accessToken: { not: null }, ...(accountId ? { id: accountId } : {}) },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  })
  if (!account) return {
    status: "skipped",
    foundCount: 0,
    newCount: 0,
    duplicateCount: 0,
    ignoredCount: 0,
    error: "x_official_account_missing",
    rawStats: {
      platform: "twitter",
      adapter: "X_API",
      coverageClass: "BLOCKED",
      providerRequestDispatched: false,
      dispatchUnknown: false,
    },
  }
  const result = await pollTwitterAccount(account.id, source)
  return {
    // A transport failure after the paid search GET started has unknown quota
    // exposure. Keep it failed even when earlier pages yielded findings so the
    // budget ledger cannot misclassify the run as successfully settled.
    status: result.dispatchUnknown
      ? "failed"
      : result.error
        ? (result.found ? "partial" : "failed")
        : "success",
    foundCount: result.found ?? result.ingested,
    newCount: result.ingested,
    duplicateCount: result.duplicates ?? 0,
    ignoredCount: result.ignored ?? 0,
    error: result.error ?? null,
    rawStats: {
      platform: "twitter",
      adapter: "X_API",
      coverageClass: result.error ? "PARTIAL" : "COMPLETE_FOR_QUERY_WINDOW",
      providerRequestDispatched: result.providerRequestDispatched,
      dispatchUnknown: result.dispatchUnknown,
    },
  }
}

/**
 * Poll all active Twitter accounts for a given org (or all orgs).
 */
export async function pollAllTwitter(orgId?: string): Promise<{ total: number; perAccount: Array<{ accountId: string; handle: string; ingested: number; error?: string }> }> {
  const accounts = await prisma.socialAccount.findMany({
    where: {
      platform: "twitter",
      isActive: true,
      accessToken: { not: null },
      ...(orgId ? { organizationId: orgId } : {}),
    },
  })

  const perAccount: Array<{ accountId: string; handle: string; ingested: number; error?: string }> = []
  let total = 0
  for (const a of accounts) {
    const r = await pollTwitterAccount(a.id)
    perAccount.push({ accountId: a.id, handle: a.handle, ingested: r.ingested, error: r.error })
    total += r.ingested
  }
  return { total, perAccount }
}
