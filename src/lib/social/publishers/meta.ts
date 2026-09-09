import { decryptToken } from "@/lib/secure-token"
import type { SocialReplyPublisher, SocialReplyPublishInput, SocialReplyPublishResult } from "./types"

const GRAPH = "https://graph.facebook.com/v21.0"

/**
 * Publishes replies through the Meta Graph API.
 * Instagram: POST /{ig-comment-id}/replies (page token of the linked page).
 * Facebook: POST /{comment-id}/comments (comment reply) or /{post-id}/comments.
 * Both platforms store the page token on SocialAccount.accessToken encrypted
 * with purpose `oauth:{platform}:{handle}` (see oauth/facebook/callback).
 */
async function publishViaGraph(
  platform: "instagram" | "facebook",
  input: SocialReplyPublishInput,
): Promise<SocialReplyPublishResult> {
  const { senderAccount, externalId, replyText } = input
  if (!senderAccount.accessToken) {
    return { ok: false, error: "sender_account_not_connected", retriable: false }
  }

  let token: string
  try {
    token = decryptToken(senderAccount.accessToken, `oauth:${platform}:${senderAccount.handle}`)
  } catch {
    return { ok: false, error: "token_decrypt_failed", retriable: false }
  }
  if (!token) return { ok: false, error: "token_empty", retriable: false }

  // IG replies to comments via /replies; FB replies to comments and posts via /comments.
  const edge = platform === "instagram" ? "replies" : "comments"
  const url = `${GRAPH}/${encodeURIComponent(externalId)}/${edge}`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: replyText, access_token: token }),
    })
    const json = await res.json().catch(() => ({})) as { id?: string; error?: { message?: string; code?: number } }
    if (!res.ok || json.error) {
      const code = json.error?.code
      // 4 = rate limit, 2 = transient, 190 = token expired (permanent until reconnect)
      const retriable = res.status >= 500 || code === 4 || code === 2
      return {
        ok: false,
        error: json.error?.message || `graph_http_${res.status}`,
        retriable,
      }
    }
    return { ok: true, externalReplyId: json.id }
  } catch {
    return { ok: false, error: "network_error", retriable: true }
  }
}

export const instagramReplyPublisher: SocialReplyPublisher = {
  platform: "instagram",
  publishReply: (input) => publishViaGraph("instagram", input),
}

export const facebookReplyPublisher: SocialReplyPublisher = {
  platform: "facebook",
  publishReply: (input) => publishViaGraph("facebook", input),
}
