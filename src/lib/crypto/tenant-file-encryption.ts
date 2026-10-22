import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { createReadStream } from "fs"
import { Readable } from "stream"
import { deriveTenantFileEncryptionKey } from "@/lib/crypto/tenant-pii-encryption"

/**
 * Encryption at rest for uploaded files (chat media, contract/task/ticket
 * attachments, Field photos and documents).
 *
 * Envelope v1, all integers big-endian:
 *
 *   "LDFE" | version=1 | keyIdLength | keyId | chunkBytes(u32) | plaintextBytes(u64) | salt(16)
 *   then one record per chunk: AES-256-GCM ciphertext | tag(16)
 *
 * • Key: per-file key = HKDF-SHA256(tenant file key, salt, info + orgId). The
 *   tenant file key comes from `keyId`; "t1" is the HKDF-derived key of
 *   `TENANT_PII_MASTER_KEY`. A future stored/wrapped tenant key gets a new id
 *   and old envelopes keep reading under theirs.
 * • Nonce: 7 zero bytes | chunk index (u32) | last-chunk flag. A fresh random
 *   salt makes every file's key unique, so the counter nonce never repeats
 *   under one key.
 * • AAD: the whole header. Size, chunking and key id are authenticated by
 *   every record; the last-chunk flag rejects truncation and the index rejects
 *   reordering. orgId enters the key derivation, so another tenant's key fails
 *   the tag check.
 *
 * Chunking keeps reads streamable: a file is decrypted one 64 KiB record at a
 * time and never has to be held whole in memory by the download path.
 *
 * Files written before this envelope existed are plain bytes. Every reader
 * goes through `decodeTenantFileBytes` / `openTenantFileStream`, which pass a
 * non-envelope file through unchanged, so old and new files coexist.
 */

const MAGIC = Buffer.from("LDFE", "ascii")
const FORMAT_VERSION = 1
const CURRENT_KEY_ID = "t1"
const DEFAULT_CHUNK_BYTES = 64 * 1024
const MIN_CHUNK_BYTES = 4 * 1024
const MAX_CHUNK_BYTES = 4 * 1024 * 1024
const MAX_KEY_ID_BYTES = 32
const SALT_BYTES = 16
const TAG_BYTES = 16
const NONCE_BYTES = 12
const FILE_KEY_INFO = "leaddrive-tenant-file-key-v1"

/** Large enough for any v1 header: the reader buffers this much before deciding. */
export const TENANT_FILE_MAX_HEADER_BYTES = MAGIC.length + 1 + 1 + MAX_KEY_ID_BYTES + 4 + 8 + SALT_BYTES

/** Stable, non-sensitive failure: the bytes are not a readable envelope for this tenant. */
export class TenantFileIntegrityError extends Error {
  constructor(readonly code: "TENANT_FILE_INTEGRITY_FAILED" | "TENANT_FILE_TENANT_REQUIRED" = "TENANT_FILE_INTEGRITY_FAILED") {
    super(code)
    this.name = "TenantFileIntegrityError"
  }
}

type TenantFileHeader = {
  headerBytes: Buffer
  keyId: string
  chunkBytes: number
  plaintextBytes: number
  salt: Buffer
  recordCount: number
  encryptedBytes: number
}

function recordCountFor(plaintextBytes: number, chunkBytes: number): number {
  // An empty file still has one (empty, final) record, so its header is authenticated.
  return Math.max(1, Math.ceil(plaintextBytes / chunkBytes))
}

function tenantKeyFor(orgId: string, keyId: string): Buffer {
  if (keyId === CURRENT_KEY_ID) return deriveTenantFileEncryptionKey(orgId)
  throw new TenantFileIntegrityError()
}

function fileKeyFor(orgId: string, header: Pick<TenantFileHeader, "keyId" | "salt">): Buffer {
  return Buffer.from(hkdfSync(
    "sha256",
    tenantKeyFor(orgId, header.keyId),
    header.salt,
    Buffer.from(`${FILE_KEY_INFO}\0${orgId}`, "utf8"),
    32,
  ))
}

function nonceFor(index: number, last: boolean): Buffer {
  const nonce = Buffer.alloc(NONCE_BYTES)
  nonce.writeUInt32BE(index, 7)
  nonce[11] = last ? 1 : 0
  return nonce
}

function buildHeader(keyId: string, chunkBytes: number, plaintextBytes: number, salt: Buffer): Buffer {
  const id = Buffer.from(keyId, "ascii")
  const fixed = Buffer.alloc(4 + 8)
  fixed.writeUInt32BE(chunkBytes, 0)
  fixed.writeBigUInt64BE(BigInt(plaintextBytes), 4)
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION, id.length]), id, fixed, salt])
}

/** True when the bytes start like an envelope; anything else is a legacy plain file. */
export function isTenantFileEnvelope(bytes: Uint8Array): boolean {
  return bytes.byteLength > MAGIC.length
    && MAGIC.every((value, index) => bytes[index] === value)
    && bytes[MAGIC.length] === FORMAT_VERSION
}

function parseHeader(bytes: Buffer): TenantFileHeader {
  if (!isTenantFileEnvelope(bytes) || bytes.byteLength < MAGIC.length + 2) throw new TenantFileIntegrityError()
  const keyIdLength = bytes[MAGIC.length + 1]
  if (keyIdLength < 1 || keyIdLength > MAX_KEY_ID_BYTES) throw new TenantFileIntegrityError()
  const keyIdStart = MAGIC.length + 2
  const fixedStart = keyIdStart + keyIdLength
  const headerLength = fixedStart + 4 + 8 + SALT_BYTES
  if (bytes.byteLength < headerLength) throw new TenantFileIntegrityError()
  const keyId = bytes.subarray(keyIdStart, fixedStart).toString("ascii")
  if (!/^[A-Za-z0-9._:-]+$/.test(keyId)) throw new TenantFileIntegrityError()
  const chunkBytes = bytes.readUInt32BE(fixedStart)
  const plaintextBig = bytes.readBigUInt64BE(fixedStart + 4)
  if (chunkBytes < MIN_CHUNK_BYTES || chunkBytes > MAX_CHUNK_BYTES) throw new TenantFileIntegrityError()
  if (plaintextBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new TenantFileIntegrityError()
  const plaintextBytes = Number(plaintextBig)
  const recordCount = recordCountFor(plaintextBytes, chunkBytes)
  if (recordCount > 0xffffffff) throw new TenantFileIntegrityError()
  return {
    headerBytes: Buffer.from(bytes.subarray(0, headerLength)),
    keyId,
    chunkBytes,
    plaintextBytes,
    salt: Buffer.from(bytes.subarray(fixedStart + 12, headerLength)),
    recordCount,
    encryptedBytes: headerLength + plaintextBytes + recordCount * TAG_BYTES,
  }
}

function plaintextLengthOf(header: TenantFileHeader, index: number): number {
  return index === header.recordCount - 1
    ? header.plaintextBytes - index * header.chunkBytes
    : header.chunkBytes
}

function openRecord(key: Buffer, header: TenantFileHeader, index: number, record: Buffer): Buffer {
  const ciphertextLength = record.byteLength - TAG_BYTES
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(index, index === header.recordCount - 1), {
      authTagLength: TAG_BYTES,
    })
    decipher.setAAD(header.headerBytes)
    decipher.setAuthTag(record.subarray(ciphertextLength))
    return Buffer.concat([decipher.update(record.subarray(0, ciphertextLength)), decipher.final()])
  } catch {
    throw new TenantFileIntegrityError()
  }
}

/** Encrypt file bytes for one tenant. The result is what goes to disk. */
export function sealTenantFile(
  orgId: string,
  plaintext: Uint8Array,
  options: { chunkBytes?: number } = {},
): Buffer {
  if (typeof orgId !== "string" || orgId.length === 0) throw new TenantFileIntegrityError("TENANT_FILE_TENANT_REQUIRED")
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  if (!Number.isInteger(chunkBytes) || chunkBytes < MIN_CHUNK_BYTES || chunkBytes > MAX_CHUNK_BYTES) {
    throw new RangeError("sealTenantFile: chunkBytes out of range")
  }
  const salt = randomBytes(SALT_BYTES)
  const headerBytes = buildHeader(CURRENT_KEY_ID, chunkBytes, plaintext.byteLength, salt)
  const header = parseHeader(headerBytes)
  const key = fileKeyFor(orgId, header)
  const parts: Buffer[] = [headerBytes]
  for (let index = 0; index < header.recordCount; index += 1) {
    const start = index * chunkBytes
    const cipher = createCipheriv("aes-256-gcm", key, nonceFor(index, index === header.recordCount - 1), {
      authTagLength: TAG_BYTES,
    })
    cipher.setAAD(headerBytes)
    parts.push(
      cipher.update(plaintext.subarray(start, start + plaintextLengthOf(header, index))),
      cipher.final(),
      cipher.getAuthTag(),
    )
  }
  return Buffer.concat(parts)
}

/**
 * Plain bytes of a stored file: decrypts an envelope, passes a legacy plain
 * file through. `orgId` is the tenant the caller has already authorized; an
 * envelope written for another tenant fails rather than decrypting.
 */
export function decodeTenantFileBytes(orgId: string | null | undefined, stored: Buffer): Buffer {
  if (!isTenantFileEnvelope(stored)) return stored
  if (!orgId) throw new TenantFileIntegrityError("TENANT_FILE_TENANT_REQUIRED")
  const header = parseHeader(stored)
  if (stored.byteLength !== header.encryptedBytes) throw new TenantFileIntegrityError()
  const key = fileKeyFor(orgId, header)
  const parts: Buffer[] = []
  let offset = header.headerBytes.byteLength
  for (let index = 0; index < header.recordCount; index += 1) {
    const recordLength = plaintextLengthOf(header, index) + TAG_BYTES
    parts.push(openRecord(key, header, index, stored.subarray(offset, offset + recordLength)))
    offset += recordLength
  }
  return Buffer.concat(parts)
}

async function* decryptRecords(
  orgId: string,
  header: TenantFileHeader,
  buffered: Buffer,
  source: AsyncIterator<Buffer>,
): AsyncGenerator<Buffer> {
  const key = fileKeyFor(orgId, header)
  let pending = buffered.subarray(header.headerBytes.byteLength)
  let sourceDone = false
  for (let index = 0; index < header.recordCount; index += 1) {
    const recordLength = plaintextLengthOf(header, index) + TAG_BYTES
    while (pending.byteLength < recordLength && !sourceDone) {
      const next = await source.next()
      if (next.done) sourceDone = true
      else pending = pending.byteLength === 0 ? next.value : Buffer.concat([pending, next.value])
    }
    if (pending.byteLength < recordLength) throw new TenantFileIntegrityError()
    yield openRecord(key, header, index, pending.subarray(0, recordLength))
    pending = pending.subarray(recordLength)
  }
  if (pending.byteLength > 0) throw new TenantFileIntegrityError()
  if (!sourceDone && !(await source.next()).done) throw new TenantFileIntegrityError()
}

async function* passThrough(buffered: Buffer, source: AsyncIterator<Buffer>): AsyncGenerator<Buffer> {
  if (buffered.byteLength > 0) yield buffered
  for (let next = await source.next(); !next.done; next = await source.next()) yield next.value
}

async function* prepend(first: IteratorResult<Buffer>, rest: AsyncGenerator<Buffer>): AsyncGenerator<Buffer> {
  if (first.done) return
  yield first.value
  yield* rest
}

async function* closingSource(inner: AsyncGenerator<Buffer>, source: Readable): AsyncGenerator<Buffer> {
  try {
    yield* inner
  } finally {
    source.destroy()
  }
}

/**
 * Stream a stored file's plain bytes. `storedBytes` is the on-disk size from
 * `stat`; the returned `size` is the plain size to announce as Content-Length.
 * Throws `TenantFileIntegrityError` before any byte is returned when the header
 * is unreadable, belongs to no tenant the caller named, or does not match the
 * on-disk size. A record that fails later errors the stream.
 */
export async function openTenantFileStream(
  orgId: string | null | undefined,
  filePath: string,
  storedBytes: number,
): Promise<{ size: number; encrypted: boolean; stream: Readable }> {
  const source = createReadStream(filePath, { highWaterMark: 64 * 1024 })
  const iterator = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>
  let head: Buffer = Buffer.alloc(0)
  try {
    while (head.byteLength < TENANT_FILE_MAX_HEADER_BYTES) {
      const next = await iterator.next()
      if (next.done) break
      head = head.byteLength === 0 ? next.value : Buffer.concat([head, next.value])
    }
    if (!isTenantFileEnvelope(head)) {
      return {
        size: storedBytes,
        encrypted: false,
        stream: Readable.from(closingSource(passThrough(head, iterator), source), { objectMode: false }),
      }
    }
    if (!orgId) throw new TenantFileIntegrityError("TENANT_FILE_TENANT_REQUIRED")
    const header = parseHeader(head)
    if (storedBytes !== header.encryptedBytes) throw new TenantFileIntegrityError()
    // Open the first record now: a wrong tenant or key fails its tag here,
    // before the caller has sent a status or a single header.
    const records = decryptRecords(orgId, header, head, iterator)
    const first = await records.next()
    return {
      size: header.plaintextBytes,
      encrypted: true,
      stream: Readable.from(closingSource(prepend(first, records), source), { objectMode: false }),
    }
  } catch (error) {
    source.destroy()
    throw error
  }
}
