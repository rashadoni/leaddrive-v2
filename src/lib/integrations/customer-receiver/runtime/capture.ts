import { createHash, randomUUID } from "node:crypto"
import { canonicalJson } from "../../../event-platform/canonical-json"
import { appendDomainEvent, type EventPlatformTransaction } from "../../../event-platform/append"
import { enqueueEffect, type EventExecutionMode } from "../../../event-platform/effects"
import { identifier } from "../contract"
import type { BuilderField, BuilderResource } from "../constructor/catalog"
import { BuilderEvaluationError, previewBuilderResource } from "../constructor/engine"
import type { BuilderProfile } from "../constructor/profile"
import { loadBuilderSnapshot, type BuilderSourceReader } from "../constructor/source"
import { BUILDER_CHANNEL_TYPE, publicBuilderDraft, type BuilderRow } from "../constructor/store"
import { captureAllowed, receiverDestination, type RuntimeBinding, type RuntimeSwitches } from "./binding"
import { sealReceiverBody, storeReceiverPayload } from "./payload-store"
import { recordRuntimeSecurityEvent } from "./security-log"
import { pinUtc, type ReceiverSqlTransaction } from "./sql"

export const RECEIVER_RUNTIME_EFFECT_TYPE = "customer_receiver.mapped_submit.v1"
const EVENT_TYPE = "integration.customer-receiver.captured.v1"
const DATA_SCHEMA = "urn:leaddrive:schema:integration.customer-receiver.captured:v1"

export type CaptureTransaction = ReceiverSqlTransaction & EventPlatformTransaction & {
  effectOutbox: { create(args: Record<string, unknown>): Promise<Record<string, unknown>> }
}

/** Frozen request metadata. Stored in the immutable effect ledger; no business values. */
export interface ReceiverEffectMetadata {
  schema: "customer-receiver.effect.v1"
  integrationId: string
  environment: "TEST" | "PROD"
  resource: BuilderResource
  externalId: string
  eventId: string
  entityVersion: number
  occurredAt: string
  trigger: "change" | "operator"
  correlationId: string
  profile: { draftId: string; revision: number; sha256: string }
  catalogueSha256: string
  request: { method: "PUT" | "POST"; path: string; bodySha256: string; bodyBytes: number; idempotencyKey: string }
  receipt: BuilderProfile["receipt"]
  limits: { connectTimeoutSeconds: number; timeoutSeconds: number; maxBodyKiB: number; requestsPerSecond: number; concurrency: number }
  dependsOn: { resource: "customers"; externalId: string; minimumVersion: number } | null
}

export type CaptureResult =
  | { status: "disabled" | "fenced" }
  | { status: "profile_not_approved" | "not_selected" | "invalid"; code: string }
  | { status: "queued"; effectId: string; eventId: string; entityVersion: number }

const aggregateType = (resource: BuilderResource) => resource === "customers" ? "receiver-customer" : resource === "contacts" ? "receiver-contact" : "receiver-deal"
const aggregateId = (binding: RuntimeBinding, externalId: string) => `${binding.integrationId}/${binding.environment}/${externalId}`

export function catalogueFingerprint(catalogue: readonly BuilderField[]) {
  return createHash("sha256").update(canonicalJson(catalogue.map((entry) => [entry.key, entry.entity, entry.kind]).sort())).digest("hex")
}

/**
 * The approved revision, located in the current draft or its history and
 * verified by hash. Editing the draft after approval does not change what is
 * captured; a missing/mismatched revision stops capture instead.
 */
export async function loadApprovedProfile(tx: ReceiverSqlTransaction, binding: RuntimeBinding): Promise<BuilderProfile | null> {
  const rows = await tx.$queryRawUnsafe<BuilderRow[]>(
    `SELECT "id", "organizationId", "channelType", "isActive", "settings", "updatedAt" FROM "channel_configs"
      WHERE "id" = $1 AND "organizationId" = $2 AND "channelType" = $3 AND "isActive" = false`,
    binding.profile.draftId, binding.organizationId, BUILDER_CHANNEL_TYPE,
  )
  if (!rows[0]) return null
  let draft
  try { draft = publicBuilderDraft(rows[0], binding.organizationId) } catch { return null }
  const candidate = draft.revision === binding.profile.revision ? draft.profile : draft.history.find((entry) => entry.revision === binding.profile.revision)?.profile
  if (!candidate) return null
  const sha256 = createHash("sha256").update(canonicalJson(candidate)).digest("hex")
  return sha256 === binding.profile.sha256 && candidate.environment === binding.environment ? candidate : null
}

/**
 * Call INSIDE the tenant transaction that performs the CRM mutation, after the
 * mutation. Version allocation (DomainEvent + EventOutbox), the immutable
 * effect pointer, the encrypted payload and the security record commit or roll
 * back together with that mutation. Nothing here performs network I/O.
 *
 * `trigger: "change"` captures only resources whose builder selection is `all`
 * or `filtered` under an `on_change` schedule; `manual` resources are queued
 * only by an explicit operator trigger.
 */
export async function captureReceiverChange(tx: CaptureTransaction, input: {
  binding: RuntimeBinding
  switches: RuntimeSwitches
  mode: EventExecutionMode
  trigger: "change" | "operator"
  resource: BuilderResource
  recordId: string
  actor: { type: "user" | "service"; id: string }
  correlationId: string
  instanceId: string
  reader: BuilderSourceReader
  catalogue: readonly BuilderField[]
  producerVersion: string
}): Promise<CaptureResult> {
  const { binding } = input
  if (!captureAllowed(binding, input.switches)) return { status: "disabled" }
  if (input.mode !== "live") return { status: "fenced" }
  const externalId = identifier(input.recordId)
  const correlationId = identifier(input.correlationId)
  const log = (action: "submission_queued" | "submission_skipped", outcome: "success" | "failure", eventId: string | null) => recordRuntimeSecurityEvent(tx, {
    organizationId: binding.organizationId, environment: binding.environment, instanceId: input.instanceId,
    category: "integration", action, outcome, severity: outcome === "success" ? "info" : "medium",
    actor: input.actor, target: { type: input.resource, id: externalId }, correlationId, integrationEventId: eventId,
    retentionDays: binding.securityLogRetentionDays,
  })

  // appendDomainEvent binds lastEventAt through a session-zone timestamp cast
  // while occurredAt is written as UTC; under a non-UTC session the stream
  // coherence trigger rejects the append. Pin UTC for this transaction (also
  // makes CURRENT_TIMESTAMP defaults agree with Prisma's naive-UTC columns).
  await pinUtc(tx)
  const profile = await loadApprovedProfile(tx, binding)
  if (!profile) { await log("submission_skipped", "failure", null); return { status: "profile_not_approved", code: "approved_revision_unavailable" } }
  const config = profile.resources.find((entry) => entry.resource === input.resource)
  if (!config || !config.enabled) return { status: "not_selected", code: "resource_disabled" }
  if (input.trigger === "change" && (config.selection.mode === "manual" || profile.schedule.mode !== "on_change")) return { status: "not_selected", code: "not_on_change" }

  // JavaScript-level failures below (missing source, invalid value, missing
  // encryption key) are reported as a skipped submission and leave the CRM
  // mutation intact. A database error, by contrast, aborts the whole tenant
  // transaction: the mutation and its queue entry never diverge.
  let snapshot
  try {
    snapshot = await loadBuilderSnapshot({ reader: input.reader, organizationId: binding.organizationId, resource: input.resource, externalId, catalogue: input.catalogue })
    sealReceiverBody(binding.organizationId, "{}")
  } catch (error) {
    await log("submission_skipped", "failure", null)
    return { status: "invalid", code: error instanceof BuilderEvaluationError ? error.code : "source_or_key_unavailable" }
  }
  const customerExternalId = input.resource === "customers" ? undefined : String(snapshot.entities.company?.fields.id ?? "")
  const occurredAt = new Date().toISOString()
  const evaluate = (eventId: string, entityVersion: number) => previewBuilderResource({
    profile, resource: input.resource, snapshot, catalogue: input.catalogue,
    context: { organizationId: binding.organizationId, integrationId: binding.integrationId, eventId, externalId, entityVersion, occurredAt, ...(customerExternalId ? { customerExternalId } : {}) },
  })
  // Validate and select BEFORE allocating a version: a rejected or unselected
  // record leaves no event, no effect and no payload behind.
  try {
    const provisional = evaluate(randomUUID(), 1)
    if (!provisional.selected) return { status: "not_selected", code: provisional.selection }
  } catch (error) {
    await log("submission_skipped", "failure", null)
    return { status: "invalid", code: error instanceof BuilderEvaluationError ? error.code : "invalid_record" }
  }

  let dependsOn: ReceiverEffectMetadata["dependsOn"] = null
  if (customerExternalId) {
    const heads = await tx.$queryRawUnsafe<{ currentVersion: bigint }[]>(
      `SELECT "currentVersion" FROM "event_aggregate_heads" WHERE "organizationId" = $1 AND "aggregateType" = $2 AND "aggregateId" = $3`,
      binding.organizationId, aggregateType("customers"), aggregateId(binding, customerExternalId),
    )
    dependsOn = { resource: "customers", externalId: identifier(customerExternalId), minimumVersion: heads[0] ? Number(heads[0].currentVersion) : 1 }
  }

  const eventId = randomUUID()
  const appended = await appendDomainEvent(tx, {
    organizationId: binding.organizationId, domain: "integration", aggregateType: aggregateType(input.resource),
    aggregateId: aggregateId(binding, externalId), eventId, eventType: EVENT_TYPE, dataSchema: DATA_SCHEMA,
    source: "urn:leaddrive:integration:customer-receiver", classification: "internal", correlationId,
    producer: "customer-receiver-capture", producerVersion: input.producerVersion, occurredAt: new Date(occurredAt),
    data: { integrationId: binding.integrationId, environment: binding.environment, resource: input.resource, externalId, profileRevision: binding.profile.revision },
  })
  const entityVersion = Number(appended.aggregateVersion)
  const prepared = evaluate(eventId, entityVersion)
  if (!prepared.selected) throw new BuilderEvaluationError("selection_changed")
  const sealed = sealReceiverBody(binding.organizationId, prepared.body)
  const metadata: ReceiverEffectMetadata = {
    schema: "customer-receiver.effect.v1", integrationId: binding.integrationId, environment: binding.environment,
    resource: input.resource, externalId, eventId, entityVersion, occurredAt, trigger: input.trigger, correlationId,
    profile: binding.profile, catalogueSha256: catalogueFingerprint(input.catalogue),
    request: { method: prepared.method, path: prepared.path, bodySha256: sealed.bodySha256, bodyBytes: sealed.bodyBytes, idempotencyKey: prepared.idempotencyKey },
    receipt: profile.receipt,
    limits: { connectTimeoutSeconds: profile.limits.connectTimeoutSeconds, timeoutSeconds: profile.limits.timeoutSeconds, maxBodyKiB: profile.limits.maxBodyKiB, requestsPerSecond: profile.limits.requestsPerSecond, concurrency: profile.limits.concurrency },
    dependsOn,
  }
  const effect = await enqueueEffect(tx, {
    organizationId: binding.organizationId, sourceEventId: eventId, effectType: RECEIVER_RUNTIME_EFFECT_TYPE,
    effectKey: prepared.idempotencyKey, destination: receiverDestination(binding), mode: input.mode,
    payload: metadata as unknown as Record<string, unknown>,
  })
  const effectId = String(effect.id)
  await storeReceiverPayload(tx, { organizationId: binding.organizationId, effectId, integrationId: binding.integrationId, environment: binding.environment, sealed, ttlHours: binding.payloadTtlHours })
  await log("submission_queued", "success", eventId)
  return { status: "queued", effectId, eventId, entityVersion }
}
