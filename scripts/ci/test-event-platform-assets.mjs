import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { validateActivationEvidence } from "../event-platform/activation-preflight.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const assetRoot = path.join(repoRoot, "ops/event-platform")

const activationEvidence = {
  apiVersion: "event-platform.leaddrive.io/v1",
  kind: "KafkaActivationEvidence",
  environment: "prod",
  releaseSha: "a".repeat(40),
  changeId: "CHG-1001",
  requestedBy: "operator-a",
  approvedBy: "operator-b",
  kafka: {
    failureDomains: 3, autoTopicCreationDisabled: true, tlsVerified: true,
    encryptionAtRest: true, privateEndpoints: true, backupDrTested: true,
    bootstrapServers: ["broker-a:9093", "broker-b:9093", "broker-c:9093"],
  },
  connect: {
    imageDigest: `sha256:${"b".repeat(64)}`, postgresConnectorVerified: true,
    outboxRouterVerified: true, acksAllVerified: true, idempotenceVerified: true,
    internalTopicReplicationFactor: 3,
  },
  registry: {
    privateEndpoint: true, tlsVerified: true, jsonSchemaReferencesVerified: true,
    backwardTransitiveVerified: true,
  },
  postgres: {
    backupEvidenceId: "restore-1001", restoreVerified: true, walLevel: "logical",
    maxSlotWalKeepSizeBytes: 4_294_967_296, capacityApproved: true,
  },
  archive: { immutable: true, offProviderCopy: true, retentionDays: 400, watermarkAlertLive: true },
  monitoring: {
    connectorFailure: true, slotWalBytes: true, postgresFreeSpace: true,
    underReplicatedPartitions: true, consumerLag: true, schemaRejections: true,
    quarantineRate: true, tenantProjectionParity: true,
  },
  drill: {
    evidenceId: "drill-1001", ordering: true, duplicateHandling: true,
    tenantIsolation: true, effectFence: true, archiveReconciliation: true,
  },
  secretReferences: {
    kafkaConsumer: "vault://leaddrive/prod/kafka-consumer",
    connectProducer: "vault://leaddrive/prod/connect-producer",
    schemaRegistry: "vault://leaddrive/prod/schema-registry",
    postgresCdc: "vault://leaddrive/prod/postgres-cdc",
  },
}
assert.deepEqual(
  validateActivationEvidence(activationEvidence, { environment: "prod", releaseSha: "a".repeat(40) }),
  { ready: true, environment: "prod", releaseSha: "a".repeat(40), changeId: "CHG-1001", evidenceId: "drill-1001" },
)
assert.throws(
  () => validateActivationEvidence({ ...activationEvidence, approvedBy: "operator-a" }),
  /different approver/,
)
assert.throws(
  () => validateActivationEvidence({ ...activationEvidence, postgres: { ...activationEvidence.postgres, walLevel: "replica" } }),
  /wal_level must be logical/,
)

async function readText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8")
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath))
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`)
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function extractQuotedValues(source, declarationPattern, label) {
  const match = source.match(declarationPattern)
  assert.ok(match, `could not derive ${label} from src/lib/modules.ts`)
  return [...match[1].matchAll(/"([a-z][a-z0-9-]*)"/g)].map((item) => item[1])
}

const modulesSource = await readText("src/lib/modules.ts")
const groupModules = extractQuotedValues(
  modulesSource,
  /export const GROUP_MODULE_IDS = \[([\s\S]*?)\] as const/,
  "group modules",
)
const addOnModules = extractQuotedValues(
  modulesSource,
  /export const ADDON_FLAG_IDS = \[([\s\S]*?)\] as const/,
  "add-on modules",
)
const intentionallyUngated = extractQuotedValues(
  modulesSource,
  /export const INTENTIONALLY_UNGATED = new Set<string>\(\[([\s\S]*?)\]\)/,
  "intentionally ungated domains",
).filter((value) => !["read", "write", "delete"].includes(value))

const expectedDomains = sorted(new Set([
  ...groupModules,
  ...addOnModules,
  "sms-otp",
  ...intentionallyUngated,
]))
assert.equal(expectedDomains.length, 27, "the governed product-domain boundary changed")

const topics = await readJson("ops/event-platform/topics.v1.json")
assert.equal(topics.status, "template-not-applied")
assert.equal(topics.environmentToken, "<env>")
assert.equal(topics.automaticTopicCreation, false)
assert.equal(topics.defaults.replicationFactor, 3)
assert.equal(topics.defaults.config["min.insync.replicas"], "2")
assert.equal(topics.defaults.config["unclean.leader.election.enable"], "false")

const actualDomains = sorted(topics.domains.map((domain) => domain.name))
assert.deepEqual(actualDomains, expectedDomains, "topic domains must exactly cover the module catalog")
unique(actualDomains, "topic domains")
for (const domain of topics.domains) {
  assert.match(domain.name, /^[a-z][a-z0-9-]*$/)
  assert.match(domain.owner, /^[a-z][a-z0-9-]*$/)
  assert.ok(Number.isInteger(domain.partitions) && domain.partitions >= 6)
  assert.equal(domain.partitions % 6, 0, `${domain.name} partitions must be a multiple of six`)
  assert.equal(domain.eventRetentionMs, 7_776_000_000, `${domain.name} must retain domain events for 90 days`)
}

const expectedFamilies = new Map([
  ["events", "ld.<env>.<domain>.events.v1"],
  ["replay", "ld.<env>.<domain>.replay.v1"],
  ["quarantine", "ld.<env>.<domain>.quarantine.v1"],
])
assert.equal(topics.topicFamilies.length, expectedFamilies.size)
for (const family of topics.topicFamilies) {
  assert.equal(family.nameTemplate, expectedFamilies.get(family.kind))
  assert.equal(family.config["cleanup.policy"], "delete")
  if (family.kind === "events") assert.equal(family.retentionMsFromDomain, true)
  if (family.kind === "replay") assert.equal(family.retentionMs, 1_209_600_000)
  if (family.kind === "quarantine") assert.equal(family.retentionMs, 7_776_000_000)
}

const expectedControls = sorted([
  "ld.<env>.event-platform.replay-control.v1",
  "ld.<env>.event-platform.replay-audit.v1",
  "ld.<env>.effects.requests.v1",
  "ld.<env>.effects.results.v1",
  "ld.<env>.security.audit.v1",
])
assert.deepEqual(sorted(topics.controlTopics.map((topic) => topic.name)), expectedControls)

const expandedNames = []
for (const domain of topics.domains) {
  for (const family of topics.topicFamilies) {
    const name = family.nameTemplate
      .replace("<env>", "ci")
      .replace("<domain>", domain.name)
    assert.match(name, /^ld\.ci\.[a-z][a-z0-9-]*\.(?:events|replay|quarantine)\.v1$/)
    expandedNames.push(name)
  }
}
for (const topic of topics.controlTopics) {
  assert.equal(topic.replicationFactor, 3, `${topic.name} replication factor`)
  assert.equal(topic.config["min.insync.replicas"], "2", `${topic.name} min ISR`)
  assert.equal(topic.config["unclean.leader.election.enable"], "false", `${topic.name} unclean election`)
  expandedNames.push(topic.name.replace("<env>", "ci"))
}
assert.equal(expandedNames.length, 86)
unique(expandedNames, "expanded physical topic names")

const connector = await readJson("ops/event-platform/debezium/event-outbox-connector.template.json")
const config = connector.config
assert.equal(connector.name, "leaddrive-event-outbox-__ENV__")
assert.equal(config["connector.class"], "io.debezium.connector.postgresql.PostgresConnector")
assert.equal(config["plugin.name"], "pgoutput")
assert.equal(config["tasks.max"], "1")
assert.equal(config["database.user"], "leaddrive_event_cdc")
assert.equal(config["database.password"], "__SECRET_FROM_PROVIDER__")
assert.equal(config["database.sslmode"], "verify-full")
assert.equal(config["publication.name"], "leaddrive_event_outbox")
assert.equal(config["publication.autocreate.mode"], "disabled")
assert.equal(config["table.include.list"], "public.event_outbox")
assert.equal(config["schema.include.list"], "public")
assert.equal(config["skipped.operations"], "u,d,t")
assert.equal(config["topic.creation.enable"], "false")
assert.equal(config["errors.tolerance"], "none")
assert.equal(config["event.processing.failure.handling.mode"], "fail")
assert.equal(config["provide.transaction.metadata"], "false")
assert.equal(config.transforms, "outbox")
assert.equal(config["transforms.outbox.type"], "io.debezium.transforms.outbox.EventRouter")
assert.equal(config["transforms.outbox.table.op.invalid.behavior"], "fatal")
assert.equal(config["transforms.outbox.table.field.event.key"], "partitionKey")
assert.equal(config["transforms.outbox.table.field.event.payload"], "envelope")
assert.equal(config["transforms.outbox.route.by.field"], "topic")
assert.equal(config["transforms.outbox.route.topic.regex"], "leaddrive\\.domain\\.([a-z][a-z0-9-]*)\\.v1")
assert.equal(config["transforms.outbox.route.topic.replacement"], "ld.__ENV__.$1.events.v1")
assert.equal(config["transforms.outbox.table.expand.json.payload"], "true")
assert.equal(config["transforms.outbox.table.field.additional.missing"], "error")
assert.equal(config["transforms.outbox.table.json.payload.null.behavior"], "optional_bytes")
assert.equal(config["value.converter.schemas.enable"], "false")
assert.match(config["slot.name"], /^leaddrive_event_outbox___ENV__$/)
assert.match(
  config["snapshot.select.statement.overrides.public.event_outbox"],
  /ORDER BY o\."partitionKey", \(\(o\."envelope" ->> 'aggregateversion'\)::bigint\), o\."id"$/,
)

const expectedColumns = [
  "id", "organizationId", "eventId", "eventType", "topic",
  "partitionKey", "envelope", "payloadHash", "createdAt",
].map((column) => `public.event_outbox.${column}`)
assert.deepEqual(config["column.include.list"].split(","), expectedColumns)
const connectorText = JSON.stringify(connector)
for (const forbidden of ["jdbc:postgresql://", "sasl.jaas.config", "BEGIN PRIVATE KEY", "https://localhost"]) {
  assert.equal(connectorText.includes(forbidden), false, `connector contains forbidden embedded value: ${forbidden}`)
}

const effectOperatorSql = await readText("ops/event-platform/postgres/prepare-effect-operator.sql")
for (const requiredGuard of [
  "NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
  "GRANT INSERT ON TABLE public.effect_reconciliations TO leaddrive_effect_operator",
  "GRANT UPDATE ON TABLE public.effect_outbox TO leaddrive_effect_operator",
  "must have no inbound or outbound role memberships during preparation",
  "effect operator gained an inbound/outbound membership during preparation",
  "Membership is intentionally not granted here",
]) {
  assert.ok(effectOperatorSql.includes(requiredGuard), `effect operator guard is missing: ${requiredGuard}`)
}
assert.equal(
  /GRANT\s+leaddrive_effect_operator\s+TO/i.test(effectOperatorSql),
  false,
  "effect operator preparation must not grant human/runtime membership",
)

const githubDeploy = await readText(".github/workflows/deploy.yml")
const githubPrChecks = await readText(".github/workflows/pr-checks.yml")
const nextConfig = await readText("next.config.ts")
const serverBuildDeploy = await readText("scripts/server-build-deploy.sh")
const manualDeploy = await readText("scripts/deploy.sh")
const hostedBuildPrep = await readText("scripts/ci/prepare-hosted-build-runner.sh")
const productionSshAction = await readText(".github/actions/setup-production-ssh/action.yml")
const productionEnvironmentGuard = await readText(".github/actions/assert-production-environment-protection/action.yml")
const productionInspection = await readText(".github/workflows/tail-app-logs.yml")
const backupCommissionWorkflow = await readText(".github/workflows/commission-production-backup.yml")
const backupReadiness = await readText("scripts/backup/report-production-readiness.sh")
const backupCommission = await readText("scripts/backup/commission-production-backup.sh")
const offlineCustodyVerifier = await readText("scripts/backup/verify-age-key-custody.sh")
const offlineArchiveVerifier = await readText("scripts/backup/verify-offline-backup.sh")
const postgresBackup = await readText("scripts/backup/postgres-backup.sh")
const secretsSnapshot = await readText("scripts/backup/snapshot-secrets.sh")
const runtimeFilesSnapshot = await readText("scripts/backup/snapshot-runtime-files.sh")
const restoreCanary = await readText("scripts/backup/postgres-restore-canary.sh")
const restoredPiiProof = await readText("scripts/backup/prove-restored-pii.mjs")
const canarySql = await readText("scripts/backup/canary.sql")
const clientOperator = await readText("scripts/client.sh")
const serverDeploy = await readText("scripts/server-deploy.sh")
const buildInfoRoute = await readText("src/app/api/v1/public/build-info/route.ts")
const eventPlatformReadme = await readText("docs/event-platform/README.md")
const recoveryRunbook = await readText("docs/event-platform/PROJECTION_RECOVERY_RUNBOOK.md")
const backupRunbook = await readText("docs/BACKUP_RUNBOOK.md")
const deploymentGuide = await readText("docs/DEPLOYMENT.md")
const legacyClientProbe = await readText("scripts/event-platform-legacy-client-probe.mjs")
const appendSource = await readText("src/lib/event-platform/append.ts")
const tenantDemoSeed = await readText("scripts/seed-tenant-demo.mjs")
const recoveryHelperPins = [
  ["CUSTODY_VERIFIER_SHA256", "BACKUP_CUSTODY_VERIFIER_SHA256", offlineCustodyVerifier],
  ["ARCHIVE_VERIFIER_SHA256", "BACKUP_ARCHIVE_VERIFIER_SHA256", offlineArchiveVerifier],
  ["POSTGRES_BACKUP_SHA256", "BACKUP_POSTGRES_SCRIPT_SHA256", postgresBackup],
  ["SECRETS_SNAPSHOT_SHA256", "BACKUP_SECRETS_SCRIPT_SHA256", secretsSnapshot],
  ["RUNTIME_FILES_SNAPSHOT_SHA256", "BACKUP_RUNTIME_FILES_SCRIPT_SHA256", runtimeFilesSnapshot],
  ["RESTORE_CANARY_SHA256", "BACKUP_RESTORE_CANARY_SHA256", restoreCanary],
  ["PII_PROOF_SHA256", "BACKUP_PII_PROOF_SHA256", restoredPiiProof],
  ["CANARY_SQL_SHA256", "BACKUP_CANARY_SQL_SHA256", canarySql],
]
for (const [sharedName, deployName, source] of recoveryHelperPins) {
  const digest = createHash("sha256").update(source).digest("hex")
  assert.ok(
    backupCommission.includes(sharedName + '="' + digest + '"')
      && backupReadiness.includes(sharedName + '="' + digest + '"')
      && serverDeploy.includes(deployName + '="' + digest + '"'),
    sharedName + " must pin the current helper bytes consistently in commissioning, readiness, and deployment",
  )
}
for (const [label, protectedProgram] of [
  ["backup commissioning", backupCommission],
  ["backup readiness", backupReadiness],
  ["server deploy", serverDeploy],
]) {
  assert.equal(
    protectedProgram.includes("TO_BE_FINALIZED"),
    false,
    `${label} must not ship with unbound recovery-program hashes`,
  )
}
assert.ok(
  legacyClientProbe.includes("SET CONSTRAINTS ALL IMMEDIATE"),
  "rollback-only legacy probe must execute deferred coherence checks before its intentional abort",
)
assert.ok(
  githubDeploy.includes('"$GITHUB_SHA"') && githubDeploy.includes("src/generated/build-sha.ts"),
  "GitHub production build must compile its immutable SHA into event provenance",
)
for (const [label, retiredEntryPoint] of [
  ["manual deploy", manualDeploy],
  ["on-host build", serverBuildDeploy],
]) {
  assert.ok(
    retiredEntryPoint.includes("intentionally retired")
      && retiredEntryPoint.includes("GitHub Actions")
      && retiredEntryPoint.includes("exit 64"),
    `${label} entry point must remain a fail-fast tombstone`,
  )
}
assert.match(
  clientOperator,
  /cmd_deploy\(\) \{\s+die "Direct client deploy is retired\./,
  "single-client direct production deploy must fail before push/build/restart",
)
assert.match(
  clientOperator,
  /cmd_deploy_all\(\) \{\s+die "Direct multi-client deploy is retired\./,
  "multi-client direct production deploy must fail before push/build/restart",
)
assert.ok(
  githubDeploy.includes("runs-on: ubuntu-24.04")
    && githubDeploy.includes("bash scripts/ci/prepare-hosted-build-runner.sh")
    && githubDeploy.includes("NODE_OPTIONS: --max-old-space-size=8192")
    && githubDeploy.includes("ulimit -c 0")
    && githubDeploy.includes('NEXT_BUILD_CPUS: "1"')
    && githubDeploy.includes('NEXT_WEBPACK_PARALLELISM: "1"')
    && githubDeploy.includes('LEADDRIVE_COLD_PRODUCTION_BUILD: "1"')
    && !githubDeploy.includes("runs-on: [self-hosted, leaddrive-builder]"),
  "production build must stay on a bounded GitHub-hosted Linux runner",
)
// The trigger list must keep `labeled` (so applying the production-build
// label starts the proof) and, per docs/ci-cost-policy.md, `ready_for_review`
// (so the typecheck that skips drafts still runs before a merge). The order
// of the list is not part of the contract.
const prChecksTypes = githubPrChecks.match(/^\s*types: \[([^\]]*)\]/m)?.[1] ?? ""
assert.ok(
  /\blabeled\b/.test(prChecksTypes)
    && /\bready_for_review\b/.test(prChecksTypes)
    && githubPrChecks.includes("contains(github.event.pull_request.labels.*.name, 'production-build')")
    && githubPrChecks.includes("name: GitHub-hosted Linux production build")
    && githubPrChecks.includes("bash scripts/ci/prepare-hosted-build-runner.sh")
    && githubPrChecks.includes("NODE_OPTIONS: --max-old-space-size=8192")
    && githubPrChecks.includes('LEADDRIVE_COLD_PRODUCTION_BUILD: "1"')
    && githubPrChecks.includes("ulimit -c 0")
    && githubPrChecks.includes("npx next build --webpack"),
  "the production-build PR label must trigger the same isolated webpack proof",
)
assert.ok(
  nextConfig.includes('webpackBuildWorker: process.env.LEADDRIVE_COLD_PRODUCTION_BUILD === "1" ? true : undefined')
    && nextConfig.includes('process.env.LEADDRIVE_COLD_PRODUCTION_BUILD === "1"')
    && nextConfig.includes("config.cache = false"),
  "custom webpack builds must isolate compiler graphs and disable the unconsumed cold CI cache",
)
for (const requiredHostedGuard of [
  'RUNNER_ENVIRONMENT:-}" = "github-hosted"',
  "RUNNER_TEMP",
  "GITHUB_WORKSPACE",
  "SYSTEM_TEMP_REAL",
  'MODE="${1:-prepare}"',
  "swap_is_active()",
  'sudo swapoff "$SWAP_FILE"',
  'SWAP_MIB" -le 4096',
  "sudo swapon",
  'MIN_MEMORY_BUDGET_KIB="${LEADDRIVE_BUILD_MIN_BUDGET_KIB:-12582912}"',
]) {
  assert.ok(hostedBuildPrep.includes(requiredHostedGuard), `hosted build guard is missing: ${requiredHostedGuard}`)
}
assert.equal(
  hostedBuildPrep.includes("/mnt/leaddrive-production-build.swap"),
  false,
  "hosted build helper must use GitHub's documented runner paths instead of a static VM path",
)
for (const requiredSshGuard of [
  'EXPECTED_PRODUCTION_HOST: "13.140.132.245"',
  'StrictHostKeyChecking yes',
  'UserKnownHostsFile ~/.ssh/known_hosts',
  'ssh-keygen -F "$SERVER_HOST"',
]) {
  assert.ok(productionSshAction.includes(requiredSshGuard), `shared production SSH guard is missing: ${requiredSshGuard}`)
}
// The independent-reviewer half of this guard was removed on 2026-09-06: GitHub
// only offers required_reviewers for private repositories on Enterprise, so the
// check could never pass on this plan and made every path to production
// impassable rather than protected. Layer 2 of docs/DELIVERY-ARCHITECTURE.md
// replaces it — an agent that did not write the change reviews every pull
// request, and `agent-review` is the required check on main. What is asserted
// here is the half that does work: production is reachable only from main, and
// the guard still fails closed when GitHub cannot be inspected at all.
assert.ok(
  productionEnvironmentGuard.includes('GH_TOKEN: ${{ inputs.github-token }}')
    && productionEnvironmentGuard.includes("deployment_branch_policy")
    && productionEnvironmentGuard.includes("deployment-branch-policies")
    && productionEnvironmentGuard.includes("(.branch_policies | length == 1)")
    && productionEnvironmentGuard.includes('(.branch_policies[0].name == "main")')
    && productionEnvironmentGuard.includes("Cannot inspect GitHub production-environment protection"),
  "production access must fail closed unless GitHub exposes an exact main branch policy",
)
// Matches the check itself, not the word: the comment above it explains why the
// requirement was dropped and necessarily names it.
assert.ok(
  !/select\(\s*\.type\s*==\s*"required_reviewers"/u.test(productionEnvironmentGuard)
    && !/select\(\s*\.type\s*==\s*"required_reviewers"/u.test(githubDeploy),
  "the reviewer requirement is deliberately gone; re-adding it makes production undeployable on this plan",
)
// The first agent review of the architecture pull request made this point: an
// assertion that only forbids the old gate would let someone delete the new one
// and leave the repository with neither. So the replacement is asserted to
// exist, by name, together with the script that makes it a required check.
//
// 2026-09-11: the replacement is no longer `agent-review`. The owner dropped it —
// without an ANTHROPIC_API_KEY it reported green on every PR by design, and it
// was the ONLY required context, so tests and typecheck were not required at
// all. What is required now is what GitHub itself runs. The principle above
// still holds and is asserted below: the gate must exist, must run on every
// pull request, and must be what main actually requires.
const prChecksWorkflow = await readText(".github/workflows/pr-checks.yml")
const mainProtectionScript = await readText("scripts/ci/configure-main-protection.sh")
const requiredContexts = ["pr-scope", "static-checks", "typecheck", "runner-policy", "scan"]
// "Runs on every pull request" means no path filter of either sign on the
// pull_request trigger. The fourth agent review pointed out that checking only
// `paths:` would let a `paths-ignore:` slip through, and it was right.
const prTrigger = prChecksWorkflow.slice(
  prChecksWorkflow.indexOf("  pull_request:"),
  prChecksWorkflow.indexOf("  push:"),
)
assert.ok(
  prTrigger.length > 0 && !/^\s+paths(-ignore)?:/mu.test(prTrigger),
  "pr-checks must start on every pull request: its jobs are required, and a check that never starts leaves a PR unmergeable for ever",
)
// The heavy jobs may be skipped for documentation-only PRs, but only through
// pr-scope — and pr-scope must itself be required, because a failed detector
// skips its dependants and GitHub counts a skip as a pass.
assert.ok(
  prChecksWorkflow.includes("  pr-scope:")
    && /static-checks:\n    needs: pr-scope/u.test(prChecksWorkflow)
    && /typecheck:[\s\S]{0,1200}?\n    needs: pr-scope/u.test(prChecksWorkflow)
    && (prChecksWorkflow.match(/needs\.pr-scope\.outputs\.code == 'true'/g) ?? []).length === 2,
  "static-checks and typecheck may skip only via pr-scope",
)
assert.ok(
  requiredContexts.every((context) => mainProtectionScript.includes(`"${context}"`))
    && !mainProtectionScript.includes('"agent-review"'),
  "main must require the checks GitHub actually runs — pr-scope, static-checks, typecheck, runner-policy, scan — and not the retired agent-review",
)
assert.ok(
  (githubDeploy.match(/GitHub production environment must allow exactly the main branch/g) ?? []).length === 3
    && githubDeploy.includes("Require historical build to come only from main")
    && githubDeploy.includes("Require production to deploy only from main")
    && githubDeploy.includes("Require recovery to deploy only from main")
    && backupCommissionWorkflow.includes("permissions:\n  contents: read\n  actions: read")
    && backupCommissionWorkflow.includes("./.github/actions/assert-production-environment-protection")
    && backupCommissionWorkflow.indexOf("./.github/actions/assert-production-environment-protection")
      < backupCommissionWorkflow.indexOf("Setup pinned production SSH")
    && productionInspection.includes("permissions:\n  contents: read\n  actions: read")
    && productionInspection.includes("./.github/actions/assert-production-environment-protection")
    && productionInspection.indexOf("./.github/actions/assert-production-environment-protection")
      < productionInspection.indexOf("./.github/actions/setup-production-ssh")
    && deploymentGuide.includes("exact custom deployment branch policy")
    && deploymentGuide.includes("only allowed pattern is `main`")
    && deploymentGuide.includes("docs/DELIVERY-ARCHITECTURE.md"),
  "every owned production path must independently fail closed on an unprotected GitHub environment before SSH access",
)
assert.ok(
  productionInspection.includes("backup-readiness")
    && productionInspection.includes("'bash -s' < scripts/backup/report-production-readiness.sh")
    && productionInspection.includes("./.github/actions/setup-production-ssh")
    && productionInspection.includes("workflow_dispatch")
    && !/^ {2}push:/mu.test(productionInspection),
  "backup readiness must be a dispatch-only, pinned-SSH, read-only production diagnostic",
)
for (const requiredWorkflowGuard of [
  "workflow_dispatch:",
  "environment: production",
  "group: production-deploy",
  "cancel-in-progress: false",
  'EXPECTED_CONFIRMATION="INSTALL_PINNED_BACKUP_TOOLS_AND_EXTEND_LOG_RETENTION_ON_13_140_132_245"',
  'EXPECTED_CONFIRMATION="ENABLE_AGE_BACKUPS_ON_13_140_132_245"',
  'EXPECTED_CONFIRMATION="CREATE_BOOTSTRAP_BACKUP_ON_13_140_132_245"',
  'EXPECTED_CONFIRMATION="CERTIFY_BOOTSTRAP_RESTORE_ON_13_140_132_245"',
  'EXPECTED_CONFIRMATION="CREATE_FULL_RECOVERY_BACKUP_ON_13_140_132_245"',
  'EXPECTED_CONFIRMATION="CERTIFY_FULL_RECOVERY_ON_13_140_132_245"',
  "run-bootstrap-backup",
  "certify-bootstrap-restore",
  "run-verified-backup",
  "certify-offline-restore",
  "git fetch --no-tags --depth=1 origin refs/heads/main",
  '[ "$GITHUB_SHA" = "$CURRENT_MAIN_SHA" ]',
  "BACKUP_OFFLINE_ALLOWED_SIGNERS",
  "ops/backup/recovery-program-set.files",
  "hash-recovery-program-set.sh",
  '"$STAGE_DIR/backup-code.tar"',
]) {
  assert.ok(
    backupCommissionWorkflow.includes(requiredWorkflowGuard),
    `production backup commissioning workflow guard is missing: ${requiredWorkflowGuard}`,
  )
}
assert.equal(
  /^ {2}push:/mu.test(backupCommissionWorkflow),
  false,
  "production backup commissioning must never run implicitly on push",
)
for (const forbiddenReadinessPattern of [
  'source "$BACKUP_ENV_FILE"',
  '. "$BACKUP_ENV_FILE"',
  "set -x",
]) {
  assert.equal(
    backupReadiness.includes(forbiddenReadinessPattern),
    false,
    `backup readiness must not execute or trace secret configuration: ${forbiddenReadinessPattern}`,
  )
}
for (const requiredReadinessGuard of [
  'BACKUP_ENV_FILE="/etc/leaddrive/backup.env"',
  "read_static_env_value()",
  "configuration contains duplicate $key entries",
  "value redacted",
  "public age recipient accepts encryption (recipient redacted)",
  "get-object-lock-configuration",
  "signed evidence is preserved and cryptographically valid",
  "secrets snapshot timer is loaded, enabled and active",
  "runtime-files snapshot timer is loaded, enabled and active",
  "machine_ready=",
  "enterprise_ga_ready=",
  "operator_attestation_required=yes",
  'LOG_SHIP_RETENTION_DAYS:400',
  'BOOTSTRAP_RESTORE_MARKER="$EVIDENCE_ROOT/bootstrap-offline-restore-current.env"',
  "check_bootstrap_certificate_chain()",
  'FORMAT_VERSION)" = "4"',
  'FORMAT_VERSION)" = "3"',
  'FORMAT_VERSION)" = "$expected_evidence_format"',
  "RECOVERY_CATALOG_FORMAT_VERSION",
  "recovery-catalog/v3/archive-restore",
  "bootstrap-offline-restore.env",
  "log-evidence-genesis.env",
]) {
  assert.ok(backupReadiness.includes(requiredReadinessGuard), `backup readiness guard is missing: ${requiredReadinessGuard}`)
}
for (const forbiddenCommissionPattern of [
  'source "$BACKUP_ENV_FILE"',
  '. "$BACKUP_ENV_FILE"',
  "age-keygen",
  "curl -fsSL",
  "BACKUP_ENCRYPTION=off\\n",
]) {
  assert.equal(
    backupCommission.includes(forbiddenCommissionPattern),
    false,
    `backup commissioning contains a forbidden key/secret/supply-chain pattern: ${forbiddenCommissionPattern}`,
  )
}
for (const requiredCommissionGuard of [
  'AGE_VERSION="1.3.2"',
  'AGE_ARCHIVE_SHA256="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"',
  'AWS_SIGNING_FINGERPRINT="FB5DB77FD5C118B80511ADA8A6310ACC4672475C"',
  'gpg --batch --homedir "$WORK_DIR/gnupg"',
  '--verify "$WORK_DIR/awscliv2.zip.sig" "$WORK_DIR/awscliv2.zip"',
  "fence_backup_runner",
  "migrate_log_retention_policy",
  "LOG_SHIP_RETENTION_DAYS=400",
  'systemctl disable --now "$timer"',
  'printf \'BACKUP_ENCRYPTION=age\\n\'',
  "Object Lock precondition verified (bucket details redacted)",
  "[restore-canary] restore canary passed",
  "prepare_commission_code",
  "run_transient_backup_unit database",
  "run_transient_backup_unit secrets",
  "run_transient_backup_unit runtime-files",
  "DATABASE_OBJECT_VERSION_ID",
  "SECRETS_OBJECT_VERSION_ID",
  "RUNTIME_FILES_OBJECT_VERSION_ID",
  "RECOVERY_CATALOG_OBJECT_VERSION_ID",
  "RECOVERY_CATALOG_FORMAT_VERSION=3",
  "BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION",
  "bootstrap-offline-restore.env",
  "bootstrap-evidence.env",
  "bootstrap-evidence.env.sig",
  "preserve_signed_evidence",
  "ssh-keygen -Y verify",
  "PII_DECRYPT_STATUS",
  "DATABASE_AUTHORITY_CATALOG_STATUS",
  "RLS_FORCE_RLS_CATALOG_STATUS",
  "backup verified and locked until",
  "commit_commission_timers_disabled",
]) {
  assert.ok(backupCommission.includes(requiredCommissionGuard), `backup commissioning guard is missing: ${requiredCommissionGuard}`)
}
assert.ok(
  backupCommission.indexOf("fence_backup_runner", backupCommission.indexOf("install_tools()"))
      < backupCommission.indexOf("aws_url=", backupCommission.indexOf("install_tools()"))
    && backupCommission.lastIndexOf("commit_commission_timers_disabled")
      > backupCommission.indexOf("verify_signed_evidence archive-restore"),
  "commissioning must fence all recovery timers before installing AWS and leave them disabled after signed recovery proof until the matching reviewed deployment activates them",
)
const runnerFenceRecoveryStart = backupCommission.indexOf("recover_commission_runner_fence()")
const runnerFenceRecoveryEnd = backupCommission.indexOf("\n}\n\n", runnerFenceRecoveryStart)
const runnerFenceRecovery = backupCommission.slice(runnerFenceRecoveryStart, runnerFenceRecoveryEnd)
assert.ok(
  runnerFenceRecovery.includes(
    "^(install-backup-tools|activate-backup-encryption|run-bootstrap-backup|certify-bootstrap-restore|run-verified-backup|certify-offline-restore)$",
  ),
  "runner-fence recovery must accept every bounded commissioning operation, including both bootstrap stages",
)
assert.ok(
  backupCommission.includes("assert_full_recovery_program_matches_committed_genesis()")
    && backupCommission.includes("current recovery program differs from the committed bootstrap genesis")
    && backupCommission.includes('"$candidate_file" RECOVERY_PROGRAM_SET_SHA256)')
    && backupCommission.includes("full-recovery candidate was created with a recovery program different from the committed genesis")
    && (backupCommission.match(/assert_full_recovery_program_matches_committed_genesis/g) ?? []).length >= 3,
  "full backup and certification must reject a recovery-program change after the committed log genesis",
)
for (const [label, verifier, required] of [
  ["offline key-custody verifier", offlineCustodyVerifier, [
    "OFFLINE_SCRATCH_ROOT",
    "COPY_FILESYSTEM_DEVICE_STATUS=distinct",
    "COPY_FAILURE_DOMAIN_ATTESTATION=TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED",
    "CUSTODY_VERIFIER_SHA256",
    "ssh-keygen -Y sign",
    "REVIEWED_MAIN_SHA",
  ]],
  ["offline archive verifier", offlineArchiveVerifier, [
    "OFFLINE_SCRATCH_ROOT",
    "DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED",
    "DATABASE_CIPHERTEXT_SHA256",
    "SECRETS_CIPHERTEXT_SHA256",
    "RUNTIME_FILES_CIPHERTEXT_SHA256",
    "LOG_GENESIS_ANCHOR_FORMAT_VERSION",
    "LOG_GENESIS_OBJECT_VERSION_ID",
    "BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION",
    "BOOTSTRAP_RECOVERY_CERTIFICATE_ALLOWED_SIGNERS_SHA256",
    "RECOVERY_SCOPE=full-recovery",
    "RETENTION_DAYS" ,
    "RUNTIME_FILES_INVENTORY_STATUS=passed",
    "DATABASE_AUTHORITY_CATALOG_STATUS=captured_and_bound",
    "RLS_FORCE_RLS_CATALOG_STATUS=passed",
    "FULL_AUTHORITY_RESTORE_STATUS=not_tested",
    "PII_DECRYPT_STATUS=passed",
    "NEXTAUTH_SECRET_RECOVERY_STATUS=passed",
    "ARCHIVE_VERIFIER_SHA256",
    "candidate_created_epoch + retention_days * 86400 - 300",
    "ssh-keygen -Y sign",
    "REVIEWED_MAIN_SHA",
  ]],
]) {
  for (const guard of required) {
    assert.ok(verifier.includes(guard), `${label} guard is missing: ${guard}`)
  }
}
for (const stagingGuard of [
  "cp --reflink=never",
  "$WORK_DIR/inputs/database.tar.age",
  "$WORK_DIR/inputs/candidate.env",
  "$WORK_DIR/helpers/postgres-restore-canary.sh",
  "a private staged input differs from its reviewed digest",
]) {
  assert.ok(
    offlineArchiveVerifier.includes(stagingGuard),
    `offline archive verifier staging guard is missing: ${stagingGuard}`,
  )
}
for (const authorityGuard of [
  "authority.tsv",
  "AUTHORITY_STATUS=captured",
  "database authority changed while dump/globals were being captured",
  "sha256sum database.dump globals.sql authority.tsv",
]) {
  assert.ok(postgresBackup.includes(authorityGuard), `PostgreSQL authority guard is missing: ${authorityGuard}`)
}
assert.equal(
  postgresBackup.includes("--no-owner") || postgresBackup.includes("--no-privileges"),
  false,
  "production database archive must preserve owner and privilege metadata",
)
for (const runtimeGuard of [
  "unreviewed nested mount",
  "--one-file-system",
  "runtime-file tree gained a multiply-linked file",
]) {
  assert.ok(runtimeFilesSnapshot.includes(runtimeGuard), `runtime-file snapshot guard is missing: ${runtimeGuard}`)
}
assert.ok(
  (runtimeFilesSnapshot.match(/-type f -links \+1/g) ?? []).length >= 2,
  "runtime-file snapshot must reject hardlinks both before and after capture",
)
for (const proofGuard of [
  "TENANT_PII_MASTER_KEY",
  "NEXTAUTH_SECRET",
  "encrypted PII decrypt passed",
  "encrypted integration token decrypt passed",
  "value redacted",
]) {
  assert.ok(restoredPiiProof.includes(proofGuard), `restored secret proof is missing: ${proofGuard}`)
}
const workflowFiles = (await readdir(".github/workflows")).filter((file) => /\.ya?ml$/u.test(file))
const workflowSources = await Promise.all(
  workflowFiles.map(async (file) => [file, await readText(path.join(".github/workflows", file))]),
)
for (const [file, source] of workflowSources) {
  assert.equal(source.includes("ssh-keyscan"), false, `${file} must not trust a runtime-scanned SSH host key`)
}
const productionHostWorkflows = workflowSources.filter(([, source]) => source.includes("secrets.SERVER_HOST"))
for (const [file, source] of productionHostWorkflows) {
  if (file !== "deploy.yml") {
    assert.equal(
      /^ {2}push:/mu.test(source),
      false,
      `${file} must not contact production merely because operator code was pushed`,
    )
  }
  if (!new Set(["check-fb-env.yml", "tail-app-logs.yml"]).has(file)) {
    assert.ok(
      source.includes("group: production-deploy"),
      `${file} must serialize production mutations/connections with the canonical deploy`,
    )
  }
  if (source.includes("./.github/actions/setup-production-ssh")) {
    assert.ok(
      source.indexOf("actions/checkout@") < source.indexOf("./.github/actions/setup-production-ssh"),
      `${file} must check out the pinned local SSH action before using it`,
    )
    continue
  }
  if (file === "record-mtm-routes-guide.yml") {
    assert.ok(
      source.includes("bash scripts/ci/refresh-swissmed-mtm-fixtures.sh")
        && !/\b(?:ssh|scp)\s/u.test(source),
      `${file} may reach production only through the audited exact-host fixture helper`,
    )
    continue
  }
  assert.ok(
    source.includes("13.140.132.245"),
    `${file} must fence SERVER_HOST to the registered production address`,
  )
}
const fixtureRefresh = await readText("scripts/ci/refresh-swissmed-mtm-fixtures.sh")
assert.ok(
  fixtureRefresh.includes('expected_production_host="13.140.132.245"')
    && fixtureRefresh.includes('SERVER_HOST" != "$expected_production_host'),
  "the allowlisted fixture SSH helper must fence the exact production host",
)
assert.equal(
  (githubDeploy.match(/prepare-hosted-build-runner\.sh cleanup/gu) ?? []).length,
  1,
  "production build must always clean its bounded swap",
)
assert.equal(
  (githubPrChecks.match(/prepare-hosted-build-runner\.sh cleanup/gu) ?? []).length,
  1,
  "PR production build must always clean its bounded swap",
)
assert.ok(
  buildInfoRoute.includes("const artifactSha")
    && buildInfoRoute.includes("{ sha, artifactSha, builtAt:"),
  "the running bundle must expose its full compiled artifact SHA for exact cutover proof",
)
const prerequisiteShaMatch = serverDeploy.match(
  /EVENT_PLATFORM_ATOMIC_PREREQUISITE_SHA="([0-9a-f]{40})"/,
)
assert.ok(prerequisiteShaMatch, "Fund cutover must pin one exact atomic prerequisite SHA")
const prerequisiteSha = prerequisiteShaMatch[1]
assert.notEqual(prerequisiteSha, "0".repeat(40), "Fund prerequisite SHA must not be a placeholder")
for (const document of [eventPlatformReadme, recoveryRunbook]) {
  assert.ok(document.includes(prerequisiteSha), "operator docs must name the exact Fund prerequisite SHA")
}
for (const [label, builder] of [["GitHub", githubDeploy]]) {
  assert.equal(
    builder.includes("CONTRACT=fund-transaction-atomic-insert-first-v1"),
    false,
    `${label} final builder must not emit the one-release prerequisite marker`,
  )
  assert.ok(
    builder.includes("[ ! -e .next/standalone/.event-platform-fund-atomic-insert-first-v1 ]")
      && builder.includes("[ ! -L .next/standalone/.event-platform-fund-atomic-insert-first-v1 ]"),
    `${label} final builder must fail if a stale prerequisite marker enters the candidate`,
  )
}
assert.ok(
  githubDeploy.includes('EXPECTED="$GITHUB_SHA"')
    && githubDeploy.includes('"artifactSha"')
    && githubDeploy.includes("ref: ${{ inputs.recovery_sha }}"),
  "normal and recovery workflows must verify/checkout the exact full artifact revision",
)
assert.ok(
  githubDeploy.includes("deployment_mode:")
    && githubDeploy.includes("recovery-bootstrap")
    && githubDeploy.includes("recovery-bootstrap-resume")
    && githubDeploy.includes("bootstrap_resume_sha")
    && githubDeploy.includes("DEPLOY_TARGET_SHA")
    && githubDeploy.includes("DEPLOYMENT_MODE")
    && githubDeploy.includes("&& '0' || '1'")
    && githubDeploy.includes("deployment_mode must be normal, recovery-bootstrap, or recovery-bootstrap-resume")
    && githubDeploy.includes("manual normal deployment must rebuild the exact current main artifact")
    && githubDeploy.includes("manual normal build must use the exact current main artifact")
    && githubDeploy.includes("bootstrap-resume build must use an exact SHA reachable from current main")
    && githubDeploy.includes("bootstrap_resume_sha is valid only for recovery-bootstrap-resume")
    && githubDeploy.includes("recovery promotion may only be dispatched from main")
    && githubDeploy.includes("recovery_sha must be an exact SHA reachable from current main")
    && githubDeploy.includes('git merge-base --is-ancestor "$TARGET_SHA" "$CURRENT_MAIN_SHA"')
    && githubDeploy.includes("git fetch --no-tags origin refs/heads/main")
    && githubDeploy.includes("exact SHA-named staged artifact is missing")
    && githubDeploy.includes('bash /tmp/server-deploy.sh "$DEPLOY_MODE" "$DEPLOY_SHA"')
    && githubDeploy.includes("env.DEPLOYMENT_MODE == 'normal'"),
  "deployment workflow must bind a bootstrap resume to its historical main ancestor and exact staged artifact",
)
const dispatchPreflightStart = githubDeploy.indexOf("\n  dispatch_input_preflight:")
const checksJobStart = githubDeploy.indexOf("\n  checks:")
const resumeBuildAdmissionStart = githubDeploy.indexOf("\n  resume_build_admission:")
const buildJobStart = githubDeploy.indexOf("\n  build:")
const deployJobStart = githubDeploy.indexOf("\n  deploy:")
const recoveryJobStart = githubDeploy.indexOf("\n  recovery:")
const buildJob = githubDeploy.slice(buildJobStart, deployJobStart)
const deployJob = githubDeploy.slice(deployJobStart, recoveryJobStart)
const recoveryJob = githubDeploy.slice(recoveryJobStart)
assert.ok(
  dispatchPreflightStart >= 0
    && checksJobStart > dispatchPreflightStart
    && resumeBuildAdmissionStart > checksJobStart
    && buildJobStart > resumeBuildAdmissionStart
    && deployJobStart > buildJobStart
    && recoveryJobStart > deployJobStart
    && githubDeploy.includes("needs: [dispatch_input_preflight, resume_build_admission]")
    && githubDeploy.includes("bootstrap_resume_sha must be a 40-character lowercase commit SHA")
    && githubDeploy.includes("initial recovery-bootstrap cannot use recovery_sha, recovery_artifact_run_id, or bootstrap_resume_sha")
    && githubDeploy.includes("recovery_artifact_run_id must be a positive decimal Actions run ID")
    && githubDeploy.includes("Approve historical bootstrap-resume build")
    && githubDeploy.includes("Confirm protected historical-build admission")
    && githubDeploy.includes("environment:\n      name: production")
    && !githubDeploy.includes("deployment: false")
    && !githubDeploy.includes("secrets.NEXTAUTH_SECRET")
    && githubDeploy.includes("BUILD_ONLY_NEXTAUTH_SECRET")
    && (githubDeploy.match(/Remove checkout credential before repository code/g) ?? []).length === 2,
  "historical bootstrap code must be rejected before approval and receive neither a live auth secret nor checkout credential",
)
const downloadedArtifactVerificationStart = deployJob.indexOf("Verify downloaded SHA-bound artifact")
const stagedArtifactStart = deployJob.indexOf("Stage immutable artifact on production disk")
const downloadedArtifactVerification = deployJob.slice(
  downloadedArtifactVerificationStart,
  stagedArtifactStart,
)
assert.ok(
  buildJob.includes("Upload SHA-bound deploy artifact")
    && buildJob.includes("actions/upload-artifact@v7")
    && buildJob.includes("leaddrive-prod-${{ env.DEPLOY_TARGET_SHA }}")
    && buildJob.includes("retention-days: 30")
    && !buildJob.includes("SSH_PRIVATE_KEY")
    && !buildJob.includes("SERVER_HOST")
    && !/^\s*scp(?:\s|$)/m.test(buildJob)
    && deployJob.includes("Download SHA-bound deploy artifact")
    && deployJob.includes("actions/download-artifact@v4")
    && downloadedArtifactVerificationStart >= 0
    && stagedArtifactStart > downloadedArtifactVerificationStart
    && downloadedArtifactVerification.includes('tar -xOzf "$artifact" ./.deploy-sha')
    && deployJob.indexOf("Upload deploy script") > stagedArtifactStart,
  "only the protected deploy job may download, verify, and stage the SHA-bound production artifact",
)
assert.ok(
  recoveryJob.includes("RECOVERY_ARTIFACT_RUN_ID")
    && recoveryJob.includes("Authorize retained recovery artifact source")
    && recoveryJob.includes("recovery artifact source run must be completed successfully")
    && recoveryJob.includes("recovery artifact source must originate from this repository's main branch")
    && recoveryJob.includes(".github/workflows/deploy.yml@main|.github/workflows/deploy.yml@refs/heads/main")
    && recoveryJob.includes("permissions:\n      contents: read\n      actions: read")
    && recoveryJob.includes("RUN_HEAD_REPOSITORY")
    && recoveryJob.includes("RUN_HEAD_BRANCH")
    && recoveryJob.includes("Download exact retained recovery artifact")
    && recoveryJob.includes("repository: ${{ github.repository }}")
    && recoveryJob.includes("github-token: ${{ github.token }}")
    && recoveryJob.includes("run-id: ${{ env.RECOVERY_ARTIFACT_RUN_ID }}")
    && recoveryJob.includes("Verify downloaded retained recovery artifact")
    && recoveryJob.includes("Stage exact retained recovery artifact on production disk")
    && recoveryJob.includes('tar -xOzf "$artifact" ./.deploy-sha')
    && !githubDeploy.includes("elif [ -s /tmp/leaddrive-deploy.tar.gz ]")
    && deploymentGuide.includes("recovery_artifact_run_id")
    && deploymentGuide.includes("After 30 days this route fails\nclosed"),
  "artifact recovery must fetch an exact retained same-main deploy artifact and never promote a stale host tarball",
)
assert.ok(
  githubDeploy.includes("prove-source-database.sh")
    && serverDeploy.includes("scripts/backup/prove-source-database.sh"),
  "every production artifact path must carry the backup source-identity probe",
)
assert.ok(
  githubDeploy.includes('EXPECTED_PRODUCTION_HOST: "13.140.132.245"')
    && (githubDeploy.match(/SERVER_SSH_KNOWN_HOSTS/g) ?? []).length >= 4
    && (githubDeploy.match(/StrictHostKeyChecking yes/g) ?? []).length === 2
    && !githubDeploy.includes("ssh-keyscan"),
  "only the protected deploy and recovery SSH paths must pin the reviewed production host key",
)

const artifactIdentity = serverDeploy.indexOf("ARTIFACT_DEPLOY_SHA=")
const candidateMarkerRejection = serverDeploy.indexOf(
  'tar -tzf "$DEPLOY_TAR" "./$EVENT_PLATFORM_ATOMIC_PREREQUISITE_MARKER"',
  artifactIdentity,
)
const prerequisiteArtifactGate = serverDeploy.indexOf(
  'validate_event_platform_atomic_prerequisite_artifact "$BACKUP_PATH/standalone"',
  artifactIdentity,
)
const prerequisiteLiveGate = serverDeploy.indexOf(
  "validate_event_platform_atomic_prerequisite_live",
  prerequisiteArtifactGate,
)
const backupPreflight = serverDeploy.indexOf(
  "validate_event_platform_backup_preconditions",
  prerequisiteLiveGate,
)
const previousStandaloneBackup = serverDeploy.indexOf(
  'cp -a -- "$APP_DIR/.next/standalone" "$BACKUP_PATH/standalone"',
)
const previousStandaloneSync = serverDeploy.indexOf(
  "sync_event_platform_previous_standalone",
  artifactIdentity,
)
const pm2FenceStart = serverDeploy.indexOf("persist_event_platform_pm2_stop_fence()")
const pm2ReadOnlyInspection = serverDeploy.indexOf("pm2 jlist", pm2FenceStart)
const handoffMutationIntent = serverDeploy.indexOf("HANDOFF_STARTED=true", pm2ReadOnlyInspection)
const firstPm2Delete = serverDeploy.indexOf('pm2 delete "$process_id"', handoffMutationIntent)
const durableClientPrep = serverDeploy.indexOf("prepare_event_platform_recovery_state", artifactIdentity)
const pilotQuiesce = serverDeploy.indexOf("quiesce_event_platform_pilot", durableClientPrep)
const standaloneReplacement = serverDeploy.indexOf(
  'safe_remove_tree "$APP_DIR/.next/standalone"',
  pilotQuiesce,
)
const pilotBackup = serverDeploy.indexOf("backup_event_platform_pilot_database", standaloneReplacement)
const failClosedBeforeMigration = serverDeploy.indexOf(
  "EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true",
  pilotBackup,
)
const migrationDeploy = serverDeploy.indexOf("npx prisma migrate deploy", pilotBackup)
const previousClientGate = serverDeploy.indexOf("timeout 180 node \"$LEGACY_CLIENT_PROBE\"", migrationDeploy)
const productionPostconditions = serverDeploy.indexOf(
  "EVENT_PLATFORM_POSTCONDITIONS_SQL=",
  previousClientGate,
)
const durableVerification = serverDeploy.indexOf(
  "mark_event_platform_cutover_verified",
  productionPostconditions,
)
assert.ok(
  previousStandaloneBackup >= 0
    && artifactIdentity < previousStandaloneBackup
    && candidateMarkerRejection > artifactIdentity
    && prerequisiteArtifactGate > candidateMarkerRejection
    && prerequisiteLiveGate > prerequisiteArtifactGate
    && backupPreflight > prerequisiteLiveGate
    && previousStandaloneSync > artifactIdentity
    && previousStandaloneSync > backupPreflight
    && durableClientPrep > previousStandaloneSync
    && pilotQuiesce > durableClientPrep
    && standaloneReplacement > pilotQuiesce
    && pilotBackup > standaloneReplacement
    && failClosedBeforeMigration > pilotBackup
    && migrationDeploy > failClosedBeforeMigration
    && previousClientGate > migrationDeploy
    && productionPostconditions > previousClientGate
    && durableVerification > productionPostconditions,
  "Fund cutover must persist/quiesce before replacement, then back up, migrate, prove, reconcile and durably verify",
)
const pilotBackupFunctionStart = serverDeploy.indexOf("backup_event_platform_pilot_database()")
const pilotBackupFunctionEnd = serverDeploy.indexOf("\n}\n", pilotBackupFunctionStart)
const pilotBackupFunction = serverDeploy.slice(pilotBackupFunctionStart, pilotBackupFunctionEnd)
assert.ok(
  pilotBackupFunctionStart >= 0
    && pilotBackupFunction.includes("validate_event_platform_recovery_state")
    && pilotBackupFunction.includes("validate_event_platform_backup_preconditions")
    && pilotBackupFunction.indexOf("validate_event_platform_backup_preconditions")
      > pilotBackupFunction.indexOf("validate_event_platform_recovery_state")
    && pilotBackupFunction.indexOf("validate_event_platform_backup_preconditions")
      < pilotBackupFunction.indexOf('rm -f -- "$evidence_path" "$evidence_record" "$checksum_path"')
    && pilotBackupFunction.includes('"$candidate_script" --commission-monthly')
    && pilotBackupFunction.includes('"OBJECT_VERSION_ID=$object_version"')
    && pilotBackupFunction.includes('"RETENTION_TIER=$retention_tier"')
    && pilotBackupFunction.includes("validate_event_platform_backup_preconditions fenced")
    && !pilotBackupFunction.includes('systemctl unmask --runtime "$service"'),
  "the post-drain Fund backup must revalidate recovery and backup preconditions before replacing evidence",
)
assert.ok(
  serverDeploy.includes('local postgres_service_mode="${1:-unfenced}"')
    && serverDeploy.includes('EVENT_PLATFORM_BACKUP_SERVICE_RUNTIME_MASKED" = "true"')
    && serverDeploy.includes('PostgreSQL backup service is not protected by the journaled cutover fence')
    && serverDeploy.includes('cleanup_event_platform_backup_transient'),
  "the ordinary PostgreSQL backup target must remain durably fenced through the complete Fund cutover",
)
const pilotEvidenceFunctionStart = serverDeploy.indexOf("validate_event_platform_recovery_evidence()")
const pilotEvidenceFunctionEnd = serverDeploy.indexOf("\n}\n", pilotEvidenceFunctionStart)
const pilotEvidenceFunction = serverDeploy.slice(pilotEvidenceFunctionStart, pilotEvidenceFunctionEnd)
assert.ok(
  pilotEvidenceFunction.includes("run_pinned_backup_aws 45 s3api head-object")
    && pilotEvidenceFunction.includes("--version-id=\"$object_version\"")
    && pilotEvidenceFunction.includes("run_pinned_backup_aws 45 s3api get-object-retention")
    && pilotEvidenceFunction.includes('"COMPLIANCE"')
    && pilotEvidenceFunction.includes('"2:verified:monthly"')
    && pilotEvidenceFunction.includes('[ "$artifact_sha" = "$ARTIFACT_DEPLOY_SHA" ]')
    && pilotEvidenceFunction.includes('[ "$script_sha" = "$BACKUP_POSTGRES_SCRIPT_SHA256" ]')
    && pilotEvidenceFunction.includes('[ "$backup_env_sha" = "$current_backup_env_sha" ]')
    && pilotEvidenceFunction.includes('object_created_epoch + 14700')
    && pilotEvidenceFunction.includes('created_epoch" -le $((now_epoch + 300))'),
  "Fund retry must revalidate the exact artifact/config-bound monthly Object-Locked recovery point, not only a local log",
)
assert.ok(
  pm2FenceStart >= 0
    && pm2ReadOnlyInspection > pm2FenceStart
    && handoffMutationIntent > pm2ReadOnlyInspection
    && firstPm2Delete > handoffMutationIntent
    && serverDeploy.includes("Live standalone was not replaced; leaving the running artifact unchanged."),
  "pre-swap Fund inspection failures must leave the healthy artifact and PM2 process untouched",
)
assert.ok(
  serverDeploy.includes(
    "the Fund pilot migration outcome is ambiguous; refusing automatic rollback until a reviewed retry resolves durable state",
  )
    && !serverDeploy.includes("EVENT_PLATFORM_FAILURE_GATE_TABLE")
    && !serverDeploy.includes("EVENT_PLATFORM_PILOT_APPLIED_AFTER_FAILURE"),
  "a failed first-cutover migration must remain fail-closed without racy follow-up reads",
)
for (const allocatorGuard of [
  "if (expected === null)",
  "else if (expected === BigInt(0))",
  'ON CONFLICT ("organizationId", "aggregateType", "aggregateId") DO NOTHING',
  'UPDATE "event_aggregate_heads"',
  'AND "currentVersion" = $6::bigint',
]) {
  assert.ok(appendSource.includes(allocatorGuard), `optimistic append allocator is missing: ${allocatorGuard}`)
}
assert.equal(
  appendSource.includes("WHERE $6::bigint IS NULL OR $6::bigint = 0"),
  false,
  "positive expected versions must not depend on a zero-row INSERT source",
)
const demoFundSeedStart = tenantDemoSeed.indexOf("// ─── 43. FundTransaction ───")
const demoFundSeedEnd = tenantDemoSeed.indexOf("// ─── 44. PaymentOrder ───", demoFundSeedStart)
const demoFundSeed = tenantDemoSeed.slice(demoFundSeedStart, demoFundSeedEnd)
assert.ok(
  demoFundSeedStart >= 0
    && demoFundSeedEnd > demoFundSeedStart
    && demoFundSeed.includes("prisma.$transaction(async (tx)")
    && demoFundSeed.includes("tx.fundTransaction.create")
    && demoFundSeed.includes("tx.fund.updateMany")
    && demoFundSeed.indexOf("tx.fundTransaction.create")
      < demoFundSeed.indexOf("tx.fund.updateMany")
    && demoFundSeed.includes("updated.count !== 1")
    && demoFundSeed.indexOf('SET CONSTRAINTS ALL IMMEDIATE')
      > demoFundSeed.indexOf("updated.count !== 1")
    && demoFundSeed.indexOf('SET CONSTRAINTS ALL DEFERRED')
      > demoFundSeed.indexOf('SET CONSTRAINTS ALL IMMEDIATE'),
  "production-capable demo seed must keep Fund ledger and balance writes atomic in INSERT-first order",
)
for (const requiredDeployGuard of [
  "pg_control_system()).system_identifier",
  "app_database_identity\" = \"$migration_database_identity",
  "application and migration URLs do not share the same live PostgreSQL database",
  "leaddrive-postgres-backup.service",
  "backup service configuration does not target the migration database instance",
  "PostgreSQL backup environment changed between identity proof and backup",
  "validate_preserved_backup_evidence",
  "validate_deploy_artifact_identity",
  "run_recovery_bootstrap_deploy",
  "explicit deploy mode must be normal, recovery-bootstrap, or recovery-bootstrap-resume",
  "pending root log genesis requires its exact durable genesis-pending journal and bootstrap-resume mode",
  "pending root log genesis is incompatible with the interrupted operations activation phase",
  "durable genesis resume does not match the exact active immutable operations release",
  "durable genesis resume anchor does not match the exact bootstrap deployment SHA",
  "BOOTSTRAP_RECOVERY_CERTIFICATE_FORMAT_VERSION",
  "RECOVERY_CATALOG_FORMAT_VERSION",
  "recovery-catalog/v3/archive-restore",
  "prove_remote_log_genesis_body",
  "ssh-keygen -Y verify",
  "BACKUP_SIGNED_EVIDENCE_DIR",
  "DATABASE_CIPHERTEXT_SHA256",
  "SECRETS_CIPHERTEXT_SHA256",
  "PII_DECRYPT_STATUS",
  "leaddrive-secrets-snapshot.timer",
  '"_SYSTEMD_INVOCATION_ID=$invocation"',
  "[restore-canary] restore canary passed",
  "encrypting backup with offline age recipient",
  "backup verified and locked until",
  "app.event_platform_force_deep=on -c statement_timeout=0",
  "EVENT_PLATFORM_POSTCONDITION_TIMEOUT_SECONDS=7200",
  "EVENT_PLATFORM_AUTO_RECOVERY_BLOCKED=true",
  "previous PM2 artifact remains stopped",
  "pm2 save --force",
  "pm2 delete softphone-relay",
  "unset PM2_NAME",
  "APP_PORT=3001",
  "pm_exec_path",
  "usesProtectedPort",
  "sync_event_platform_previous_standalone",
  "Both granted locks are the proof",
  "event_platform_cutover_gates",
  "previousClientHash",
  "pg_catalog.pg_has_role(:'app_role', privileged.oid, 'SET')",
  "Fund cutover requires /api/v1/ping=200",
  "EVENT_PLATFORM_ATOMIC_PREREQUISITE_SHA=\"",
  "EVENT_PLATFORM_ATOMIC_PREREQUISITE_MARKER=\".event-platform-fund-atomic-insert-first-v1\"",
  "EVENT_PLATFORM_ATOMIC_PREREQUISITE_CONTRACT=\"fund-transaction-atomic-insert-first-v1\"",
  "Fund atomic prerequisite contract marker must have mode 0444",
  "previous artifact is not the exact approved atomic Fund prerequisite SHA",
  "live Fund writer is not the exact approved atomic prerequisite revision",
  "candidate artifact must not claim the one-release Fund atomic prerequisite contract",
  "extracted candidate falsely claims the Fund atomic prerequisite contract",
  "EXPECTED_SHARED_SERVER_IP=\"13.140.132.245\"",
  "LEGACY_SHARED_SERVER_IP=\"46.224.171.53\"",
  "migrate_registered_shared_server_ip",
  "SHARED_SERVER_IP migration did not produce the registered production host",
  'chown -hR root:root -- "$APP_DIR/.next/standalone"',
  'tar --no-same-owner -xzf "$DEPLOY_TAR"',
]) {
  assert.ok(serverDeploy.includes(requiredDeployGuard), `production cutover guard is missing: ${requiredDeployGuard}`)
}

const historicalBootstrapValidatorStart = serverDeploy.indexOf(
  "validate_historical_bootstrap_genesis_record()",
)
const historicalBootstrapValidatorEnd = serverDeploy.indexOf(
  "\n}\n\nvalidate_preserved_backup_evidence()",
  historicalBootstrapValidatorStart,
)
const historicalBootstrapValidator = serverDeploy.slice(
  historicalBootstrapValidatorStart,
  historicalBootstrapValidatorEnd,
)
const bootstrapAuthorityValidatorStart = serverDeploy.indexOf("validate_bootstrap_recovery_authority()")
const bootstrapAuthorityValidatorEnd = serverDeploy.indexOf(
  "\n}\n\ncomplete_log_evidence_genesis()",
  bootstrapAuthorityValidatorStart,
)
const bootstrapAuthorityValidator = serverDeploy.slice(
  bootstrapAuthorityValidatorStart,
  bootstrapAuthorityValidatorEnd,
)
assert.ok(
  historicalBootstrapValidatorStart >= 0
    && historicalBootstrapValidatorEnd > historicalBootstrapValidatorStart
    && historicalBootstrapValidator.includes("historical bootstrap evidence may not claim a log-genesis proof")
    && historicalBootstrapValidator.includes("historical bootstrap candidate may not claim a log-genesis proof")
    && historicalBootstrapValidator.includes('read_static_env_value "$evidence_file" CANDIDATE_SHA256')
    && historicalBootstrapValidator.includes("historical bootstrap secrets identity is not bound across its records")
    && historicalBootstrapValidator.includes("historical bootstrap proof does not bind candidate catalog field")
    && !historicalBootstrapValidator.includes("/etc/leaddrive/app.env")
    && !historicalBootstrapValidator.includes("run_pinned_backup_aws"),
  "the historical bootstrap certificate must retain cryptographic record binding without requiring expired payloads or current secrets",
)
assert.ok(
  serverDeploy.includes('local validation_profile="${5:-current}"')
    && serverDeploy.includes('historical-genesis) evidence_maximum_age=0')
    && serverDeploy.includes('"$recipient_sha" log-genesis-bootstrap-only historical-genesis')
    && bootstrapAuthorityValidatorStart >= 0
    && bootstrapAuthorityValidatorEnd > bootstrapAuthorityValidatorStart
    && !bootstrapAuthorityValidator.includes("historical-genesis"),
  "only the normal full-recovery chain may treat a bootstrap certificate as historical; a new bootstrap remains fresh",
)
assert.ok(
  serverDeploy.includes("restore_operations_timer_states leaddrive-log-ship.timer")
    && serverDeploy.includes("assert_operations_timer_states_except leaddrive-log-ship.timer"),
  "bootstrap activation must restore DB, secrets and runtime schedules exactly while keeping only log shipping fenced",
)
const genesisReconciliationStart = serverDeploy.indexOf(
  "reconcile_log_genesis_before_operations_switch()",
)
const genesisReconciliationEnd = serverDeploy.indexOf(
  "\n}\n\nvalidate_staged_operations_systemd_units()",
  genesisReconciliationStart,
)
const genesisReconciliation = serverDeploy.slice(
  genesisReconciliationStart,
  genesisReconciliationEnd,
)
assert.ok(
  genesisReconciliationStart >= 0
    && genesisReconciliationEnd > genesisReconciliationStart
    && genesisReconciliation.includes('[ "$DEPLOY_MODE" = recovery-bootstrap-resume ]')
    && genesisReconciliation.includes('[ "$GENESIS_ACTIVATION_DURABLE" = true ]')
    && genesisReconciliation.includes("pending root log genesis requires its exact durable genesis-pending journal"),
  "a pending root anchor must fail closed unless its exact durable bootstrap-resume journal is present",
)
const artifactIdentityInvocation = serverDeploy.indexOf("\nvalidate_deploy_artifact_identity\n")
const bootstrapAdmissionInvocation = serverDeploy.indexOf(
  "# Bootstrap admission is deliberately after the immutable artifact identity is",
)
const activationRecoveryInvocation = serverDeploy.indexOf(
  "\nrecover_pending_operations_activation\n",
  bootstrapAdmissionInvocation,
)
assert.ok(
  artifactIdentityInvocation >= 0
    && bootstrapAdmissionInvocation > artifactIdentityInvocation
    && activationRecoveryInvocation > bootstrapAdmissionInvocation
    && serverDeploy.slice(bootstrapAdmissionInvocation, activationRecoveryInvocation)
      .includes("validate_bootstrap_recovery_authority"),
  "bootstrap certificate admission must pass after artifact binding and before recovery reconciliation can mutate state",
)
assert.ok(
  backupRunbook.includes("deployment_mode=recovery-bootstrap-resume")
    && backupRunbook.includes("Bare PENDING")
    && backupRunbook.includes("anchor `COMMITTED`: bootstrap уже завершён")
    && backupRunbook.includes('prefix = "/usr/local/lib/leaddrive-v2/ops/releases/"')
    && backupRunbook.includes("BOOTSTRAP_DEPLOY_SHA=")
    && backupRunbook.includes("Approve historical\n     bootstrap-resume build")
    && deploymentGuide.includes("recovery-bootstrap-resume")
    && deploymentGuide.includes("A bare\nPENDING anchor")
    && deploymentGuide.includes("COMMITTED anchor without that journal")
    && deploymentGuide.includes("will not run Prisma, activate operations/timers")
    && deploymentGuide.includes("runs one fenced log-ship service")
    && deploymentGuide.includes("Approve historical bootstrap-resume build")
    && deploymentGuide.includes("The required policy is an exact custom deployment branch policy")
    && deploymentGuide.includes("bootstrap_resume_sha"),
  "operator documentation must describe the SHA-pinned bootstrap-resume route and reject a bare pending anchor",
)
assert.ok(
  backupRunbook.includes("**не** использовать обычный `backup-readiness`")
    && backupRunbook.includes("Первый normal reviewed deploy — это activation ceremony")
    && backupRunbook.includes("Сразу после успешного normal deploy dispatch `Inspect production safely`")
    && backupRunbook.includes("`machine_ready=no` **ожидаем**")
    && backupRunbook.includes("database/runtime — не старше 26 часов, secrets — не старше")
    && backupRunbook.includes("`machine_ready=yes issues=0`"),
  "the runbook must distinguish timer activation from the later successful scheduled runs required for machine readiness",
)
assert.ok(
  backupRunbook.includes("byte-identical recovery program set")
    && backupRunbook.includes("**hard stop**")
    && backupRunbook.includes("supersession/reanchor protocol; он пока не"),
  "the runbook must forbid silently continuing or re-bootstraping a chain after recovery-byte drift",
)

const subjects = await readJson("ops/event-platform/schema-registry/subjects.v1.json")
assert.equal(subjects.status, "template-not-registered")
assert.equal(subjects.schemaType, "JSON")
assert.equal(subjects.defaultCompatibility, "BACKWARD_TRANSITIVE")
assert.equal(subjects.normalize, true)
unique(subjects.subjects.map((subject) => subject.subject), "schema subjects")
unique(subjects.subjects.map((subject) => subject.schemaId), "schema IDs")

const pilotMigration = await readText("prisma/migrations/20260901100000_fund_event_source_pilot/migration.sql")
const foundationMigration = await readText("prisma/migrations/20260901090000_event_platform_foundation/migration.sql")
const postconditionsSql = await readText("scripts/event-platform-postconditions.sql")
const prismaSchema = await readText("prisma/schema.prisma")
assert.ok(
  foundationMigration.includes('CREATE TABLE "event_platform_cutover_gates"')
    && pilotMigration.includes("'fund-event-source-v1'")
    && postconditionsSql.includes("event_platform_cutover_gates_guard_trigger")
    && prismaSchema.includes("model EventPlatformCutoverGate")
    && prismaSchema.includes('@@map("event_platform_cutover_gates")'),
  "durable cutover-gate table must remain migration-, schema- and postcondition-governed",
)
assert.equal(pilotMigration.includes("array_agg("), false, "Fund cutover must not materialize full event arrays")
const compatibilityTransactionGuard = pilotMigration.slice(
  pilotMigration.indexOf("CREATE OR REPLACE FUNCTION fund_transactions_event_source_guard_fn()"),
  pilotMigration.indexOf("CREATE TRIGGER funds_compat_insert_event_trigger"),
)
assert.equal(
  /UPDATE\s+public\.funds/i.test(compatibilityTransactionGuard),
  false,
  "the compatibility INSERT trigger must leave the pinned atomic route's conditional Fund update mandatory",
)
assert.equal(postconditionsSql.includes("array_agg("), false, "deep verification must use bounded stream state")
const implementedFundEvents = sorted(new Set(
  [...pilotMigration.matchAll(/finance\.fund-[a-z-]+\.v1/g)].map((match) => match[0]),
))
const concreteSubjects = subjects.subjects.filter((subject) => subject.eventType)
assert.deepEqual(
  sorted(concreteSubjects.map((subject) => subject.eventType)),
  implementedFundEvents,
  "every implemented Fund event must have exactly one concrete schema subject",
)

const runtimeContractSource = await readText("src/lib/event-platform/fund-contracts.ts")
const runtimeContractPairs = [...runtimeContractSource.matchAll(
  /"(finance\.fund-[a-z-]+\.v1)":\s*\{\s*dataSchema:\s*"([^"]+)"/g,
)].map((match) => ({ eventType: match[1], schemaId: match[2] }))
assert.deepEqual(
  sorted(runtimeContractPairs.map(({ eventType, schemaId }) => `${eventType}|${schemaId}`)),
  sorted(concreteSubjects.map(({ eventType, schemaId }) => `${eventType}|${schemaId}`)),
  "registered Fund subjects and runtime Zod contracts must have identical eventType/dataSchema pairs",
)
unique(runtimeContractPairs.map(({ eventType }) => eventType), "runtime Fund event contracts")
unique(runtimeContractPairs.map(({ schemaId }) => schemaId), "runtime Fund schema contracts")

const contractGatePosition = appendSource.indexOf("assertEventContract({")
const aggregateHeadWritePosition = appendSource.indexOf("INSERT INTO \"event_aggregate_heads\"")
assert.ok(contractGatePosition >= 0, "appendDomainEvent must invoke the runtime contract gate")
assert.ok(
  aggregateHeadWritePosition > contractGatePosition,
  "runtime contract validation must happen before aggregate-head allocation",
)

const contractTests = await readText("src/__tests__/lib-event-platform-foundation.test.ts")
for (const requiredFixture of [
  'fundId: "fund-live"',
  'fundId: "fund-bootstrap"',
  'legacyBootstrap: true',
  'fundId: "fund-compat"',
  'legacyCompatibilityWrite: true',
  'eventType: "finance.fund-renamed.v1"',
]) {
  assert.ok(contractTests.includes(requiredFixture), `Fund contract fixtures are missing: ${requiredFixture}`)
}
const bootstrapTransactionFixture = contractTests.match(
  /transactionId: "tx-bootstrap"([\s\S]*?)legacyBootstrap: true/,
)
assert.ok(bootstrapTransactionFixture, "legacy bootstrap transaction fixture is missing")
assert.equal(
  bootstrapTransactionFixture[1].includes("resultingBalance"),
  false,
  "legacy bootstrap fixture must prove resultingBalance remains optional",
)

for (const subject of subjects.subjects) {
  assert.equal(subject.compatibility, "BACKWARD_TRANSITIVE")
  assert.ok(subject.owner)
  const absoluteSchemaPath = path.resolve(path.join(assetRoot, "schema-registry"), subject.schemaFile)
  const schema = JSON.parse(await readFile(absoluteSchemaPath, "utf8"))
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema")
  assert.equal(schema.$id, subject.schemaId)

  if (!subject.eventType) {
    assert.equal(schema.additionalProperties, false)
    for (const requiredField of [
      "specversion", "id", "source", "type", "time", "datacontenttype",
      "dataschema", "organizationid", "aggregatetype", "aggregateid",
      "aggregateversion", "correlationid", "producer", "producerversion",
      "classification", "data",
    ]) assert.ok(schema.required.includes(requiredField), `base envelope requires ${requiredField}`)
    continue
  }

  const envelopeReference = subject.references.find(
    (reference) => reference.name === "urn:leaddrive:schema:event-envelope:v1",
  )
  assert.deepEqual(envelopeReference, {
    name: "urn:leaddrive:schema:event-envelope:v1",
    subject: "leaddrive.event-envelope.v1-value",
    version: 1,
  })
  assert.equal(schema.allOf[0].$ref, envelopeReference.name)
  const specialization = schema.allOf[1].properties
  assert.equal(specialization.type.const, subject.eventType)
  assert.equal(specialization.dataschema.const, subject.schemaId)
  assert.equal(specialization.aggregatetype.const, "fund")
  assert.equal(specialization.classification.const, "confidential")
  assert.equal(specialization.data.$ref, "#/$defs/data")
  assert.equal(schema.$defs.data.additionalProperties, false)
  assert.ok(schema.$defs.data.required.includes("fundId"))

  const serialized = JSON.stringify(schema)
  for (const forbiddenField of ["password", "accessToken", "refreshToken", "otp", "secret"]) {
    assert.equal(serialized.includes(`\"${forbiddenField}\"`), false, `${subject.eventType} exposes ${forbiddenField}`)
  }
}

const openedSubject = concreteSubjects.find((subject) => subject.eventType === "finance.fund-opened.v1")
const transactionSubject = concreteSubjects.find(
  (subject) => subject.eventType === "finance.fund-transaction-recorded.v1",
)
assert.ok(openedSubject && transactionSubject, "Fund opening and transaction subjects are required")
const openedSchema = await readJson(path.join("ops/event-platform/schema-registry", openedSubject.schemaFile))
const transactionSchema = await readJson(path.join("ops/event-platform/schema-registry", transactionSubject.schemaFile))
assert.equal(
  openedSchema.$defs.data.properties.openingBalance.$ref,
  "#/$defs/nonNegativeMoney",
  "Fund opening balance must match the non-negative replay invariant",
)
assert.equal(
  transactionSchema.$defs.data.required.includes("resultingBalance"),
  false,
  "legacy bootstrap transactions intentionally omit resultingBalance",
)

const schemaFiles = await readdir(path.join(assetRoot, "schema-registry/schemas/finance"))
assert.deepEqual(
  sorted(schemaFiles.filter((file) => file.endsWith(".schema.json"))),
  sorted(concreteSubjects.map((subject) => path.basename(subject.schemaFile))),
  "unregistered or missing Finance schemas are forbidden",
)

const connectorContract = await readText("ops/event-platform/debezium/README.md")
for (const [label, required] of [
  ["connector does not validate JSON Schema", /does not validate JSON Schema/],
  ["connector does not consult Schema Registry", /does not consult Schema\s+Registry/],
  ["contract-validated outbox rows", /contract-validated outbox rows/],
  ["Kafka brokers do not enforce contracts", /Kafka\s+brokers do not enforce/],
]) assert.match(connectorContract, required, `connector contract documentation is missing: ${label}`)

const prepareCdc = await readText("ops/event-platform/postgres/prepare-cdc.sql")
for (const required of [
  "current_setting('wal_level') <> 'logical'",
  "max_slot_wal_keep_size",
  "LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS",
  "GRANT SELECT ON TABLE public.\"event_outbox\" TO leaddrive_event_cdc",
  "CREATE POLICY event_outbox_cdc_select",
  "CREATE PUBLICATION leaddrive_event_outbox",
  "FOR TABLE ONLY public.\"event_outbox\"",
  "publish = 'insert'",
]) assert.ok(prepareCdc.includes(required), `prepare-cdc.sql is missing: ${required}`)
for (const forbidden of [
  "GRANT ALL",
  "GRANT SELECT ON ALL TABLES",
  "BYPASSRLS;",
  "FOR ALL TABLES",
  "slot.drop.on.stop",
]) assert.equal(prepareCdc.includes(forbidden), false, `prepare-cdc.sql contains: ${forbidden}`)

assert.match(
  prepareCdc,
  /REVOKE %I FROM leaddrive_event_cdc/,
  "CDC preparation must revoke roles granted to the CDC identity",
)
assert.match(
  prepareCdc,
  /REVOKE leaddrive_event_cdc FROM %I/,
  "CDC preparation must revoke CDC membership from every possible runtime identity",
)
assert.ok(
  (prepareCdc.match(/granted_role\.oid = memberships\.roleid/g) ?? []).length >= 2,
  "CDC preparation and postcondition must both inspect pg_auth_members.roleid",
)
assert.ok(
  (prepareCdc.match(/member_role\.oid = memberships\.member/g) ?? []).length >= 2,
  "CDC preparation and postcondition must both inspect pg_auth_members.member",
)
assert.ok(
  (prepareCdc.match(/granted_role\.rolname = 'leaddrive_event_cdc'[\s\S]*?OR member_role\.rolname = 'leaddrive_event_cdc'/g) ?? []).length >= 2,
  "CDC preparation and postcondition must reject both inbound and outbound memberships",
)
assert.match(
  prepareCdc,
  /NOINHERIT does not prevent[\s\S]*SET ROLE/,
  "CDC role contract must document that NOINHERIT does not block SET ROLE",
)

const postgresConfig = await readText("ops/event-platform/postgres/postgresql.conf.example")
assert.match(postgresConfig, /^wal_level = logical$/m)
const slotCap = postgresConfig.match(/^max_slot_wal_keep_size = '([0-9]+)GB'$/m)
assert.ok(slotCap && Number(slotCap[1]) >= 4, "slot WAL cap must be finite and at least 4 GiB")
for (const setting of ["max_replication_slots", "max_wal_senders"]) {
  const match = postgresConfig.match(new RegExp(`^${setting} = ([0-9]+)$`, "m"))
  assert.ok(match && Number(match[1]) >= 4, `${setting} must allow controlled replacement`)
}

const replayControlMigration = await readText(
  "prisma/migrations/20260906120000_projection_replay_control_plane/migration.sql",
)
for (const required of [
  'CREATE TABLE "projection_activations"',
  'CREATE TABLE "projection_promotion_events"',
  'projection_promotion_events_two_person',
  'projection_activation_guard_trigger',
  'projection_checkpoint_guard_trigger',
  'projection_promotion_events_append_only_trigger',
  'ALTER TABLE "projection_activations" FORCE ROW LEVEL SECURITY',
  'ALTER TABLE "projection_promotion_events" FORCE ROW LEVEL SECURITY',
]) assert.ok(replayControlMigration.includes(required), `replay control migration is missing: ${required}`)
assert.match(
  replayControlMigration,
  /"activationVersion" <> OLD\."activationVersion" \+ 1/,
  "projection pointer must advance by exact compare-and-swap version",
)
assert.match(
  replayControlMigration,
  /"sourceOffset" < OLD\."sourceOffset"/,
  "projection checkpoints must reject offset rewind in PostgreSQL",
)

console.log(`event-platform assets OK: ${actualDomains.length} domains, ${expandedNames.length} topics, ${concreteSubjects.length} concrete schemas`)
