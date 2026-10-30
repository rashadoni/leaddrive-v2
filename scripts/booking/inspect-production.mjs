import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/;
const countKeys = ['bookingCount', 'invalidHostCount', 'invalidPageCount', 'duplicateTaskCount',
  'overlapCount', 'invalidIntervalCount', 'missingTaskCount', 'missingLeadCount',
  'invalidTaskLinkCount', 'invalidLeadLinkCount'];
const booleanKeys = ['btreeGistAvailable', 'btreeGistInstalled', 'extensionCreatePrivilege',
  'migrationRoleSuperuser', 'rlsUnfiltered', 'readOnly'];
const blockingCounts = ['invalidHostCount', 'invalidPageCount', 'duplicateTaskCount', 'overlapCount', 'invalidIntervalCount'];

export function requireSha(sha) {
  if (!shaPattern.test(sha ?? '')) throw new Error('INVALID_SHA');
  return sha;
}

// Reuse the reviewed static env parser and credential-safe libpq runner.
// Only these helpers are emitted, never the unrelated event-platform inspector.
export function emitRemote(artifactSha) {
  requireSha(artifactSha);
  const helper = readFileSync(new URL('../event-platform/inspect-production.sh', import.meta.url), 'utf8');
  const boundary = '\nreport_connection_file_metadata() {';
  if (helper.split(boundary).length !== 2) throw new Error('INSPECTION_HELPERS_CHANGED');
  const sql = readFileSync(new URL('./inspect-production.sql', import.meta.url), 'utf8');
  return `${helper.split(boundary)[0]}
export LC_ALL=C
artifact=/opt/leaddrive-v2/.next/standalone/.deploy-sha
[ -f "$artifact" ] && [ ! -L "$artifact" ] && [ "$(stat -c '%U:%G' "$artifact")" = root:root ] || exit 1
[ "$(tr -d '\\r\\n' < "$artifact")" = '${artifactSha}' ] || exit 1
require_root_file /etc/leaddrive/migration.env 600 || exit 1
booking_inspection_url="$(read_static_env_value /etc/leaddrive/migration.env MIGRATION_DATABASE_URL)" || exit 1
run_readonly_psql "$booking_inspection_url" 2>/dev/null <<'BOOKING_READONLY_SQL'
${sql}BOOKING_READONLY_SQL
`;
}

export function sanitize(raw, sourceSha, artifactSha, transportExit) {
  requireSha(sourceSha); requireSha(artifactSha);
  const failure = { version: 1, status: 'ERROR', sourceSha, artifactSha, productionObserved: false,
    code: 'TRANSPORT_OR_OUTPUT_INVALID' };
  if (transportExit !== 0 || Buffer.byteLength(raw) > 4096) return failure;
  let value;
  try { value = JSON.parse(raw); } catch { return failure; }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== countKeys.length + booleanKeys.length
    || countKeys.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)
    || booleanKeys.some(key => typeof value[key] !== 'boolean') || !value.readOnly || !value.rlsUnfiltered) return failure;
  const blocked = blockingCounts.some(key => value[key] !== 0) || !value.btreeGistAvailable
    || (!value.btreeGistInstalled && !value.extensionCreatePrivilege && !value.migrationRoleSuperuser);
  // Reconstruct an allowlisted result: raw provider/SQL errors can never enter evidence.
  const inventory = Object.fromEntries([...countKeys, ...booleanKeys].map(key => [key, value[key]]));
  return { version: 1, status: blocked ? 'BLOCKED_DATA_OR_EXTENSION' : 'PASS_INVENTORY_ONLY',
    sourceSha, artifactSha, productionObserved: true, observedAt: new Date().toISOString(), inventory };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, sourceSha, artifactSha, exitCode] = process.argv.slice(2);
  try {
    if (mode === '--emit-remote' && sourceSha && !artifactSha) process.stdout.write(emitRemote(sourceSha));
    else if (mode === '--validate-output' && /^[0-9]+$/.test(exitCode ?? '')) {
      const result = sanitize(readFileSync(0, 'utf8'), sourceSha, artifactSha, Number(exitCode));
      process.stdout.write(JSON.stringify(result) + '\n');
      if (result.status !== 'PASS_INVENTORY_ONLY') process.exitCode = 1;
    } else throw new Error('INVALID_ARGUMENTS');
  } catch {
    // Never echo inputs, filesystem paths or connection configuration on failure.
    process.stderr.write('BOOKING_INSPECTION_INVALID\n');
    process.exitCode = 1;
  }
}
