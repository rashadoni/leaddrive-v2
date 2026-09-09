import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { checkRateLimit } from "@/lib/rate-limit"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB — a contract logo/stamp, not a photo album
// NO svg — image/svg+xml renders inline via the F-41 gate and SVG can carry
// script; the email-images route allows it, the contract surface does not.
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"])

// POST /api/v1/contracts/upload-image  (toolbar Phase 3)
// Upload an image to embed in a contract body. Mirrors the email-images
// pattern: org-scoped dir and a random filename in the canonical runtime
// root. The returned URL is the ONLY src shape
// sanitizeContractBody accepts (and the F-41 gate org-checks it on read):
//   /uploads/contract-images/<orgId>/img-<hash>.<ext>
export const POST = withRlsAuth("contracts", "write", async (req, auth, ctx) => {
  if (!checkRateLimit(`contract-img-upload:${auth.userId}`, { maxRequests: 30, windowMs: 60_000 })) {
    console.warn(`[contract-upload-image POST] 429 rate-limit hit for user ${auth.userId}`)
    return NextResponse.json({ success: false, error: "Too many uploads. Please try again later." }, { status: 429 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Allowed: PNG, JPG, WebP, GIF" },
        { status: 400 },
      )
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "File too large. Max 5MB" }, { status: 400 })
    }
    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ success: false, error: "Invalid file extension" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const hash = crypto.randomBytes(8).toString("hex")
    const filename = `img-${hash}${ext}`

    const uploadRoot = runtimePublicUploadDirectory("contract-images")
    const uploadDir = path.resolve(uploadRoot, auth.orgId)
    if (!uploadDir.startsWith(`${uploadRoot}${path.sep}`)) {
      return NextResponse.json({ success: false, error: "Storage unavailable" }, { status: 500 })
    }
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, filename), buffer)

    return NextResponse.json({ success: true, url: `/${path.posix.join("uploads", "contract-images", auth.orgId, filename)}` })
  } catch (error) {
    console.error("[contract-upload-image] error:", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
})
