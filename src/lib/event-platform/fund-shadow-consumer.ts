import { TextDecoder } from "node:util"
import { consumeIdempotently, validateKafkaEventRecord, type IncomingEventPosition, type KafkaEventRecord } from "./consumer"
import type { DomainEventEnvelope } from "./envelope"
import { assertEventContract, FUND_EVENT_CONTRACTS } from "./fund-contracts"
import { reduceFundBalance, type FundBalanceState } from "./fund-balance-reducer"

/** Trusted provisioning/configuration, never copied from message headers. */
export interface FundShadowScope {
  readonly organizationId: string
  readonly buildId: string
  readonly buildKey: string
  readonly projectionVersion: number
  readonly codeSha: string
  readonly environment: string
  readonly expectedWorkerRole: string
}

export interface FundShadowTransaction {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

/**
 * Must be a REAL interactive transaction factory: resolve only AFTER COMMIT,
 * reject and roll back on any callback/COMMIT error. A plain callback wrapper
 * does not satisfy this contract. There is deliberately no public in-tx entry.
 */
export interface FundShadowDatabase {
  $transaction<T>(work: (tx: FundShadowTransaction) => Promise<T>, options: {
    isolationLevel: "Serializable"
    maxWait: number
    timeout: number
  }): Promise<T>
}

export interface FundShadowResult {
  readonly duplicate: boolean
  /** Current shadow state, NOT the historical result stored in the inbox. */
  readonly state: FundBalanceState
  readonly checkpointAdvanced: boolean
  readonly checkpoint: { readonly sourceOffset: bigint; readonly lastEventId: string }
}

export class FundShadowIntegrityError extends Error {
  readonly code = "FUND_SHADOW_INTEGRITY_INVALID"
  constructor(message: string) {
    super(message)
    this.name = "FundShadowIntegrityError"
  }
}

const PROJECTION = "finance.fund-balance"
const CONSUMER_VERSION = 1
const IDENTIFIER = /^[^\s:\u0000-\u001f\u007f]{1,191}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OFFSET = /^(0|[1-9][0-9]*)$/
const MAX_OFFSET = BigInt("9223372036854775807")
const UTC_TIME = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new FundShadowIntegrityError(message)
}

function uuidEqual(left: unknown, right: string): boolean {
  return typeof left === "string" && UUID.test(left) && left.toLowerCase() === right.toLowerCase()
}

function offset(value: unknown): bigint {
  requireCondition(typeof value === "string" && OFFSET.test(value), "Invalid database/broker offset")
  const result = BigInt(value)
  requireCondition(result <= MAX_OFFSET, "Offset exceeds PostgreSQL BIGINT")
  return result
}

function validTime(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_TIME.test(value)) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10)
}

function utf8(value: unknown, label: string): string {
  requireCondition(typeof value === "string" || Buffer.isBuffer(value), `${label} must be a single UTF-8 value`)
  // Fatal decoding rejects replacement-character recovery; keep BOM so JSON
  // parsing cannot silently strip a different byte sequence.
  if (Buffer.isBuffer(value)) return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value)
  requireCondition(Buffer.from(value, "utf8").toString("utf8") === value, `${label} contains an unpaired surrogate`)
  return value
}

function snapshotScope(input: FundShadowScope): Readonly<FundShadowScope> {
  const scope = Object.freeze({ ...input })
  requireCondition(typeof scope.organizationId === "string" && IDENTIFIER.test(scope.organizationId), "Invalid configured tenant")
  requireCondition(typeof scope.buildId === "string" && UUID.test(scope.buildId), "Invalid configured build ID")
  requireCondition(typeof scope.buildKey === "string" && IDENTIFIER.test(scope.buildKey), "Invalid configured build key")
  requireCondition(Number.isInteger(scope.projectionVersion) && scope.projectionVersion >= 2 && scope.projectionVersion <= 2147483647, "Shadow version must be at least 2")
  requireCondition(typeof scope.codeSha === "string" && /^[0-9a-f]{40}$/.test(scope.codeSha), "Invalid configured code SHA")
  requireCondition(typeof scope.environment === "string" && /^[a-z][a-z0-9]*$/.test(scope.environment), "Invalid configured environment")
  requireCondition(typeof scope.expectedWorkerRole === "string" && /^[a-z_][a-z0-9_]{0,62}$/.test(scope.expectedWorkerRole), "Invalid configured worker role")
  return scope
}

function validatedRecord(record: KafkaEventRecord, scope: FundShadowScope) {
  const rawEnvelope = utf8(record.value, "Kafka value")
  const key = utf8(record.key, "Kafka key")
  const headers = Object.fromEntries(["id", "eventtype", "organizationid", "payloadhash"].map(name => [name, utf8(record.headers?.[name], `Kafka header ${name}`)]))
  requireCondition(record.topic === `ld.${scope.environment}.finance.events.v1`, "Record is outside the exact finance topic")
  requireCondition(Number.isInteger(record.partition) && record.partition >= 0 && record.partition <= 2147483647, "Invalid Kafka partition")
  offset(record.offset)
  const validated = validateKafkaEventRecord({ ...record, key, value: rawEnvelope, headers }, scope.environment)
  const event = validated.envelope
  requireCondition(event.organizationid === scope.organizationId, "Record is outside the configured tenant")
  requireCondition(UUID.test(event.id) && headers.id === event.id, "Scalar id header must equal the event UUID")
  requireCondition(IDENTIFIER.test(event.aggregateid) && validTime(event.time), "Invalid Fund identity/event time")
  requireCondition(Object.hasOwn(FUND_EVENT_CONTRACTS, event.type), "Unsupported Fund event type")
  for (const field of ["source", "correlationid", "producer", "producerversion"] as const) {
    requireCondition(typeof event[field] === "string" && event[field].length > 0, `Missing event ${field}`)
  }
  assertEventContract({ domain: "finance", aggregateType: event.aggregatetype, aggregateId: event.aggregateid,
    eventType: event.type, dataSchema: event.dataschema, classification: event.classification, data: event.data })
  return { ...validated, rawEnvelope, key }
}

interface BuildRow {
  id: string; organizationId: string; projectionName: string; projectionVersion: number; buildKey: string; codeSha: string
  mode: string; status: string; effectsFenced: boolean; replayFrom: unknown; replayTo: unknown
}
interface InboxRow extends Omit<IncomingEventPosition, "sourceOffset"> { sourceOffset: string; result: unknown }
interface CheckpointRow { sourceOffset: string; lastEventId: string | null }
interface ShadowRow {
  organizationId: string; fundId: string; projectionVersion: number; buildKey: string; status: string; promotedAt: unknown
  balance: string; currency: string; aggregateVersion: string; lastEventId: string | null; evidence: Record<string, unknown>
}

function checkInbox(row: InboxRow, event: IncomingEventPosition): void {
  requireCondition(row.organizationId === event.organizationId && row.consumerName === event.consumerName && row.consumerVersion === event.consumerVersion
    && uuidEqual(row.eventId, event.eventId) && row.eventType === event.eventType && row.payloadHash === event.payloadHash
    && row.sourceTopic === event.sourceTopic && row.sourcePartition === event.sourcePartition, "Inbox identity/hash/partition conflict")
  requireCondition(offset(row.sourceOffset) <= event.sourceOffset, "Delivery precedes its original inbox position")
}

function shadowState(row: ShadowRow, scope: FundShadowScope, event: IncomingEventPosition, fundId: string): FundBalanceState {
  const evidence = row.evidence
  requireCondition(row.organizationId === scope.organizationId && row.fundId === fundId && row.projectionVersion === scope.projectionVersion
    && row.buildKey === scope.buildKey && row.status === "shadow" && row.promotedAt === null, "Existing row is not this untouched shadow build")
  requireCondition(evidence && !Array.isArray(evidence) && evidence.adapterVersion === 1 && uuidEqual(evidence.buildId, scope.buildId)
    && evidence.codeSha === scope.codeSha && evidence.sourceTopic === event.sourceTopic && evidence.sourcePartition === event.sourcePartition,
  "Shadow evidence build/source binding mismatch")
  offset(evidence.lastSourceOffset)
  requireCondition(typeof row.aggregateVersion === "string" && OFFSET.test(row.aggregateVersion), "Invalid shadow aggregate version")
  const version = Number(row.aggregateVersion)
  requireCondition(Number.isSafeInteger(version) && version >= 1 && typeof row.lastEventId === "string" && UUID.test(row.lastEventId)
    && uuidEqual(evidence.lastEventId, row.lastEventId) && validTime(evidence.lastEventAt), "Invalid shadow event evidence")
  requireCondition(typeof row.balance === "string" && /^(?:0|[1-9][0-9]{0,13})\.[0-9]{4}$/.test(row.balance)
    && typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency), "Invalid persisted exact balance/currency")
  return Object.freeze({ organizationId: row.organizationId, fundId, balance: row.balance, currency: row.currency,
    aggregateVersion: version, lastEventId: row.lastEventId, lastEventAt: evidence.lastEventAt })
}

/**
 * INACTIVE / WIP: no broker, acknowledgement, activation, effects or v1 writes.
 *
 * External provisioning is REQUIRED: independent tenant authorization, a
 * non-owner restricted login, least-privilege shadow/inbox/checkpoint grants,
 * SELECT on immutable outbox plus active v1/funds/aggregate heads (the deferred
 * coherence trigger reads them), and the reviewed immutable-createdAt column
 * UPDATE privilege needed by build FOR UPDATE. This function grants nothing;
 * a caller-controlled app.org_id GUC is NOT an authorization boundary.
 *
 * The factory must commit atomically before resolving. PostgreSQL/role/locking
 * and rollback semantics need the real-PG gate; mocks do not establish them.
 * Serializable failures are returned to the future broker, not auto-retried.
 *
 * PG-jsonb verifies the FULL raw envelope against the origin hash AND immutable
 * outbox. It does NOT authenticate broker offsets, generation or assignment.
 * The future trusted broker adapter must serialize partition delivery, manage
 * assignment fencing/global contiguous high-water across tenants/builds, and
 * never acknowledge gaps merely because this tenant-local call succeeded.
 * The inbox records the FIRST position only, not every duplicate's position;
 * older duplicates can be checked against that position and current occupied
 * offsets, but this is not a complete immutable history of duplicate offsets.
 */
export async function consumeFundShadowRecord(
  database: FundShadowDatabase, configuredScope: FundShadowScope, record: KafkaEventRecord,
): Promise<FundShadowResult> {
  const scope = snapshotScope(configuredScope)
  const validated = validatedRecord(record, scope)
  const envelope: DomainEventEnvelope = validated.envelope
  const position: IncomingEventPosition = { ...validated.position,
    consumerName: `fund-shadow:${scope.buildId.toLowerCase()}`, consumerVersion: CONSUMER_VERSION }

  return database.$transaction(async tx => {
    const roles = await tx.$queryRawUnsafe<Array<{ currentRole: string; sessionRole: string; restricted: boolean }>>(`/* fund-shadow:role */
      SELECT current_user::text AS "currentRole", session_user::text AS "sessionRole",
        NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) AS restricted
      FROM pg_catalog.pg_roles WHERE rolname = current_user`)
    requireCondition(roles.length === 1 && roles[0].currentRole === scope.expectedWorkerRole && roles[0].sessionRole === scope.expectedWorkerRole
      && roles[0].restricted === true, "Expected restricted login role is required; SET ROLE is insufficient")
    await tx.$queryRawUnsafe(`/* fund-shadow:tenant */ SELECT pg_catalog.set_config('app.org_id', $1, true),
      pg_catalog.set_config('lock_timeout', '5s', true), pg_catalog.set_config('statement_timeout', '10s', true)`, scope.organizationId)

    const builds = await tx.$queryRawUnsafe<BuildRow[]>(`/* fund-shadow:build */
      SELECT id::text, "organizationId", "projectionName", "projectionVersion", "buildKey", "codeSha", mode, status,
        "effectsFenced", "replayFrom", "replayTo"
      FROM public.projection_builds WHERE "organizationId" = $1 AND id = $2::uuid FOR UPDATE`, scope.organizationId, scope.buildId)
    const build = builds[0]
    requireCondition(builds.length === 1 && uuidEqual(build.id, scope.buildId) && build.organizationId === scope.organizationId
      && build.projectionName === PROJECTION && build.projectionVersion === scope.projectionVersion && build.buildKey === scope.buildKey
      && build.codeSha === scope.codeSha && build.mode === "shadow" && build.status === "running" && build.effectsFenced === true,
    "Build identity/lifecycle/effect fence mismatch")
    // This first adapter folds a complete history, not a timestamp-sliced replay.
    requireCondition(build.replayFrom === null && build.replayTo === null, "Ranged builds are not supported by the full-history shadow adapter")

    const sources = await tx.$queryRawUnsafe<Array<{ payloadHash: string; incomingHash: string; sourceHash: string; exactEnvelope: boolean;
      parsedEnvelope: boolean; eventType: string; topic: string; partitionKey: string }>>(`/* fund-shadow:source */
      SELECT "payloadHash", public.event_platform_jsonb_sha256($1::jsonb) AS "incomingHash",
        public.event_platform_jsonb_sha256(envelope) AS "sourceHash", envelope = $1::jsonb AS "exactEnvelope",
        $1::jsonb = $2::jsonb AS "parsedEnvelope", "eventType", topic, "partitionKey"
      FROM public.event_outbox WHERE "organizationId" = $3 AND "eventId" = $4::uuid`,
    validated.rawEnvelope, JSON.stringify(envelope), scope.organizationId, envelope.id)
    const source = sources[0]
    requireCondition(sources.length === 1 && source.payloadHash === position.payloadHash && source.incomingHash === position.payloadHash
      && source.sourceHash === position.payloadHash && source.exactEnvelope === true && source.parsedEnvelope === true
      && source.eventType === envelope.type && source.topic === "leaddrive.domain.finance.v1" && source.partitionKey === validated.key,
    "Full-envelope PostgreSQL hash/source/parsing fidelity mismatch")

    const inboxColumns = `"organizationId", "consumerName", "consumerVersion", "eventId"::text, "eventType", "payloadHash",
      "sourceTopic", "sourcePartition", "sourceOffset"::text, result`
    const receipts = await tx.$queryRawUnsafe<InboxRow[]>(`/* fund-shadow:inbox */ SELECT ${inboxColumns}
      FROM public.consumer_inbox WHERE "organizationId" = $1 AND "consumerName" = $2 AND "consumerVersion" = $3 AND "eventId" = $4::uuid`,
    scope.organizationId, position.consumerName, CONSUMER_VERSION, envelope.id)
    const occupied = await tx.$queryRawUnsafe<InboxRow[]>(`/* fund-shadow:occupied */ SELECT ${inboxColumns}
      FROM public.consumer_inbox WHERE "consumerName" = $1 AND "consumerVersion" = $2 AND "sourceTopic" = $3
        AND "sourcePartition" = $4 AND "sourceOffset" = $5::bigint`,
    position.consumerName, CONSUMER_VERSION, position.sourceTopic, position.sourcePartition, position.sourceOffset.toString())
    requireCondition(receipts.length <= 1 && occupied.length <= 1, "Ambiguous inbox identity/position")
    const receipt = receipts[0] ?? null
    if (receipt) checkInbox(receipt, position)
    if (occupied[0]) {
      checkInbox(occupied[0], position)
      requireCondition(receipt !== null && offset(occupied[0].sourceOffset) === position.sourceOffset, "Position has no matching event receipt")
    }

    const checkpoints = await tx.$queryRawUnsafe<CheckpointRow[]>(`/* fund-shadow:checkpoint */
      SELECT "sourceOffset"::text, "lastEventId"::text FROM public.projection_checkpoints
      WHERE "organizationId" = $1 AND "buildId" = $2::uuid AND "sourceTopic" = $3 AND "sourcePartition" = $4`,
    scope.organizationId, scope.buildId, position.sourceTopic, position.sourcePartition)
    requireCondition(checkpoints.length <= 1, "Ambiguous checkpoint")
    const checkpoint = checkpoints[0] ?? null
    const priorOffset = checkpoint ? offset(checkpoint.sourceOffset) : null
    if (checkpoint) requireCondition(typeof checkpoint.lastEventId === "string" && UUID.test(checkpoint.lastEventId), "Checkpoint has no valid event identity")
    if (receipt) {
      requireCondition(priorOffset !== null && priorOffset >= offset(receipt.sourceOffset), "Inbox receipt is ahead of its checkpoint")
      if (priorOffset === position.sourceOffset) requireCondition(uuidEqual(checkpoint?.lastEventId, envelope.id), "Checkpoint position belongs to another event")
    } else {
      requireCondition(priorOffset === null || position.sourceOffset > priorOffset, "Unknown event at an already passed offset")
    }

    const shadows = await tx.$queryRawUnsafe<ShadowRow[]>(`/* fund-shadow:shadow */
      SELECT "organizationId", "fundId", "projectionVersion", "buildKey", status, "promotedAt", balance::text, currency,
        "aggregateVersion"::text, "lastEventId"::text, evidence
      FROM public.fund_balance_projections WHERE "organizationId" = $1 AND "fundId" = $2 AND "projectionVersion" = $3 AND "buildKey" = $4 FOR UPDATE`,
    scope.organizationId, envelope.aggregateid, scope.projectionVersion, scope.buildKey)
    requireCondition(shadows.length <= 1, "Ambiguous shadow row")
    let currentState = shadows[0] ? shadowState(shadows[0], scope, position, envelope.aggregateid) : null
    if (shadows[0]) requireCondition(priorOffset !== null && offset(shadows[0].evidence.lastSourceOffset) <= priorOffset, "Shadow state is ahead of its checkpoint")
    if (receipt) requireCondition(currentState !== null && currentState.aggregateVersion >= envelope.aggregateversion
      && (currentState.aggregateVersion !== envelope.aggregateversion || uuidEqual(currentState.lastEventId, envelope.id)), "Duplicate receipt has no coherent current shadow")

    // Build row locking serializes this build's writers. The structural adapter
    // closes over this explicit tx only; no global/currentTx or nested factory.
    const consumed = await consumeIdempotently<FundBalanceState>({ consumerInbox: {
      findUnique: async () => receipt,
      create: async args => {
        const data = args.data as { result: unknown }
        const count = await tx.$executeRawUnsafe(`/* fund-shadow:insert-inbox */
          INSERT INTO public.consumer_inbox ("organizationId", "consumerName", "consumerVersion", "eventId", "eventType", "payloadHash",
            "sourceTopic", "sourcePartition", "sourceOffset", result)
          VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9::bigint, $10::jsonb)`,
        scope.organizationId, position.consumerName, CONSUMER_VERSION, envelope.id, envelope.type, position.payloadHash,
        position.sourceTopic, position.sourcePartition, position.sourceOffset.toString(), JSON.stringify(data.result))
        requireCondition(count === 1, "Inbox insert did not persist exactly one receipt")
        return count
      },
    } }, position, async () => {
      const previous = currentState
      const next = reduceFundBalance(previous, envelope)
      const evidence = JSON.stringify({ adapterVersion: 1, buildId: scope.buildId, codeSha: scope.codeSha,
        sourceTopic: position.sourceTopic, sourcePartition: position.sourcePartition, lastSourceOffset: position.sourceOffset.toString(),
        lastEventId: next.lastEventId, lastEventAt: next.lastEventAt })
      const count = previous
        ? await tx.$executeRawUnsafe(`/* fund-shadow:update-shadow */
          UPDATE public.fund_balance_projections SET balance = $5::numeric, currency = $6, "aggregateVersion" = $7::bigint,
            "lastEventId" = $8::uuid, evidence = $9::jsonb
          WHERE "organizationId" = $1 AND "fundId" = $2 AND "projectionVersion" = $3 AND "buildKey" = $4
            AND status = 'shadow' AND "promotedAt" IS NULL AND "aggregateVersion" = $10::bigint AND "lastEventId" = $11::uuid`,
        scope.organizationId, next.fundId, scope.projectionVersion, scope.buildKey, next.balance, next.currency, next.aggregateVersion.toString(),
        next.lastEventId, evidence, previous.aggregateVersion.toString(), previous.lastEventId)
        : await tx.$executeRawUnsafe(`/* fund-shadow:insert-shadow */
          INSERT INTO public.fund_balance_projections ("organizationId", "fundId", "projectionVersion", "buildKey", status,
            balance, currency, "aggregateVersion", "lastEventId", evidence)
          VALUES ($1, $2, $3, $4, 'shadow', $5::numeric, $6, $7::bigint, $8::uuid, $9::jsonb)`,
        scope.organizationId, next.fundId, scope.projectionVersion, scope.buildKey, next.balance, next.currency, next.aggregateVersion.toString(), next.lastEventId, evidence)
      requireCondition(count === 1, "Shadow write lost its expected state")
      currentState = next
      return next
    })

    // Deliberately OUTSIDE apply(): a duplicate at a newer broker offset must
    // advance the checkpoint in the same transaction, without applying again.
    const checkpointAdvanced = priorOffset === null || position.sourceOffset > priorOffset
    if (checkpointAdvanced) {
      const count = await tx.$executeRawUnsafe(`/* fund-shadow:write-checkpoint */
        INSERT INTO public.projection_checkpoints ("organizationId", "buildId", "sourceTopic", "sourcePartition", "sourceOffset", "lastEventId")
        VALUES ($1, $2::uuid, $3, $4, $5::bigint, $6::uuid)
        ON CONFLICT ("organizationId", "buildId", "sourceTopic", "sourcePartition") DO UPDATE
        SET "sourceOffset" = EXCLUDED."sourceOffset", "lastEventId" = EXCLUDED."lastEventId", "updatedAt" = CURRENT_TIMESTAMP
        WHERE public.projection_checkpoints."sourceOffset" < EXCLUDED."sourceOffset"`,
      scope.organizationId, scope.buildId, position.sourceTopic, position.sourcePartition, position.sourceOffset.toString(), envelope.id)
      requireCondition(count === 1, "Checkpoint did not advance atomically")
    }
    requireCondition(currentState !== null, "Shadow state was not produced")
    return Object.freeze({ duplicate: consumed.duplicate, state: currentState, checkpointAdvanced,
      checkpoint: Object.freeze(checkpointAdvanced
        ? { sourceOffset: position.sourceOffset, lastEventId: envelope.id }
        : { sourceOffset: priorOffset!, lastEventId: checkpoint!.lastEventId! }) })
  }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 })
}
