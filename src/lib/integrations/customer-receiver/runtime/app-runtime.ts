import { readFile } from "node:fs/promises"
import { hostname } from "node:os"
import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { eventProducerVersion } from "@/lib/event-platform/append"
import { catalogueWithCustomFields, type BuilderResource } from "../constructor/catalog"
import { prismaBuilderSourceReader } from "../constructor/prisma-source"
import { requestReceiverJson } from "../transport"
import { captureAllowed, deliveryAllowed, kernelBinding, loadRuntimeBindings, runtimeSwitches } from "./binding"
import { captureReceiverChange, type CaptureResult, type CaptureTransaction } from "./capture"
import { purgeExpiredReceiverPayloads, purgeExpiredRuntimeSecurityEvents } from "./payload-store"
import { readRuntimeSecurityEvents, recordRuntimeSecurityEvent } from "./security-log"
import type { ReceiverDatabase } from "./sql"
import { runReceiverDelivery, type DeliverySummary, type ReceiverSender } from "./worker"

/** Tenant-scoped interactive transaction: runWithTenant sets app.org_id for FORCE RLS. */
export const receiverDatabase: ReceiverDatabase<CaptureTransaction> = {
  tenant: (organizationId, work) => runWithTenant(organizationId, () =>
    prisma.$transaction((tx: Prisma.TransactionClient) => work(tx as unknown as CaptureTransaction), { timeout: 45_000 })),
}

/**
 * Credentials are read server-side from the operator's secret files at send
 * time and passed straight to the transport. They are never logged, stored in
 * the database, the profile, attempt evidence or the security log.
 */
export const fileReceiverSender: ReceiverSender = async (request) => {
  const { binding } = request
  if (!binding.target || !binding.credentials) throw new Error("receiver_target_not_configured")
  const [accessToken, certificate, privateKey, ca] = await Promise.all([
    readFile(binding.credentials.accessTokenFile, "utf8"), readFile(binding.credentials.certificateFile),
    readFile(binding.credentials.privateKeyFile), readFile(binding.credentials.caFile),
  ])
  return requestReceiverJson({
    binding: kernelBinding(binding), organizationId: binding.organizationId,
    target: { integrationId: binding.integrationId, organizationId: binding.organizationId, environment: binding.environment, ...binding.target },
    credentials: { accessToken: accessToken.trim(), certificate, privateKey, ca }, correlationId: request.correlationId,
    prepared: { organizationId: binding.organizationId, integrationId: binding.integrationId, environment: binding.environment, selected: true, method: request.method, path: request.path, body: request.body, idempotencyKey: request.idempotencyKey, payloadHash: request.payloadHash },
    limits: request.limits,
  })
}

/**
 * Entry point for CRM write paths: call inside the SAME tenant transaction as
 * the mutation. Returns one result per configured binding of the organization;
 * with no binding file or switches it returns [] without touching the database.
 */
export async function captureCrmChangeForReceivers(tx: Prisma.TransactionClient, input: {
  organizationId: string; resource: BuilderResource; recordId: string
  actor: { type: "user" | "service"; id: string }; correlationId?: string; trigger?: "change" | "operator"
}): Promise<CaptureResult[]> {
  const switches = runtimeSwitches()
  if (!switches.capture) return []
  const bindings = loadRuntimeBindings().bindings.filter((binding) => binding.organizationId === input.organizationId && captureAllowed(binding, switches))
  if (!bindings.length) return []
  const fields = await tx.customField.findMany({ where: { organizationId: input.organizationId, isActive: true, entityType: { in: ["company", "contact", "deal"] } }, take: 501, orderBy: { id: "asc" }, select: { id: true, entityType: true, fieldLabel: true, fieldType: true } })
  const catalogue = catalogueWithCustomFields(fields)
  const results: CaptureResult[] = []
  for (const binding of bindings) {
    results.push(await captureReceiverChange(tx as unknown as CaptureTransaction, {
      binding, switches, mode: "live", trigger: input.trigger ?? "change", resource: input.resource, recordId: input.recordId,
      actor: input.actor, correlationId: input.correlationId ?? randomUUID(), instanceId: instanceId(),
      reader: prismaBuilderSourceReader(tx), catalogue, producerVersion: eventProducerVersion(),
    }))
  }
  return results
}

function instanceId() {
  return (hostname().replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "app").slice(0, 120)
}

export interface ConfiguredRunResult {
  configuration: "not_configured" | "unreadable" | "invalid" | "loaded"
  bindings: { integrationId: string; environment: "TEST" | "PROD"; delivery: DeliverySummary | "disabled"; purgedPayloads: number; purgedEvents: number }[]
}

/** Cron body: retention first (always), then delivery only where allowed. */
export async function runConfiguredReceiverRuntime(input: { maxEffects: number; send?: ReceiverSender }): Promise<ConfiguredRunResult> {
  const switches = runtimeSwitches()
  const loaded = loadRuntimeBindings()
  const result: ConfiguredRunResult = { configuration: loaded.error ?? "loaded", bindings: [] }
  for (const binding of loaded.bindings) {
    const purged = await receiverDatabase.tenant(binding.organizationId, async (tx) => {
      const payloads = await purgeExpiredReceiverPayloads(tx, { organizationId: binding.organizationId, limit: 1000 })
      const events = await purgeExpiredRuntimeSecurityEvents(tx, { organizationId: binding.organizationId, limit: 1000 })
      if (payloads + events > 0) await recordRuntimeSecurityEvent(tx, {
        organizationId: binding.organizationId, environment: binding.environment, instanceId: instanceId(), category: "logging",
        action: "retention_purge", outcome: "success", severity: "info", actor: { type: "service", id: "receiver-retention" },
        target: null, correlationId: null, integrationEventId: null, retentionDays: binding.securityLogRetentionDays,
      })
      return { payloads, events }
    })
    const delivery = deliveryAllowed(binding, switches)
      ? await runReceiverDelivery({ db: receiverDatabase, binding, switches, send: input.send ?? fileReceiverSender, workerId: instanceId(), maxEffects: input.maxEffects })
      : "disabled" as const
    result.bindings.push({ integrationId: binding.integrationId, environment: binding.environment, delivery, purgedPayloads: purged.payloads, purgedEvents: purged.events })
  }
  return result
}

/** Tenant-scoped read of the runtime log for the protected export route. */
export function readRuntimeEventsForExport(input: { organizationId: string; environment: "TEST" | "PROD"; from: string; to: string; limit: number }) {
  return receiverDatabase.tenant(input.organizationId, (tx) => readRuntimeSecurityEvents(tx, input))
}
