import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  acquirePublicConcurrencySlot,
  releasePublicConcurrencySlot,
  type PublicConcurrencyReservation,
} from "@/lib/public-abuse-guard"
import {
  createMtmMediaObjectKey,
  getMtmMediaObject,
  headMtmMediaObject,
  mtmMediaRetentionUntil,
  putMtmMediaObject,
  readMtmMediaObjectStorageConfig,
  type MtmMediaObjectKind,
  type MtmMediaObjectReference,
  type MtmMediaObjectStorageConfig,
  MtmMediaObjectStorageError,
} from "@/lib/mtm/media-object-storage"

type MediaObjectState = "PENDING" | "COMMITTED" | "DELETE_PENDING" | "QUARANTINED" | "DELETED"

// AES-GCM verification materializes a bounded plaintext buffer today. Keep
// object reads separate from CRM mutations and cap them before an unusual
// gallery/download burst can consume the Node heap. A future streaming AEAD
// reader can raise this only after load evidence.
const MEDIA_OBJECT_READ_CONCURRENCY = {
  global: { maxConcurrent: 2, leaseSeconds: 300 },
  tenant: { maxConcurrent: 1, leaseSeconds: 300 },
} as const

export type MtmReservedMediaObject = MtmMediaObjectReference & {
  provider: string
  mimeType: string
  state: MediaObjectState
  photoId: string | null
  documentId: string | null
  retentionUntil: Date
  legalHold: boolean
}

export type MtmMediaObjectReservation =
  | { status: "reserved"; mediaObject: MtmReservedMediaObject }
  | { status: "mismatch" }
  | { status: "quarantined"; mediaObject: MtmReservedMediaObject }

export class MtmMediaObjectLifecycleError extends Error {
  constructor(readonly code: "MTM_MEDIA_OBJECT_ID_CONFLICT" | "MTM_MEDIA_OBJECT_RECOVERY_REQUIRED") {
    super(code)
    this.name = "MtmMediaObjectLifecycleError"
  }
}

function isKnownPrismaUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function hasSameReservation(input: {
  row: Pick<MtmReservedMediaObject, "kind" | "checksumSha256" | "sizeBytes" | "mimeType" | "encryptionKeyId">
  kind: MtmMediaObjectKind
  checksumSha256: string
  sizeBytes: number
  mimeType: string
  requestHash: string
  storedRequestHash: string
  config: MtmMediaObjectStorageConfig
}): boolean {
  return input.row.kind === input.kind
    && input.row.checksumSha256 === input.checksumSha256
    && input.row.sizeBytes === input.sizeBytes
    && input.row.mimeType === input.mimeType
    && input.config.encryptionKeys.has(input.row.encryptionKeyId)
    && input.requestHash === input.storedRequestHash
}

export function toMtmReservedMediaObject(row: {
  id: string
  organizationId: string
  kind: string
  state: string
  provider: string
  bucketName: string
  objectKey: string
  checksumSha256: string
  sizeBytes: number
  mimeType: string
  encryptionKeyId: string
  retentionUntil: Date
  legalHold: boolean
  photoId: string | null
  documentId: string | null
}): MtmReservedMediaObject {
  return {
    mediaObjectId: row.id,
    organizationId: row.organizationId,
    kind: row.kind as MtmMediaObjectKind,
    state: row.state as MediaObjectState,
    provider: row.provider,
    bucketName: row.bucketName,
    objectKey: row.objectKey,
    checksumSha256: row.checksumSha256,
    sizeBytes: row.sizeBytes,
    mimeType: row.mimeType,
    encryptionKeyId: row.encryptionKeyId,
    retentionUntil: row.retentionUntil,
    legalHold: row.legalHold,
    photoId: row.photoId,
    documentId: row.documentId,
  }
}

const reservationSelect = {
  id: true,
  organizationId: true,
  kind: true,
  state: true,
  provider: true,
  bucketName: true,
  objectKey: true,
  checksumSha256: true,
  sizeBytes: true,
  mimeType: true,
  encryptionKeyId: true,
  retentionUntil: true,
  legalHold: true,
  photoId: true,
  documentId: true,
  requestHash: true,
} satisfies Prisma.MtmMediaObjectSelect

/**
 * Hash causal upload fields without persisting/logging the raw title, IDs or
 * coordinates in the storage lifecycle row. The business rows remain the
 * source of those values; this only protects an interrupted reservation.
 */
export function hashMtmMediaObjectRequest(input: {
  kind: MtmMediaObjectKind
  clientMediaId: string
  checksumSha256: string
  mimeType: string
  sizeBytes: number
  causal: Record<string, string | number | null>
}): string {
  const canonicalCausal = Object.entries(input.causal)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value])
  return createHash("sha256")
    .update(JSON.stringify({
      kind: input.kind,
      clientMediaId: input.clientMediaId,
      checksumSha256: input.checksumSha256,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      causal: canonicalCausal,
    }), "utf8")
    .digest("hex")
}

async function findExistingReservation(input: {
  organizationId: string
  uploaderAgentId: string
  clientMediaId: string
}) {
  return prisma.mtmMediaObject.findFirst({
    where: input,
    select: reservationSelect,
  })
}

/**
 * Reserve durable metadata before the first object-store request. The unique
 * mobile id is the sole authority for retry recovery; callers never create a
 * second key for the same `(tenant, agent, clientMediaId)`.
 */
export async function reserveMtmMediaObject(input: {
  config: MtmMediaObjectStorageConfig
  organizationId: string
  uploaderAgentId: string
  clientMediaId: string
  requestHash: string
  kind: MtmMediaObjectKind
  checksumSha256: string
  sizeBytes: number
  mimeType: string
  now?: Date
}): Promise<MtmMediaObjectReservation> {
  const existing = await findExistingReservation(input)
  if (existing) {
    const mediaObject = toMtmReservedMediaObject(existing)
    if (!hasSameReservation({
      row: mediaObject,
      kind: input.kind,
      checksumSha256: input.checksumSha256,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      requestHash: input.requestHash,
      storedRequestHash: existing.requestHash,
      config: input.config,
    })) {
      return { status: "mismatch" }
    }
    if (mediaObject.state === "QUARANTINED" || mediaObject.state === "DELETED") {
      return { status: "quarantined", mediaObject }
    }
    return { status: "reserved", mediaObject }
  }

  const now = input.now ?? new Date()
  try {
    const created = await prisma.mtmMediaObject.create({
      data: {
        organizationId: input.organizationId,
        uploaderAgentId: input.uploaderAgentId,
        clientMediaId: input.clientMediaId,
        requestHash: input.requestHash,
        kind: input.kind,
        state: "PENDING",
        provider: "S3_COMPATIBLE",
        bucketName: input.config.bucketName,
        objectKey: createMtmMediaObjectKey(input.kind),
        checksumSha256: input.checksumSha256,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
        encryptionKeyId: input.config.encryptionKeyId,
        retentionUntil: mtmMediaRetentionUntil(input.config, now),
        legalHold: input.config.legalHold,
      },
      select: reservationSelect,
    })
    return { status: "reserved", mediaObject: toMtmReservedMediaObject(created) }
  } catch (error) {
    // A competing retry may have inserted the exact id first. Read its row
    // once; never generate another object key merely because of a race.
    if (!isKnownPrismaUniqueError(error)) throw error
    const raced = await findExistingReservation(input)
    if (!raced) throw error
    const mediaObject = toMtmReservedMediaObject(raced)
    if (!hasSameReservation({
      row: mediaObject,
      kind: input.kind,
      checksumSha256: input.checksumSha256,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      requestHash: input.requestHash,
      storedRequestHash: raced.requestHash,
      config: input.config,
    })) {
      return { status: "mismatch" }
    }
    if (mediaObject.state === "QUARANTINED" || mediaObject.state === "DELETED") {
      return { status: "quarantined", mediaObject }
    }
    return { status: "reserved", mediaObject }
  }
}

function storageReference(mediaObject: MtmReservedMediaObject): MtmMediaObjectReference {
  return {
    mediaObjectId: mediaObject.mediaObjectId,
    organizationId: mediaObject.organizationId,
    kind: mediaObject.kind,
    bucketName: mediaObject.bucketName,
    objectKey: mediaObject.objectKey,
    checksumSha256: mediaObject.checksumSha256,
    sizeBytes: mediaObject.sizeBytes,
    encryptionKeyId: mediaObject.encryptionKeyId,
  }
}

async function noteStorageAttempt(mediaObject: MtmReservedMediaObject): Promise<void> {
  await prisma.mtmMediaObject.updateMany({
    where: { id: mediaObject.mediaObjectId, organizationId: mediaObject.organizationId, state: "PENDING" },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), lastErrorCode: null },
  })
}

async function noteStorageFailure(mediaObject: MtmReservedMediaObject, error: unknown): Promise<void> {
  const code = error instanceof MtmMediaObjectStorageError ? error.code : "MTM_MEDIA_OBJECT_STORAGE_UNAVAILABLE"
  // Failure codes are stable enums only; endpoint/key/request payload never
  // enter the database or telemetry through this recovery path.
  await prisma.mtmMediaObject.updateMany({
    where: { id: mediaObject.mediaObjectId, organizationId: mediaObject.organizationId, state: "PENDING" },
    data: { lastErrorCode: code, lastAttemptAt: new Date() },
  }).catch(() => undefined)
}

async function quarantineMtmMediaObject(mediaObject: MtmReservedMediaObject): Promise<void> {
  await prisma.mtmMediaObject.updateMany({
    where: { id: mediaObject.mediaObjectId, organizationId: mediaObject.organizationId, state: "PENDING" },
    data: {
      state: "QUARANTINED",
      quarantinedAt: new Date(),
      lastErrorCode: "MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED",
    },
  })
}

/**
 * Reconcile a PENDING row before PUT. A process death after a successful PUT
 * is recovered by HEAD metadata; a mismatch is quarantined instead of
 * overwriting an object whose ownership cannot be proven.
 */
export async function ensureMtmMediaObjectUploaded(input: {
  config: MtmMediaObjectStorageConfig
  mediaObject: MtmReservedMediaObject
  plaintext: Buffer
}): Promise<void> {
  const { mediaObject, config } = input
  if (mediaObject.state === "COMMITTED") return
  if (mediaObject.state !== "PENDING") {
    throw new MtmMediaObjectLifecycleError("MTM_MEDIA_OBJECT_RECOVERY_REQUIRED")
  }

  await noteStorageAttempt(mediaObject)
  try {
    const reference = storageReference(mediaObject)
    const head = await headMtmMediaObject({ config, reference })
    if (head === "matches") return
    if (head === "mismatch") {
      await quarantineMtmMediaObject(mediaObject)
      throw new MtmMediaObjectLifecycleError("MTM_MEDIA_OBJECT_RECOVERY_REQUIRED")
    }
    try {
      await putMtmMediaObject({
        config,
        reference,
        plaintext: input.plaintext,
        retentionUntil: mediaObject.retentionUntil,
      })
    } catch (error) {
      if (!(error instanceof MtmMediaObjectStorageError) || error.code !== "MTM_MEDIA_OBJECT_STORAGE_CONFLICT") {
        throw error
      }
      // Two exact retries can both observe a missing object. `If-None-Match`
      // lets exactly one create it; the loser re-HEADs and returns success only
      // when the immutable reservation metadata proves it is the same object.
      const afterConflict = await headMtmMediaObject({ config, reference })
      if (afterConflict === "matches") return
      if (afterConflict === "mismatch") {
        await quarantineMtmMediaObject(mediaObject)
        throw new MtmMediaObjectLifecycleError("MTM_MEDIA_OBJECT_RECOVERY_REQUIRED")
      }
      throw error
    }
  } catch (error) {
    await noteStorageFailure(mediaObject, error)
    throw error
  }
}

/** Attach the already-uploaded object and business record in one DB transaction. */
export async function attachMtmMediaObjectInTransaction(input: {
  tx: Prisma.TransactionClient
  organizationId: string
  mediaObjectId: string
  kind: MtmMediaObjectKind
  businessId: string
}): Promise<void> {
  const linkage = input.kind === "PHOTO" ? { photoId: input.businessId } : { documentId: input.businessId }
  const attached = await input.tx.mtmMediaObject.updateMany({
    where: {
      id: input.mediaObjectId,
      organizationId: input.organizationId,
      state: "PENDING",
      ...(input.kind === "PHOTO" ? { photoId: null, documentId: null } : { documentId: null, photoId: null }),
    },
    data: { ...linkage, state: "COMMITTED", committedAt: new Date(), lastErrorCode: null },
  })
  if (attached.count !== 1) {
    throw new MtmMediaObjectLifecycleError("MTM_MEDIA_OBJECT_RECOVERY_REQUIRED")
  }
}

/**
 * Reads only an already-committed S3 object. The caller has completed its own
 * tenant/permission/scope checks. There is intentionally no filesystem
 * fallback for a row that selected object storage as its authority.
 */
export async function readCommittedMtmMediaObject(input: {
  mediaObject: MtmReservedMediaObject
}): Promise<Buffer> {
  if (input.mediaObject.state !== "COMMITTED" || input.mediaObject.provider !== "S3_COMPATIBLE") {
    throw new MtmMediaObjectLifecycleError("MTM_MEDIA_OBJECT_RECOVERY_REQUIRED")
  }
  const config = readMtmMediaObjectStorageConfig()
  if (!config) {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
  }
  const reservations: PublicConcurrencyReservation[] = []
  for (const [scope, identifier, policy] of [
    ["global", "all", MEDIA_OBJECT_READ_CONCURRENCY.global],
    ["tenant", input.mediaObject.organizationId, MEDIA_OBJECT_READ_CONCURRENCY.tenant],
  ] as const) {
    const reservation = await acquirePublicConcurrencySlot(
      `mtm-media-object-read:${scope}`,
      identifier,
      policy,
    )
    if (!reservation.allowed) {
      await Promise.allSettled(reservations.map((entry) => releasePublicConcurrencySlot(entry)))
      throw new MtmMediaObjectStorageError(
        reservation.unavailable ? "MTM_MEDIA_OBJECT_STORAGE_UNAVAILABLE" : "MTM_MEDIA_OBJECT_STORAGE_RATE_LIMITED",
        reservation.retryAfterSeconds,
      )
    }
    reservations.push(reservation)
  }
  try {
    return await getMtmMediaObject({ config, reference: storageReference(input.mediaObject) })
  } finally {
    await Promise.allSettled(reservations.map((entry) => releasePublicConcurrencySlot(entry)))
  }
}
