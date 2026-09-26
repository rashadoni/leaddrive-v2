import { mkdir, unlink, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import {
  createMobileDocumentStorageKey,
  mobileDocumentSha256,
  mobileDocumentStorageRoot,
  resolveMobileDocumentStoragePath,
  validateMobileDocument,
  validateMobileDocumentBytes,
} from "@/lib/mtm/mobile-document"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

export const runtime = "nodejs"

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Manager access required", code: "MTM_PRODUCT_UPLOAD_FORBIDDEN" }, { status: 403 })
  }

  let storagePath: string | null = null
  try {
    const formData = await req.formData()
    const file = formData.get("file")
    const clientDocumentId = String(formData.get("clientDocumentId") ?? "").trim()
    const title = String(formData.get("title") ?? "").trim() || null
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 })
    if (clientDocumentId.length < 8 || clientDocumentId.length > 128) {
      return NextResponse.json({ error: "clientDocumentId must be 8..128 characters" }, { status: 400 })
    }
    if (title && title.length > 200) {
      return NextResponse.json({ error: "title must be 200 characters or fewer" }, { status: 400 })
    }

    const validated = validateMobileDocument(file)
    if (!validated.value) return NextResponse.json({ error: validated.error }, { status: 400 })
    if (![
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(validated.value.mimeType)) {
      return NextResponse.json({ error: "Only PDF or PowerPoint presentations are allowed" }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const contentError = validateMobileDocumentBytes(validated.value.mimeType, bytes)
    if (contentError) return NextResponse.json({ error: contentError }, { status: 400 })
    const checksumSha256 = mobileDocumentSha256(bytes)
    const existing = await prisma.mtmDocument.findFirst({
      where: { organizationId: auth.orgId, clientDocumentId },
      select: { id: true, checksumSha256: true, deletedAt: true },
    })
    if (existing) {
      if (existing.checksumSha256 !== checksumSha256 || existing.deletedAt) {
        return NextResponse.json({ error: "Upload id was already used for different bytes", code: "MTM_PRODUCT_UPLOAD_CONFLICT" }, { status: 409 })
      }
      return NextResponse.json({ success: true, data: { document: existing }, idempotent: true })
    }

    const storageKey = createMobileDocumentStorageKey()
    storagePath = resolveMobileDocumentStoragePath(storageKey)
    await mkdir(mobileDocumentStorageRoot(), { recursive: true })
    await writeFile(storagePath, bytes, { flag: "wx" })
    const document = await prisma.mtmDocument.create({
      data: {
        organizationId: auth.orgId,
        clientDocumentId,
        title,
        fileName: validated.value.fileName,
        mimeType: validated.value.mimeType,
        sizeBytes: bytes.byteLength,
        storageKey,
        checksumSha256,
        uploadedByAgentId: actor.agentId,
        uploadedByUserId: auth.userId || null,
        sourceSystem: "FIELD_PRODUCT_CATALOG",
        sourceObservedAt: new Date(),
      },
      select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, checksumSha256: true },
    })
    storagePath = null

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "FIELD_PRODUCT_PRESENTATION_UPLOAD",
      entity: "document",
      entityId: document.id,
      metadataKind: "product_presentation_uploaded",
      newData: document,
      req,
    }).catch((error) => console.warn("[MTM/products/upload POST] audit failed", error))

    return NextResponse.json({ success: true, data: { document }, idempotent: false }, { status: 201 })
  } catch (error) {
    if (storagePath) await unlink(storagePath).catch(() => undefined)
    console.error("[MTM/products/upload POST]", error)
    return NextResponse.json({ error: "Failed to upload presentation", code: "MTM_PRODUCT_UPLOAD_FAILED" }, { status: 500 })
  }
})
