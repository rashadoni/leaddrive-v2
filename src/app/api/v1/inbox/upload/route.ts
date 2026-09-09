import { NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { checkRateLimit } from "@/lib/rate-limit"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

/**
 * Inbox attachment upload (media SEND, Slice 3). An authed agent picks a file in the composer;
 * we store it under public/uploads/inbox/<org>/ (org-scoped, served by the F-41 proxy) and return
 * its URL. POST /api/v1/inbox then references that URL to (a) persist it on the outbound message and
 * (b) deliver it through the channel (WhatsApp/Telegram/…). One canonical
 * runtime directory avoids checkout/standalone dual-writes.
 */

const MAX_FILE_SIZE = 16 * 1024 * 1024 // 16 MB (WhatsApp's outbound media cap is the tightest)
const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "video/mp4",
  "audio/ogg", "audio/mpeg", "audio/aac", "audio/mp4", "audio/amr",
  "application/pdf", "text/plain", "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])
// Reject executable / script extensions even if the MIME looks benign (defense in depth).
const BLOCKED_EXT = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".jar", ".js", ".mjs", ".cjs",
  ".ps1", ".psm1", ".sh", ".bash", ".zsh", ".vbs", ".vbe", ".wsf", ".hta",
  ".app", ".dmg", ".pkg", ".php", ".phtml", ".phar", ".py", ".rb", ".pl",
  ".html", ".htm", ".svg", ".dll", ".sys",
])

export const POST = withInboxSessionWrite(async (req, { orgId }) => {

  // Authed, but a scripted/compromised session could still fill disk with 16MB writes.
  if (!checkRateLimit(`inbox-upload:${orgId}`, { maxRequests: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many uploads, please slow down" }, { status: 429 })
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 })

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 16 MB)" }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 })
  }
  const lowerName = file.name.toLowerCase()
  const extMatch = lowerName.match(/\.[a-z0-9]+$/)
  if (extMatch && BLOCKED_EXT.has(extMatch[0])) {
    return NextResponse.json({ error: `Disallowed file extension: ${extMatch[0]}` }, { status: 400 })
  }
  // Reject double-extension tricks like "foo.exe.pdf".
  for (const ext of Array.from(BLOCKED_EXT)) {
    if (lowerName.includes(ext + ".")) {
      return NextResponse.json({ error: "Suspicious filename" }, { status: 400 })
    }
  }

  const ext = path.extname(file.name).toLowerCase().slice(0, 10).replace(/[^a-z0-9.]/g, "")
  const storedName = `${crypto.randomBytes(8).toString("hex")}${ext}`
  const baseDir = path.join("uploads", "inbox", orgId)
  const buffer = Buffer.from(await file.arrayBuffer())

  const rootDir = path.join(runtimePublicUploadDirectory("inbox"), orgId)
  await mkdir(rootDir, { recursive: true })
  await writeFile(path.join(rootDir, storedName), buffer)

  const url = `/${path.posix.join(baseDir, storedName)}`
  return NextResponse.json(
    { success: true, data: { url, name: file.name, type: file.type, size: file.size } },
    { status: 201 },
  )
})
