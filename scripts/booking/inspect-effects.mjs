import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emitRemote, requireSha } from './inspect-production.mjs';

const tenantPattern = /^[a-z0-9-]{1,60}$/;
const bookingPattern = /^[a-z0-9]{20,32}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const statuses = new Set(['pending', 'leased', 'succeeded', 'definitely_failed', 'reconciliation_required']);
const keys = ['bookingFound', 'truncated', 'observedUTC', 'sessionTimezone', 'readOnly', 'rlsUnfiltered', 'rows'];
const rowKeys = ['id', 'status', 'attemptCount', 'bookingVersion', 'lastErrorCode', 'availableAtUTC', 'createdAtUTC', 'completedAtUTC'];
const exactKeys = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const timestamp = value => typeof value === 'string' && timestampPattern.test(value) && Number.isFinite(Date.parse(value));

export function emitEffectsRemote(sha, tenant, bookingId) {
  requireSha(sha);
  if (!tenantPattern.test(tenant ?? '') || !bookingPattern.test(bookingId ?? '')) throw Error('INVALID_SELECTOR');
  const oldSql = readFileSync(new URL('./inspect-production.sql', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('./inspect-effects.sql', import.meta.url), 'utf8')
    .replace('EFFECT_DIAGNOSTIC_TENANT', tenant).replace('EFFECT_DIAGNOSTIC_BOOKING', bookingId);
  const base = emitRemote(sha);
  if (base.split(oldSql).length !== 2) throw Error('INSPECTOR_CONTRACT_CHANGED');
  // SQL regexes contain $ followed by a quote; replacement strings would
  // interpret that as JavaScript's suffix substitution and corrupt the SQL.
  return base.replace(oldSql, () => sql);
}

export function sanitizeEffects(raw, sourceSha, artifactSha, transportExit) {
  requireSha(sourceSha); requireSha(artifactSha);
  const error = { version: 1, status: 'ERROR', sourceSha, artifactSha, productionObserved: false, code: 'EFFECT_INSPECTION_INVALID' };
  if (transportExit !== 0 || Buffer.byteLength(raw) > 16384) return error;
  let value;
  try { value = JSON.parse(raw); } catch { return error; }
  if (!exactKeys(value, keys) || typeof value.bookingFound !== 'boolean' || value.truncated !== false
    || value.readOnly !== true || value.rlsUnfiltered !== true || !timestamp(value.observedUTC)
    || typeof value.sessionTimezone !== 'string' || !/^[A-Za-z0-9_+/:.-]{1,64}$/.test(value.sessionTimezone)
    || !Array.isArray(value.rows) || value.rows.length > 20 || (!value.bookingFound && value.rows.length !== 0)) return error;
  const ids = new Set();
  for (const row of value.rows) {
    if (!exactKeys(row, rowKeys) || !uuidPattern.test(row.id ?? '') || ids.has(row.id) || !statuses.has(row.status)
      || !Number.isSafeInteger(row.attemptCount) || row.attemptCount < 0
      || (row.bookingVersion !== null && (!Number.isSafeInteger(row.bookingVersion) || row.bookingVersion < 0 || row.bookingVersion > 999999999))
      || (row.lastErrorCode !== null && !/^(?:LOCAL_FAILURE_(?:[1-9]|1[0-9]|20)|DELIVERY_UNCONFIRMED|REDACTED)$/.test(row.lastErrorCode))
      || !timestamp(row.availableAtUTC) || !timestamp(row.createdAtUTC)
      || (row.completedAtUTC !== null && !timestamp(row.completedAtUTC))) return error;
    ids.add(row.id);
  }
  // Rebuild an allowlist; never preserve raw SQL errors, payload or arbitrary keys.
  return { version: 1, status: 'PASS_EFFECT_METADATA_ONLY', sourceSha, artifactSha, productionObserved: true,
    metadata: Object.fromEntries(keys.map(key => [key, key === 'rows'
      ? value.rows.map(row => Object.fromEntries(rowKeys.map(field => [field, row[field]]))) : value[key]])) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [mode, source, artifact, arg] = args;
  try {
    if (mode === '--emit-remote' && args.length === 4) process.stdout.write(emitEffectsRemote(source, artifact, arg));
    else if (mode === '--validate-output' && args.length === 4 && /^\d+$/.test(arg ?? '')) {
      const result = sanitizeEffects(readFileSync(0, 'utf8'), source, artifact, Number(arg));
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result.status === 'ERROR') process.exitCode = 1;
    } else throw Error('INVALID_ARGUMENTS');
  } catch { process.stderr.write('EFFECT_INSPECTION_INVALID\n'); process.exitCode = 1; }
}
