import { mkdir, unlink, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { readFormDataRequestWithinLimit } from "@/lib/request-body-limit"
import {
  createMobileDocumentStorageKey,
  MAX_MOBILE_DOCUMENT_BYTES,
  mobileDocumentSha256,
  mobileDocumentStorageRoot,
  resolveMobileDocumentStoragePath,
  validateMobileDocument,
  validateMobileDocumentBytes,
} from "@/lib/mtm/mobile-document"
import {
  readMtmMobileMediaUploadPolicy,
  releaseMtmMobileMediaUpload,
  mtmMobileMediaDeviceCohortRequiredResponse,
  requireMtmMobileMediaAccess,
  reserveMtmMobileMediaUpload,
  type MtmMobileMediaUploadPolicy,
} from "@/lib/mtm/mobile-media-guard"
import { recordMtmMobileMediaTelemetry } from "@/lib/mtm/mobile-media-telemetry"
import { mtmMediaObjectUploadFailureResponse } from "@/lib/mtm/media-object-http"
import {
  attachMtmMediaObjectInTransaction,
  ensureMtmMediaObjectUploaded,
  hashMtmMediaObjectRequest,
  MtmMediaObjectLifecycleError,
  reserveMtmMediaObject,
} from "@/lib/mtm/media-object-lifecycle"
import { readMtmMediaObjectStorageConfig } from "@/lib/mtm/media-object-storage"
import { withMobileRls } from "@/lib/with-mobile-rls"

// Multipart framing and small text fields need headroom beyond the binary-file
// limit. The parser enforces this while streaming, so an undeclared large body
// never reaches `formData()` or a disk write.
const MAX_DOCUMENT_MULTIPART_BYTES = MAX_MOBILE_DOCUMENT_BYTES + 1_024 * 1_024

const responseDocumentSelect = {
  id: true,
  clientDocumentId: true,
  title: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  visitId: true,
  taskId: true,
  createdAt: true,
} satisfies Prisma.MtmDocumentSelect

type ExistingMobileDocument = {
  title: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string | null
  visitId: string | null
  taskId: string | null
}

type DocumentReplayInput = {
  checksumSha256: string
  fileName: string
  mimeType: string
  sizeBytes: number
  title: string | null
  visitId: string | null
  taskId: string | null
}

function isExactDocumentReplay(input: { existing: ExistingMobileDocument } & DocumentReplayInput): boolean {
  const { existing } = input
  // Rows written before durable checksums cannot prove that a reused client ID
  // carries the same bytes. Return a visible conflict rather than falsely
  // acknowledging a different document and allowing the APK to drop its file.
  return existing.checksumSha256 !== null
    && existing.checksumSha256 === input.checksumSha256
    && existing.fileName === input.fileName
    && existing.mimeType === input.mimeType
    && existing.sizeBytes === input.sizeBytes
    && existing.title === input.title
    && existing.visitId === input.visitId
    && existing.taskId === input.taskId
}

function documentIdConflictResponse() {
  return NextResponse.json(
    {
      error: "clientDocumentId was already used with different document data",
      code: "MTM_DOCUMENT_ID_CONFLICT",
    },
    { status: 409 },
  )
}

export const runtime = "nodejs"
export const maxDuration = 300

export const POST = withMobileRls(async (req, auth) => {
  let storagePath: string | null = null
  let clientDocumentId = ""
  let replayInput: DocumentReplayInput | null = null
  let uploadReservation: Awaited<ReturnType<typeof reserveMtmMobileMediaUpload>> | null = null
  let uploadBytes: number | null = null
  let mediaPolicy: MtmMobileMediaUploadPolicy = {
    contractVersion: 1,
    deviceId: null,
    isolated: false,
    requiresDeviceCohort: false,
    cohortEpoch: null,
  }
  const startedAt = Date.now()
  const record = (result: "ok" | "forbidden" | "invalid_request" | "conflict" | "rate_limited" | "unavailable" | "failed") => {
    recordMtmMobileMediaTelemetry({
      organizationId: auth.orgId,
      endpoint: "documents",
      contractVersion: mediaPolicy.contractVersion,
      apkVersion: req.headers.get("x-field-apk-version"),
      result,
      durationMs: Date.now() - startedAt,
      bytes: uploadBytes,
    })
  }

  try {
    const accessForbidden = await requireMtmMobileMediaAccess(auth)
    if (accessForbidden) {
      record("forbidden")
      return accessForbidden
    }

    // The server owns contract selection. A request header can identify a
    // device, but cannot turn protection on or off for that device.
    mediaPolicy = await readMtmMobileMediaUploadPolicy({
      auth,
      deviceId: req.headers.get("x-field-device-id"),
    })
    if (mediaPolicy.requiresDeviceCohort) {
      record("forbidden")
      return mtmMobileMediaDeviceCohortRequiredResponse()
    }
    // This is also applied to v1-compatible callers. The media cohort owns
    // rollout semantics, not basic protection of the non-streaming multipart
    // parser from a cross-tenant memory storm.
    uploadReservation = await reserveMtmMobileMediaUpload({
      auth,
      deviceId: mediaPolicy.deviceId,
    })
    if (!uploadReservation.allowed) {
      record(uploadReservation.response.status === 503 ? "unavailable" : "rate_limited")
      return uploadReservation.response
    }

    const parsed = await readFormDataRequestWithinLimit(req, MAX_DOCUMENT_MULTIPART_BYTES)
    if (!parsed.ok) {
      record("invalid_request")
      return NextResponse.json(
        {
          error: parsed.reason === "too_large" ? "Payload too large" : "multipart/form-data required",
          code: parsed.reason === "too_large" ? "MTM_MOBILE_MEDIA_PAYLOAD_TOO_LARGE" : "MTM_MOBILE_MEDIA_INVALID_MULTIPART",
        },
        { status: parsed.reason === "too_large" ? 413 : 400 },
      )
    }

    const formData = parsed.value
    const file = formData.get("file")
    clientDocumentId = String(formData.get("clientDocumentId") ?? "").trim()
    const titleRaw = String(formData.get("title") ?? "").trim()
    const title = titleRaw || null
    const visitId = String(formData.get("visitId") ?? "").trim() || null
    const taskId = String(formData.get("taskId") ?? "").trim() || null

    if (!(file instanceof File)) {
      record("invalid_request")
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }
    uploadBytes = file.size
    if (clientDocumentId.length < 8 || clientDocumentId.length > 128) {
      record("invalid_request")
      return NextResponse.json({ error: "clientDocumentId must be 8..128 characters" }, { status: 400 })
    }
    if (titleRaw.length > 200) {
      record("invalid_request")
      return NextResponse.json({ error: "title must be 200 characters or fewer" }, { status: 400 })
    }
    if ((visitId && visitId.length > 128) || (taskId && taskId.length > 128)) {
      record("invalid_request")
      return NextResponse.json({ error: "Invalid visitId or taskId" }, { status: 400 })
    }

    const validated = validateMobileDocument(file)
    if (!validated.value) {
      record("invalid_request")
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    const documentMeta = validated.value
    const bytes = Buffer.from(await file.arrayBuffer())
    const contentError = validateMobileDocumentBytes(documentMeta.mimeType, bytes)
    if (contentError) {
      record("invalid_request")
      return NextResponse.json({ error: contentError }, { status: 400 })
    }
    const checksumSha256 = mobileDocumentSha256(bytes)
    const exactReplayInput: DocumentReplayInput = {
      checksumSha256,
      fileName: documentMeta.fileName,
      mimeType: documentMeta.mimeType,
      sizeBytes: bytes.byteLength,
      title,
      visitId,
      taskId,
    }
    replayInput = exactReplayInput

    // Compute and compare the immutable digest before replay. A duplicate ID
    // is safe only when the file *and* its causal binding are identical.
    const existing = await prisma.mtmDocument.findFirst({
      where: { organizationId: auth.orgId, clientDocumentId, uploadedByAgentId: auth.agentId, deletedAt: null },
      select: responseDocumentSelect,
    })
    if (existing) {
      if (!isExactDocumentReplay({ existing, ...exactReplayInput })) {
        record("conflict")
        return documentIdConflictResponse()
      }
      record("ok")
      return NextResponse.json({ success: true, data: existing, idempotent: true })
    }

    const [visit, task] = await Promise.all([
      visitId
        ? prisma.mtmVisit.findFirst({
            where: {
              id: visitId,
              organizationId: auth.orgId,
              deletedAt: null,
              OR: [
                { agentId: auth.agentId },
                { participants: { some: { agentId: auth.agentId, leftAt: null, role: { not: "OBSERVER" } } } },
              ],
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      taskId
        ? prisma.mtmTask.findFirst({
            where: { id: taskId, organizationId: auth.orgId, agentId: auth.agentId, deletedAt: null },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])
    if (visitId && !visit) {
      record("invalid_request")
      return NextResponse.json({ error: "Visit not found or not available", code: "MTM_DOCUMENT_VISIT_NOT_FOUND" }, { status: 409 })
    }
    if (taskId && !task) {
      record("invalid_request")
      return NextResponse.json({ error: "Task not found or not owned", code: "MTM_DOCUMENT_TASK_NOT_FOUND" }, { status: 409 })
    }

    const persistDocument = async (input: { storageKey: string; mediaObjectId?: string }) => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.mtmDocument.create({
        data: {
          organizationId: auth.orgId,
          clientDocumentId,
          title,
          fileName: documentMeta.fileName,
          mimeType: documentMeta.mimeType,
          sizeBytes: bytes.byteLength,
          storageKey: input.storageKey,
          checksumSha256,
          uploadedByAgentId: auth.agentId,
          visitId,
          taskId,
        },
        select: responseDocumentSelect,
      })
      await tx.mtmDocumentAssignment.create({
        data: {
          organizationId: auth.orgId,
          documentId: created.id,
          agentId: auth.agentId,
          required: false,
          readAt: new Date(),
        },
      })
      if (input.mediaObjectId) {
        await attachMtmMediaObjectInTransaction({
          tx,
          organizationId: auth.orgId,
          mediaObjectId: input.mediaObjectId,
          kind: "DOCUMENT",
          businessId: created.id,
        })
      }
      return created
    })

    // Object storage is a server-first, exact-cohort path. An enabled bucket
    // never makes an old APK write remotely, and an exact cohort never writes
    // both remote bytes and a local filesystem copy.
    let objectStorage = null
    if (mediaPolicy.isolated) {
      try {
        objectStorage = readMtmMediaObjectStorageConfig()
      } catch (error) {
        const response = mtmMediaObjectUploadFailureResponse(error)
        if (response) {
          record(response.status === 429 ? "rate_limited" : "unavailable")
          return response
        }
        throw error
      }
    }
    if (objectStorage) {
      const requestHash = hashMtmMediaObjectRequest({
        kind: "DOCUMENT",
        clientMediaId: clientDocumentId,
        checksumSha256,
        mimeType: documentMeta.mimeType,
        sizeBytes: bytes.byteLength,
        causal: {
          fileName: documentMeta.fileName,
          title,
          visitId,
          taskId,
        },
      })
      const reservation = await reserveMtmMediaObject({
        config: objectStorage,
        organizationId: auth.orgId,
        uploaderAgentId: auth.agentId,
        clientMediaId: clientDocumentId,
        requestHash,
        kind: "DOCUMENT",
        checksumSha256,
        sizeBytes: bytes.byteLength,
        mimeType: documentMeta.mimeType,
      })
      if (reservation.status === "mismatch") {
        record("conflict")
        return documentIdConflictResponse()
      }
      if (reservation.status === "quarantined") {
        const response = mtmMediaObjectUploadFailureResponse(
          new MtmMediaObjectLifecycleError("MTM_MEDIA_OBJECT_RECOVERY_REQUIRED"),
        )
        record("conflict")
        return response ?? documentIdConflictResponse()
      }
      try {
        await ensureMtmMediaObjectUploaded({
          config: objectStorage,
          mediaObject: reservation.mediaObject,
          plaintext: bytes,
        })
      } catch (error) {
        const response = mtmMediaObjectUploadFailureResponse(error)
        if (response) {
          record(response.status === 429 ? "rate_limited" : response.status === 409 ? "conflict" : "unavailable")
          return response
        }
        throw error
      }
      const document = await persistDocument({
        // `storageKey` remains required during the additive migration, but is
        // only a compatibility handle here. Readers select mediaObject first
        // and never resolve it to a filesystem path.
        storageKey: createMobileDocumentStorageKey(),
        mediaObjectId: reservation.mediaObject.mediaObjectId,
      })
      record("ok")
      return NextResponse.json({ success: true, data: document }, { status: 201 })
    }

    const storageKey = createMobileDocumentStorageKey()
    storagePath = resolveMobileDocumentStoragePath(storageKey)
    await mkdir(mobileDocumentStorageRoot(), { recursive: true })
    await writeFile(storagePath, bytes, { flag: "wx" })

    const document = await persistDocument({ storageKey })

    record("ok")
    return NextResponse.json({ success: true, data: document }, { status: 201 })
  } catch (error) {
    if (storagePath) await unlink(storagePath).catch(() => undefined)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      try {
        const existing = await prisma.mtmDocument.findFirst({
          where: { organizationId: auth.orgId, clientDocumentId, uploadedByAgentId: auth.agentId, deletedAt: null },
          select: responseDocumentSelect,
        })
        if (existing && replayInput && isExactDocumentReplay({ existing, ...replayInput })) {
          record("ok")
          return NextResponse.json({ success: true, data: existing, idempotent: true })
        }
        if (existing) {
          record("conflict")
          return documentIdConflictResponse()
        }
        record("conflict")
        return documentIdConflictResponse()
      } catch {
        // Fall through to the retryable response below.
      }
    }
    const mediaFailure = mtmMediaObjectUploadFailureResponse(error)
    if (mediaFailure) {
      record(mediaFailure.status === 429 ? "rate_limited" : mediaFailure.status === 409 ? "conflict" : "unavailable")
      return mediaFailure
    }
    console.error("[MTM/mobile/documents/upload POST]", error)
    record("failed")
    return NextResponse.json({ error: "Document upload failed, retry" }, { status: 500 })
  } finally {
    if (uploadReservation?.allowed) {
      await releaseMtmMobileMediaUpload(uploadReservation.reservation)
    }
  }
})
