import { prisma } from "@/lib/prisma"
import { encryptToken, decryptToken } from "@/lib/secure-token"
import { ingestMention, findMatchedKeyword } from "@/lib/social/ingest-mention"
import { withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"

/**
 * YouTube poller — fetches recent comments across the authenticated channel
 * via the commentThreads endpoint. For keyword-based mention search across
 * public YouTube, use the Search API (additional quota cost).
 */

export async function refreshYouTubeToken(
  account: { id: string; accessToken: string | null; tokenExpiresAt: Date | null },
  parentSignal?: AbortSignal,
): Promise<string | null> {
  if (!account.accessToken) return null
  let decrypted: string
  try { decrypted = decryptToken(account.accessToken, "oauth:youtube") } catch { return null }
  const [access, refresh] = decrypted.split("::")
  const expired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 60_000
  if (!expired) return access
  if (!refresh) return null

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const tokenResponse = await withSocialProviderTimeout("youtube", async signal => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }).toString(),
      signal,
    })
    return {
      response,
      payload: response.ok
        ? await response.json() as { access_token: string; expires_in?: number }
        : null,
    }
  }, { signal: parentSignal })
  if (!tokenResponse.response.ok) {
    await prisma.socialAccount.update({ where: { id: account.id }, data: { isActive: false } }).catch(() => {})
    return null
  }
  const j = tokenResponse.payload as { access_token: string; expires_in?: number }
  const stored = encryptToken([j.access_token, refresh].join("::"), "oauth:youtube")
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: stored,
      tokenExpiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
    },
  })
  return j.access_token
}

export async function pollYouTubeAccount(accountId: string): Promise<{ ingested: number; error?: string }> {
  const account = await prisma.socialAccount.findUnique({ where: { id: accountId } })
  if (!account || account.platform !== "youtube" || !account.isActive) return { ingested: 0, error: "inactive" }
  const token = await refreshYouTubeToken(account)
  if (!token) return { ingested: 0, error: "no token" }

  const runStartedAt = new Date()
  const watermark = account.lastPolledAt instanceof Date ? account.lastPolledAt : null
  const seenPageTokens = new Set<string>()
  let pageToken: string | null = null
  let ingested = 0

  while (true) {
    // allThreadsRelatedToChannelId fetches comments on videos owned by the channel.
    // `order=time` plus the last successful watermark makes subsequent polls
    // incremental while the first run walks the complete available history.
    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads")
    url.searchParams.set("part", "snippet")
    url.searchParams.set("allThreadsRelatedToChannelId", account.handle)
    url.searchParams.set("maxResults", "100")
    url.searchParams.set("order", "time")
    if (pageToken) url.searchParams.set("pageToken", pageToken)

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return { ingested, error: `threads failed ${res.status}` }
    const json = (await res.json()) as {
      nextPageToken?: string
      items?: Array<{
        id: string
        snippet?: {
          videoId?: string
          topLevelComment?: {
            snippet: {
              textDisplay: string
              authorDisplayName?: string
              authorProfileImageUrl?: string
              publishedAt?: string
              likeCount?: number
            }
          }
        }
      }>
    }

    let reachedWatermark = false
    for (const item of json.items || []) {
      const c = item.snippet?.topLevelComment?.snippet
      if (!c || !c.textDisplay) continue
      const publishedAt = c.publishedAt ? new Date(c.publishedAt) : null
      if (watermark && publishedAt && !Number.isNaN(publishedAt.getTime()) && publishedAt.getTime() <= watermark.getTime()) {
        reachedWatermark = true
        continue
      }
      const videoId = item.snippet?.videoId
      try {
        // ingestMention (not a raw upsert) so the comment gets sourceType="comment",
        // runs through scenario keyword matching, clustering, and workflow triggers.
        // &lc= deep-links the comment AND keeps its URL unique per comment.
        await ingestMention({
          organizationId: account.organizationId,
          accountId: account.id,
          platform: "youtube",
          externalId: item.id,
          sourceType: "comment",
          sourceProvider: "native",
          sourceMetadata: videoId ? { videoId } : {},
          text: c.textDisplay,
          sentiment: null,
          matchedTerm: findMatchedKeyword(c.textDisplay, account.keywords),
          engagement: c.likeCount || 0,
          url: videoId ? `https://www.youtube.com/watch?v=${videoId}&lc=${encodeURIComponent(item.id)}` : null,
          authorName: c.authorDisplayName ?? null,
          authorAvatar: c.authorProfileImageUrl ?? null,
          publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : new Date(),
        })
        ingested++
      } catch (e) {
        console.error("[youtube-poller] ingest failed", e)
      }
    }

    const nextPageToken = json.nextPageToken?.trim() || null
    if (reachedWatermark || !nextPageToken) break
    if (seenPageTokens.has(nextPageToken)) return { ingested, error: "threads pagination loop" }
    seenPageTokens.add(nextPageToken)
    pageToken = nextPageToken
  }

  // Advance only after a complete traversal (or reaching the previous
  // watermark). Mid-pagination failures retry safely through ingest dedupe.
  await prisma.socialAccount.update({ where: { id: account.id }, data: { lastPolledAt: runStartedAt } })
  return { ingested }
}

export async function pollAllYouTube(orgId?: string): Promise<{ total: number; accounts: number }> {
  const accounts = await prisma.socialAccount.findMany({
    where: {
      platform: "youtube",
      isActive: true,
      accessToken: { not: null },
      ...(orgId ? { organizationId: orgId } : {}),
    },
  })
  let total = 0
  for (const a of accounts) {
    const r = await pollYouTubeAccount(a.id)
    total += r.ingested
  }
  return { total, accounts: accounts.length }
}
