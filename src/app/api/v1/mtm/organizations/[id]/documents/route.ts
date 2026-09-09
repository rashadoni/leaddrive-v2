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
import { resolveOrganizationDetailAccess } from "@/lib/mtm/organization-detail-access"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const { actor, customer } = await resolveOrganizationDetailAccess(auth, id)
  if (!actor || !canManageFieldMasterData(actor)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let storagePath: string | null = null
  try {
    const formData = await req.formData()
    const file = formData.get("file")
    const clientDocumentId = String(formData.get("clientDocumentId") ?? "").trim()
    const title = String(formData.get("title") ?? "").trim() || null
    const sourceSystem = String(formData.get("sourceSystem") ?? "").trim()
    const sourceReference = String(formData.get("sourceReference") ?? "").trim() || null
    const sourceObservedAt = new Date(String(formData.get("sourceObservedAt") ?? ""))
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 })
    if (clientDocumentId.length < 8 || clientDocumentId.length > 128) {
      return NextResponse.json({ error: "clientDocumentId must be 8..128 characters" }, { status: 400 })
    }
    if (title && title.length > 200) return NextResponse.json({ error: "title must be 200 characters or fewer" }, { status: 400 })
    if (sourceSystem.length < 2 || sourceSystem.length > 200) {
      return NextResponse.json({ error: "sourceSystem must be 2..200 characters" }, { status: 400 })
    }
    if (sourceReference && sourceReference.length > 500) return NextResponse.json({ error: "sourceReference is too long" }, { status: 400 })
    if (Number.isNaN(sourceObservedAt.getTime()) || sourceObservedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return NextResponse.json({ error: "A valid sourceObservedAt is required and cannot be in the future" }, { status: 400 })
    }
    const validated = validateMobileDocument(file)
    if (!validated.value) return NextResponse.json({ error: validated.error }, { status: 400 })
    const bytes = Buffer.from(await file.arrayBuffer())
    const contentError = validateMobileDocumentBytes(validated.value.mimeType, bytes)
    if (contentError) return NextResponse.json({ error: contentError }, { status: 400 })
    const checksumSha256 = mobileDocumentSha256(bytes)
    const existing = await prisma.mtmDocument.findFirst({
      where: { organizationId: auth.orgId, clientDocumentId },
      select: { id: true, customerId: true, checksumSha256: true, deletedAt: true },
    })
    if (existing) {
      if (existing.customerId !== id || existing.checksumSha256 !== checksumSha256 || existing.deletedAt) {
        return NextResponse.json({ error: "clientDocumentId was already used with different file facts", code: "MTM_DOCUMENT_REPLAY_MISMATCH" }, { status: 409 })
      }
      return NextResponse.json({ success: true, data: { document: existing, idempotent: true } })
    }

    const storageKey = createMobileDocumentStorageKey()
    storagePath = resolveMobileDocumentStoragePath(storageKey)
    await mkdir(mobileDocumentStorageRoot(), { recursive: true })
    await writeFile(storagePath, bytes, { flag: "wx" })
    const document = await prisma.mtmDocument.create({
      data: {
        organizationId: auth.orgId,
        customerId: id,
        clientDocumentId,
        title,
        fileName: validated.value.fileName,
        mimeType: validated.value.mimeType,
        sizeBytes: bytes.byteLength,
        storageKey,
        checksumSha256,
        uploadedByAgentId: actor.agentId,
        uploadedByUserId: auth.userId || null,
        sourceSystem,
        sourceReference,
        sourceObservedAt,
      },
      select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, checksumSha256: true, sourceSystem: true, sourceReference: true, sourceObservedAt: true, createdAt: true },
    })
    storagePath = null
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "FIELD_ORGANIZATION_UPDATE",
      entity: "document",
      entityId: document.id,
      metadataKind: "organization_document_uploaded",
      newData: { customerId: id, ...document },
      req,
    }).catch((error) => console.warn("[MTM/organizations/documents POST] audit failed", error))
    return NextResponse.json({ success: true, data: { document, idempotent: false } }, { status: 201 })
  } catch (error) {
    if (storagePath) await unlink(storagePath).catch(() => undefined)
    throw error
  }
})
