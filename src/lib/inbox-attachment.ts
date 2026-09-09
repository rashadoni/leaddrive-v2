import { readFile } from "fs/promises"
import path from "path"
import { runtimePublicUploadsRoot } from "@/lib/runtime-paths"

/**
 * Secure read of an inbox attachment the composer previously uploaded via POST /api/v1/inbox/upload
 * (stored at /uploads/inbox/<org>/<hex>.<ext>). POST /api/v1/inbox calls this to read the bytes back
 * for channel delivery (upload-to-WhatsApp, Telegram sendPhoto/Document).
 *
 * SECURITY — the attachmentUrl is CLIENT-supplied; never trust it as a path:
 *   1. It must match EXACTLY /uploads/inbox/<orgId>/<safe-name>, where <orgId> is INJECTED from the
 *      session (getOrgId), NOT parsed from the URL — so tenant A literally cannot name tenant B's dir.
 *   2. After path.resolve, re-assert the result stays under the uploads root (the ..%2F backstop —
 *      the same guard the F-41 proxy GET uses).
 * Returns null on any mismatch / traversal / missing file → caller declines to send media.
 */

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", ogg: "audio/ogg", mp3: "audio/mpeg", aac: "audio/aac", m4a: "audio/mp4", amr: "audio/amr",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function readInboxAttachment(
  attachmentUrl: string,
  organizationId: string,
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  if (!attachmentUrl || !organizationId) return null

  // org injected from the session — the URL must point at THIS org's inbox dir + a safe filename
  // (the upload endpoint produces randomHex + a sanitized extension).
  const re = new RegExp(`^/uploads/inbox/${escapeRegex(organizationId)}/([0-9a-f]{8,64}(?:\\.[a-z0-9]{1,10})?)$`)
  const m = attachmentUrl.match(re)
  if (!m) return null
  const filename = m[1]

  try {
    const uploadsRoot = runtimePublicUploadsRoot()
    const filePath = path.resolve(uploadsRoot, "inbox", organizationId, filename)
    // ..%2F backstop — even with the regex, re-assert containment like the proxy does.
    if (!filePath.startsWith(uploadsRoot + path.sep)) return null

    const buffer = await readFile(filePath)
    const ext = path.extname(filename).slice(1).toLowerCase()
    const mime = MIME_BY_EXT[ext] || "application/octet-stream"
    return { buffer, filename, mime }
  } catch {
    return null
  }
}

/** True for mimes WhatsApp/Telegram should send as a viewable image rather than a document. */
export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/")
}
