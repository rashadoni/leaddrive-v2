/**
 * POST /api/v1/users/me/avatar
 *
 * Self-service avatar upload. Any authenticated user can set only their OWN
 * avatar (same session-cookie-only pattern as the rest of users/me/*). The file is
 * stored under /public/uploads/avatars/<orgId>/ and User.avatar is set to the
 * public URL.
 *
 * Writes through the one canonical runtime volume, with these deliberate
 * controls:
 *   - 2MB cap (avatars are small) instead of 5MB
 *   - NO SVG (image/svg+xml is an XSS vector when served from our origin)
 *   - self-service auth (any authenticated user, own row) — no campaigns:write
 */
import { NextResponse } from "next/server"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { writeFile, mkdir, unlink } from "fs/promises"
import path from "path"
import crypto from "crypto"
import sharp from "sharp"
import { validateUploadBytes } from "@/lib/upload-security"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { readFormDataRequestWithinLimit } from "@/lib/request-body-limit"
import { runtimePublicUploadsRoot } from "@/lib/runtime-paths"

export const runtime = "nodejs"

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB — avatars are small
const MAX_REQUEST_BODY_SIZE = MAX_FILE_SIZE + 64 * 1024
const MAX_INPUT_DIMENSION = 4096
const MAX_INPUT_PIXELS = 16_000_000
// SVG deliberately excluded: an <svg> served from our own origin can carry
// inline <script>, an XSS vector. Raster formats only.
const ALLOWED_INPUTS = new Map<string, { extensions: Set<string>; format: string }>([
  ["image/png", { extensions: new Set([".png"]), format: "png" }],
  ["image/jpeg", { extensions: new Set([".jpg", ".jpeg"]), format: "jpeg" }],
  ["image/webp", { extensions: new Set([".webp"]), format: "webp" }],
  ["image/gif", { extensions: new Set([".gif"]), format: "gif" }],
])
const EXECUTABLE_INTERMEDIATE_EXTENSIONS = new Set([
  "asp", "aspx", "bat", "cgi", "cmd", "com", "exe", "htm", "html", "js", "jsp",
  "jspx", "mjs", "phtml", "phar", "php", "php3", "php4", "php5", "pl", "py", "rb",
  "sh", "shtml", "svg", "xml",
])

function hasSuspiciousActiveContent(bytes: Buffer): boolean {
  // Re-encoding is the main trust boundary. These markers additionally reject
  // common image/script polyglots before they reach the decoder.
  const sample = bytes.toString("latin1").toLowerCase()
  return ["<?php", "<script", "<svg", "javascript:"].some((marker) => sample.includes(marker))
}

function hasSafeOriginalFilename(name: string, extensions: ReadonlySet<string>): boolean {
  // The original name is never persisted, but rejecting executable
  // intermediate extensions closes `avatar.php.jpg`-style filter bypasses.
  const basename = name.split(/[\\/]/).at(-1) ?? ""
  const extension = path.extname(basename).toLowerCase()
  const stem = basename.slice(0, -extension.length)
  const intermediateExtensions = stem.toLowerCase().split(".").slice(1)
  return extension.length > 0
    && extensions.has(extension)
    && stem.length > 0
    && !intermediateExtensions.some((part) => EXECUTABLE_INTERMEDIATE_EXTENSIONS.has(part))
}

async function unlinkBestEffort(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch {
    // Missing/locked cleanup targets must not roll back a successful DB write.
  }
}

function currentHardenedAvatarPath(
  avatarUrl: string | null,
  organizationId: string,
  uploadsRoot: string,
): string | null {
  if (!avatarUrl) return null
  const prefix = `/uploads/avatars/${organizationId}/`
  if (!avatarUrl.startsWith(prefix)) return null
  const filename = avatarUrl.slice(prefix.length)
  if (!/^av-[0-9a-f]{32}\.webp$/.test(filename)) return null
  return path.join(uploadsRoot, "avatars", organizationId, filename)
}

export const POST = withRlsSessionAuth(async (req, auth) => {
  // Shared Redis limiter applies across every PM2 worker. Production fails
  // closed when Redis is unavailable; otherwise process hopping would bypass a
  // local counter and allow repeated image-decode/storage work.
  const rate = await consumePublicRateLimit(
    "avatar-upload",
    `${auth.orgId}:${auth.userId}`,
    { maxRequests: 10, windowSeconds: 60 },
  )
  if (!rate.allowed) {
    const status = rate.unavailable ? 503 : 429
    return NextResponse.json(
      {
        success: false,
        error: rate.unavailable
          ? "Upload protection temporarily unavailable"
          : "Too many uploads. Please try again later.",
      },
      { status, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    )
  }

  try {
    // Enforce the cap while reading the stream, not after req.formData() has
    // already materialized an attacker-controlled multipart body in memory.
    const multipart = await readFormDataRequestWithinLimit(req, MAX_REQUEST_BODY_SIZE)
    if (!multipart.ok) {
      return NextResponse.json(
        {
          success: false,
          error: multipart.reason === "too_large" ? "Request body too large" : "Invalid form data",
        },
        { status: multipart.reason === "too_large" ? 413 : 400 },
      )
    }
    const file = multipart.value.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
    }
    const mimeType = file.type.toLowerCase().trim()
    const allowedInput = ALLOWED_INPUTS.get(mimeType)
    if (!allowedInput) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Allowed: PNG, JPG, WebP, GIF" },
        { status: 400 },
      )
    }
    if (file.size < 1 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "File too large. Max 2MB" }, { status: 400 })
    }
    if (!hasSafeOriginalFilename(file.name, allowedInput.extensions)) {
      return NextResponse.json({ success: false, error: "Invalid file extension" }, { status: 400 })
    }

    const input = Buffer.from(await file.arrayBuffer())
    if (input.byteLength !== file.size || validateUploadBytes(mimeType, input)) {
      return NextResponse.json({ success: false, error: "Invalid image content" }, { status: 400 })
    }
    if (hasSuspiciousActiveContent(input)) {
      return NextResponse.json({ success: false, error: "Invalid image content" }, { status: 400 })
    }

    let optimized: Buffer
    try {
      const image = sharp(input, {
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
        animated: false,
      })
      const metadata = await image.metadata()
      const width = metadata.width ?? 0
      const height = metadata.height ?? 0
      if (
        metadata.format !== allowedInput.format
        || width < 1
        || height < 1
        || width > MAX_INPUT_DIMENSION
        || height > MAX_INPUT_DIMENSION
        || width * height > MAX_INPUT_PIXELS
        || (metadata.pages ?? 1) !== 1
      ) {
        return NextResponse.json({ success: false, error: "Invalid image content" }, { status: 400 })
      }

      // Decode and re-encode instead of persisting attacker-controlled bytes.
      // This strips metadata/trailing payloads and produces one static raster
      // format with a server-generated extension and filename.
      optimized = await image
        .rotate()
        .resize(512, 512, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86, alphaQuality: 90 })
        .toBuffer()
    } catch {
      return NextResponse.json({ success: false, error: "Invalid image content" }, { status: 400 })
    }

    const hash = crypto.randomBytes(16).toString("hex")
    const filename = `av-${hash}.webp`

    // Scope uploads per org so a tenant can never reference another tenant's
    // avatars by guessing a URL.
    const relativeUrl = `uploads/avatars/${auth.orgId}/${filename}`
    const uploadsRoot = runtimePublicUploadsRoot()
    const targetDir = path.join(uploadsRoot, "avatars", auth.orgId)
    const newFilePath = path.join(targetDir, filename)

    const current = await prisma.user.findFirst({
      where: { id: auth.userId, organizationId: auth.orgId },
      select: { avatar: true },
    })
    if (!current) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 })
    }

    // This is the one canonical serving path. In production it is the external
    // runtime volume; a write elsewhere must never be counted as success.
    try {
      await mkdir(targetDir, { recursive: true })
      await writeFile(newFilePath, optimized)
    } catch {
      return NextResponse.json({ success: false, error: "Upload failed" }, { status: 500 })
    }

    const url = `/${relativeUrl}`

    // Optimistic avatar predicate serializes concurrent replacements. A losing
    // request deletes its new file instead of leaving an unreferenced orphan.
    let updatedCount = 0
    try {
      const updated = await prisma.user.updateMany({
        where: {
          id: auth.userId,
          organizationId: auth.orgId,
          avatar: current.avatar,
        },
        data: { avatar: url },
      })
      updatedCount = updated.count
    } catch (error) {
      await unlinkBestEffort(newFilePath)
      throw error
    }
    if (updatedCount === 0) {
      await unlinkBestEffort(newFilePath)
      return NextResponse.json(
        { success: false, error: "Avatar changed concurrently. Please retry." },
        { status: 409 },
      )
    }

    const previousPath = currentHardenedAvatarPath(current.avatar, auth.orgId, uploadsRoot)
    if (previousPath && previousPath !== newFilePath) {
      await unlinkBestEffort(previousPath)
    }

    return NextResponse.json({ success: true, url })
  } catch (error: any) {
    console.error("[users/me/avatar] error:", error)
    return NextResponse.json({ success: false, error: "Upload failed" }, { status: 500 })
  }
})
