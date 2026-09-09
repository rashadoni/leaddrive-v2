import crypto from "crypto"
import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { readFormDataRequestWithinLimit } from "@/lib/request-body-limit"
import { decodeAndReencodeSafeRaster } from "@/lib/safe-raster-upload"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

export const runtime = "nodejs"

const MAX_FILE_SIZE = 2 * 1024 * 1024
const MAX_REQUEST_BODY_SIZE = MAX_FILE_SIZE + 64 * 1024

// POST /api/v1/admin/upload-logo — Upload a public-safe tenant logo image.
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  const rate = await consumePublicRateLimit(
    "admin-tenant-logo-upload",
    auth.userId,
    { maxRequests: 10, windowSeconds: 60 },
  )
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: rate.unavailable
          ? "Upload protection temporarily unavailable"
          : "Too many uploads. Please try again later.",
      },
      {
        status: rate.unavailable ? 503 : 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    )
  }

  try {
    const multipart = await readFormDataRequestWithinLimit(req, MAX_REQUEST_BODY_SIZE)
    if (!multipart.ok) {
      return NextResponse.json(
        { error: multipart.reason === "too_large" ? "Request body too large" : "Invalid form data" },
        { status: multipart.reason === "too_large" ? 413 : 400 },
      )
    }

    const entries = Array.from(multipart.value.entries())
    const file = multipart.value.get("file")
    if (
      !(file instanceof File)
      || entries.length !== 1
      || entries[0]?.[0] !== "file"
    ) {
      return NextResponse.json({ error: "Exactly one image file is required" }, { status: 400 })
    }

    const raster = await decodeAndReencodeSafeRaster(file, {
      maxInputBytes: MAX_FILE_SIZE,
      maxOutputBytes: MAX_FILE_SIZE,
      maxOutputDimension: 1024,
    })
    if (!raster.ok) {
      const error = raster.reason === "size"
        ? "File too large. Max 2MB"
        : raster.reason === "type"
          ? "Invalid file type. Allowed: PNG, JPG, WebP"
          : "Invalid image content"
      return NextResponse.json({ error }, { status: 400 })
    }

    const filename = `logo-${crypto.randomBytes(16).toString("hex")}.${raster.extension}`
    const uploadDir = runtimePublicUploadDirectory("logos")
    await mkdir(uploadDir, { recursive: true, mode: 0o750 })
    await writeFile(path.join(uploadDir, filename), raster.bytes, {
      flag: "wx",
      mode: 0o640,
    })

    return NextResponse.json({
      success: true,
      url: `/${path.posix.join("uploads", "logos", filename)}`,
    })
  } catch (error) {
    console.error("[UPLOAD-LOGO] Error:", error)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
