import { isDeepStrictEqual } from 'node:util'
import { CDC_VERIFY_LIMITS, verifyCdcRecords } from './verify-cdc-records.mjs'

function reject(message) {
  throw new Error(`Synthetic expanded-CDC diagnostic: ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * DIAGNOSTIC EXPERIMENT ONLY. Never use this instead of verifyCdcRecords as a
 * transport acceptance gate, application validator, or production consumer.
 *
 * A strict envelope mismatch otherwise stops verification before later records'
 * metadata/order checks. Here each observed value's own event ID selects its SQL
 * reference envelope. Only that sixth formatter field is replaced, after its
 * ORIGINAL parity result is recorded; all headers, keys, timestamps, partitions
 * and offsets remain untouched and pass through the unchanged strict verifier.
 *
 * An extra JSON decoding step is allowed ONLY to identify double-encoding as a
 * defect. It never makes payloadParityPassed true. An absent/unknown observed
 * ID cannot be recovered from headers or guessed from position.
 *
 * metadataAndSourceOrder checks versions from the SQL ID mapping, not from the
 * original payload (which may be corrupt). Payload defects remain failures in
 * the separate verdict. The caller must keep both results in its experiment.
 */
export function compareExpandedCdcRecords(rawText, expectedRows) {
  if (typeof rawText !== 'string' || Buffer.byteLength(rawText) > CDC_VERIFY_LIMITS.fileBytes) reject('record input must be bounded text')
  if (!Array.isArray(expectedRows) || expectedRows.length < 1 || expectedRows.length > CDC_VERIFY_LIMITS.expectedRows) reject('expected SQL rows must be a nonempty bounded array')
  const expected = new Map()
  for (const row of expectedRows) {
    if (!isObject(row) || typeof row.eventId !== 'string' || !isObject(row.envelope) || expected.has(row.eventId)) reject('invalid or duplicate source identity')
    expected.set(row.eventId, row)
  }
  const lines = (rawText.endsWith('\n') ? rawText.slice(0, -1) : rawText).split('\n')
  if (!rawText || lines.length > CDC_VERIFY_LIMITS.records) reject('record count outside bounded fixture')

  let doubleEncodedRecords = 0
  let envelopeMismatchRecords = 0
  let failedPayloadRecords = 0
  const failedEventIds = new Set()
  const metadataEvidence = lines.map((line, index) => {
    const label = `record ${index + 1}`
    if (!line || Buffer.byteLength(line) > CDC_VERIFY_LIMITS.recordBytes || line.includes('\r')) reject(`${label}: invalid formatter line`)
    const fields = line.split('\t')
    if (fields.length !== 6) reject(`${label}: expected six formatter fields`)
    let observed
    try { observed = JSON.parse(fields[5]) } catch { reject(`${label}: original value is not JSON`) }
    const doubleEncoded = typeof observed === 'string'
    if (doubleEncoded) {
      doubleEncodedRecords += 1
      try { observed = JSON.parse(observed) } catch { reject(`${label}: double-encoded value has no JSON identity`) }
    }
    if (!isObject(observed) || typeof observed.id !== 'string') reject(`${label}: original value has no object event identity`)
    const source = expected.get(observed.id)
    if (!source) reject(`${label}: unexpected original event ID`)
    const envelopeMatches = isDeepStrictEqual(observed, source.envelope)
    if (!envelopeMatches) envelopeMismatchRecords += 1
    if (doubleEncoded || !envelopeMatches) {
      failedPayloadRecords += 1
      failedEventIds.add(observed.id)
    }
    fields[5] = JSON.stringify(source.envelope)
    return fields.join('\t')
  }).join('\n')

  // This unchanged verifier validates the SQL reference shape as well as the
  // complete observed ID set and all original transport metadata, including
  // duplicate-header identity. A metadata failure is never downgraded here.
  const metadataAndSourceOrder = verifyCdcRecords(metadataEvidence, expectedRows)
  return {
    diagnosticOnly: true,
    metadataAndSourceOrder,
    payloadParityPassed: failedPayloadRecords === 0,
    defects: {
      failedPayloadRecords,
      failedUniqueEvents: failedEventIds.size,
      doubleEncodedRecords,
      envelopeMismatchRecords,
    },
  }
}
