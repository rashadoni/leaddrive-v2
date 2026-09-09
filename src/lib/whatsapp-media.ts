import { writeFile, mkdir } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

/**
 * WhatsApp inbound media ingestion (Slice 1).
 *
 * The WhatsApp Cloud API delivers inbound media as an opaque `id` (not a URL). To show the
 * actual image/document in the inbox thread we must: resolve the temporary media URL via the
 * Graph API, download the bytes (auth-gated by the same token), and store them under
 * public/uploads/whatsapp/<org>/ so the F-41 /uploads proxy can serve them. The ChannelMessage's
 * `mediaUrl` column then points at our copy (the WA-hosted URL expires + needs the token, so we
 * cannot store that directly).
 *
 * The runtime root is one physical location. The upload proxy serves it after
 * authorization, so a deployment never needs a checkout/standalone dual-write.
 */

const GRAPH_API_BASE = process.env.WHATSAPP_GRAPH_BASE || "https://graph.facebook.com/v21.0"
const MAX_BYTES = 16 * 1024 * 1024 // WhatsApp's own inbound media cap

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/aac": "aac", "audio/amr": "amr", "audio/mp4": "m4a",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
}

function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] || "bin"
}

/**
 * Download a WhatsApp media object by its `id` and store it locally. Returns the public
 * `/uploads/...` URL + mime, or `null` on ANY failure (caller keeps the text placeholder —
 * media ingestion must never break inbound message persistence).
 */
export async function fetchAndStoreWaMedia(
  mediaId: string,
  accessToken: string,
  organizationId: string,
): Promise<{ url: string; mime: string } | null> {
  if (!mediaId || !accessToken || !organizationId) return null
  try {
    // 1. Resolve the temporary media URL + mime from the Graph API.
    const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(6_000),
    })
    if (!metaRes.ok) return null
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number }
    if (!meta.url) return null
    if (typeof meta.file_size === "number" && meta.file_size > MAX_BYTES) return null

    // 2. Download the bytes (the WA-hosted URL also requires the bearer token).
    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(12_000),
    })
    if (!binRes.ok) return null
    const buf = Buffer.from(await binRes.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null

    const mime = (meta.mime_type || binRes.headers.get("content-type") || "application/octet-stream")
      .split(";")[0].trim()
    const storedName = `${crypto.randomBytes(8).toString("hex")}.${extForMime(mime)}`
    const baseDir = path.join("uploads", "whatsapp", organizationId)

    // 3. Store once under the external runtime root. The organization id comes
    // from channel configuration, not request path input.
    const rootDir = path.join(runtimePublicUploadDirectory("whatsapp"), organizationId)
    await mkdir(rootDir, { recursive: true })
    await writeFile(path.join(rootDir, storedName), buf)

    return { url: `/${path.posix.join(baseDir, storedName)}`, mime }
  } catch {
    return null
  }
}
