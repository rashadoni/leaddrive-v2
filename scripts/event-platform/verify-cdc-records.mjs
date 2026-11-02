import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export const CDC_VERIFY_LIMITS = Object.freeze({
  fileBytes: 2 * 1024 * 1024,
  recordBytes: 64 * 1024,
  expectedRows: 32,
  records: 256,
  headers: 16,
  aggregateVersion: 4,
})

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const scalarPattern = /^[^\s,:]+$/
const unsignedPattern = /^(0|[1-9][0-9]*)$/
const sha256Pattern = /^[0-9a-f]{64}$/

function reject(message) {
  // Never include record payloads, headers, arbitrary filesystem paths or SQL
  // output in a failure message. This verifier reports evidence shape only.
  throw new Error(`CDC transport verification: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateExpectedRows(expectedRows) {
  if (!Array.isArray(expectedRows) || expectedRows.length < 1 || expectedRows.length > CDC_VERIFY_LIMITS.expectedRows) {
    reject('expected SQL rows must be a nonempty bounded array')
  }
  let serialized
  try { serialized = JSON.stringify(expectedRows) } catch { reject('expected SQL rows must be JSON') }
  if (Buffer.byteLength(serialized) > CDC_VERIFY_LIMITS.fileBytes) reject('expected SQL evidence exceeds size limit')
  const byId = new Map()
  const versions = new Map()
  for (const [index, row] of expectedRows.entries()) {
    const label = `expected row ${index + 1}`
    if (!isObject(row) || !isObject(row.envelope)) reject(`${label}: source envelope must be an object`)
    if (typeof row.eventId !== 'string' || !uuidPattern.test(row.eventId) || row.envelope.id !== row.eventId) {
      reject(`${label}: inconsistent source event ID`)
    }
    if (byId.has(row.eventId)) reject(`${label}: duplicate source event ID`)
    if (typeof row.payloadHash !== 'string' || !sha256Pattern.test(row.payloadHash)) reject(`${label}: source hash must be SHA-256 hex`)
    if (!Number.isSafeInteger(row.createdAtMs) || row.createdAtMs < 0) reject(`${label}: source timestamp must be integer milliseconds`)
    for (const field of ['organizationid', 'aggregatetype', 'aggregateid', 'type']) {
      if (typeof row.envelope[field] !== 'string' || !scalarPattern.test(row.envelope[field])) reject(`${label}: invalid source identity`)
    }
    const expectedKey = `${row.envelope.organizationid}:${row.envelope.aggregatetype}:${row.envelope.aggregateid}`
    if (row.partitionKey !== expectedKey) reject(`${label}: source key disagrees with envelope identity`)
    const version = row.envelope.aggregateversion
    if (!Number.isSafeInteger(version) || version < 1 || version > CDC_VERIFY_LIMITS.aggregateVersion) {
      reject(`${label}: source version outside bounded fixture`)
    }
    const keyVersions = versions.get(expectedKey) ?? new Set()
    if (keyVersions.has(version)) reject(`${label}: duplicate source key/version`)
    keyVersions.add(version)
    versions.set(expectedKey, keyVersions)
    byId.set(row.eventId, row)
  }
  for (const keyVersions of versions.values()) {
    const ordered = [...keyVersions].sort((a, b) => a - b)
    if (ordered.some((version, index) => version !== index + 1)) reject('source key versions must be contiguous from one')
  }
  return byId
}

function unsignedField(text, prefix, maximum, label) {
  if (!text.startsWith(prefix)) reject(`${label}: missing numeric field prefix`)
  const value = text.slice(prefix.length)
  if (!unsignedPattern.test(value)) reject(`${label}: invalid unsigned numeric field`)
  const parsed = BigInt(value)
  if (parsed > maximum) reject(`${label}: numeric field exceeds range`)
  return parsed
}

function parseHeaders(text, label) {
  const entries = text.split(',')
  if (!text || entries.length > CDC_VERIFY_LIMITS.headers) reject(`${label}: invalid header count`)
  const headers = new Map()
  for (const entry of entries) {
    const separator = entry.indexOf(':')
    if (separator < 1 || separator === entry.length - 1) reject(`${label}: malformed header`)
    const key = entry.slice(0, separator)
    const value = entry.slice(separator + 1)
    if (!/^[A-Za-z0-9._-]+$/.test(key) || /[\r\n\t]/.test(value)) reject(`${label}: malformed header`)
    if (headers.has(key)) reject(`${label}: duplicate header`)
    headers.set(key, value)
  }
  for (const key of ['id', 'eventtype', 'organizationid', 'payloadhash']) {
    if (!headers.has(key)) reject(`${label}: missing required header`)
  }
  return headers
}

/**
 * Validate one topic's bounded synthetic fixture dump, not application/replay
 * correctness. expectedRows must come directly from PostgreSQL, including its
 * trigger-produced payloadHash and createdAt epoch milliseconds.
 *
 * Kafka 4.3.1 DefaultMessageFormatter with print.timestamp/partition/offset/
 * headers/key/value=true emits six TAB-separated fields, newline per record.
 * Do not set deserializers, print.delivery, print.epoch, or custom separators.
 * https://github.com/apache/kafka/blob/4.3.1/tools/src/main/java/org/apache/kafka/tools/consumer/DefaultMessageFormatter.java
 *
 * SimpleHeaderConverter uses Values.convertToString → append(..., false).
 * String headers are raw UTF-8, NOT JSON quoted strings; no normalization here.
 * https://github.com/apache/kafka/blob/4.3.1/connect/api/src/main/java/org/apache/kafka/connect/storage/SimpleHeaderConverter.java
 * https://github.com/apache/kafka/blob/4.3.1/connect/api/src/main/java/org/apache/kafka/connect/data/Values.java
 */
export function verifyCdcRecords(rawText, expectedRows) {
  if (typeof rawText !== 'string' || Buffer.byteLength(rawText) > CDC_VERIFY_LIMITS.fileBytes) reject('record evidence exceeds size limit or is not text')
  const expected = validateExpectedRows(expectedRows)
  // Only one formatter-added trailing newline is optional. Blank lines, CRLF,
  // log chatter and pretty-printed multiline JSON are not silently discarded.
  const lines = (rawText.endsWith('\n') ? rawText.slice(0, -1) : rawText).split('\n')
  if (!rawText || lines.length > CDC_VERIFY_LIMITS.records) reject('record count outside bounded fixture')
  const seen = new Map()
  const keyPartitions = new Map()
  const keyVersions = new Map()
  const partitionOffsets = new Map()
  let duplicates = 0

  for (const [index, line] of lines.entries()) {
    const label = `record ${index + 1}`
    if (!line || Buffer.byteLength(line) > CDC_VERIFY_LIMITS.recordBytes || line.includes('\r')) reject(`${label}: invalid record line`)
    const fields = line.split('\t')
    if (fields.length !== 6) reject(`${label}: expected six TAB-separated formatter fields`)
    const [timestampText, partitionText, offsetText, headersText, key, valueText] = fields
    const timestamp = Number(unsignedField(timestampText, 'CreateTime:', BigInt(Number.MAX_SAFE_INTEGER), label))
    const partition = Number(unsignedField(partitionText, 'Partition:', 2147483647n, label))
    const offset = unsignedField(offsetText, 'Offset:', 9223372036854775807n, label)
    const previousOffset = partitionOffsets.get(partition)
    if (previousOffset !== undefined && offset <= previousOffset) reject(`${label}: offsets must increase within each partition`)
    partitionOffsets.set(partition, offset)
    const headers = parseHeaders(headersText, label)
    let envelope
    try { envelope = JSON.parse(valueText) } catch { reject(`${label}: value is not JSON`) }
    if (!isObject(envelope)) reject(`${label}: value must be a JSON object, not a double-encoded string or tombstone`)
    const source = expected.get(envelope.id)
    if (!source) reject(`${label}: unexpected event ID`)
    if (!isDeepStrictEqual(envelope, source.envelope)) reject(`${label}: envelope differs from SQL source`)
    const requiredHeaders = {
      id: source.eventId,
      eventtype: source.envelope.type,
      organizationid: source.envelope.organizationid,
      payloadhash: source.payloadHash,
    }
    for (const [name, expectedValue] of Object.entries(requiredHeaders)) {
      if (headers.get(name) !== expectedValue) reject(`${label}: header differs from SQL source`)
    }
    if (key !== source.partitionKey) reject(`${label}: Kafka key differs from SQL source`)
    if (timestamp !== source.createdAtMs) reject(`${label}: timestamp differs from SQL createdAt`)
    const previousPartition = keyPartitions.get(key)
    if (previousPartition !== undefined && previousPartition !== partition) reject(`${label}: aggregate key moved partitions`)
    keyPartitions.set(key, partition)
    if (seen.has(envelope.id)) {
      if (!isDeepStrictEqual(headers, seen.get(envelope.id))) reject(`${label}: duplicate event has different headers`)
      duplicates += 1
    } else {
      const previousVersion = keyVersions.get(key) ?? 0
      if (envelope.aggregateversion !== previousVersion + 1) reject(`${label}: first-seen aggregate versions are out of order`)
      keyVersions.set(key, envelope.aggregateversion)
      seen.set(envelope.id, headers)
    }
  }
  if (seen.size !== expected.size) reject('expected event IDs are missing')
  return {
    ok: true,
    records: lines.length,
    uniqueEvents: seen.size,
    duplicates,
    keys: keyPartitions.size,
    partitions: partitionOffsets.size,
  }
}

function readBoundedUtf8(path) {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > CDC_VERIFY_LIMITS.fileBytes) reject('input must be a bounded regular file')
    const buffer = Buffer.alloc(CDC_VERIFY_LIMITS.fileBytes + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > CDC_VERIFY_LIMITS.fileBytes) reject('input exceeds size limit')
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))
  } catch (error) {
    if (error?.message?.startsWith('CDC transport verification:')) throw error
    reject('cannot read bounded UTF-8 input')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function main(args) {
  const paths = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]
    const value = args[index + 1]
    if (!['--records', '--expected'].includes(option) || paths.has(option) || !value || value.startsWith('--')) {
      reject('usage: --records FILE --expected FILE')
    }
    paths.set(option, value)
  }
  if (paths.size !== 2) reject('usage: --records FILE --expected FILE')
  const raw = readBoundedUtf8(paths.get('--records'))
  let expected
  try { expected = JSON.parse(readBoundedUtf8(paths.get('--expected'))) } catch (error) {
    if (error?.message?.startsWith('CDC transport verification:')) throw error
    reject('expected SQL evidence must be JSON')
  }
  process.stdout.write(`${JSON.stringify(verifyCdcRecords(raw, expected))}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error?.message?.startsWith('CDC transport verification:') ? error.message : 'CDC transport verification: unexpected verification failure'}\n`)
    process.exitCode = 1
  }
}
