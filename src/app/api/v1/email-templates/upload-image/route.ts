import crypto from "crypto"
import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { readFormDataRequestWithinLimit } from "@/lib/request-body-limit"
import { decodeAndReencodeSafeRaster } from "@/lib/safe-raster-upload"
import { isSafeOrganizationPathSegment } from "@/lib/upload-path-policy"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

export const runtime = "nodejs"

const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_REQUEST_BODY_SIZE = MAX_FILE_SIZE + 64 * 1024

// POST /api/v1/email-templates/upload-image
// Upload a hardened immutable raster referenced by remote email clients.
export const POST = withRlsAuth("campaigns", "write", async (req, auth) => {
  const rate = await consumePublicRateLimit(
    "email-template-image-upload",
    `${auth.orgId}:${auth.userId}`,
    { maxRequests: 20, windowSeconds: 60 },
  )
  if (!rate.allowed) {
    return NextResponse.json(
      {
        success: false,
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
    // Enforce the total multipart cap while reading the stream. Calling
    // req.formData() directly would materialize an attacker-controlled body
    // before the per-file size check runs.
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

    const entries = Array.from(multipart.value.entries())
    const file = multipart.value.get("file")
    if (
      !(file instanceof File)
      || entries.length !== 1
      || entries[0]?.[0] !== "file"
    ) {
      return NextResponse.json(
        { success: false, error: "Exactly one image file is required" },
        { status: 400 },
      )
    }

    const raster = await decodeAndReencodeSafeRaster(file, {
      maxInputBytes: MAX_FILE_SIZE,
      maxOutputBytes: MAX_FILE_SIZE,
      maxOutputDimension: 1920,
    })
    if (!raster.ok) {
      const error = raster.reason === "size"
        ? "File too large. Max 5MB"
        : raster.reason === "type"
          ? "Invalid file type. Allowed: PNG, JPG, WebP"
          : "Invalid image content"
      return NextResponse.json({ success: false, error }, { status: 400 })
    }

    if (!isSafeOrganizationPathSegment(auth.orgId)) {
      console.error("[email-template-upload-image] invalid authenticated organization id")
      return NextResponse.json({ success: false, error: "Upload failed" }, { status: 500 })
    }

    const filename = `img-${crypto.randomBytes(16).toString("hex")}.${raster.extension}`
    const uploadRoot = runtimePublicUploadDirectory("email-images")
    const uploadDir = path.resolve(uploadRoot, auth.orgId)
    if (!uploadDir.startsWith(`${uploadRoot}${path.sep}`)) {
      return NextResponse.json({ success: false, error: "Upload failed" }, { status: 500 })
    }

    // The standalone public directory is the canonical serving path. The
    // deploy script symlinks this subdir to persistent storage in production;
    // success anywhere else must not produce a URL that the proxy cannot read.
    await mkdir(uploadDir, { recursive: true, mode: 0o750 })
    await writeFile(path.join(uploadDir, filename), raster.bytes, {
      flag: "wx",
      mode: 0o640,
    })

    const url = `/${path.posix.join("uploads", "email-images", auth.orgId, filename)}`
    return NextResponse.json({ success: true, url })
  } catch (error) {
    console.error("[email-template-upload-image] error:", error)
    return NextResponse.json(
      { success: false, error: "Upload failed" },
      { status: 500 },
    )
  }
})
