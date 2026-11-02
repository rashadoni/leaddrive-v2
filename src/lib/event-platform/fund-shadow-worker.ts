import { validateKafkaEventRecord } from "./consumer"
import { consumeFundShadowRecord, FundShadowIntegrityError, type FundShadowDatabase, type FundShadowScope } from "./fund-shadow-consumer"
import { createPartitionProcessor, type PartitionAssignment, type PartitionBroker } from "./partition-processor"

/** Trusted admission plan, built independently of Kafka headers. */
export interface FundShadowRoute {
  readonly scope: FundShadowScope
  readonly database: FundShadowDatabase
}

/**
 * INACTIVE partition coordinator. No connect/subscribe, credentials, live
 * effects, startup hook or projection promotion. The future broker driver
 * supplies membership-fenced commits and the complete partition stream.
 */
export function createFundShadowPartitionWorker(input: {
  assignment: PartitionAssignment
  environment: string
  routes: readonly FundShadowRoute[]
  broker: PartitionBroker
  maxBatchRecords?: number
  maxBatchBytes?: number
}) {
  const environment = input.environment
  if (!/^[a-z][a-z0-9]*$/.test(environment) || input.assignment.topic !== `ld.${environment}.finance.events.v1`) {
    throw new FundShadowIntegrityError("Worker requires the configured finance topic")
  }
  if (!Array.isArray(input.routes) || input.routes.length === 0 || input.routes.length > 1000) {
    throw new FundShadowIntegrityError("Worker requires a bounded tenant admission plan")
  }
  const routes = new Map<string, FundShadowRoute>()
  const roles = new Set<string>()
  const builds = new Set<string>()
  for (const route of input.routes) {
    const scope = Object.freeze({ ...route.scope })
    const build = scope.buildId.toLowerCase()
    if (!scope.organizationId || scope.environment !== environment || routes.has(scope.organizationId)
      || roles.has(scope.expectedWorkerRole) || builds.has(build)) {
      throw new FundShadowIntegrityError("Worker admission identities must be unique and environment-bound")
    }
    // Capture the factory now. The SQL adapter verifies the actual restricted
    // login/build/lifecycle and owns its transaction; do not nest transactions.
    const database: FundShadowDatabase = Object.freeze({ $transaction: route.database.$transaction.bind(route.database) })
    routes.set(scope.organizationId, Object.freeze({ scope, database }))
    roles.add(scope.expectedWorkerRole)
    builds.add(build)
  }
  return createPartitionProcessor({
    assignment: input.assignment,
    broker: input.broker,
    maxBatchRecords: input.maxBatchRecords,
    maxBatchBytes: input.maxBatchBytes,
    async applyCommitted(record) {
      const validated = validateKafkaEventRecord(record, environment)
      const route = routes.get(validated.envelope.organizationid)
      if (!route) throw new FundShadowIntegrityError("Tenant is outside the worker admission plan")
      // Never turn the tenant-local result.checkpoint into a broker cursor.
      await consumeFundShadowRecord(route.database, route.scope, record)
    },
  })
}
