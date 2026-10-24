import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// BEGIN PURE CONTRACT — emitted unchanged by the current-main recovery admission.
const shaPattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;
export function parseManifest(raw, expectedSha) {
  if (!shaPattern.test(expectedSha ?? '')) throw new Error('INVALID_ARTIFACT_SHA');
  if (raw === '') return null; // A historical artifact genuinely has no marker.
  if (Buffer.byteLength(raw) > 1024) throw new Error('INVALID_BOOKING_CONTRACT');
  const value = JSON.parse(raw);
  const keys = ['version','contract','artifactSha','schemaHash','phase'];
  if (!value || Object.keys(value).length !== keys.length || keys.some(k => !(k in value))
    || value.version !== 1 || value.contract !== 'booking-canonical-writer/v1'
    || value.artifactSha !== expectedSha || !hashPattern.test(value.schemaHash ?? '')
    || !['compatibility','workspace'].includes(value.phase)) throw new Error('INVALID_BOOKING_CONTRACT');
  return Object.fromEntries(keys.map(k => [k,value[k]]));
}

export function parseState(raw) {
  if (Buffer.byteLength(raw) > 1024) throw new Error('INVALID_BOOKING_RELEASE_STATE');
  const value = JSON.parse(raw);
  if (!value || Object.keys(value).length !== 5 || typeof value.expanded !== 'boolean'
    || !Number.isSafeInteger(value.canonicalCount) || value.canonicalCount < 0
    || typeof value.enforced !== 'boolean' || value.readOnly !== true || value.rlsUnfiltered !== true
    || (!value.expanded && (value.canonicalCount !== 0 || value.enforced))) throw new Error('INVALID_BOOKING_RELEASE_STATE');
  return value;
}

export function admitCandidate(state, candidate, predecessor) {
  if (!candidate && state.expanded) throw new Error('PRE_CANONICAL_RECOVERY_FORBIDDEN');
  if (candidate?.phase === 'workspace' && (!state.expanded || !predecessor
    || predecessor.schemaHash !== candidate.schemaHash)) throw new Error('COMPATIBLE_PREDECESSOR_REQUIRED');
  return { firstExpansion: candidate?.phase === 'compatibility' && !predecessor
    && !state.enforced && state.canonicalCount === 0 };
}

export function admitRollback(state, target, candidate, firstExpansion, quiesced) {
  if (target) {
    if (!state.expanded || !candidate || target.schemaHash !== candidate.schemaHash)
      throw new Error('ROLLBACK_SCHEMA_CONTRACT_MISMATCH');
    return;
  }
  if (!state.expanded) return;
  if (firstExpansion && quiesced && candidate?.phase === 'compatibility'
    && state.canonicalCount === 0 && !state.enforced) return;
  throw new Error('LEGACY_ROLLBACK_FORBIDDEN');
}
export function releaseProof(state, candidate, live, artifactSha) {
  if (!shaPattern.test(artifactSha ?? '')) throw new Error('INVALID_ARTIFACT_SHA');
  if (candidate) {
    if (!live || candidate.artifactSha !== artifactSha || live.artifactSha !== artifactSha
      || live.phase !== candidate.phase || live.schemaHash !== candidate.schemaHash || !state.expanded
      || (candidate.phase === 'workspace' && !state.enforced)) throw new Error('BOOKING_RELEASE_NOT_PROVEN');
  } else if (live || state.expanded) throw new Error('LEGACY_RELEASE_NOT_PROVEN');
  return {version:1,status:'PASS_BOOKING_RELEASE',artifactSha,phase:candidate?.phase??'legacy',
    enforced:state.enforced,canonicalCount:state.canonicalCount,readOnly:state.readOnly,rlsUnfiltered:state.rlsUnfiltered};
}
// END PURE CONTRACT

export function bookingSchemaHash(schema) {
  const models = ['Booking','BookingPage','BookingCoordinatorGrant','BookingSecret','BookingIntegrationBinding','BookingChangeNote'];
  const fragments = models.map(name => {
    const definition = schema.match(new RegExp('^model ' + name + ' \\{[\\s\\S]*?^\\}', 'm'));
    if (!definition) throw new Error('BOOKING_SCHEMA_MODEL_MISSING');
    return definition[0];
  });
  return createHash('sha256').update(fragments.join('\n')).digest('hex');
}

function helpers() {
  const text = readFileSync(new URL('../event-platform/inspect-production.sh', import.meta.url), 'utf8');
  const boundary = '\nreport_connection_file_metadata() {';
  if (text.split(boundary).length !== 2) throw new Error('INSPECTION_HELPERS_CHANGED');
  return text.split(boundary)[0];
}

export function databaseStateScript(drained = false) {
  return helpers() + '\nrun_readonly_psql "$BOOKING_RELEASE_DB_URL" 2>/dev/null <<\'BOOKING_STATE_SQL\'\n'
    + readFileSync(new URL('./release-state.sql', import.meta.url), 'utf8').replace(
      "SET LOCAL app.booking_release_require_drained = 'off';",
      "SET LOCAL app.booking_release_require_drained = '" + (drained ? 'on' : 'off') + "';") + 'BOOKING_STATE_SQL\n';
}

function readManifestAt(directory, requireRoot) {
  const marker = path.join(directory, '.booking-backend-contract.json');
  try { lstatSync(marker); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  for (const file of [directory, marker, path.join(directory,'.deploy-sha')]) {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || (requireRoot && (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022))))
      throw new Error('UNSAFE_BOOKING_ARTIFACT');
  }
  const sha = readFileSync(path.join(directory,'.deploy-sha'), 'utf8').trim();
  const raw = readFileSync(marker,'utf8');
  if (!raw) throw new Error('INVALID_BOOKING_CONTRACT');
  return parseManifest(raw, sha);
}

export function emitAdmission(artifactSha, rawManifest, proof = false) {
  const candidate = parseManifest(rawManifest, artifactSha);
  const own = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const core = own.split('// BEGIN PURE CONTRACT — emitted unchanged by the current-main recovery admission.')[1]
    ?.split('// END PURE CONTRACT')[0]?.replaceAll('export function ', 'function ');
  if (!core) throw new Error('CONTRACT_EMISSION_FAILED');
  const action = proof
    ? "if (readFileSync('/opt/leaddrive-v2/.next/standalone/.deploy-sha','utf8').trim() !== " + JSON.stringify(artifactSha) + ") throw new Error('DEPLOYED_SHA_MISMATCH'); console.log(JSON.stringify(releaseProof(state," + JSON.stringify(candidate) + ',predecessor,' + JSON.stringify(artifactSha) + ')));'
    : 'admitCandidate(state,' + JSON.stringify(candidate) + ",predecessor); console.log('booking_artifact_admission=PASS');";

  return helpers() + `
require_root_file /etc/leaddrive/migration.env 600 || exit 1
booking_release_url="$(read_static_env_value /etc/leaddrive/migration.env MIGRATION_DATABASE_URL)" || exit 1
booking_release_state="$(run_readonly_psql "$booking_release_url" 2>/dev/null <<'BOOKING_STATE_SQL'
${readFileSync(new URL('./release-state.sql', import.meta.url), 'utf8')}BOOKING_STATE_SQL
)" || exit 1
BOOKING_RELEASE_STATE="$booking_release_state" node <<'BOOKING_ADMISSION_JS'
const {readFileSync,lstatSync,existsSync}=require('node:fs');
const path=require('node:path');
${core}
${readManifestAt.toString()}
try {
  const state=parseState(process.env.BOOKING_RELEASE_STATE);
  const predecessor=readManifestAt('/opt/leaddrive-v2/.next/standalone',true);
  ${action}
} catch { console.error('booking_artifact_admission=BLOCKED');process.exitCode=1; }
BOOKING_ADMISSION_JS
`;
}

export function activationSql(candidate) {
  if (!candidate) return '';
  const validated = parseManifest(JSON.stringify(candidate),candidate.artifactSha);
  if (validated.phase !== 'workspace') return '';
  return "BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL app.booking_workspace_artifact_sha = '"
    + validated.artifactSha + "';\n" + readFileSync(new URL('./activate-workspace.sql',import.meta.url),'utf8') + '\nCOMMIT;\n';
}

function getState(drained = false) {
  const deadline = Date.now() + (drained ? 15000 : 50000);
  do {
    const result = spawnSync('bash',['-s'], {input:databaseStateScript(drained),encoding:'utf8',
      timeout:Math.max(1,deadline-Date.now()),maxBuffer:8192,env:process.env});
    if (result.status !== 0) throw new Error('BOOKING_STATE_UNAVAILABLE');
    if (result.stdout.trim() !== 'BOOKING_WRITERS_BUSY') return parseState(result.stdout.trim());
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
  } while (Date.now() < deadline);
  throw new Error('BOOKING_WRITERS_NOT_DRAINED');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [mode,...args] = process.argv.slice(2);
    if (mode === '--write-manifest') {
      const [directory,artifactSha] = args;
      if (!shaPattern.test(artifactSha ?? '')) throw new Error('INVALID_ARTIFACT_SHA');
      const phase = JSON.parse(readFileSync('src/lib/booking/release-phase.json','utf8')).mode;
      if (!['compatibility','workspace'].includes(phase)) throw new Error('INVALID_RELEASE_PHASE');
      const schemaHash = bookingSchemaHash(readFileSync('prisma/schema.prisma','utf8'));
      writeFileSync(path.join(directory,'.booking-backend-contract.json'),JSON.stringify({
        version:1,contract:'booking-canonical-writer/v1',artifactSha,schemaHash,phase
      })+'\n',{flag:'wx'});
    } else if (mode === '--activation-sql') {
      process.stdout.write(activationSql(parseManifest(readFileSync(args[0],'utf8'),args[1])));
    } else if (mode === '--assert-activated') {
      const candidate = parseManifest(readFileSync(args[0],'utf8'),args[1]);
      if (candidate?.phase === 'workspace' && !getState().enforced) throw new Error('WORKSPACE_NOT_ACTIVATED');
    } else if (mode === '--emit-admission' || mode === '--emit-proof') {
      process.stdout.write(emitAdmission(args[0],readFileSync(0,'utf8'),mode==='--emit-proof'));
    } else if (mode === '--check-admission') {
      const [candidateFile,artifactSha,predecessorDirectory] = args;
      const candidate = parseManifest(readFileSync(candidateFile,'utf8'),artifactSha);
      const result = admitCandidate(getState(), candidate, readManifestAt(predecessorDirectory,true));
      process.stdout.write(result.firstExpansion ? 'first-expansion\n' : 'compatible\n');
    } else if (mode === '--check-rollback') {
      const [targetDirectory,candidateFile,artifactSha,firstExpansion,quiesced] = args;
      if (![firstExpansion,quiesced].every(v=>v==='true'||v==='false')) throw new Error('INVALID_ROLLBACK_PROOF');
      admitRollback(getState(true),readManifestAt(targetDirectory,true),parseManifest(readFileSync(candidateFile,'utf8'),artifactSha),
        firstExpansion==='true',quiesced==='true');
      process.stdout.write('booking_rollback_admission=PASS\n');
    } else throw new Error('INVALID_ARGUMENTS');
  } catch {
    process.stderr.write('BOOKING_RELEASE_CONTRACT_BLOCKED\n');
    process.exitCode = 1;
  }
}
