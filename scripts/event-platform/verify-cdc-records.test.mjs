import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { fixtureEvents, FIXTURE_PHASES } from './cdc-fixture.mjs'
import { CDC_VERIFY_LIMITS, verifyCdcRecords } from './verify-cdc-records.mjs'

// This is a verifier unit fixture, NOT a substitute for the SQL-origin hashes
// required by the integration harness. Each synthetic hash is deliberately
// unrelated to JSON.stringify so the verifier cannot recompute it locally.
function expectedRows(phases = FIXTURE_PHASES) {
  return phases.flatMap(fixtureEvents).map((event, index) => ({
    eventId: event.eventId,
    partitionKey: event.partitionKey,
    envelope: event.envelope,
    payloadHash: String(index + 1).padStart(64, '0'),
    createdAtMs: Date.parse(event.createdAt),
  }))
}

function headersFor(row) {
  return `id:${row.eventId},eventtype:${row.envelope.type},organizationid:${row.envelope.organizationid},payloadhash:${row.payloadHash}`
}

function format(row, { partition = 0, offset = 0, timestamp = row.createdAtMs, headers = headersFor(row), key = row.partitionKey, value = row.envelope } = {}) {
  return [`CreateTime:${timestamp}`, `Partition:${partition}`, `Offset:${offset}`, headers, key, JSON.stringify(value)].join('\t')
}

function records(rows = expectedRows()) {
  return rows.map((row, index) => format(row, { offset: index })).join('\n') + '\n'
}

function replaceRecord(rows, index, changes) {
  return rows.map((row, offset) => format(row, { offset, ...(offset === index ? changes : {}) })).join('\n')
}

test('verifies all eight SQL-origin identities, scalar headers, keys, timestamps and JSON values', () => {
  const rows = expectedRows()
  assert.deepEqual(verifyCdcRecords(records(rows), rows), {
    ok: true, records: 8, uniqueEvents: 8, duplicates: 0, keys: 2, partitions: 1,
  })
  assert.equal(verifyCdcRecords(records(rows).slice(0, -1), rows).ok, true)
  assert.equal(verifyCdcRecords(records(rows), [...rows].reverse()).ok, true, 'SQL row order is not the Kafka ordering oracle')
  assert.equal(verifyCdcRecords(records(expectedRows(['snapshot'])), expectedRows(['snapshot'])).uniqueEvents, 4)
})

test('allows only identical duplicate event IDs at new, increasing offsets', () => {
  const rows = expectedRows()
  const withDuplicates = [...rows.slice(0, 2), rows[0], ...rows.slice(2), rows[0]]
  const raw = withDuplicates.map((row, index) => format(row, { offset: index })).join('\n')
  assert.equal(verifyCdcRecords(raw, rows).duplicates, 2)
  const changedEnvelope = structuredClone(rows[0].envelope)
  changedEnvelope.data.zero = 1
  assert.throws(() => verifyCdcRecords(records(rows) + format(rows[0], { offset: 8, value: changedEnvelope }), rows), /envelope differs/)
  assert.throws(() => verifyCdcRecords(records(rows) + format(rows[0], { offset: 8, headers: `${headersFor(rows[0])},extra:changed` }), rows), /duplicate event has different headers/)
})

test('preserves JSON object semantics without accepting converter data loss or coercions', () => {
  const rows = expectedRows()
  for (const change of [
    envelope => { delete envelope.data.empty },
    envelope => { delete envelope.data.nested.empty },
    envelope => { envelope.data.nested.objects[0].empty = null },
    envelope => { envelope.data.nullable = '' },
    envelope => { envelope.data.disabled = 'false' },
    envelope => { envelope.data.zero = '0' },
    envelope => { envelope.data.text = 'replacement' },
    envelope => { envelope.unexpected = true },
  ]) {
    const value = structuredClone(rows[0].envelope)
    change(value)
    assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { value }), rows), /envelope differs/)
  }
  const reordered = Object.fromEntries(Object.entries(rows[0].envelope).reverse())
  assert.equal(verifyCdcRecords(replaceRecord(rows, 0, { value: reordered }), rows).ok, true)
  for (const value of [JSON.stringify(rows[0].envelope), null, [], 0, false]) {
    assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { value }), rows), /value must be a JSON object/)
  }
})

test('rejects missing/extra IDs and inconsistent expected SQL evidence', () => {
  const rows = expectedRows()
  assert.throws(() => verifyCdcRecords(records(rows.slice(0, -1)), rows), /event IDs are missing/)
  const extra = structuredClone(rows[0].envelope)
  extra.id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { value: extra }), rows), /unexpected event ID/)
  for (const invalid of [[], [...rows, rows[0]], [{ ...rows[0], eventId: extra.id }], [{ ...rows[0], partitionKey: 'wrong' }], [{ ...rows[0], payloadHash: 'x' }], [{ ...rows[0], createdAtMs: String(rows[0].createdAtMs) }]]) {
    assert.throws(() => verifyCdcRecords(records(rows), invalid), /expected SQL rows|source/)
  }
  assert.throws(() => verifyCdcRecords(records(rows.slice(1)), rows.slice(1)), /contiguous from one/)
  const duplicateVersion = structuredClone(rows[0])
  duplicateVersion.eventId = extra.id
  duplicateVersion.envelope.id = extra.id
  assert.throws(() => verifyCdcRecords(records(rows), [...rows, duplicateVersion]), /duplicate source key\/version/)
})

test('requires each identity header exactly once with literal unquoted scalar values', () => {
  const rows = expectedRows()
  const parts = headersFor(rows[0]).split(',')
  for (const [index, part] of parts.entries()) {
    assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { headers: parts.filter((_, i) => i !== index).join(',') }), rows), /missing required header/)
    assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { headers: [...parts, part].join(',') }), rows), /duplicate header/)
    const quoted = [...parts]
    const separator = part.indexOf(':')
    quoted[index] = `${part.slice(0, separator + 1)}${JSON.stringify(part.slice(separator + 1))}`
    assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { headers: quoted.join(',') }), rows), /header differs/)
  }
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { headers: headersFor(rows[0]).replace(rows[0].payloadHash, 'f'.repeat(64)) }), rows), /header differs/)
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { headers: 'NO_HEADERS' }), rows), /malformed header/)
})

test('enforces tenant aggregate key and SQL createdAt, including on duplicate events', () => {
  const rows = expectedRows()
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { key: 'wrong-tenant:transport-fixture:same-logical-id' }), rows), /Kafka key differs/)
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { timestamp: rows[0].createdAtMs + 1 }), rows), /timestamp differs/)
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 0, { timestamp: Date.parse(rows[0].envelope.time) }), rows), /timestamp differs/)
  assert.throws(() => verifyCdcRecords(records(rows).replace('CreateTime:', 'LogAppendTime:'), rows), /missing numeric field prefix/)
})

test('checks first-seen versions rather than UUID order or replayed old versions', () => {
  const rows = expectedRows()
  const outOfOrder = [...rows]
  ;[outOfOrder[0], outOfOrder[1]] = [outOfOrder[1], outOfOrder[0]]
  assert.throws(() => verifyCdcRecords(records(outOfOrder), rows), /first-seen aggregate versions are out of order/)
})

test('pins each key to one partition, with strictly increasing 64-bit offsets per partition', () => {
  const rows = expectedRows()
  const counts = new Map()
  const raw = rows.map(row => {
    const partition = row.envelope.organizationid.endsWith('-a') ? 0 : 1
    const offset = counts.get(partition) ?? 9007199254740993n
    counts.set(partition, offset + 1n)
    return format(row, { partition, offset })
  }).join('\n')
  assert.equal(verifyCdcRecords(raw, rows).partitions, 2)
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 1, { partition: 1 }), rows), /moved partitions/)
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 1, { offset: 0 }), rows), /offsets must increase/)
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 1, { offset: -1 }), rows), /invalid unsigned/)
  assert.throws(() => verifyCdcRecords(replaceRecord(rows, 1, { offset: 9223372036854775808n }), rows), /exceeds range/)
})

test('rejects malformed formatter output and bounded evidence violations', () => {
  const rows = expectedRows()
  for (const raw of ['', records(rows) + '\n', records(rows).replaceAll('\n', '\r\n'), 'log chatter\n' + records(rows), records(rows).replace('Partition:0\t', ''), records(rows).replace('CreateTime:', 'NO_TIMESTAMP:')]) {
    assert.throws(() => verifyCdcRecords(raw, rows))
  }
  assert.throws(() => verifyCdcRecords('x'.repeat(CDC_VERIFY_LIMITS.fileBytes + 1), rows), /size limit/)
  assert.throws(() => verifyCdcRecords(Array(CDC_VERIFY_LIMITS.records + 1).fill('x').join('\n'), rows), /record count/)
  assert.throws(() => verifyCdcRecords('x'.repeat(CDC_VERIFY_LIMITS.recordBytes + 1), rows), /record line/)
  assert.throws(() => verifyCdcRecords(records(rows), Array(CDC_VERIFY_LIMITS.expectedRows + 1).fill(rows[0])), /bounded array/)
  const invalidJson = records(rows).replace('{"specversion"', '{broken"specversion"')
  assert.throws(() => verifyCdcRecords(invalidJson, rows), /value is not JSON/)
})

test('CLI returns a small receipt and fails without leaking malformed input or unknown paths', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ld-cdc-verifier-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const recordsPath = join(directory, 'records.txt')
  const expectedPath = join(directory, 'expected.json')
  const rows = expectedRows()
  writeFileSync(recordsPath, records(rows))
  writeFileSync(expectedPath, JSON.stringify(rows))
  const script = fileURLToPath(new URL('./verify-cdc-records.mjs', import.meta.url))
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  const ok = run(['--records', recordsPath, '--expected', expectedPath])
  assert.equal(ok.status, 0, ok.stderr)
  assert.equal(JSON.parse(ok.stdout).uniqueEvents, 8)
  assert.equal(ok.stderr, '')
  const missing = run(['--records', join(directory, 'private-missing-file'), '--expected', expectedPath])
  assert.equal(missing.status, 1)
  assert.doesNotMatch(missing.stderr, /private-missing-file/)
  for (const args of [[], ['--records', recordsPath], ['--records', recordsPath, '--records', recordsPath], ['--records', recordsPath, '--expected', expectedPath, '--ignore-errors', 'yes']]) {
    assert.equal(run(args).status, 1)
  }
  writeFileSync(recordsPath, Buffer.from([0xff, 0xfe]))
  const invalidUtf8 = run(['--records', recordsPath, '--expected', expectedPath])
  assert.equal(invalidUtf8.status, 1)
  assert.match(invalidUtf8.stderr, /UTF-8/)
})
