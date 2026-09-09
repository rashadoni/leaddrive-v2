#!/usr/bin/env bash
set -Eeuo pipefail
ssh -o ConnectTimeout=30 -o ServerAliveInterval=15 -i ~/.ssh/deploy_key \
  ${SERVER_USER}@${SERVER_HOST} 'bash -s' <<'REMOTE'
set -euo pipefail
# The process may still serve a deleted standalone directory after a
# historical interrupted release. This proof is read-only and needs
# only Prisma plus dotenv, so resolve those dependencies from the
# root-owned checkout instead of assuming the live runtime exists.
cd /opt/leaddrive-v2
node <<'NODE'
const fs = require("node:fs")
const preflightRuntime = "/opt/leaddrive-v2"
const canonicalEnv = "/etc/leaddrive/app.env"
const legacyEnv = "/opt/leaddrive-v2/.env"
const hasPathOrSymlink = (candidate) => {
  try {
    fs.lstatSync(candidate)
    return true
  } catch (error) {
    if (error && error.code === "ENOENT") return false
    throw error
  }
}
const assertRootOwnedNonwritableDirectory = (label, candidate) => {
  const stat = fs.lstatSync(candidate)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`)
  }
  if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0) {
    throw new Error(`${label} must be root:root and not group- or world-writable`)
  }
}
const assertRootOnlyEnvFile = (label, candidate) => {
  const stat = fs.lstatSync(candidate)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symlink`)
  }
  if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be root:root mode 0600`)
  }
}
assertRootOwnedNonwritableDirectory("preflight runtime checkout", preflightRuntime)
assertRootOwnedNonwritableDirectory("preflight runtime dependencies", `${preflightRuntime}/node_modules`)
const dotenv = require(`${preflightRuntime}/node_modules/dotenv`)
// The first runtime-separation release creates the canonical file
// inside server-deploy.sh. Keep this pre-deploy safety probe
// read-only-compatible with that one transition only. Do not parse
// either source until ownership, mode, and symlink boundaries pass.
const envFile = hasPathOrSymlink(canonicalEnv) ? canonicalEnv : legacyEnv
if (envFile === canonicalEnv) {
  assertRootOwnedNonwritableDirectory("canonical app-env parent", "/etc/leaddrive")
  assertRootOnlyEnvFile("canonical app env", canonicalEnv)
} else {
  assertRootOwnedNonwritableDirectory("LeadDrive checkout", "/opt/leaddrive-v2")
  assertRootOnlyEnvFile("legacy checkout app env", legacyEnv)
}
dotenv.config({ path: envFile })
const { PrismaClient } = require(`${preflightRuntime}/node_modules/@prisma/client`)
const prisma = new PrismaClient()

;(async () => {
  const organizationId = (process.env.VOICE_AGENT_ORGANIZATION_ID || "").trim()
  if (!organizationId) throw new Error("AI-call pilot organization is not configured")
  // The third of three fences that together made enabling the queue
  // impossible rather than deliberate. The other two were lifted in
  // #837; this one was missed, so the first deploy after the owner
  // set the flag failed here — which is precisely the trap #837
  // existed to remove. Reported, not fatal.
  if (process.env.VOICE_CALL_QUEUE_EXECUTION_ENABLED === "true") {
    console.log("AI-call queue server gate is ENABLED (owner decision, 2026-08-13).")
  }

  const proof = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.org_id', $1, true)",
      organizationId,
    )
    const [config] = await tx.$queryRawUnsafe(`
      SELECT
        count(*) FILTER (
          WHERE lower(coalesce(settings->>'voiceQueueEnabled', 'false')) = 'true'
        )::int AS "queueEnabledCount",
        count(*) FILTER (
          WHERE "isActive" = true
            AND lower(coalesce(settings->>'voiceAgentEnabled', 'false')) = 'true'
        )::int AS "voiceAgentConfigCount",
        count(*) FILTER (
          WHERE "isActive" = true
            AND lower(coalesce(settings->>'voiceAgentEnabled', 'false')) = 'true'
            AND coalesce(btrim(settings->>'voiceAgentPrompt'), '') = ''
        )::int AS "emptyPromptCount"
      FROM channel_configs
      WHERE "organizationId" = $1 AND "channelType" = 'voip'
    `, organizationId)
    const [active] = await tx.$queryRawUnsafe(`
      SELECT count(*)::int AS count
      FROM voice_call_sessions
      WHERE "organizationId" = $1
        AND "endedAt" IS NULL
        AND status IN ('prepared', 'dispatching', 'dispatch_uncertain')
    `, organizationId)
    const [callLogMigrationRisk] = await tx.$queryRawUnsafe(`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'call_logs'
            AND column_name = 'targetPhoneE164'
        ) AS "canonicalColumnPresent",
        pg_total_relation_size('public.call_logs')::text AS "tableBytes",
        EXISTS (
          SELECT 1 FROM pg_index i
          JOIN pg_class idx ON idx.oid = i.indexrelid
          JOIN pg_class r ON r.oid = i.indrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
          WHERE n.nspname = 'public' AND r.relname = 'audit_logs'
            AND idx.relname = 'audit_logs_voice_permission_request_key'
            AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique
            AND pg_get_expr(i.indpred, i.indrelid) = '(("entityType" = ''lead_voice_permission''::text) AND ("entityId" IS NOT NULL))'
        ) AS "voicePermissionIndexPresent",
        pg_total_relation_size('public.audit_logs')::text AS "auditTableBytes",
        (
          SELECT count(*)::int FROM (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class r ON r.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'public' AND r.relname = 'call_logs'
              AND c.conname = 'call_logs_target_phone_e164_check'
            UNION ALL
            SELECT 1 WHERE to_regclass('public.call_logs_org_target_phone_e164_idx') IS NOT NULL
          ) artifacts
        ) AS "callTargetArtifactCount",
        (
          SELECT count(*)::int FROM (
            SELECT 1 WHERE to_regclass('public.audit_logs_voice_permission_request_key') IS NOT NULL
            UNION ALL
            SELECT 1 WHERE to_regprocedure('public.protect_voice_permission_audit_row()') IS NOT NULL
            UNION ALL
            SELECT 1 FROM pg_trigger t
            JOIN pg_class r ON r.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'public' AND r.relname = 'audit_logs'
              AND t.tgname = 'audit_logs_voice_permission_append_only'
          ) artifacts
        ) AS "voicePermissionArtifactCount",
        (
          SELECT count(*)::int FROM audit_logs
          WHERE "entityType" = 'lead_voice_permission'
        ) AS "voicePermissionReservedRowCount",
        (
          SELECT count(*)::int FROM (
            SELECT 1 FROM audit_logs
            WHERE "entityType" = 'lead_voice_permission' AND "entityId" IS NOT NULL
            GROUP BY "organizationId", "entityType", "entityId"
            HAVING count(*) > 1
          ) duplicate_groups
        ) AS "voicePermissionDuplicateGroupCount"
    `)
    return { config, active, callLogMigrationRisk }
  })

  // This fence was absolute while the AI-call contour was being built.
  // The owner turned the queue on on 2026-08-13, so an enabled tenant
  // is now a fact to report rather than a deploy to fail. The fence
  // below stays: a deploy must not cut off a call in progress.
  if (proof.config.queueEnabledCount !== 0) {
    console.log(`AI-call queue is enabled for ${proof.config.queueEnabledCount} tenant(s).`)
  }
  if (proof.active.count !== 0) {
    throw new Error("Active AI-call sessions must drain before the queue migration")
  }
  // The pending migration performs a deterministic one-time canonical
  // phone backfill. Fail before staging or migrating if the live table
  // is too large for this bounded foundation rollout. Once the column
  // exists, later deploys do not repeat this gate.
  const maxBackfillBytes = 256n * 1024n * 1024n
  if (
    !proof.callLogMigrationRisk.canonicalColumnPresent
    && BigInt(proof.callLogMigrationRisk.tableBytes) > maxBackfillBytes
  ) {
    throw new Error("Call history table requires a staged backfill before this deployment")
  }
  if (
    !proof.callLogMigrationRisk.canonicalColumnPresent
    && proof.callLogMigrationRisk.callTargetArtifactCount !== 0
  ) {
    throw new Error("Call history migration has unexpected partial schema artifacts")
  }
  if (
    !proof.callLogMigrationRisk.voicePermissionIndexPresent
    && BigInt(proof.callLogMigrationRisk.auditTableBytes) > maxBackfillBytes
  ) {
    throw new Error("Audit history table requires a staged index build before this deployment")
  }
  if (
    !proof.callLogMigrationRisk.voicePermissionIndexPresent
    && (
      proof.callLogMigrationRisk.voicePermissionArtifactCount !== 0
      || proof.callLogMigrationRisk.voicePermissionReservedRowCount !== 0
      || proof.callLogMigrationRisk.voicePermissionDuplicateGroupCount !== 0
    )
  ) {
    throw new Error("Voice-permission audit namespace is not clean for its first migration")
  }
  if (
    proof.config.voiceAgentConfigCount < 1
    || proof.config.emptyPromptCount !== 0
  ) {
    throw new Error("CRM-managed voice prompt must be present before deployment")
  }
  console.log("AI-call pre-deploy safety proof passed")
})().finally(() => prisma.$disconnect())
NODE
REMOTE
