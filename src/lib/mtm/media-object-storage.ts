import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto"

/**
 * S3-compatible media storage for the exact Field media cohort.
 *
 * This intentionally uses separate MTM_MEDIA_S3_* credentials and never
 * reads BACKUP_S3_* or AWS_* backup credentials. The feature is disabled until
 * every required media setting is supplied, so an additive rollout cannot
 * silently redirect legacy v1 files to an arbitrary bucket.
 */

const ENVELOPE_MAGIC = Buffer.from([0x4c, 0x44, 0x4d, 0x01]) // LDM + format v1
const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16
const SHA256_HEX = /^[a-f0-9]{64}$/
const SAFE_KEY_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_REGION = /^[a-z0-9-]{2,32}$/
const SAFE_BUCKET = /^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

export type MtmMediaObjectKind = "PHOTO" | "DOCUMENT"
export type MtmMediaObjectStorageConfig = {
  endpoint: URL
  region: string
  bucketName: string
  accessKeyId: string
  secretAccessKey: string
  encryptionKey: Buffer
  encryptionKeyId: string
  /** Current plus explicitly configured read-only historic keys. */
  encryptionKeys: ReadonlyMap<string, Buffer>
  retentionDays: number
  objectLockMode: "GOVERNANCE" | "COMPLIANCE"
  legalHold: boolean
}

export type MtmMediaObjectStorageErrorCode =
  | "MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID"
  | "MTM_MEDIA_OBJECT_STORAGE_UNAVAILABLE"
  | "MTM_MEDIA_OBJECT_STORAGE_RATE_LIMITED"
  | "MTM_MEDIA_OBJECT_STORAGE_CONFLICT"
  | "MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED"

/** A deliberately non-sensitive error shape suitable for route mapping. */
export class MtmMediaObjectStorageError extends Error {
  constructor(
    readonly code: MtmMediaObjectStorageErrorCode,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code)
    this.name = "MtmMediaObjectStorageError"
  }
}

export type MtmMediaObjectIdentity = {
  mediaObjectId: string
  organizationId: string
  kind: MtmMediaObjectKind
}

export type MtmMediaObjectReference = MtmMediaObjectIdentity & {
  bucketName: string
  objectKey: string
  checksumSha256: string
  sizeBytes: number
  encryptionKeyId: string
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>
type MediaObjectStorageEnvironment = Readonly<Record<string, string | undefined>>

function configError(): MtmMediaObjectStorageError {
  // Do not include an endpoint, bucket, credential name, or malformed value in
  // a thrown message: callers can safely surface only the stable code.
  return new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
}

function required(env: MediaObjectStorageEnvironment, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw configError()
  return value
}

function parsePositiveDays(value: string): number {
  if (!/^\d{1,4}$/.test(value)) throw configError()
  const days = Number(value)
  // Retention is an owner-approved deployment policy. No default is supplied
  // here, so setting a bucket alone can never enable uncontrolled deletion.
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw configError()
  return days
}

function parseEncryptionKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw configError()
  const key = Buffer.from(value, "base64")
  if (key.byteLength !== 32) throw configError()
  return key
}

function parseEncryptionKeyring(
  raw: string | undefined,
  currentId: string,
  currentKey: Buffer,
): ReadonlyMap<string, Buffer> {
  const keys = new Map<string, Buffer>([[currentId, currentKey]])
  if (!raw?.trim()) return keys
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw configError()
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw configError()
  for (const [keyId, encodedKey] of Object.entries(parsed as Record<string, unknown>)) {
    if (!SAFE_KEY_ID.test(keyId) || typeof encodedKey !== "string") throw configError()
    const key = parseEncryptionKey(encodedKey)
    if (keyId === currentId && !key.equals(currentKey)) throw configError()
    keys.set(keyId, key)
  }
  return keys
}

/**
 * Returns null for the only safe default: disabled. If an operator opts in
 * with `s3`, partial/malformed configuration fails closed for the exact
 * cohort instead of falling back to local disk or backup storage.
 */
export function readMtmMediaObjectStorageConfig(
  env: MediaObjectStorageEnvironment = process.env,
): MtmMediaObjectStorageConfig | null {
  const mode = (env.MTM_MEDIA_OBJECT_STORAGE_MODE ?? "disabled").trim().toLowerCase()
  if (!mode || mode === "disabled") return null
  if (mode !== "s3") throw configError()

  const endpointRaw = required(env, "MTM_MEDIA_S3_ENDPOINT")
  let endpoint: URL
  try {
    endpoint = new URL(endpointRaw)
  } catch {
    throw configError()
  }
  if (
    endpoint.protocol !== "https:"
    || !endpoint.hostname
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) {
    throw configError()
  }

  const region = required(env, "MTM_MEDIA_S3_REGION")
  const bucketName = required(env, "MTM_MEDIA_S3_BUCKET")
  const accessKeyId = required(env, "MTM_MEDIA_S3_ACCESS_KEY_ID")
  const secretAccessKey = required(env, "MTM_MEDIA_S3_SECRET_ACCESS_KEY")
  const encryptionKeyId = required(env, "MTM_MEDIA_ENCRYPTION_KEY_ID")
  const encryptionKey = parseEncryptionKey(required(env, "MTM_MEDIA_ENCRYPTION_KEY_BASE64"))
  const encryptionKeys = parseEncryptionKeyring(env.MTM_MEDIA_ENCRYPTION_KEYRING_JSON, encryptionKeyId, encryptionKey)
  const retentionDays = parsePositiveDays(required(env, "MTM_MEDIA_OBJECT_RETENTION_DAYS"))
  const objectLockMode = required(env, "MTM_MEDIA_OBJECT_LOCK_MODE").toUpperCase()
  const legalHold = required(env, "MTM_MEDIA_OBJECT_LEGAL_HOLD").toUpperCase()

  if (!SAFE_REGION.test(region) || !SAFE_BUCKET.test(bucketName)) throw configError()
  if (!/^\S{1,256}$/.test(accessKeyId) || !/^\S{1,512}$/.test(secretAccessKey)) throw configError()
  if (!SAFE_KEY_ID.test(encryptionKeyId)) throw configError()
  if (objectLockMode !== "GOVERNANCE" && objectLockMode !== "COMPLIANCE") throw configError()
  if (legalHold !== "ON" && legalHold !== "OFF") throw configError()
  // The existing backup bucket is intentionally a separate authority. Reuse
  // would mix backup retention/IAM with user media and break rollback safety.
  if (env.BACKUP_S3_BUCKET?.trim() && env.BACKUP_S3_BUCKET.trim() === bucketName) throw configError()

  return {
    endpoint,
    region,
    bucketName,
    accessKeyId,
    secretAccessKey,
    encryptionKey,
    encryptionKeyId,
    encryptionKeys,
    retentionDays,
    objectLockMode,
    legalHold: legalHold === "ON",
  }
}

export function createMtmMediaObjectKey(kind: MtmMediaObjectKind): string {
  // Deliberately omit tenant, agent, original filename, GPS and business IDs.
  return `mtm-field/v1/${kind.toLowerCase()}/${randomBytes(24).toString("hex")}`
}

export function mtmMediaRetentionUntil(config: MtmMediaObjectStorageConfig, now = new Date()): Date {
  return new Date(now.getTime() + config.retentionDays * 24 * 60 * 60 * 1000)
}

function encryptionKeyFor(config: MtmMediaObjectStorageConfig, encryptionKeyId: string): Buffer {
  const key = config.encryptionKeys.get(encryptionKeyId)
  if (!key) throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
  return key
}

function additionalAuthenticatedData(identity: MtmMediaObjectIdentity): Buffer {
  return Buffer.from(
    `leaddrive-mtm-media-v1\u0000${identity.organizationId}\u0000${identity.mediaObjectId}\u0000${identity.kind}`,
    "utf8",
  )
}

/** Encrypt a plain Field file before it ever reaches the S3-compatible API. */
export function encryptMtmMediaObject(
  config: Pick<MtmMediaObjectStorageConfig, "encryptionKey">,
  identity: MtmMediaObjectIdentity,
  plaintext: Buffer,
): Buffer {
  const iv = randomBytes(GCM_IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", config.encryptionKey, iv, { authTagLength: GCM_TAG_BYTES })
  cipher.setAAD(additionalAuthenticatedData(identity))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([ENVELOPE_MAGIC, iv, cipher.getAuthTag(), ciphertext])
}

export function decryptMtmMediaObject(
  config: Pick<MtmMediaObjectStorageConfig, "encryptionKey">,
  identity: MtmMediaObjectIdentity,
  encrypted: Buffer,
): Buffer {
  const overhead = ENVELOPE_MAGIC.byteLength + GCM_IV_BYTES + GCM_TAG_BYTES
  if (encrypted.byteLength <= overhead || !encrypted.subarray(0, ENVELOPE_MAGIC.byteLength).equals(ENVELOPE_MAGIC)) {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED")
  }
  const ivStart = ENVELOPE_MAGIC.byteLength
  const tagStart = ivStart + GCM_IV_BYTES
  const ciphertextStart = tagStart + GCM_TAG_BYTES
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      config.encryptionKey,
      encrypted.subarray(ivStart, tagStart),
      { authTagLength: GCM_TAG_BYTES },
    )
    decipher.setAAD(additionalAuthenticatedData(identity))
    decipher.setAuthTag(encrypted.subarray(tagStart, ciphertextStart))
    return Buffer.concat([decipher.update(encrypted.subarray(ciphertextStart)), decipher.final()])
  } catch {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED")
  }
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest()
}

function awsDate(value: Date): { dateStamp: string; timestamp: string } {
  const yyyy = value.getUTCFullYear().toString().padStart(4, "0")
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, "0")
  const dd = value.getUTCDate().toString().padStart(2, "0")
  const hh = value.getUTCHours().toString().padStart(2, "0")
  const min = value.getUTCMinutes().toString().padStart(2, "0")
  const ss = value.getUTCSeconds().toString().padStart(2, "0")
  return { dateStamp: `${yyyy}${mm}${dd}`, timestamp: `${yyyy}${mm}${dd}T${hh}${min}${ss}Z` }
}

function objectUrl(config: MtmMediaObjectStorageConfig, objectKey: string): URL {
  if (!/^mtm-field\/v1\/(photo|document)\/[a-f0-9]{48}$/.test(objectKey)) {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
  }
  const basePath = config.endpoint.pathname.replace(/\/+$/, "")
  const encodedKey = objectKey.split("/").map((part) => encodeURIComponent(part)).join("/")
  return new URL(`${basePath}/${encodeURIComponent(config.bucketName)}/${encodedKey}`, config.endpoint.origin)
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const regionKey = hmac(dateKey, region)
  const serviceKey = hmac(regionKey, "s3")
  return hmac(serviceKey, "aws4_request")
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after")
  if (!raw || !/^\d{1,3}$/.test(raw)) return null
  const seconds = Number(raw)
  return seconds >= 1 && seconds <= 300 ? seconds : null
}

function storageHttpError(response: Response): MtmMediaObjectStorageError {
  if (response.status === 404) {
    // A committed record with no object is an integrity/recovery condition,
    // not a reason to try a local legacy file.
    return new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED")
  }
  if (response.status === 401 || response.status === 403) {
    // Do not turn a bucket/IAM misconfiguration into an unbounded retry loop.
    return new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
  }
  if (response.status === 409 || response.status === 412) {
    return new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFLICT")
  }
  if (response.status === 429) {
    return new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_RATE_LIMITED", retryAfterSeconds(response) ?? 30)
  }
  // Object stores routinely use 5xx/408/503 during regional pressure. The
  // caller leaves the PENDING row intact and maps this to a bounded retry.
  return new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_UNAVAILABLE", retryAfterSeconds(response) ?? 5)
}

async function signedS3Request(input: {
  config: MtmMediaObjectStorageConfig
  method: "PUT" | "GET" | "HEAD"
  objectKey: string
  body?: Buffer
  headers?: Record<string, string>
  fetchImpl?: FetchLike
  now?: Date
}): Promise<Response> {
  const { config, method, objectKey } = input
  const url = objectUrl(config, objectKey)
  const body = input.body ?? Buffer.alloc(0)
  const { dateStamp, timestamp } = awsDate(input.now ?? new Date())
  const headers = new Map<string, string>()
  headers.set("host", url.host)
  headers.set("x-amz-content-sha256", sha256Hex(body))
  headers.set("x-amz-date", timestamp)
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers.set(name.toLowerCase(), value.trim())
  }
  const canonicalHeaderEntries = [...headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value.replace(/\s+/g, " ").trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  const canonicalHeaders = canonicalHeaderEntries.map(([name, value]) => `${name}:${value}\n`).join("")
  const signedHeaders = canonicalHeaderEntries.map(([name]) => name).join(";")
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery(url),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n")
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n")
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex")
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  )

  try {
    return await (input.fetchImpl ?? fetch)(url, {
      method,
      headers: Object.fromEntries(headers),
      ...(method === "PUT" ? { body: body as unknown as BodyInit } : {}),
      redirect: "error",
      cache: "no-store",
    })
  } catch {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_UNAVAILABLE", 5)
  }
}

function expectedMetadata(reference: MtmMediaObjectReference): Record<string, string> {
  return {
    "x-amz-meta-ldm-media-id": reference.mediaObjectId,
    "x-amz-meta-ldm-plain-sha256": reference.checksumSha256,
    "x-amz-meta-ldm-plain-size": String(reference.sizeBytes),
    "x-amz-meta-ldm-kind": reference.kind,
    "x-amz-meta-ldm-key-id": reference.encryptionKeyId,
  }
}

function isValidReference(reference: MtmMediaObjectReference, config: MtmMediaObjectStorageConfig): boolean {
  return reference.bucketName === config.bucketName
    && config.encryptionKeys.has(reference.encryptionKeyId)
    && SHA256_HEX.test(reference.checksumSha256)
    && Number.isInteger(reference.sizeBytes)
    && reference.sizeBytes > 0
}

/**
 * PUT is idempotent at the media-object key. The encrypted payload is stored
 * once under an opaque key; no local-disk copy is written on this path.
 */
export async function putMtmMediaObject(input: {
  config: MtmMediaObjectStorageConfig
  reference: MtmMediaObjectReference
  plaintext: Buffer
  retentionUntil: Date
  fetchImpl?: FetchLike
}): Promise<void> {
  const { config, reference } = input
  if (!isValidReference(reference, config)) {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
  }
  if (reference.sizeBytes !== input.plaintext.byteLength || sha256Hex(input.plaintext) !== reference.checksumSha256) {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED")
  }
  // A PENDING row may legitimately outlive a key rotation. It can finish only
  // when the retired key is explicitly retained in the configured keyring;
  // otherwise it fails closed for manual recovery rather than re-encrypting a
  // reserved object under a different key ID.
  const body = encryptMtmMediaObject(
    { encryptionKey: encryptionKeyFor(config, reference.encryptionKeyId) },
    reference,
    input.plaintext,
  )
  const response = await signedS3Request({
    config,
    method: "PUT",
    objectKey: reference.objectKey,
    body,
    headers: {
      "content-type": "application/octet-stream",
      "if-none-match": "*",
      "x-amz-server-side-encryption": "AES256",
      "x-amz-object-lock-mode": config.objectLockMode,
      "x-amz-object-lock-retain-until-date": input.retentionUntil.toISOString(),
      "x-amz-object-lock-legal-hold": config.legalHold ? "ON" : "OFF",
      ...expectedMetadata(reference),
    },
    fetchImpl: input.fetchImpl,
  })
  if (!response.ok) throw storageHttpError(response)
}

/**
 * A HEAD only verifies immutable metadata after a process interruption. It
 * intentionally does not treat an unexpected object as readable or overwrite
 * it; that record must be quarantined by lifecycle code.
 */
export async function headMtmMediaObject(input: {
  config: MtmMediaObjectStorageConfig
  reference: MtmMediaObjectReference
  fetchImpl?: FetchLike
}): Promise<"missing" | "matches" | "mismatch"> {
  if (!isValidReference(input.reference, input.config)) {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
  }
  const response = await signedS3Request({
    config: input.config,
    method: "HEAD",
    objectKey: input.reference.objectKey,
    fetchImpl: input.fetchImpl,
  })
  if (response.status === 404) return "missing"
  if (!response.ok) throw storageHttpError(response)
  const metadata = expectedMetadata(input.reference)
  return Object.entries(metadata).every(([header, value]) => response.headers.get(header) === value)
    ? "matches"
    : "mismatch"
}

/** Fetch, decrypt and verify plain bytes. Never fall back to a local file. */
export async function getMtmMediaObject(input: {
  config: MtmMediaObjectStorageConfig
  reference: MtmMediaObjectReference
  fetchImpl?: FetchLike
}): Promise<Buffer> {
  if (!isValidReference(input.reference, input.config)) {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_CONFIG_INVALID")
  }
  const response = await signedS3Request({
    config: input.config,
    method: "GET",
    objectKey: input.reference.objectKey,
    fetchImpl: input.fetchImpl,
  })
  if (!response.ok) throw storageHttpError(response)
  const encrypted = Buffer.from(await response.arrayBuffer())
  const plaintext = decryptMtmMediaObject(
    { encryptionKey: encryptionKeyFor(input.config, input.reference.encryptionKeyId) },
    input.reference,
    encrypted,
  )
  if (
    plaintext.byteLength !== input.reference.sizeBytes
    || sha256Hex(plaintext) !== input.reference.checksumSha256
  ) {
    throw new MtmMediaObjectStorageError("MTM_MEDIA_OBJECT_STORAGE_INTEGRITY_FAILED")
  }
  return plaintext
}
