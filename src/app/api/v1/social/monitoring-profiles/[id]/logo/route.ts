import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import crypto from "crypto"
import path from "path"
import { mkdir, unlink, writeFile } from "fs/promises"
import sharp from "sharp"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkRateLimit } from "@/lib/rate-limit"
import { validateUploadBytes } from "@/lib/upload-security"
import { hmacToken } from "@/lib/secure-token"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

export const runtime = "nodejs"

const MAX_FILE_SIZE = 2 * 1024 * 1024
const MAX_INPUT_PIXELS = 16_000_000
const ALLOWED_EXTENSIONS = new Map<string, Set<string>>([
  ["image/png", new Set([".png"])],
  ["image/jpeg", new Set([".jpg", ".jpeg"])],
  ["image/webp", new Set([".webp"])],
])

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRlsAuth<RouteContext>(
  "social",
  "write",
  async (req: NextRequest, auth, context) => {
    if (!checkRateLimit(`monitoring-logo-upload:${auth.userId}`, {
      maxRequests: 20,
      windowMs: 60_000,
    })) {
      return NextResponse.json({ error: "upload_rate_limited" }, { status: 429 })
    }

    const { id } = await context.params
    const subject = await prisma.monitoringSubject.findFirst({
      where: {
        id,
        organizationId: auth.orgId,
        status: { not: "deleted" },
      },
      select: { id: true, name: true },
    })
    if (!subject) {
      return NextResponse.json({ error: "monitoring_not_found" }, { status: 404 })
    }

    const formData = await req.formData().catch(() => null)
    const file = formData?.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "logo_file_required" }, { status: 400 })
    }
    if (file.size < 1 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "logo_file_size" }, { status: 400 })
    }

    const mimeType = file.type.toLowerCase().trim()
    const extension = path.extname(file.name).toLowerCase()
    const extensions = ALLOWED_EXTENSIONS.get(mimeType)
    if (!extensions?.has(extension)) {
      return NextResponse.json({ error: "logo_file_type" }, { status: 400 })
    }

    const input = Buffer.from(await file.arrayBuffer())
    if (validateUploadBytes(mimeType, input)) {
      return NextResponse.json({ error: "logo_file_content" }, { status: 400 })
    }

    let optimized: Buffer
    try {
      optimized = await sharp(input, {
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize(512, 512, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 86, alphaQuality: 90 })
        .toBuffer()
    } catch {
      return NextResponse.json({ error: "logo_file_content" }, { status: 400 })
    }

    const filename = `brand-${crypto.randomBytes(16).toString("hex")}.webp`
    const relativeUrl = `/${path.posix.join("uploads", "social-logos", auth.orgId, filename)}`
    const uploadRoot = runtimePublicUploadDirectory("social-logos")
    const uploadDir = path.resolve(uploadRoot, auth.orgId)
    if (!uploadDir.startsWith(`${uploadRoot}${path.sep}`)) {
      return NextResponse.json({ error: "monitoring_not_found" }, { status: 404 })
    }
    const filePath = path.join(uploadDir, filename)

    try {
      await mkdir(uploadDir, { recursive: true })
      await writeFile(filePath, optimized)

      const reference = await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
        await transaction.visualReference.updateMany({
          where: {
            organizationId: auth.orgId,
            subjectId: subject.id,
            referenceType: "LOGO",
            status: "active",
          },
          data: { status: "archived" },
        })
        return transaction.visualReference.create({
          data: {
            organizationId: auth.orgId,
            subjectId: subject.id,
            referenceType: "LOGO",
            label: `${subject.name} logo`,
            imageUrl: relativeUrl,
            contentHmac: hmacToken(relativeUrl, `visual-reference:${auth.orgId}`),
            processingAllowed: false,
            createdBy: auth.userId,
          },
          select: { id: true, imageUrl: true },
        })
      })

      logAudit(auth.orgId, "update", "monitoring_profile", subject.id, "logo_updated")
      return NextResponse.json({
        success: true,
        data: {
          referenceId: reference.id,
          logoUrl: reference.imageUrl,
        },
      }, { status: 201 })
    } catch (error) {
      await unlink(filePath).catch(() => undefined)
      console.error("[monitoring-profile-logo POST]", error)
      return NextResponse.json({ error: "logo_upload_failed" }, { status: 500 })
    }
  },
)
