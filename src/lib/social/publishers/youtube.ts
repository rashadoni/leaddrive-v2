import { decryptToken } from "@/lib/secure-token"
import type { SocialReplyPublisher, SocialReplyPublishInput, SocialReplyPublishResult } from "./types"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parentCommentId(input: SocialReplyPublishInput): string {
  const metadata = record(input.sourceMetadata)
  const topLevelId = typeof metadata.topLevelCommentId === "string" ? metadata.topLevelCommentId.trim() : ""
  return topLevelId || input.externalId
}

async function publishYouTubeReply(input: SocialReplyPublishInput): Promise<SocialReplyPublishResult> {
  if (!input.senderAccount.accessToken) return { ok: false, error: "sender_account_not_connected", retriable: false }
  const token = await accessTokenForPublish(input)
  if (!token) return { ok: false, error: "youtube_token_unavailable", retriable: false }

  try {
    const response = await fetch("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          parentId: parentCommentId(input),
          textOriginal: input.replyText,
        },
      }),
    })
    const body = await response.json().catch(() => ({})) as {
      id?: string
      error?: { message?: string; errors?: Array<{ reason?: string }> }
    }
    if (response.ok && body.id) return { ok: true, externalReplyId: body.id }
    const reason = body.error?.errors?.[0]?.reason
    const retriable = response.status === 429 || response.status >= 500 || reason === "backendError"
    return {
      ok: false,
      error: reason || body.error?.message || `youtube_http_${response.status}`,
      retriable,
    }
  } catch {
    return { ok: false, error: "network_error", retriable: true }
  }
}

async function accessTokenForPublish(input: SocialReplyPublishInput): Promise<string | null> {
  let decrypted: string
  try {
    decrypted = decryptToken(input.senderAccount.accessToken as string, "oauth:youtube")
  } catch {
    return null
  }
  const [access, refresh] = decrypted.split("::")
  const expiresAt = input.senderAccount.tokenExpiresAt
  if (!expiresAt || expiresAt.getTime() >= Date.now() + 60_000) return access || null
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!refresh || !clientId || !clientSecret) return null
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  })
  if (!response.ok) return null
  const body = await response.json().catch(() => null) as { access_token?: string } | null
  return body?.access_token?.trim() || null
}

export const youtubeReplyPublisher: SocialReplyPublisher = {
  platform: "youtube",
  publishReply: publishYouTubeReply,
}
