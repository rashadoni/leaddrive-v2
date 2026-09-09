import { writeFile, mkdir } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

/**
 * Telegram inbound media ingestion (Slice 2).
 *
 * Telegram delivers inbound media as a `file_id` (not a URL). To show the actual photo/document
 * in the inbox thread we: call getFile to resolve `file_path`, download the bytes from the file
 * endpoint, and store them under public/uploads/telegram/<org>/ so the F-41 /uploads proxy can
 * serve them (org-scoped). The ChannelMessage's `mediaUrl` then points at our copy.
 *
 * NOTE: the bot token is in the URL (Telegram's API has no header auth) — it is never logged.
 * Storage mirrors whatsapp-media.ts in one external runtime root. Fail-closed to null.
 */

const TG_API_BASE = process.env.TELEGRAM_API_BASE || "https://api.telegram.org"
const MAX_BYTES = 50 * 1024 * 1024

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/aac": "aac",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
}

/** Pick a safe extension: prefer the real one from Telegram's file_path, else map the mime. */
function pickExt(filePath: string, mime: string): string {
  const raw = path.extname(filePath).toLowerCase().replace(/[^a-z0-9.]/g, "")
  if (raw.length > 1 && raw.length <= 6) return raw.slice(1)
  return EXT_BY_MIME[mime] || "bin"
}

/**
 * Download a Telegram media object by its `file_id` and store it locally. Returns the public
 * `/uploads/...` URL + mime, or `null` on ANY failure (caller keeps the text placeholder —
 * ingestion must never break inbound message persistence).
 */
export async function fetchAndStoreTelegramMedia(
  fileId: string,
  botToken: string,
  organizationId: string,
): Promise<{ url: string; mime: string } | null> {
  if (!fileId || !botToken || !organizationId) return null
  try {
    // 1. getFile → file_path (+ size guard).
    const metaRes = await fetch(`${TG_API_BASE}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, {
      signal: AbortSignal.timeout(6_000),
    })
    if (!metaRes.ok) return null
    const meta = (await metaRes.json()) as { ok?: boolean; result?: { file_path?: string; file_size?: number } }
    const filePath = meta?.result?.file_path
    if (!meta?.ok || !filePath) return null
    if (typeof meta.result?.file_size === "number" && meta.result.file_size > MAX_BYTES) return null

    // 2. Download the bytes from the file endpoint.
    const binRes = await fetch(`${TG_API_BASE}/file/bot${botToken}/${filePath}`, {
      signal: AbortSignal.timeout(12_000),
    })
    if (!binRes.ok) return null
    const buf = Buffer.from(await binRes.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null

    const mime = (binRes.headers.get("content-type") || "application/octet-stream").split(";")[0].trim()
    const storedName = `${crypto.randomBytes(8).toString("hex")}.${pickExt(filePath, mime)}`
    const baseDir = path.join("uploads", "telegram", organizationId)

    // 3. Store once under the external runtime root. The organization id comes
    // from channel configuration, not request path input.
    const rootDir = path.join(runtimePublicUploadDirectory("telegram"), organizationId)
    await mkdir(rootDir, { recursive: true })
    await writeFile(path.join(rootDir, storedName), buf)

    return { url: `/${path.posix.join(baseDir, storedName)}`, mime }
  } catch {
    return null
  }
}

/**
 * Send an OUTBOUND media message (media SEND, Slice 3b) by uploading the bytes to Telegram —
 * sendPhoto for images, sendDocument for everything else. Multipart, no logging (the POST
 * /api/v1/inbox caller persists the outbound row with our own /uploads mediaUrl).
 */
export async function sendTelegramMedia(
  botToken: string,
  chatId: string,
  buffer: Buffer,
  mime: string,
  filename: string,
  caption?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!botToken || !chatId) return { success: false, error: "Telegram not configured" }
  const isImage = mime.startsWith("image/") && mime !== "image/gif"
  const method = isImage ? "sendPhoto" : "sendDocument"
  const field = isImage ? "photo" : "document"
  try {
    const fd = new FormData()
    fd.append("chat_id", chatId)
    fd.append(field, new Blob([new Uint8Array(buffer)], { type: mime }), filename)
    if (caption) fd.append("caption", caption)
    const res = await fetch(`${TG_API_BASE}/bot${botToken}/${method}`, {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(20_000),
    })
    const data = (await res.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } }
    if (!res.ok || !data?.ok) {
      return { success: false, error: data?.description || `HTTP ${res.status}` }
    }
    return { success: true, messageId: String(data?.result?.message_id ?? "") }
  } catch (err: any) {
    return { success: false, error: err?.message || "network error" }
  }
}
