import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// The deploy recovery-point gate, the commissioning workflow and the readiness
// report each refuse an endpoint that does not belong to the configured region.
// They carry their own copy of the predicate (each script is hashed into the
// recovery program set on its own), so the copies must not drift apart.
const SCRIPTS = [
  'scripts/server-deploy.sh',
  'scripts/backup/commission-production-backup.sh',
  'scripts/backup/report-production-readiness.sh',
]

const FUNCTION_PATTERN = /^object_storage_endpoint_matches_region\(\) \{\n[\s\S]*?\n\}\n/m

function extract(path) {
  const match = readFileSync(path, 'utf8').match(FUNCTION_PATTERN)
  assert.ok(match, `${path} defines object_storage_endpoint_matches_region`)
  return match[0]
}

const definitions = SCRIPTS.map(extract)

test('every gate carries the same endpoint predicate', () => {
  for (const definition of definitions.slice(1)) assert.equal(definition, definitions[0])
})

test('no gate still compares against the Hetzner endpoint form', () => {
  for (const path of SCRIPTS) {
    assert.equal(readFileSync(path, 'utf8').includes('your-objectstorage.com'), false, path)
  }
})

function matches(endpoint, region) {
  const result = spawnSync('bash', ['-c', `${definitions[0]}\nobject_storage_endpoint_matches_region "$1" "$2"`, 'predicate', endpoint, region])
  return result.status === 0
}

test('accepts the B2 S3 endpoint of the configured region', () => {
  assert.equal(matches('https://s3.eu-central-003.backblazeb2.com', 'eu-central-003'), true)
  assert.equal(matches('https://s3.us-west-004.backblazeb2.com', 'us-west-004'), true)
})

test('refuses everything else', () => {
  const refused = [
    ['https://hel1.your-objectstorage.com', 'hel1'],
    ['https://s3.eu-central-003.backblazeb2.com', 'us-west-004'],
    ['https://s3.eu-central-003.backblazeb2.com/', 'eu-central-003'],
    ['http://s3.eu-central-003.backblazeb2.com', 'eu-central-003'],
    ['https://s3.eu-central-003.backblazeb2.com.example.net', 'eu-central-003'],
    ['https://s3.eu-central-003.backblazeb2.com', 'eu-central-003.backblazeb2.com.example'],
    ['https://s3..backblazeb2.com', ''],
    ['', 'eu-central-003'],
  ]
  for (const [endpoint, region] of refused) {
    assert.equal(matches(endpoint, region), false, `${endpoint} / ${region}`)
  }
})
