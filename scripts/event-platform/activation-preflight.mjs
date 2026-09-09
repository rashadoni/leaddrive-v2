#!/usr/bin/env node
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

const SHA = /^[0-9a-f]{40}$/
const ENVIRONMENT = /^[a-z][a-z0-9]*$/
const DIGEST = /^sha256:[0-9a-f]{64}$/

function requiredString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`)
  assert.ok(value.trim(), `${label} is required`)
}

function requiredTrue(value, label) {
  assert.equal(value, true, `${label} must be proven true`)
}

function distinctStrings(values, label) {
  values.forEach((value, index) => requiredString(value, `${label}[${index}]`))
  assert.equal(new Set(values).size, values.length, `${label} must be distinct`)
}

export function validateActivationEvidence(evidence, expected = {}) {
  assert.equal(evidence?.apiVersion, "event-platform.leaddrive.io/v1")
  assert.equal(evidence?.kind, "KafkaActivationEvidence")
  assert.match(evidence.environment, ENVIRONMENT, "environment must be a safe topic/slot slug")
  assert.match(evidence.releaseSha, SHA, "releaseSha must be a full lowercase Git SHA")
  if (expected.environment) assert.equal(evidence.environment, expected.environment, "environment does not match the approved target")
  if (expected.releaseSha) assert.equal(evidence.releaseSha, expected.releaseSha, "release SHA does not match the approved artifact")

  requiredString(evidence.changeId, "changeId")
  requiredString(evidence.requestedBy, "requestedBy")
  requiredString(evidence.approvedBy, "approvedBy")
  assert.notEqual(evidence.requestedBy, evidence.approvedBy, "activation requires a different approver")

  assert.ok(evidence.kafka.failureDomains >= 3, "Kafka must span at least three failure domains")
  requiredTrue(evidence.kafka.autoTopicCreationDisabled, "kafka.autoTopicCreationDisabled")
  requiredTrue(evidence.kafka.tlsVerified, "kafka.tlsVerified")
  requiredTrue(evidence.kafka.encryptionAtRest, "kafka.encryptionAtRest")
  requiredTrue(evidence.kafka.privateEndpoints, "kafka.privateEndpoints")
  requiredTrue(evidence.kafka.backupDrTested, "kafka.backupDrTested")
  distinctStrings(evidence.kafka.bootstrapServers, "kafka.bootstrapServers")
  assert.ok(evidence.kafka.bootstrapServers.length >= 3, "at least three Kafka bootstrap endpoints are required")

  assert.match(evidence.connect.imageDigest, DIGEST, "Connect must use an immutable image digest")
  requiredTrue(evidence.connect.postgresConnectorVerified, "connect.postgresConnectorVerified")
  requiredTrue(evidence.connect.outboxRouterVerified, "connect.outboxRouterVerified")
  requiredTrue(evidence.connect.acksAllVerified, "connect.acksAllVerified")
  requiredTrue(evidence.connect.idempotenceVerified, "connect.idempotenceVerified")
  assert.ok(evidence.connect.internalTopicReplicationFactor >= 3, "Connect internal topics require replication factor >= 3")

  requiredTrue(evidence.registry.privateEndpoint, "registry.privateEndpoint")
  requiredTrue(evidence.registry.tlsVerified, "registry.tlsVerified")
  requiredTrue(evidence.registry.jsonSchemaReferencesVerified, "registry.jsonSchemaReferencesVerified")
  requiredTrue(evidence.registry.backwardTransitiveVerified, "registry.backwardTransitiveVerified")

  requiredString(evidence.postgres.backupEvidenceId, "postgres.backupEvidenceId")
  requiredTrue(evidence.postgres.restoreVerified, "postgres.restoreVerified")
  assert.equal(evidence.postgres.walLevel, "logical", "PostgreSQL wal_level must be logical")
  assert.ok(evidence.postgres.maxSlotWalKeepSizeBytes > 0, "PostgreSQL slot WAL cap must be finite")
  requiredTrue(evidence.postgres.capacityApproved, "postgres.capacityApproved")

  requiredTrue(evidence.archive.immutable, "archive.immutable")
  requiredTrue(evidence.archive.offProviderCopy, "archive.offProviderCopy")
  assert.ok(evidence.archive.retentionDays >= 400, "immutable archive retention must be at least 400 days")
  requiredTrue(evidence.archive.watermarkAlertLive, "archive.watermarkAlertLive")

  for (const gate of [
    "connectorFailure", "slotWalBytes", "postgresFreeSpace", "underReplicatedPartitions",
    "consumerLag", "schemaRejections", "quarantineRate", "tenantProjectionParity",
  ]) requiredTrue(evidence.monitoring[gate], `monitoring.${gate}`)

  for (const gate of ["ordering", "duplicateHandling", "tenantIsolation", "effectFence", "archiveReconciliation"]) {
    requiredTrue(evidence.drill[gate], `drill.${gate}`)
  }
  requiredString(evidence.drill.evidenceId, "drill.evidenceId")

  const secretRefs = Object.values(evidence.secretReferences ?? {})
  assert.ok(secretRefs.length >= 4, "separate Kafka, Connect, Registry, and CDC secret references are required")
  distinctStrings(secretRefs, "secretReferences")
  for (const reference of secretRefs) {
    assert.match(reference, /^(vault|aws-secretsmanager|gcp-secretmanager|azure-keyvault):\/\//, "credentials must be secret-manager references")
  }

  return {
    ready: true,
    environment: evidence.environment,
    releaseSha: evidence.releaseSha,
    changeId: evidence.changeId,
    evidenceId: evidence.drill.evidenceId,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const value = (name) => {
    const index = args.indexOf(name)
    assert.ok(index >= 0 && args[index + 1], `${name} is required`)
    return args[index + 1]
  }
  const evidencePath = value("--evidence")
  const expectedEnvironment = value("--expected-environment")
  const expectedSha = value("--expected-sha")
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"))
  const result = validateActivationEvidence(evidence, { environment: expectedEnvironment, releaseSha: expectedSha })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Kafka activation blocked: ${error.message}\n`)
    process.exitCode = 1
  })
}
