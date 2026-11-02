import assert from 'node:assert/strict'
import test from 'node:test'
import { FIXTURE_PHASES, fixtureEvents } from './cdc-fixture.mjs'
import { compareExpandedCdcRecords } from './compare-expanded-cdc.mjs'
import { CDC_VERIFY_LIMITS, verifyCdcRecords } from './verify-cdc-records.mjs'

function sourceRows() {
  return FIXTURE_PHASES.flatMap(fixtureEvents).map((event, index) => ({
    eventId: event.eventId,
    envelope: event.envelope,
    partitionKey: event.partitionKey,
    payloadHash: String(index + 1).padStart(64, '0'), // unit placeholder, not a SQL-origin hash
    createdAtMs: Date.parse(event.createdAt),
  }))
}

function fieldsFor(row, offset) {
  return [
    `CreateTime:${row.createdAtMs}`, 'Partition:0', `Offset:${offset}`,
    `id:${row.eventId},eventtype:${row.envelope.type},organizationid:${row.envelope.organizationid},payloadhash:${row.payloadHash}`,
    row.partitionKey, JSON.stringify(row.envelope),
  ]
}

function text(records) { return records.map(fields => fields.join('\t')).join('\n') + '\n' }

function corruptFirstPayload(records) {
  const value = JSON.parse(records[0][5])
  delete value.data.empty
  records[0][5] = JSON.stringify(value)
  return records
}

test('returns separate metadata and original-payload verdicts for intact transport', () => {
  const rows = sourceRows()
  const raw = text(rows.map(fieldsFor))
  const comparison = compareExpandedCdcRecords(raw, rows)
  assert.equal(comparison.diagnosticOnly, true)
  assert.deepEqual(comparison.metadataAndSourceOrder, verifyCdcRecords(raw, rows))
  assert.equal(comparison.payloadParityPassed, true)
  assert.deepEqual(comparison.defects, { failedPayloadRecords: 0, failedUniqueEvents: 0, doubleEncodedRecords: 0, envelopeMismatchRecords: 0 })
})

test('array loss is detected while independent metadata and source-ID order can still pass', () => {
  const rows = sourceRows()
  const raw = text(corruptFirstPayload(rows.map(fieldsFor)))
  assert.throws(() => verifyCdcRecords(raw, rows), /envelope differs/)
  const comparison = compareExpandedCdcRecords(raw, rows)
  assert.equal(comparison.metadataAndSourceOrder.ok, true)
  assert.equal(comparison.metadataAndSourceOrder.uniqueEvents, 8)
  assert.equal(comparison.payloadParityPassed, false)
  assert.deepEqual(comparison.defects, { failedPayloadRecords: 1, failedUniqueEvents: 1, doubleEncodedRecords: 0, envelopeMismatchRecords: 1 })
})

test('double-encoded JSON is a detected defect, never normalized into a passing payload', () => {
  const rows = sourceRows()
  const records = rows.map(fieldsFor)
  records[0][5] = JSON.stringify(records[0][5])
  const raw = text(records)
  assert.throws(() => verifyCdcRecords(raw, rows), /double-encoded/)
  const comparison = compareExpandedCdcRecords(raw, rows)
  assert.equal(comparison.metadataAndSourceOrder.ok, true)
  assert.equal(comparison.payloadParityPassed, false)
  assert.deepEqual(comparison.defects, { failedPayloadRecords: 1, failedUniqueEvents: 1, doubleEncodedRecords: 1, envelopeMismatchRecords: 0 })
})

test('does not hide a later metadata, ordering or completeness failure behind the first payload defect', () => {
  const rows = sourceRows()
  const changes = [
    records => { records[7][3] = records[7][3].replace(rows[7].payloadHash, 'f'.repeat(64)) },
    records => { records[7][3] += `,id:${rows[7].eventId}` },
    records => { records[7][4] = 'wrong:key' },
    records => { records[7][0] = `CreateTime:${rows[7].createdAtMs + 1}` },
    records => { records[7][1] = 'Partition:1' },
    records => { records[7][2] = 'Offset:0' },
    records => { records.pop() },
    records => {
      ;[records[4], records[6]] = [records[6], records[4]]
      records.forEach((fields, index) => { fields[2] = `Offset:${index}` })
    },
  ]
  for (const change of changes) {
    const records = corruptFirstPayload(rows.map(fieldsFor))
    change(records)
    assert.throws(() => compareExpandedCdcRecords(text(records), rows), /CDC transport verification/)
  }
})

test('requires the original value ID, without recovering a missing or unknown ID from headers', () => {
  const rows = sourceRows()
  for (const change of [
    value => { delete value.id },
    value => { value.id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    value => { value.id = null },
  ]) {
    const records = rows.map(fieldsFor)
    const value = JSON.parse(records[0][5])
    change(value)
    records[0][5] = JSON.stringify(value)
    assert.throws(() => compareExpandedCdcRecords(text(records), rows), /original value has no object event identity|unexpected original event ID/)
  }
})

test('records original payload conflicts on duplicate IDs instead of concealing them with SQL substitution', () => {
  const rows = sourceRows()
  const records = rows.map(fieldsFor)
  const duplicate = fieldsFor(rows[0], 8)
  const changed = JSON.parse(duplicate[5])
  changed.data.zero = '0'
  duplicate[5] = JSON.stringify(changed)
  records.push(duplicate)
  const comparison = compareExpandedCdcRecords(text(records), rows)
  assert.equal(comparison.metadataAndSourceOrder.duplicates, 1)
  assert.equal(comparison.payloadParityPassed, false)
  assert.equal(comparison.defects.failedPayloadRecords, 1)
  records[8][3] += ',extra:changed'
  assert.throws(() => compareExpandedCdcRecords(text(records), rows), /duplicate event has different headers/)
})

test('changing source-order fields inside the original payload remains an explicit parity failure', () => {
  const rows = sourceRows()
  const records = rows.map(fieldsFor)
  const changed = JSON.parse(records[0][5])
  changed.aggregateversion = 99
  changed.organizationid = 'wrong-tenant'
  records[0][5] = JSON.stringify(changed)
  const comparison = compareExpandedCdcRecords(text(records), rows)
  assert.equal(comparison.metadataAndSourceOrder.ok, true, 'ordering is checked against source IDs, not corrupt payload fields')
  assert.equal(comparison.payloadParityPassed, false)
  assert.equal(comparison.defects.envelopeMismatchRecords, 1)
})

test('rejects malformed/triple-encoded input rather than guessing identity or stripping headers', () => {
  const rows = sourceRows()
  for (const valueText of ['{bad', 'null', '[]', 'false', JSON.stringify('not-json'), JSON.stringify(JSON.stringify(JSON.stringify(rows[0].envelope)))]) {
    const records = rows.map(fieldsFor)
    records[0][5] = valueText
    assert.throws(() => compareExpandedCdcRecords(text(records), rows), /Synthetic expanded-CDC diagnostic/)
  }
  const records = corruptFirstPayload(rows.map(fieldsFor))
  records[0][3] = records[0][3].replace(`id:${rows[0].eventId}`, `id:"${rows[0].eventId}"`)
  assert.throws(() => compareExpandedCdcRecords(text(records), rows), /header differs/)
})

test('keeps bounded raw-input checks before replacing payloads and preserves SQL-source validation', () => {
  const rows = sourceRows()
  for (const raw of ['', 'log\tnoise', text(rows.map(fieldsFor)) + '\n', text(rows.map(fieldsFor)).replaceAll('\n', '\r\n'), 'x'.repeat(CDC_VERIFY_LIMITS.fileBytes + 1), 'x'.repeat(CDC_VERIFY_LIMITS.recordBytes + 1), Array(CDC_VERIFY_LIMITS.records + 1).fill('x').join('\n')]) {
    assert.throws(() => compareExpandedCdcRecords(raw, rows), /diagnostic/)
  }
  for (const invalid of [[], [...rows, rows[0]], Array(CDC_VERIFY_LIMITS.expectedRows + 1).fill(rows[0])]) {
    assert.throws(() => compareExpandedCdcRecords(text(rows.map(fieldsFor)), invalid), /diagnostic/)
  }
  const invalidHash = structuredClone(rows)
  invalidHash[0].payloadHash = 'not-a-hash'
  assert.throws(() => compareExpandedCdcRecords(text(rows.map(fieldsFor)), invalidHash), /source hash/)
})

test('analysis never mutates expected rows or their nested payloads', () => {
  const rows = sourceRows()
  const before = JSON.stringify(rows)
  const raw = text(corruptFirstPayload(rows.map(fieldsFor)))
  compareExpandedCdcRecords(raw, rows)
  assert.equal(JSON.stringify(rows), before)
  assert.throws(() => verifyCdcRecords(raw, rows), /envelope differs/, 'strict acceptance remains unchanged after diagnosis')
})
