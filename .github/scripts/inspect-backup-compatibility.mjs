// Exact-main read-only catalog inspection. No customer rows, connection
// identities, credentials, raw SQL errors or arbitrary extension names leave
// this process. This does not start scratch or certify restore compatibility.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const MAX = 16384
const known = new Set(['plpgsql', 'pgcrypto', 'btree_gist', 'vector', 'citext', 'uuid-ossp', 'pg_trgm', 'hstore', 'unaccent'])
const stages = new Set(['INPUT', 'AUTHORITY', 'ARTIFACT', 'CONFIGURATION', 'SOURCE_QUERY', 'SOURCE_METADATA', 'OUTPUT', 'INTERNAL'])
const version = value => typeof value === 'string' && /^[0-9]{1,4}(?:\.[0-9]{1,4}){0,3}(?:[a-zA-Z0-9+-]{0,16})$/.test(value)
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === names.split(',').sort().join(',')
const fail = stage => { throw new Error(stage) }
const nullableVersion = value => value === null || (typeof value === 'string' && /^[0-9]{1,6}(?:\.[0-9]{1,6}){0,3}$/.test(value))
const locale = value => typeof value === 'string' && value.length <= 80 &&
  /^(?:C|POSIX|C\.utf-?8|[a-z]{2,3}_[a-z]{2}(?:\.utf-?8)?(?:@[a-z]{2,12})?)$/i.test(value) ? value : 'other'
const icu = value => value === null ? null : typeof value === 'string' &&
  /^(?:und|[a-z]{2,3}(?:-[a-z]{2,4}){0,2})(?:-u-[a-z0-9-]{1,40})?$/i.test(value) ? value : 'other'

export const catalogSql = `SELECT json_build_object(
  'versionNumber', current_setting('server_version_num')::int,
  'encoding', pg_encoding_to_char(d.encoding), 'provider', d.datlocprovider::text,
  'collate', d.datcollate, 'ctype', d.datctype, 'icu', d.daticulocale,
  'recordedVersion', d.datcollversion,
  'actualVersion', pg_database_collation_actual_version(d.oid),
  'tls', (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()),
  'extensions', (SELECT json_agg(json_build_object('name', e.extname, 'version', e.extversion, 'schema', n.nspname,
      'availableDefaultVersion', (SELECT default_version FROM pg_available_extensions WHERE name=e.extname),
      'sourceVersionAvailable', EXISTS(SELECT 1 FROM pg_available_extension_versions WHERE name=e.extname AND version=e.extversion),
      'requiresSuperuser', (SELECT superuser FROM pg_available_extension_versions WHERE name=e.extname AND version=e.extversion),
      'trusted', (SELECT trusted FROM pg_available_extension_versions WHERE name=e.extname AND version=e.extversion)) ORDER BY e.extname)
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace))
FROM pg_database d WHERE d.datname=current_database()`

function validAvailability(entry) {
  return (entry.availableDefaultVersion === null || version(entry.availableDefaultVersion)) &&
    typeof entry.sourceVersionAvailable === 'boolean' &&
    (entry.sourceVersionAvailable ? typeof entry.requiresSuperuser === 'boolean' && typeof entry.trusted === 'boolean'
      : entry.requiresSuperuser === null && entry.trusted === null)
}

export function summarizeCatalog(raw) {
  if (!keys(raw, 'versionNumber,encoding,provider,collate,ctype,icu,recordedVersion,actualVersion,tls,extensions') ||
    !Number.isInteger(raw.versionNumber) || raw.versionNumber < 160000 || raw.versionNumber >= 170000 || raw.tls !== true ||
    !['c', 'i'].includes(raw.provider) || ![raw.encoding, raw.collate, raw.ctype].every(v => typeof v === 'string' && v.length > 0 && v.length <= 128) ||
    ![raw.icu, raw.recordedVersion, raw.actualVersion].every(v => v === null || typeof v === 'string' && v.length <= 128) ||
    !Array.isArray(raw.extensions) || raw.extensions.length < 1 || raw.extensions.length > 32) fail('SOURCE_METADATA')
  const seen = new Set()
  for (const entry of raw.extensions) {
    if (!keys(entry, 'name,version,schema,availableDefaultVersion,sourceVersionAvailable,requiresSuperuser,trusted') || typeof entry.name !== 'string' || !/^[a-z][a-z0-9_-]{0,62}$/.test(entry.name) ||
      seen.has(entry.name) || !version(entry.version) || typeof entry.schema !== 'string' || entry.schema.length > 63 || !validAvailability(entry)) fail('SOURCE_METADATA')
    seen.add(entry.name)
  }
  const sorted = [...raw.extensions].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const visible = sorted.filter(entry => known.has(entry.name)).map(entry => ({ name: entry.name, version: entry.version,
    schema: ['public', 'pg_catalog'].includes(entry.schema) ? entry.schema : 'other',
    availableDefaultVersion: entry.availableDefaultVersion, sourceVersionAvailable: entry.sourceVersionAvailable,
    requiresSuperuser: entry.requiresSuperuser, trusted: entry.trusted }))
  const rawLocale = { encoding: raw.encoding, provider: raw.provider, collate: raw.collate, ctype: raw.ctype,
    icu: raw.icu, recordedVersion: raw.recordedVersion, actualVersion: raw.actualVersion }
  return validateOutput({ format: 1, status: 'inspected', source: {
    major: 16, versionNumber: raw.versionNumber,
    encoding: ['UTF8', 'SQL_ASCII', 'LATIN1', 'LATIN9'].includes(raw.encoding) ? raw.encoding : 'other',
    locale: { provider: raw.provider === 'c' ? 'libc' : 'icu', collate: locale(raw.collate), ctype: locale(raw.ctype), icu: icu(raw.icu),
      recordedVersion: nullableVersion(raw.recordedVersion) ? raw.recordedVersion : 'other',
      actualVersion: nullableVersion(raw.actualVersion) ? raw.actualVersion : 'other',
      versionMatches: raw.recordedVersion === raw.actualVersion, identityDigest: sha(JSON.stringify(rawLocale)) },
    extensions: visible, unknownExtensionCount: sorted.length - visible.length, extensionSetDigest: sha(JSON.stringify(sorted)),
  }, scratchDatabaseCompatibility: 'not-inspected' })
}

export function validateOutput(value) {
  if (!keys(value, 'format,status,source,scratchDatabaseCompatibility') || value.format !== 1 || value.status !== 'inspected' ||
    value.scratchDatabaseCompatibility !== 'not-inspected' || !keys(value.source, 'major,versionNumber,encoding,locale,extensions,unknownExtensionCount,extensionSetDigest')) fail('OUTPUT')
  const s = value.source, l = s.locale
  if (s.major !== 16 || !Number.isInteger(s.versionNumber) || s.versionNumber < 160000 || s.versionNumber >= 170000 ||
    !['UTF8', 'SQL_ASCII', 'LATIN1', 'LATIN9', 'other'].includes(s.encoding) ||
    !Number.isInteger(s.unknownExtensionCount) || s.unknownExtensionCount < 0 || s.unknownExtensionCount > 32 ||
    !/^[0-9a-f]{64}$/.test(s.extensionSetDigest) ||
    !keys(l, 'provider,collate,ctype,icu,recordedVersion,actualVersion,versionMatches,identityDigest') ||
    !['libc', 'icu'].includes(l.provider) || ![l.collate, l.ctype].every(v => v === 'other' || locale(v) === v) ||
    !(l.icu === 'other' || icu(l.icu) === l.icu) || ![l.recordedVersion, l.actualVersion].every(v => v === 'other' || nullableVersion(v)) ||
    typeof l.versionMatches !== 'boolean' || !/^[0-9a-f]{64}$/.test(l.identityDigest) ||
    !Array.isArray(s.extensions) || s.extensions.length > known.size || s.extensions.length + s.unknownExtensionCount > 32) fail('OUTPUT')
  const seen = new Set()
  s.extensions.forEach(entry => {
    if (!keys(entry, 'name,version,schema,availableDefaultVersion,sourceVersionAvailable,requiresSuperuser,trusted') || !known.has(entry.name) || seen.has(entry.name) || !version(entry.version) ||
      !['public', 'pg_catalog', 'other'].includes(entry.schema) || !validAvailability(entry)) fail('OUTPUT')
    seen.add(entry.name)
  })
  return value
}

export function validateEnvelope(value) {
  if (keys(value, 'format,status,stage') && value.format === 1 && value.status === 'refused' && stages.has(value.stage)) return value
  return validateOutput(value)
}

export function boundedFile(path, maximum, uid, modes, io = fs) {
  if (io.realpathSync(path) !== path) fail('AUTHORITY')
  const fd = io.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
  try {
    const st = io.fstatSync(fd)
    if (!st.isFile() || st.uid !== uid || st.nlink !== 1 || !modes.includes(st.mode & 0o7777) || st.size < 1 || st.size > maximum) fail('AUTHORITY')
    const bytes = io.readFileSync(fd)
    if (bytes.length !== st.size || bytes.length > maximum) fail('AUTHORITY')
    return bytes
  } finally { io.closeSync(fd) }
}

const configKeys = ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSFILE', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGCONNECT_TIMEOUT', 'BACKUP_EXPECTED_DB_ROLE']
export function parseConfiguration(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 65536) fail('CONFIGURATION')
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { fail('CONFIGURATION') }
  if (/[\0\r]/.test(text)) fail('CONFIGURATION')
  const data = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match || !configKeys.includes(match[1])) continue
    if (Object.hasOwn(data, match[1])) fail('CONFIGURATION')
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    data[match[1]] = value
  }
  if (configKeys.some(key => !data[key]) || data.PGSSLMODE !== 'verify-full' || !isIP(data.PGHOSTADDR) ||
    !/^[A-Za-z0-9_.:-]{1,253}$/.test(data.PGHOST) ||
    !/^[1-9][0-9]{0,4}$/.test(data.PGPORT) || Number(data.PGPORT) > 65535 || data.PGPORT === '55432' ||
    ![data.PGDATABASE, data.PGUSER].every(v => /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(v)) ||
    data.PGUSER !== data.BACKUP_EXPECTED_DB_ROLE || data.PGPASSFILE !== '/etc/leaddrive/backup.pgpass' ||
    data.PGSSLROOTCERT !== '/etc/leaddrive/managed-postgres-ca.crt' ||
    !/^[1-9][0-9]?$/.test(data.PGCONNECT_TIMEOUT) || Number(data.PGCONNECT_TIMEOUT) > 30) fail('CONFIGURATION')
  return data
}

export function queryPlan(config) {
  const environment = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/nonexistent', LC_ALL: 'C',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=10000' }
  for (const key of configKeys.filter(key => key !== 'BACKUP_EXPECTED_DB_ROLE')) environment[key] = config[key]
  return { executable: '/usr/bin/timeout', args: ['--kill-after=5', '35', '/usr/sbin/runuser', '-u', 'leaddrive-backup', '--',
    '/usr/lib/postgresql/16/bin/psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', catalogSql],
  options: { env: environment, timeout: 42000, maxBuffer: MAX, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] } }
}

export function inspect(expectedSha, runtime = { io: fs, uid: () => process.getuid(), spawn: spawnSync }) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha ?? '') || runtime.uid() !== 0) fail('INPUT')
  const marker = boundedFile('/opt/leaddrive-v2/.next/standalone/.deploy-sha', 41, 0, [0o400, 0o440, 0o444, 0o600, 0o640, 0o644], runtime.io)
  if (!marker.equals(Buffer.from(expectedSha)) && !marker.equals(Buffer.from(expectedSha + '\n'))) fail('ARTIFACT')
  const config = parseConfiguration(boundedFile('/etc/leaddrive/backup.env', 65536, 0, [0o600, 0o640], runtime.io))
  const plan = queryPlan(config)
  const result = runtime.spawn(plan.executable, plan.args, plan.options)
  if (result.error || result.status !== 0 || result.signal || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > MAX) fail('SOURCE_QUERY')
  let raw
  try { raw = JSON.parse(result.stdout) } catch { fail('SOURCE_METADATA') }
  return summarizeCatalog(raw)
}

const direct = process.argv[1] === '-' || process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (direct) {
  try {
    if (process.argv[2] === '--validate-output' && process.argv.length === 3) {
      const buffer = Buffer.alloc(MAX + 1)
      let length = 0
      while (length < buffer.length) {
        const count = fs.readSync(0, buffer, length, buffer.length - length, null)
        if (!count) break
        length += count
      }
      if (length > MAX) fail('OUTPUT')
      process.stdout.write(JSON.stringify(validateEnvelope(JSON.parse(buffer.subarray(0, length)))) + '\n')
    } else if (process.argv[2] === '--inspect' && process.argv.length === 4) {
      process.stdout.write(JSON.stringify(inspect(process.argv[3])) + '\n')
    } else fail('INPUT')
  } catch (error) {
    const result = JSON.stringify({ format: 1, status: 'refused', stage: stages.has(error.message) ? error.message : 'INTERNAL' }) + '\n'
    // The inspector exports only a finite safe refusal; the second gate must
    // validate it before display. Invalid validator input never reaches stdout.
    if (process.argv[2] === '--inspect') process.stdout.write(result)
    else process.stderr.write(result)
    process.exitCode = 1
  }
}
