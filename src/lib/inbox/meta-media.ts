/**
 * A file a customer sent on Instagram or Facebook Messenger, kept by us — not a link to Meta's CDN.
 *
 * Until 2026-11-12 the message stored Meta's `lookaside.fbsbx.com` link and a type guessed from
 * Meta's attachment label. Three of four «documents» in Zeytun's inbox were photos Meta had labelled
 * with a type the guess did not know, so the thread showed «Attachment» instead of the picture; a
 * voice note is served as `video/mp4` (`audioclip-….mp4`), so it was sent to transcription as an
 * mp3 and refused; and the page would not play audio or video from Meta's host at all (owner:
 * «почему не загружает медиа и файлы»). Like WhatsApp and Telegram, the file is now downloaded when
 * the message arrives, sealed with the organization's key, served by the inbox's own upload route,
 * and typed by what the file is.
 *
 * Best-effort: any failure returns null and the message keeps Meta's link, as before.
 */

import crypto from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import {
  downloadOutboundResource,
  type OutboundWebhookResolver,
  type OutboundWebhookTransport,
} from "@/lib/integrations/webhook-url-guard"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

const MAX_BYTES = 25 * 1024 * 1024 // Meta's own attachment cap
const DOWNLOAD_TIMEOUT_MS = 12_000

/** Meta's media hosts. A shared post (`instagram.com/p/…`) is a page, not a file, and is left as a link. */
export function isMetaMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== "https:") return false
    return hostname === "lookaside.fbsbx.com" || /(^|\.)(fbcdn\.net|cdninstagram\.com|fbsbx\.com)$/i.test(hostname)
  } catch {
    return false
  }
}

export type MetaMediaKind = "image" | "video" | "audio" | "document"

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/wav": "wav",
  "application/pdf": "pdf",
}

function headerFileName(disposition: string | undefined): string | null {
  const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null
  return match ? path.basename(decodeURIComponent(match[1])) : null
}

/** What the file is, from its own content type — and Meta names a voice note `audioclip-….mp4`. */
export function metaMediaKind(mime: string, fileName: string | null): MetaMediaKind {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return /^audioclip/i.test(fileName ?? "") ? "audio" : "video"
  return "document"
}

export type StoredMetaMedia = { url: string; mime: string; kind: MetaMediaKind; bytes: Buffer; fileName: string | null }

export async function fetchAndStoreMetaMedia(
  mediaUrl: string,
  organizationId: string,
  /** Test seams; production downloads through the IP-pinned, SSRF-checked transport. */
  seams: { transport?: OutboundWebhookTransport; resolveHost?: OutboundWebhookResolver } = {},
): Promise<StoredMetaMedia | null> {
  if (!organizationId || !isMetaMediaUrl(mediaUrl)) return null
  try {
    const res = await downloadOutboundResource(mediaUrl, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      maxResponseBytes: MAX_BYTES,
      transport: seams.transport,
      resolver: seams.resolveHost,
    })
    if (!res.ok || res.bodyBytes.byteLength === 0 || res.bodyBytes.byteLength > MAX_BYTES) return null
    const mime = (res.headers?.["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase()
    const fileName = headerFileName(res.headers?.["content-disposition"])
    const ext = EXT_BY_MIME[mime] ?? (fileName && /\.[a-z0-9]{2,5}$/i.test(fileName) ? fileName.split(".").pop()!.toLowerCase() : "bin")
    const bytes = Buffer.from(res.bodyBytes)
    const storedName = `${crypto.randomBytes(12).toString("hex")}.${ext}`
    const rootDir = path.join(runtimePublicUploadDirectory("inbox"), organizationId)
    await mkdir(rootDir, { recursive: true })
    await writeFile(path.join(rootDir, storedName), sealTenantFile(organizationId, bytes))
    return { url: `/uploads/inbox/${organizationId}/${storedName}`, mime, kind: metaMediaKind(mime, fileName), bytes, fileName }
  } catch {
    return null
  }
}
