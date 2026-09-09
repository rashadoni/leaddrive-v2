import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { buildWidgetCorsHeaders, isOriginAllowed } from "@/lib/widget-cors"
import { checkRateLimit } from "@/lib/rate-limit"
import { validateUploadBytes } from "@/lib/upload-security"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "application/pdf", "text/plain", "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
])
// Extensions to reject even if MIME type looks benign (defense in depth).
const BLOCKED_EXT = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".jar", ".js", ".mjs", ".cjs",
  ".ps1", ".psm1", ".sh", ".bash", ".zsh",
  ".vbs", ".vbe", ".wsf", ".hta",
  ".app", ".dmg", ".pkg",
  ".php", ".phtml", ".phar", ".py", ".rb", ".pl",
  ".html", ".htm", ".svg",   // svg can carry XSS; html obvious
  ".dll", ".sys",
])

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: await buildWidgetCorsHeaders(req, req.headers.get("origin")) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = await buildWidgetCorsHeaders(req, origin)

  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400, headers })

  const sessionId = String(formData.get("sessionId") || "")
  const file = formData.get("file") as File | null

  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400, headers })
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400, headers })

  if (!checkRateLimit(`wc-upload:${sessionId}`, { maxRequests: 5, windowMs: 60000 })) {
    return NextResponse.json({ error: "Too many uploads, please slow down" }, { status: 429, headers })
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400, headers })
  }
  const mimeType = file.type.toLowerCase().trim()
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400, headers })
  }
  const lowerName = file.name.toLowerCase()
  const extMatch = lowerName.match(/\.[a-z0-9]+$/)
  if (extMatch && BLOCKED_EXT.has(extMatch[0])) {
    return NextResponse.json({ error: `Disallowed file extension: ${extMatch[0]}` }, { status: 400, headers })
  }
  // Reject double-extension tricks like "foo.exe.pdf" or "foo.pdf.exe"
  for (const ext of Array.from(BLOCKED_EXT)) {
    if (lowerName.includes(ext + ".")) {
      return NextResponse.json({ error: "Suspicious filename" }, { status: 400, headers })
    }
  }

  // RLS phase 1 — org resolution: visitor sessionId, bypass-scoped lookup only.
  const session = await runWithRlsBypass(() =>
    prisma.webChatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, organizationId: true, status: true },
    })
  )
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404, headers })
  if (session.status === "closed") {
    return NextResponse.json({ error: "Session is closed" }, { status: 410, headers })
  }

  // RLS phase 2 — widget check, file write and message creation run tenant-scoped.
  return await runWithTenant(session.organizationId, async () => {
  const widget = await prisma.webChatWidget.findUnique({
    where: { organizationId: session.organizationId },
    select: { enabled: true, allowedOrigins: true },
  })
  if (!widget?.enabled) return NextResponse.json({ error: "Widget disabled" }, { status: 403, headers })
  if (!isOriginAllowed(origin, widget.allowedOrigins)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers })
  }

  const ext = path.extname(file.name).toLowerCase().slice(0, 10).replace(/[^a-z0-9.]/g, "") || ""
  const safeBase = (file.name.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80)) || "file"
  const id = crypto.randomBytes(8).toString("hex")
  const storedName = `${id}-${safeBase}${ext && !safeBase.endsWith(ext) ? ext : ""}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const contentError = validateUploadBytes(mimeType, buffer)
  if (contentError) {
    return NextResponse.json({ error: contentError }, { status: 400, headers })
  }
  const baseDir = path.join("uploads", "web-chat", session.organizationId)
  const uploadDir = path.join(runtimePublicUploadDirectory("web-chat"), session.organizationId)
  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, storedName), buffer)

  const publicUrl = `/${path.posix.join(baseDir, storedName)}`

  const message = await prisma.webChatMessage.create({
    data: {
      organizationId: session.organizationId,
      sessionId: session.id,
      fromRole: "visitor",
      text: file.name,
      attachmentUrl: publicUrl,
      attachmentName: file.name,
      attachmentType: mimeType,
      attachmentSize: file.size,
    },
  })
  await prisma.webChatSession.update({
    where: { id: session.id },
    data: { lastMessageAt: new Date() },
  })

  return NextResponse.json(
    {
      success: true,
      data: {
        id: message.id,
        url: publicUrl,
        name: file.name,
        type: mimeType,
        size: file.size,
      },
    },
    { headers },
  )
  }) // end runWithTenant (tenant-scoped handler body)
}
