/**
 * The latest posts and reels of one connected page, for choosing a post in a «word in a comment →
 * message in Direct» rule (owner 2026-11-25: «ключевые слова надо также иметь возможность завязывать
 * к публикации»). Read from Meta on demand — a fresh reel has no comments yet, so the comments board
 * alone could not offer it. The token stays on the server; only id, caption start, link and date leave.
 */
import { prisma } from "@/lib/prisma"
import { isIgLogin } from "@/lib/social/tenant-meta-app"

const IG_GRAPH = "https://graph.instagram.com/v21.0"
const FB_GRAPH = process.env.META_GRAPH_BASE || "https://graph.facebook.com/v21.0"
export const RULE_POSTS_LIMIT = 25

export type RulePost = { id: string; label: string; permalink: string | null; at: string | null; isReel: boolean }

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? v as Rec : {})
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)

/** The start of a caption, one line — what the rule card and the select show. */
export function postLabel(caption: string | null, at: string | null): string {
  const line = (caption ?? "").replace(/\s+/g, " ").trim()
  if (line) return line.length > 60 ? `${line.slice(0, 59)}…` : line
  return at ? at.slice(0, 10) : "—"
}

export type RulePostsResult = { ok: true; posts: RulePost[] } | { ok: false; error: "not_found" | "unsupported" | "meta_failed" }

export async function listRulePosts(organizationId: string, channelConfigId: string, fetcher: typeof fetch = fetch): Promise<RulePostsResult> {
  const channel = await prisma.channelConfig.findFirst({
    where: { id: channelConfigId, organizationId, channelType: { in: ["instagram", "facebook"] }, isActive: true },
    select: { channelType: true, apiKey: true, settings: true },
  })
  if (!channel?.apiKey) return { ok: false, error: "not_found" }
  const instagram = channel.channelType === "instagram"
  // Comments reach the CRM only through an Instagram-Login connection (lib/social/instagram-comments).
  if (instagram && !isIgLogin(channel.settings)) return { ok: false, error: "unsupported" }
  const url = instagram
    ? `${IG_GRAPH}/me/media?fields=id,caption,permalink,timestamp,media_type,media_product_type&limit=${RULE_POSTS_LIMIT}`
    : `${FB_GRAPH}/me/posts?fields=id,message,permalink_url,created_time,status_type&limit=${RULE_POSTS_LIMIT}`
  try {
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${channel.apiKey}` }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return { ok: false, error: "meta_failed" }
    const data = rec(await res.json()).data
    const posts = (Array.isArray(data) ? data : []).map((raw): RulePost | null => {
      const item = rec(raw)
      const id = str(item.id)
      if (!id || !/^[0-9_]+$/.test(id)) return null
      const at = str(item.timestamp) ?? str(item.created_time)
      return {
        id,
        label: postLabel(str(item.caption) ?? str(item.message), at),
        permalink: str(item.permalink) ?? str(item.permalink_url),
        at,
        isReel: str(item.media_product_type) === "REELS" || str(item.status_type) === "added_video",
      }
    }).filter((p): p is RulePost => p !== null)
    return { ok: true, posts }
  } catch {
    return { ok: false, error: "meta_failed" }
  }
}
