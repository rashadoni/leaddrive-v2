import { NextResponse } from "next/server"
import { createHash, randomBytes } from "node:crypto"
import { MtmPhotoStatus, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { readFormDataRequestWithinLimit } from "@/lib/request-body-limit"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { writeFile, mkdir, unlink } from "fs/promises"
import path from "path"
import {
  writeMtmAudit,
  PHOTO_TAMPER_DETECTED,
  PHOTO_GPS_VS_CUSTOMER_MISMATCH,
  PHOTO_ANOMALY_CHECK_FAILED,
  PHOTO_BURST_SUSPICIOUS,
} from "@/lib/mtm-audit"
import { checkRateLimit } from "@/lib/rate-limit"
import { decidePhotoStatus, parseExifFromBuffer } from "@/lib/mtm/photo-watermark"
import { checkGpsVsCustomer, checkBurstUpload, BURST_WINDOW_SECONDS } from "@/lib/mtm/visit-anomaly"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canMutateMtmVisit, mutableVisitWhere } from "@/lib/mtm/visit-scope"
import {
  readMtmMobileMediaUploadPolicy,
  releaseMtmMobileMediaUpload,
  mtmMobileMediaDeviceCohortRequiredResponse,
  reserveMtmMobileMediaUpload,
  type MtmMobileMediaUploadPolicy,
} from "@/lib/mtm/mobile-media-guard"
import { recordMtmMobileMediaTelemetry } from "@/lib/mtm/mobile-media-telemetry"
import { mtmMediaObjectUploadFailureResponse } from "@/lib/mtm/media-object-http"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import {
  attachMtmMediaObjectInTransaction,
  ensureMtmMediaObjectUploaded,
  hashMtmMediaObjectRequest,
  MtmMediaObjectLifecycleError,
  reserveMtmMediaObject,
} from "@/lib/mtm/media-object-lifecycle"
import { readMtmMediaObjectStorageConfig } from "@/lib/mtm/media-object-storage"
// Static import (not dynamic) so Next.js's output-file-tracing pulls
// heic-convert into .next/standalone/node_modules. Dynamic
// `await import("heic-convert")` left the module out of the prod
// bundle entirely and the HEIC branch threw MODULE_NOT_FOUND at
// runtime.
import heicConvert from "heic-convert"

// F-39: server-side HEIC→JPEG quality. 0.85 is the Instagram/Apple
// default for "high-quality photo" — visually indistinguishable from
// the source at standard viewing distance, 30-40% smaller than 1.0.
// Lower if MTM shifts to very-high-volume uploads on cramped storage.
const HEIC_JPEG_QUALITY = 0.85
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
// Keep a bounded multipart envelope around the binary limit. This is enforced
// before multipart parsing, including when Content-Length is omitted/spoofed.
const MAX_PHOTO_MULTIPART_BYTES = MAX_PHOTO_BYTES + 1_024 * 1_024

type ScopedPhotoVisit = {
  status: string
  requirementSnapshot: { requirements: Array<{ mode: string }> } | null
  customer: { id: string; latitude: number | null; longitude: number | null }
}

class PhotoVisitMutationFenceError extends Error {}
class PhotoLimitFenceError extends Error {
  constructor(readonly limit: number) {
    super("Photo limit reached")
  }
}

type PhotoReplayInput = {
  checksumSha256: string
  visitId: string | null
  category: string | null
  latitude: number | null
  longitude: number | null
}

function sameOptionalNumber(left: number | null, right: number | null): boolean {
  return left === right || (left === null && right === null)
}

function isExactPhotoReplay(existing: {
  checksumSha256: string | null
  visitId: string | null
  category: string | null
  latitude: number | null
  longitude: number | null
}, input: PhotoReplayInput): boolean {
  // Historic rows predate the checksum. They cannot prove equality of a
  // replayed file, so acknowledging them would risk dropping a different
  // local file after a reused clientPhotoId.
  return existing.checksumSha256 !== null
    && existing.checksumSha256 === input.checksumSha256
    && existing.visitId === input.visitId
    && existing.category === input.category
    && sameOptionalNumber(existing.latitude, input.latitude)
    && sameOptionalNumber(existing.longitude, input.longitude)
}

function photoIdConflictResponse() {
  return NextResponse.json(
    {
      error: "clientPhotoId was already used with different photo data",
      code: "MTM_PHOTO_ID_CONFLICT",
    },
    { status: 409 },
  )
}

function mimeForPhotoExtension(extension: string): string {
  if (extension === "jpg") return "image/jpeg"
  if (extension === "png") return "image/png"
  if (extension === "webp") return "image/webp"
  throw new Error("Unsupported validated photo extension")
}

function distanceBucket(distanceMeters: number): string {
  if (distanceMeters < 100) return "lt_100m"
  if (distanceMeters < 500) return "100m_500m"
  if (distanceMeters < 2_000) return "500m_2km"
  return "gte_2km"
}

function parseMtmPhotoStatus(value: string): MtmPhotoStatus | null {
  return (Object.values(MtmPhotoStatus) as string[]).includes(value)
    ? value as MtmPhotoStatus
    : null
}

export const runtime = "nodejs"
export const maxDuration = 300

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const orgId = auth.orgId
  let uploadReservation: Awaited<ReturnType<typeof reserveMtmMobileMediaUpload>> | null = null
  let uploadBytes: number | null = null
  let replayInput: PhotoReplayInput | null = null
  let telemetryRecorded = false
  let mediaPolicy: MtmMobileMediaUploadPolicy = {
    contractVersion: 1,
    deviceId: null,
    isolated: false,
    requiresDeviceCohort: false,
    cohortEpoch: null,
  }
  const startedAt = Date.now()
  const record = (result: "ok" | "forbidden" | "invalid_request" | "conflict" | "rate_limited" | "unavailable" | "failed") => {
    if (auth.principal !== "mobile") return
    telemetryRecorded = true
    recordMtmMobileMediaTelemetry({
      organizationId: orgId,
      endpoint: "photos",
      contractVersion: mediaPolicy.contractVersion,
      apkVersion: req.headers.get("x-field-apk-version"),
      result,
      durationMs: Date.now() - startedAt,
      bytes: uploadBytes,
    })
  }
  try {
    if (auth.principal === "mobile") {
      // withMtmRlsAuth constructs mobile auth with an agent, but retain an
      // explicit runtime fence so a future wrapper change cannot turn null
      // attribution into a shared media quota key.
      if (!auth.agentId) {
        record("forbidden")
        return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
      }
      const mobileMediaAuth = {
        orgId: auth.orgId,
        agentId: auth.agentId,
        userId: auth.userId,
        role: auth.role,
        // The wrapper only enters this branch after withMobileRls supplied
        // the revocation-time capability snapshot. The defensive false
        // fallback keeps a future wrapper regression fail-closed.
        tenantCapabilities: auth.tenantCapabilities ?? { routeField: false, workforceHrm: false },
      }
      // Contract selection is server-side cohort state, not a client header.
      // A cohort member cannot bypass the guard by changing request metadata.
      mediaPolicy = await readMtmMobileMediaUploadPolicy({
        auth: mobileMediaAuth,
        deviceId: req.headers.get("x-field-device-id"),
      })
      if (mediaPolicy.requiresDeviceCohort) {
        record("forbidden")
        return mtmMobileMediaDeviceCohortRequiredResponse()
      }
      // A bounded admission slot protects the multipart parser for legacy v1
      // traffic too. Cohort enrollment changes the client contract and makes
      // the device selector mandatory, but it must not leave old APK traffic
      // able to exhaust process memory before an object-storage intake exists.
      uploadReservation = await reserveMtmMobileMediaUpload({
        auth: mobileMediaAuth,
        deviceId: mediaPolicy.deviceId,
      })
      if (!uploadReservation.allowed) {
        record(uploadReservation.response.status === 503 ? "unavailable" : "rate_limited")
        return uploadReservation.response
      }
    }

    const parsed = await readFormDataRequestWithinLimit(req, MAX_PHOTO_MULTIPART_BYTES)
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
    const file = formData.get("file") as File | null
    const requestedAgentId = String(formData.get("agentId") ?? "").trim()
    const visitId = (formData.get("visitId") as string) || null
    const clientPhotoId = (formData.get("clientPhotoId") as string) || null
    const category = (formData.get("category") as string) || null
    const latitude = formData.get("latitude") ? parseFloat(formData.get("latitude") as string) : null
    const longitude = formData.get("longitude") ? parseFloat(formData.get("longitude") as string) : null

    if (!file || !requestedAgentId) {
      return NextResponse.json({ error: "file and agentId are required" }, { status: 400 })
    }
    uploadBytes = file.size
    if (clientPhotoId && (clientPhotoId.length < 8 || clientPhotoId.length > 128)) {
      return NextResponse.json({ error: "clientPhotoId must be 8..128 characters" }, { status: 400 })
    }

    const actor = await resolveMtmRouteActor(prisma, {
      organizationId: orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    })
    if (!actor) {
      return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
    }

    // A mobile token always owns the attribution. Web callers may select a
    // target only inside their freshly resolved primary-agent scope.
    if (auth.agentId && requestedAgentId !== auth.agentId) {
      return NextResponse.json({ error: "Photo agent is outside caller scope", code: "MTM_PHOTO_AGENT_OUT_OF_SCOPE" }, { status: 403 })
    }
    const authenticatedAgentId = auth.agentId ?? requestedAgentId
    if (!canMutateMtmVisit(actor, authenticatedAgentId)) {
      return NextResponse.json({ error: "Agent not found", code: "MTM_AGENT_NOT_FOUND" }, { status: 404 })
    }

    if (file.size > MAX_PHOTO_BYTES) {
      record("invalid_request")
      return NextResponse.json(
        { error: "File too large (max 10MB)", code: "MTM_MOBILE_MEDIA_PAYLOAD_TOO_LARGE" },
        { status: 413 },
      )
    }
    const allowedExtensions = ["jpg", "jpeg", "png", "webp", "heic"]
    const ext = (file.name?.split(".").pop() || "").toLowerCase()
    if (!allowedExtensions.includes(ext)) {
      record("invalid_request")
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 })
    }

    // The raw (pre-conversion) digest makes a durable mobile ID identify the
    // exact bytes the APK still retains locally. It must be computed before a
    // replay is acknowledged, even if the request is retried after checkout.
    const buffer = Buffer.from(await file.arrayBuffer())
    const exactReplayInput: PhotoReplayInput = {
      checksumSha256: createHash("sha256").update(buffer).digest("hex"),
      visitId,
      category,
      latitude,
      longitude,
    }
    replayInput = exactReplayInput

    // Replay an already-committed, auth-owned upload before active-visit
    // validation. A lost response may be retried after checkout/reassignment,
    // but a reused ID with different bytes or binding is a visible conflict.
    if (clientPhotoId) {
      const existing = await prisma.mtmPhoto.findFirst({
        where: { organizationId: orgId, agentId: authenticatedAgentId, clientPhotoId },
      })
      if (existing) {
        if (!isExactPhotoReplay(existing, exactReplayInput)) {
          record("conflict")
          return photoIdConflictResponse()
        }
        record("ok")
        return NextResponse.json({ success: true, data: existing, idempotent: true })
      }
    }

    const activeTarget = await prisma.mtmAgent.findFirst({
      where: { id: authenticatedAgentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!activeTarget) {
      return NextResponse.json({ error: "Agent not found", code: "MTM_AGENT_NOT_FOUND" }, { status: 404 })
    }

    let scopedVisit: ScopedPhotoVisit | null = null
    if (visitId) {
      scopedVisit = await prisma.mtmVisit.findFirst({
        where: {
          ...mutableVisitWhere(actor, orgId, { id: visitId }),
          agentId: authenticatedAgentId,
        },
        select: {
          status: true,
          customer: { select: { id: true, latitude: true, longitude: true } },
          requirementSnapshot: {
            select: { requirements: { where: { actionKey: "PHOTO" }, select: { mode: true } } },
          },
        },
      })
      if (!scopedVisit) {
        return NextResponse.json({ error: "Visit not found or not assigned to agent", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
      }
      if (scopedVisit.status !== "CHECKED_IN") {
        return NextResponse.json({ error: "Visit is not active", code: "MTM_VISIT_NOT_ACTIVE" }, { status: 409 })
      }
      if (scopedVisit.requirementSnapshot?.requirements[0]?.mode === "HIDDEN") {
        return NextResponse.json({ error: "Photo is hidden for this visit", code: "MTM_VISIT_ACTION_HIDDEN" }, { status: 403 })
      }
    }

    // Every mobile caller has already acquired the Redis-backed body-admission
    // slot before parsing. Legacy v1 photos additionally retain their existing
    // process-local burst limiter; web callers retain the web limiter.
    if (!mediaPolicy.isolated) {
      const rlKey = auth.agentId ? `mobile:${auth.agentId}` : `web:${auth.userId}`
      if (!checkRateLimit(`mtm-photos:${rlKey}`, { maxRequests: 30, windowMs: 60_000 })) {
        console.warn(`[MTM/photos POST] 429 rate-limit hit for ${rlKey}`)
        record("rate_limited")
        return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 })
      }
    }

    // maxPhotosPerVisit (org setting): reject uploads beyond the per-visit cap.
    // Only applies when the upload is tied to a visit — ad-hoc photos are uncapped.
    let maxPhotosPerVisit: number | null = null
    if (visitId) {
      const settings = await getMtmSettings(orgId)
      maxPhotosPerVisit = settings.maxPhotosPerVisit
      const existing = await prisma.mtmPhoto.count({ where: { visitId, organizationId: orgId } })
      if (existing >= maxPhotosPerVisit) {
        return NextResponse.json(
          { error: `Photo limit reached (${maxPhotosPerVisit} per visit)`, code: "MAX_PHOTOS_REACHED" },
          { status: 422 }
        )
      }
    }

    // F-15 / M-01: detect actual format from magic numbers, then validate.
    // — accept HEIC body even if extension lies "jpg" (iOS vision-camera in
    //   default mode returns HEIC but mobile uploads as image/jpeg with .jpg).
    // — rewrite filename with the *actual* extension so the on-disk file matches
    //   its content; otherwise downstream image processing breaks.
    // — files < 12 bytes can't carry any valid image header → reject (architect
    //   round 18: previously short files bypassed validation entirely and were
    //   written to disk with the originally-trusted extension).
    if (buffer.length < 12) {
      return NextResponse.json({ error: "File too small to validate (need ≥12 bytes for magic-number check)" }, { status: 400 })
    }
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
    // WebP: "RIFF????WEBP"
    const isWebp =
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    // HEIC/HEIF: bytes 4-7 == "ftyp", bytes 8-11 in {"heic","heix","mif1","msf1","heim","heis","hevc","hevx","heif"}
    const isFtyp =
      buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
    const brand = isFtyp ? String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]) : ""
    const HEIC_BRANDS = new Set(["heic", "heix", "mif1", "msf1", "heim", "heis", "hevc", "hevx", "heif"])
    const isHeic = isFtyp && HEIC_BRANDS.has(brand)

    // Detect actual format from magic. HEIC is converted to JPEG below
    // because no major browser renders .heic natively (Chrome/Firefox/Safari
    // on macOS all show a broken-image icon, blocking the photo-review UI).
    let actualExt: string
    let writeBuffer: Buffer = buffer
    if (isJpeg) actualExt = "jpg"
    else if (isPng) actualExt = "png"
    else if (isWebp) actualExt = "webp"
    else if (isHeic) {
      // F-39: server-side HEIC → JPEG conversion. iPhone default camera
      // captures HEIC; mobile uploads the original bytes (cheaper than
      // device-side conversion). Server pays the ~200ms one-time cost
      // here so the file written to disk renders in every browser.
      try {
        // heic-convert ships no .d.ts; project-local declaration at
        // src/types/heic-convert.d.ts mirrors the README signature.
        const jpegArrayBuf = await heicConvert({ buffer, format: "JPEG", quality: HEIC_JPEG_QUALITY })
        writeBuffer = Buffer.from(jpegArrayBuf)
        actualExt = "jpg"
      } catch (e: unknown) {
        console.error("[MTM Photos POST] HEIC conversion failed", e)
        return NextResponse.json(
          { error: "Failed to convert HEIC image — please retry from the mobile app" },
          { status: 415 }
        )
      }
    }
    else {
      return NextResponse.json({ error: "Invalid file type (no recognized image magic-number)" }, { status: 400 })
    }

    let objectStorage: ReturnType<typeof readMtmMediaObjectStorageConfig> = null
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
    if (objectStorage && !clientPhotoId) {
      // The legacy endpoint historically allowed an unkeyed photo. An exact
      // object-storage cohort cannot: a durable client ID is what recovers a
      // process death between the remote PUT and business transaction.
      record("invalid_request")
      return NextResponse.json(
        { error: "clientPhotoId is required for this media rollout", code: "MTM_MOBILE_MEDIA_ID_REQUIRED" },
        { status: 400 },
      )
    }

    // A public-looking app URL remains the stable presentation handle; it is
    // still authorized by the upload proxy and never exposes the bucket/key.
    // Object-backed names omit agent/timestamp data and have 192 bits of
    // randomness. Legacy names remain exactly as they were for old files.
    const fileName = objectStorage
      ? `media-${randomBytes(24).toString("hex")}.${actualExt}`
      : `${Date.now()}-${authenticatedAgentId.slice(-6)}-${Math.random().toString(36).slice(2, 10)}.${actualExt}`
    const url = `/uploads/mtm-photos/${fileName}`
    let filePath: string | null = null
    if (!objectStorage) {
      const uploadDir = runtimePublicUploadDirectory("mtm-photos")
      await mkdir(uploadDir, { recursive: true })
      filePath = path.join(uploadDir, fileName)
      await writeFile(filePath, writeBuffer)
    }

    // Parse EXIF from the bytes we're about to store, then classify against
    // the server-enforced target identity. Multipart agentId is never used
    // without the fresh actor + current-scope checks above.
    const exif = await parseExifFromBuffer(writeBuffer)
    const decision = decidePhotoStatus({
      exif,
      claim: { latitude, longitude, agentId: authenticatedAgentId },
      serverNow: new Date(),
    })

    let mediaObjectId: string | null = null
    if (objectStorage && clientPhotoId) {
      const objectChecksumSha256 = createHash("sha256").update(writeBuffer).digest("hex")
      const objectMimeType = mimeForPhotoExtension(actualExt)
      const requestHash = hashMtmMediaObjectRequest({
        kind: "PHOTO",
        clientMediaId: clientPhotoId,
        // Retain the digest of the original local file in the reservation.
        // HEIC conversion may change stored bytes, but must not weaken client
        // idempotency or let a different original payload replay as success.
        checksumSha256: exactReplayInput.checksumSha256,
        mimeType: objectMimeType,
        sizeBytes: writeBuffer.byteLength,
        causal: { visitId, category, latitude, longitude },
      })
      const reservation = await reserveMtmMediaObject({
        config: objectStorage,
        organizationId: orgId,
        uploaderAgentId: authenticatedAgentId,
        clientMediaId: clientPhotoId,
        requestHash,
        kind: "PHOTO",
        checksumSha256: objectChecksumSha256,
        sizeBytes: writeBuffer.byteLength,
        mimeType: objectMimeType,
      })
      if (reservation.status === "mismatch") {
        record("conflict")
        return photoIdConflictResponse()
      }
      if (reservation.status === "quarantined") {
        const response = mtmMediaObjectUploadFailureResponse(
          new MtmMediaObjectLifecycleError("MTM_MEDIA_OBJECT_RECOVERY_REQUIRED"),
        )
        record("conflict")
        return response ?? photoIdConflictResponse()
      }
      try {
        await ensureMtmMediaObjectUploaded({
          config: objectStorage,
          mediaObject: reservation.mediaObject,
          plaintext: writeBuffer,
        })
      } catch (error) {
        const response = mtmMediaObjectUploadFailureResponse(error)
        if (response) {
          record(response.status === 429 ? "rate_limited" : response.status === 409 ? "conflict" : "unavailable")
          return response
        }
        throw error
      }
      mediaObjectId = reservation.mediaObject.mediaObjectId
    }

    // Write the server-enforced target identity. For visit photos the
    // transaction also locks/revalidates the active primary-owned visit before
    // the child row is created, closing the check-to-write reassignment window.
    let photo
    try {
      photo = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (visitId) {
          const locked = await tx.mtmVisit.updateMany({
            where: {
              ...mutableVisitWhere(actor, orgId, { id: visitId, status: "CHECKED_IN" }),
              agentId: authenticatedAgentId,
            },
            data: { status: "CHECKED_IN" },
          })
          if (locked.count !== 1) throw new PhotoVisitMutationFenceError()

          // Recheck the cap while the visit row is locked. Parallel uploads for
          // one visit serialize on this fence instead of racing the early check.
          const count = await tx.mtmPhoto.count({ where: { visitId, organizationId: orgId } })
          if (maxPhotosPerVisit !== null && count >= maxPhotosPerVisit) {
            throw new PhotoLimitFenceError(maxPhotosPerVisit)
          }
        }

        const created = await tx.mtmPhoto.create({
          data: {
            organizationId: orgId,
            agentId: authenticatedAgentId,
            visitId,
            clientPhotoId,
            checksumSha256: exactReplayInput.checksumSha256,
            url,
            category,
            latitude,
            longitude,
            status: decision.status,
            hasWatermark: decision.hasWatermark,
            tamperingDetected: decision.tamperingDetected,
            exifData: exif
              ? (exif as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            watermarkedAt: decision.watermarkedAt,
            gpsMatchedAt: decision.gpsMatchedAt,
            reviewNote: decision.reviewNote,
          },
        })
        if (mediaObjectId) {
          await attachMtmMediaObjectInTransaction({
            tx,
            organizationId: orgId,
            mediaObjectId,
            kind: "PHOTO",
            businessId: created.id,
          })
        }
        return created
      })
    } catch (error) {
      if (filePath) await unlink(filePath).catch(() => {})
      if (error instanceof PhotoVisitMutationFenceError) {
        return NextResponse.json({ error: "Visit changed while uploading", code: "MTM_VISIT_MUTATION_CONFLICT" }, { status: 409 })
      }
      if (error instanceof PhotoLimitFenceError) {
        return NextResponse.json(
          { error: `Photo limit reached (${error.limit} per visit)`, code: "MAX_PHOTOS_REACHED" },
          { status: 422 },
        )
      }
      if (clientPhotoId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.mtmPhoto.findFirst({
          where: { organizationId: orgId, agentId: authenticatedAgentId, clientPhotoId },
        })
        if (existing) {
          if (replayInput && isExactPhotoReplay(existing, replayInput)) {
            record("ok")
            return NextResponse.json({ success: true, data: existing, idempotent: true })
          }
          record("conflict")
          return photoIdConflictResponse()
        }
      }
      throw error
    }

    // Audit log — non-blocking
    writeMtmAudit({
      organizationId: orgId,
      agentId: authenticatedAgentId,
      action: "PHOTO_UPLOAD",
      entity: "photo",
      entityId: photo.id,
      // The photo row remains reviewable through its ID. Do not copy a URL or
      // exact GPS into an audit payload, where it would outlive the scoped
      // media/GPS access policy and be much harder to redact.
      newData: { visitId, category, storage: mediaObjectId ? "OBJECT" : "LEGACY" },
      req,
    }).catch(() => {})

    // M3-5b: burst detection — anti-fraud signal for automated upload bots.
    // Count photos from the same agent in the last BURST_WINDOW_SECONDS (30s),
    // including the one just created. >5 is suspicious; write a non-blocking
    // audit so supervisors can spot patterns. Photo is already persisted —
    // burst detection is advisory (the upload is NOT rejected).
    //
    // Best-effort: the 2-step count→audit chain is fire-and-forget (no await).
    // If the PM2 process is killed between the response returning and the
    // .then() callback resolving, the burst audit may be silently dropped.
    // This is acceptable: the fraud signal is soft (supervisor review, not
    // automatic block) and the uploaded photo itself is always persisted.
    prisma.mtmPhoto.count({
      where: {
        agentId: authenticatedAgentId,
        organizationId: orgId,
        createdAt: { gte: new Date(Date.now() - BURST_WINDOW_SECONDS * 1_000) },
      },
    }).then((burstCount: number) => {
      if (checkBurstUpload({ count: burstCount }).isBurst) {
        writeMtmAudit({
          organizationId: orgId,
          agentId: authenticatedAgentId,
          action: PHOTO_BURST_SUSPICIOUS,
          entity: "photo",
          entityId: photo.id,
          newData: { burstCount, windowSeconds: BURST_WINDOW_SECONDS },
          req,
        }).catch(() => {})
      }
    }).catch(() => {})

    // Separate tampering-channel audit so supervisors can subscribe / grep
    // for these specifically. Constant exported from src/lib/mtm-audit.ts
    // so name stays in sync across producers. newData records both the
    // authenticated id and the (possibly forged) formData id for
    // forensic comparison.
    if (decision.tamperingDetected) {
      writeMtmAudit({
        organizationId: orgId,
        agentId: authenticatedAgentId,
        action: PHOTO_TAMPER_DETECTED,
        entity: "photo",
        entityId: photo.id,
        newData: {
          reviewNote: decision.reviewNote,
          authenticatedAgentId,
          formAgentId: requestedAgentId,
        },
        req,
      }).catch(() => {})
    }

    // M3-5a: visit anomaly — GPS cross-check against the claimed customer's
    // stored location. Soft fraud signal (the agent might legitimately be
    // across the street); a pattern of these from one rep should trigger
    // supervisor review. Skip silently if there's no visit / no customer
    // GPS / no photo GPS — those are tracked via different signals.
    //
    // CRITICAL multi-tenant: findFirst with organizationId filter (NOT
    // findUnique on id alone) — otherwise an attacker submitting another
    // org's visitId would leak that org's customer GPS into the attacker's
    // audit log. See memory/project_cross_tenant_fix.md.
    if (visitId && latitude != null && longitude != null) {
      try {
        const customer = scopedVisit?.customer
        if (customer?.latitude != null && customer.longitude != null) {
          const anomaly = checkGpsVsCustomer({
            photoLatitude: latitude,
            photoLongitude: longitude,
            customerLatitude: customer.latitude,
            customerLongitude: customer.longitude,
          })
          if (anomaly.isAnomaly && anomaly.distanceMeters != null) {
            writeMtmAudit({
              organizationId: orgId,
              agentId: authenticatedAgentId,
              action: PHOTO_GPS_VS_CUSTOMER_MISMATCH,
              entity: "photo",
              entityId: photo.id,
              newData: {
                distanceBucket: distanceBucket(anomaly.distanceMeters),
                // Entity IDs and exact coordinates stay in the authorized
                // records; diagnostics only need the privacy-safe outcome.
                customerMatched: true,
              },
              req,
            }).catch(() => {})
          }
        }
      } catch {
        // Lookup failure → log + audit so supervisors see the gap. Don't
        // fail the upload; photo is already persisted.
        console.warn("[MTM/photos] visit-anomaly check failed")
        writeMtmAudit({
          organizationId: orgId,
          agentId: authenticatedAgentId,
          action: PHOTO_ANOMALY_CHECK_FAILED,
          entity: "photo",
          entityId: photo.id,
          newData: { reason: "visit_lookup_failed" },
          req,
        }).catch(() => {})
      }
    }

    record("ok")
    return NextResponse.json({ success: true, data: photo }, { status: 201 })
  } catch (e: unknown) {
    const mediaFailure = mtmMediaObjectUploadFailureResponse(e)
    if (mediaFailure) {
      record(mediaFailure.status === 429 ? "rate_limited" : mediaFailure.status === 409 ? "conflict" : "unavailable")
      return mediaFailure
    }
    console.error("[MTM Photos POST]", e)
    record("failed")
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  } finally {
    // Keep an observable failure signal for legacy validation branches that
    // predate the media telemetry helper and return early above.
    if (auth.principal === "mobile" && !telemetryRecorded) record("failed")
    if (uploadReservation?.allowed) {
      await releaseMtmMobileMediaUpload(uploadReservation.reservation)
    }
  }
})

export const GET = withRouteFieldRlsAuth("read", async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""
  const visitId = searchParams.get("visitId") || ""
  const status = searchParams.get("status") || ""
  const parsedStatus = status ? parseMtmPhotoStatus(status) : null
  if (status && !parsedStatus) {
    return NextResponse.json({ error: "Invalid photo status" }, { status: 400 })
  }
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where: Prisma.MtmPhotoWhereInput = { organizationId: orgId }
    if (agentId) where.agentId = agentId
    if (visitId) where.visitId = visitId
    if (parsedStatus) where.status = parsedStatus

    const [photos, total] = await Promise.all([
      prisma.mtmPhoto.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          agent: { select: { id: true, name: true } },
          visit: { select: { id: true, customer: { select: { name: true } } } },
        },
      }),
      prisma.mtmPhoto.count({ where }),
    ])

    return NextResponse.json({ success: true, data: { photos, total, page, limit } })
  } catch (e) {
    console.error("[MTM/photos GET]", e)
    return NextResponse.json({ error: "Failed to load photos" }, { status: 500 })
  }
})
