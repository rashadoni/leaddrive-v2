import { validateFundShadowScope, type FundShadowScope } from "./fund-shadow-consumer"

export interface KafkaWorkerPlanExpected {
  readonly releaseSha: string
  readonly artifactSha256: string
  readonly environment: string
}

export interface FundShadowWorkerPlan {
  readonly apiVersion: "event-platform.leaddrive.io/v1"
  readonly kind: "FundShadowWorkerPlan"
  readonly releaseSha: string
  readonly artifactSha256: string
  readonly environment: string
  readonly broker: {
    readonly clusterId: string
    readonly groupId: string
    readonly topic: string
    readonly topicId: string
    readonly partitionCount: number
  }
  readonly limits: { readonly maxRecords: number; readonly maxDurationMs: number }
  readonly kafkaSecretReference: string
  readonly routes: readonly {
    readonly scope: Readonly<FundShadowScope>
    readonly databaseSecretReference: string
  }[]
}

/** No input values, parser exceptions or secret references enter this error. */
export class KafkaWorkerPlanError extends Error {
  readonly code = "KAFKA_WORKER_PLAN_INVALID"
  constructor() {
    super("KAFKA_WORKER_PLAN_INVALID")
    this.name = "KafkaWorkerPlanError"
  }
}

const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const ENVIRONMENT = /^[a-z][a-z0-9]{0,31}$/
const CLUSTER_ID = /^[A-Za-z0-9_-]{1,249}$/
const CONTROL = /[\u0000-\u001f\u007f]/
// Kafka Uuid.toString(), NOT the RFC 4122 UUID used by projection build IDs.
const TOPIC_ID = /^[A-Za-z0-9_-]{21}[AQgw]$/
const SCOPE_FIELDS = ["organizationId", "buildId", "buildKey", "projectionVersion", "codeSha", "environment", "expectedWorkerRole"] as const

function requireCondition(condition: unknown): asserts condition {
  if (!condition) throw new KafkaWorkerPlanError()
}

/** Accept JSON-shaped data only. Do not invoke accessors or copy prototypes. */
function record<const T extends readonly string[]>(raw: unknown, fields: T): Record<T[number], unknown> {
  requireCondition(typeof raw === "object" && raw !== null && !Array.isArray(raw))
  const prototype = Object.getPrototypeOf(raw)
  requireCondition(prototype === Object.prototype || prototype === null)
  const keys = Reflect.ownKeys(raw)
  requireCondition(keys.length === fields.length && keys.every(key => typeof key === "string" && fields.includes(key)))
  const result = Object.create(null) as Record<T[number], unknown>
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, field)
    requireCondition(descriptor && "value" in descriptor && descriptor.enumerable)
    result[field as T[number]] = descriptor.value
  }
  return result
}

function routeValues(raw: unknown): unknown[] {
  requireCondition(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype)
  const length = Object.getOwnPropertyDescriptor(raw, "length")?.value
  requireCondition(Number.isSafeInteger(length) && length >= 1 && length <= 1000)
  requireCondition(Reflect.ownKeys(raw).length === length + 1)
  const values: unknown[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index))
    requireCondition(descriptor && "value" in descriptor && descriptor.enumerable)
    values.push(descriptor.value)
  }
  return values
}

function text(raw: unknown, pattern: RegExp): string {
  requireCondition(typeof raw === "string" && !CONTROL.test(raw) && pattern.test(raw))
  return raw
}

function integer(raw: unknown, max: number): number {
  requireCondition(typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 1 && raw <= max)
  return raw
}

function secretReference(raw: unknown): string {
  requireCondition(typeof raw === "string" && raw.length <= 1024 && !CONTROL.test(raw))
  // Same manager authority as activation-preflight.mjs, restricted to an opaque
  // unambiguous reference: no userinfo, query, fragment, escaping or file route.
  const match = /^(vault|aws-secretsmanager|gcp-secretmanager|azure-keyvault):\/\/([A-Za-z0-9][A-Za-z0-9_.:/-]*)$/.exec(raw)
  requireCondition(match)
  requireCondition(match[2].split("/").every(segment => segment !== "" && segment !== "." && segment !== ".."))
  return raw
}

/**
 * OFFLINE shape/pin validation only; this is not activation authority or live
 * infrastructure evidence. The caller supplies independently trusted expected
 * pins and must separately verify artifact bytes/provenance and resolve secret
 * references through the existing secret-manager authority. No file, env, DB
 * or credential fallback is provided here.
 *
 * Existing bridge metadata checks and SQL role/build checks remain mandatory.
 * A restart preserves the explicitly provisioned group/suffix; a rebuild needs
 * a separately provisioned new group/build. This parser never creates either,
 * seeds/resets offsets, grants approval, promotes a projection or retries work.
 */
export function validateKafkaWorkerPlan(raw: unknown, expected: KafkaWorkerPlanExpected): Readonly<FundShadowWorkerPlan> {
  try {
    const pins = record(expected, ["releaseSha", "artifactSha256", "environment"] as const)
    const releaseSha = text(pins.releaseSha, SHA)
    const artifactSha256 = text(pins.artifactSha256, DIGEST)
    const environment = text(pins.environment, ENVIRONMENT)
    const input = record(raw, ["apiVersion", "kind", "releaseSha", "artifactSha256", "environment", "broker", "limits", "kafkaSecretReference", "routes"] as const)
    requireCondition(input.apiVersion === "event-platform.leaddrive.io/v1" && input.kind === "FundShadowWorkerPlan")
    requireCondition(input.releaseSha === releaseSha && input.artifactSha256 === artifactSha256 && input.environment === environment)
    const brokerInput = record(input.broker, ["clusterId", "groupId", "topic", "topicId", "partitionCount"] as const)
    const clusterId = text(brokerInput.clusterId, CLUSTER_ID)
    const topicId = text(brokerInput.topicId, TOPIC_ID)
    requireCondition(topicId !== "AAAAAAAAAAAAAAAAAAAAAA")
    const topic = `ld.${environment}.finance.events.v1`
    requireCondition(brokerInput.topic === topic)
    const partitionCount = integer(brokerInput.partitionCount, 128)
    const limitInput = record(input.limits, ["maxRecords", "maxDurationMs"] as const)
    const limits = Object.freeze({ maxRecords: integer(limitInput.maxRecords, 100000), maxDurationMs: integer(limitInput.maxDurationMs, 600000) })
    const kafkaSecretReference = secretReference(input.kafkaSecretReference)
    const organizations = new Set<string>(), roles = new Set<string>(), builds = new Set<string>()
    const references = new Set([kafkaSecretReference])
    let projectionVersion: number | undefined
    const routes = Object.freeze(routeValues(input.routes).map(value => {
      const route = record(value, ["scope", "databaseSecretReference"] as const)
      const scopeInput = record(route.scope, SCOPE_FIELDS)
      requireCondition(SCOPE_FIELDS.every(field => typeof scopeInput[field] !== "string" || !CONTROL.test(scopeInput[field])))
      // Share the consumer's actual pure scope validation; do not fork its rules.
      const scope = validateFundShadowScope(scopeInput as unknown as FundShadowScope)
      requireCondition(scope.environment === environment && scope.codeSha === releaseSha)
      requireCondition(projectionVersion === undefined || scope.projectionVersion === projectionVersion)
      projectionVersion = scope.projectionVersion
      const buildId = scope.buildId.toLowerCase()
      requireCondition(!organizations.has(scope.organizationId) && !roles.has(scope.expectedWorkerRole) && !builds.has(buildId))
      organizations.add(scope.organizationId); roles.add(scope.expectedWorkerRole); builds.add(buildId)
      const databaseSecretReference = secretReference(route.databaseSecretReference)
      requireCondition(!references.has(databaseSecretReference))
      references.add(databaseSecretReference)
      return Object.freeze({ scope, databaseSecretReference })
    }))
    const groupId = text(brokerInput.groupId, new RegExp(`^ld\\.${environment}\\.finance\\.fund-shadow\\.v${projectionVersion}\\.[a-z][a-z0-9-]{0,62}$`))
    const broker = Object.freeze({ clusterId, groupId, topic, topicId, partitionCount })
    return Object.freeze({ apiVersion: "event-platform.leaddrive.io/v1", kind: "FundShadowWorkerPlan", releaseSha, artifactSha256,
      environment, broker, limits, kafkaSecretReference, routes })
  } catch {
    // Includes hostile/proxy shape failures and shared scope validator errors;
    // never attach the original exception as cause or interpolate input values.
    throw new KafkaWorkerPlanError()
  }
}
