/**
 * Decide whether an inbox/social message's media should render inline (vs a download link).
 * Client-safe (no fs/node imports) so dashboard pages can import it.
 *
 * Two signals, either is enough:
 *  - messageType === "image" — set by the webhooks (WhatsApp/Facebook) and by outbound send.
 *  - the media URL ends in a known image extension — covers Telegram inbound (which doesn't set
 *    messageType) and any message where the type wasn't tagged. Stored files always carry an
 *    extension (whatsapp-media/telegram-media pick one from the mime), so this is reliable.
 */
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif)(\?|#|$)/i
const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i

export function isTikTokPlayerUrl(mediaUrl: string | null | undefined): boolean {
  if (!mediaUrl) return false
  try {
    const url = new URL(mediaUrl)
    return /(^|\.)tiktok\.com$/i.test(url.hostname) && /^\/(player|embed)\//.test(url.pathname)
  } catch {
    return /^https?:\/\/(?:www\.)?tiktok\.com\/(?:player|embed)\//i.test(mediaUrl)
  }
}

// Formats browsers can't decode inline — an <img> would render broken. Keep them as a download link
// even when the message is tagged "image" (e.g. an iPhone HEIC photo sent to WhatsApp: isImageMime is
// mime.startsWith("image/") → "image", but Chrome shows nothing). Link > broken thumbnail.
const NON_RENDERABLE_EXT_RE = /\.(heic|heif|tiff?)(\?|#|$)/i

export function isImagePreview(
  messageType: string | null | undefined,
  mediaUrl: string | null | undefined,
): boolean {
  if (!mediaUrl) return false
  if (isTikTokPlayerUrl(mediaUrl)) return false
  if (NON_RENDERABLE_EXT_RE.test(mediaUrl)) return false
  return messageType === "image" || IMAGE_EXT_RE.test(mediaUrl)
}

export function isVideoPreview(
  messageType: string | null | undefined,
  mediaUrl: string | null | undefined,
): boolean {
  if (!mediaUrl) return false
  return messageType === "video" || VIDEO_EXT_RE.test(mediaUrl)
}

/**
 * Map a YouTube or TikTok page/player URL to an embeddable iframe src, so the
 * feed can play the video inline instead of only linking out. Direct video
 * files (.mp4 etc.) are handled by isVideoPreview + <video>; this covers the
 * platform pages that carry the clip behind a watch/shorts/video URL.
 * Returns null when the URL isn't an embeddable YouTube/TikTok video.
 */
export function videoEmbedUrl(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl) return null
  let url: URL
  try {
    url = new URL(mediaUrl)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase()

  // YouTube: watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v")
    if (v) return `https://www.youtube.com/embed/${encodeURIComponent(v)}`
    const m = url.pathname.match(/^\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{6,})/)
    if (m) return `https://www.youtube.com/embed/${m[1]}`
    return null
  }
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "").split("/")[0]
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : null
  }

  // TikTok: already a player/embed URL, or a /@user/video/ID page.
  if (/(^|\.)tiktok\.com$/i.test(url.hostname)) {
    if (/^\/(player|embed)\//.test(url.pathname)) return mediaUrl
    const m = url.pathname.match(/\/video\/(\d{6,})/)
    if (m) return `https://www.tiktok.com/player/v1/${m[1]}`
    return null
  }
  return null
}
