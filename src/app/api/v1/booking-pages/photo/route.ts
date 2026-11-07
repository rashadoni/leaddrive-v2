/**
 * The picture of a service: POST a file, get back the path the form stores.
 *
 * The bytes are decoded and written out again (`decodeAndReencodeSafeRaster`),
 * so what lands in the public directory is a plain raster this server produced
 * — not whatever was uploaded with an image's name on it. Nothing is attached
 * to a service here: the answer is a path, and the form saves it with the rest
 * of the service.
 */
import crypto from "crypto"
import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { readFormDataRequestWithinLimit } from "@/lib/request-body-limit"
import { decodeAndReencodeSafeRaster } from "@/lib/safe-raster-upload"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { BOOKING_PHOTO_DIRECTORY } from "@/lib/booking/service-photo"

export const runtime = "nodejs"

const MAX_FILE_SIZE = 4 * 1024 * 1024
const MAX_REQUEST_BODY_SIZE = MAX_FILE_SIZE + 64 * 1024

export const POST = withRlsAuth("bookings", "write", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })

  const rate = await consumePublicRateLimit("booking-service-photo", auth.userId ?? auth.orgId, { maxRequests: 20, windowSeconds: 60 })
  if (!rate.allowed) {
    return NextResponse.json({ code: rate.unavailable ? "UPLOAD_UNAVAILABLE" : "TOO_MANY" },
      { status: rate.unavailable ? 503 : 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } })
  }

  const multipart = await readFormDataRequestWithinLimit(req, MAX_REQUEST_BODY_SIZE)
  if (!multipart.ok) {
    return NextResponse.json({ code: multipart.reason === "too_large" ? "TOO_LARGE" : "INVALID" },
      { status: multipart.reason === "too_large" ? 413 : 400 })
  }
  const entries = Array.from(multipart.value.entries())
  const file = multipart.value.get("file")
  if (!(file instanceof File) || entries.length !== 1 || entries[0]?.[0] !== "file") {
    return NextResponse.json({ code: "INVALID" }, { status: 400 })
  }

  const raster = await decodeAndReencodeSafeRaster(file, {
    maxInputBytes: MAX_FILE_SIZE,
    maxOutputBytes: MAX_FILE_SIZE,
    maxOutputDimension: 1280,
  })
  if (!raster.ok) {
    return NextResponse.json({ code: raster.reason === "size" ? "TOO_LARGE" : raster.reason === "type" ? "WRONG_TYPE" : "INVALID" }, { status: 400 })
  }

  try {
    const filename = `service-${crypto.randomBytes(16).toString("hex")}.${raster.extension}`
    const directory = runtimePublicUploadDirectory(BOOKING_PHOTO_DIRECTORY)
    await mkdir(directory, { recursive: true, mode: 0o750 })
    await writeFile(path.join(directory, filename), raster.bytes, { flag: "wx", mode: 0o640 })
    return NextResponse.json({ success: true, data: { url: `/${path.posix.join("uploads", BOOKING_PHOTO_DIRECTORY, filename)}` } })
  } catch (error) {
    console.error("[booking] service photo upload failed", { code: "PHOTO_UPLOAD_FAILED", error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ code: "UPLOAD_FAILED" }, { status: 500 })
  }
})
