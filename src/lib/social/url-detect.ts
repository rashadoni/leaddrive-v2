import type { MonitoringPlatform } from "@/lib/social/monitoring-source"

/**
 * Best-effort detection of platform + source type from a pasted social URL, so a
 * client can add monitoring targets by pasting links instead of filling a form.
 * Pure/browser-safe (uses global URL) — shared by the quick-add UI and the
 * scenario pipeline. Returns null platform for unrecognised hosts.
 */
export function detectSocialPlatformFromUrl(value: string): MonitoringPlatform | null {
  try {
    const hostname = new URL(value.trim()).hostname.replace(/^www\./, "").toLowerCase()
    if (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) return "instagram"
    if (hostname === "facebook.com" || hostname.endsWith(".facebook.com") || hostname === "fb.com" || hostname.endsWith(".fb.com")) return "facebook"
    if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) return "tiktok"
    if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")) return "twitter"
    if (hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be") return "youtube"
    return null
  } catch {
    return null
  }
}

// Path fragments that mean "a specific post/video", not a profile/page.
const POST_URL_PATTERNS = [
  "/p/", "/reel/", "/reels/", "/tv/", // instagram
  "/posts/", "/photos/", "/videos/", "/video/", "/watch", "/permalink.php", "/story.php", // facebook/yt
  "/status/", // twitter/x
  "/shorts/", // youtube/tiktok
]

/**
 * "search_url" when the link points at a single post/video, otherwise "profile".
 * Both are valid monitoring source types; classification derives collection mode.
 */
export function detectSocialSourceTypeFromUrl(value: string): "profile" | "search_url" {
  let path = ""
  try {
    const url = new URL(value.trim())
    path = `${url.pathname.toLowerCase()}${url.search.toLowerCase()}`
    if (url.hostname.replace(/^www\./, "").toLowerCase() === "youtu.be") return "search_url"
  } catch {
    return "search_url"
  }
  return POST_URL_PATTERNS.some((p) => path.includes(p)) ? "search_url" : "profile"
}
