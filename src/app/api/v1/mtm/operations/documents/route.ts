import crypto from "node:crypto"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  createMobileDocumentStorageKey,
  mobileDocumentSha256,
  mobileDocumentStorageRoot,
  resolveMobileDocumentStoragePath,
  validateMobileDocument,
  validateMobileDocumentBytes,
} from "@/lib/mtm/mobile-document"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_OPERATIONS_SCOPE_DENIED" }, { status: 403 })
}

function parseAgentIds(value: FormDataEntryValue | null): string[] | null {
  if (typeof value !== "string") return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 500) return null
    if (!parsed.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 128)) return null
    const unique = [...new Set(parsed)]
    return unique.length === parsed.length ? unique : null
  } catch {
    return null
  }
}

export const POST = withMtmRlsAuth("mtm", "write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role === "AGENT") return forbidden()

  let storagePath: string | null = null
  try {
    const formData = await req.formData()
    const file = formData.get("file")
    const title = String(formData.get("title") ?? "").trim()
    const agentIds = parseAgentIds(formData.get("agentIds"))
    const required = String(formData.get("required") ?? "false") === "true"
    const expiresOn = String(formData.get("expiresOn") ?? "").trim()

    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 })
    if (!agentIds) return NextResponse.json({ error: "Select at least one unique recipient" }, { status: 400 })
    if (agentIds.some((agentId) => !isAgentInRouteScope(actor, agentId))) return forbidden()
    if (title.length > 200) return NextResponse.json({ error: "title must be 200 characters or fewer" }, { status: 400 })
    let expiresAt: Date | null = null
    if (expiresOn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
        return NextResponse.json({ error: "expiresOn must use YYYY-MM-DD" }, { status: 400 })
      }
      expiresAt = new Date(`${expiresOn}T23:59:59.999Z`)
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.toISOString().slice(0, 10) !== expiresOn) {
        return NextResponse.json({ error: "Invalid expiration date" }, { status: 400 })
      }
    }

    const validated = validateMobileDocument(file)
    if (!validated.value) return NextResponse.json({ error: validated.error }, { status: 400 })
    const recipients = await prisma.mtmAgent.findMany({
      where: { organizationId: auth.orgId, id: { in: agentIds }, status: "ACTIVE" },
      select: { id: true, name: true },
    })
    if (recipients.length !== agentIds.length) {
      return NextResponse.json({ error: "One or more recipients are unavailable" }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const contentError = validateMobileDocumentBytes(validated.value.mimeType, bytes)
    if (contentError) return NextResponse.json({ error: contentError }, { status: 400 })

    const storageKey = createMobileDocumentStorageKey()
    storagePath = resolveMobileDocumentStoragePath(storageKey)
    await mkdir(mobileDocumentStorageRoot(), { recursive: true })
    await writeFile(storagePath, bytes, { flag: "wx" })

    const document = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.mtmDocument.create({
        data: {
          organizationId: auth.orgId,
          clientDocumentId: `web-${crypto.randomUUID()}`,
          title: title || null,
          fileName: validated.value!.fileName,
          mimeType: validated.value!.mimeType,
          sizeBytes: bytes.byteLength,
          storageKey,
          checksumSha256: mobileDocumentSha256(bytes),
          uploadedByAgentId: actor.agentId,
          uploadedByUserId: auth.userId,
        },
        select: {
          id: true,
          title: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          checksumSha256: true,
          createdAt: true,
        },
      })
      await tx.mtmDocumentAssignment.createMany({
        data: recipients.map((recipient: { id: string }) => ({
          organizationId: auth.orgId,
          documentId: created.id,
          agentId: recipient.id,
          assignedByUserId: auth.userId,
          required,
          expiresAt,
        })),
      })
      await tx.mtmNotification.createMany({
        data: recipients.map((recipient: { id: string }) => ({
          organizationId: auth.orgId,
          agentId: recipient.id,
          title: required ? "Required document" : "New document",
          body: title || validated.value!.fileName,
          type: required ? "document_required" : "document",
          metadata: { documentId: created.id },
        })),
      })
      return created
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: actor.agentId,
      action: "DOCUMENT_ASSIGN",
      entity: "document",
      entityId: document.id,
      metadataKind: "field_document",
      newData: { agentIds, required, expiresAt, fileName: document.fileName, sizeBytes: document.sizeBytes },
      req,
    }).catch((error) => console.warn("[MTM/operations/documents POST] audit failed", error))

    return NextResponse.json({
      success: true,
      data: { ...document, downloadUrl: `/api/v1/mtm/operations/documents/${document.id}/download` },
    }, { status: 201 })
  } catch (error) {
    if (storagePath) await unlink(storagePath).catch(() => undefined)
    console.error("[MTM/operations/documents POST]", error)
    return NextResponse.json({ error: "Document upload failed" }, { status: 500 })
  }
})
