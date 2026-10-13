import { createHash } from "node:crypto"
import { canonicalJson } from "../../../event-platform/canonical-json"
import { identifier, record } from "../contract"
import { buildSecurityExport } from "../security-events"
import { BuilderEvaluationError } from "./engine"

export const BUILDER_AUDIT_ACTIONS = ["receiver_draft_created", "receiver_draft_updated", "receiver_draft_read", "receiver_draft_previewed", "receiver_draft_logs_exported", "receiver_profile_exported", "receiver_contract_exported"] as const
export interface BuilderAuditRow { id: string; organizationId: string; userId: string | null; action: string; entityType: string; entityId: string | null; createdAt: Date; newValue: unknown }

function stableAuditUuid(organizationId: string, nativeId: string) {
  const hex = createHash("sha256").update(canonicalJson(["receiver-builder", organizationId, nativeId])).digest("hex")
  // UUIDv8: explicitly defined application-specific SHA-256-derived identity.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${(8 + (parseInt(hex[16], 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Exports ONLY the constructor's metadata audit, not an assertion of all CRM logs. */
export function exportBuilderAudit(input: { organizationId: string; environment: "TEST" | "PROD"; from: string; to: string; generatedAt: string; rows: readonly BuilderAuditRow[] }) {
  const organizationId = identifier(input.organizationId)
  const events = input.rows.map((row) => {
    if (row.organizationId !== organizationId || row.entityType !== "receiver_draft" || !BUILDER_AUDIT_ACTIONS.includes(row.action as typeof BUILDER_AUDIT_ACTIONS[number])) throw new BuilderEvaluationError("audit_scope_mismatch")
    const evidence = record(row.newValue)
    if (evidence.environment !== input.environment) throw new BuilderEvaluationError("audit_environment_unknown_or_mismatched")
    identifier(row.id)
    const configuration = row.action === "receiver_draft_created" || row.action === "receiver_draft_updated"
    return {
      schema_version: "1.0", event_id: stableAuditUuid(organizationId, row.id),
      event_time: row.createdAt.toISOString(), observed_at: row.createdAt.toISOString(), ingested_at: null,
      organization_id: organizationId, environment: input.environment,
      source: { system: "LeadDrive", service: "receiver-builder", instance_id: "crm", version: "1.0" },
      category: configuration ? "administration" : "data_access",
      action: configuration ? "configuration_change" : row.action.endsWith("_exported") ? "data_export" : "data_read",
      outcome: "success", severity: configuration ? "medium" : "info",
      actor: { type: row.userId ? "user" : "unknown", id: row.userId },
      target: row.entityId ? { type: "receiver_draft", id: row.entityId } : null,
      correlation_id: `audit:${row.id}`, integration_event_id: null,
    }
  })
  const result = buildSecurityExport({ ...input, events, coverage: [{ service: "receiver-builder", state: "collected" }] })
  return { ...result, manifest: { ...result.manifest, scope: "constructor_configuration_and_preview_only", excluded_sources: ["other_crm_sources", "azure", "vpn", "customer_api", "erp"] } }
}
