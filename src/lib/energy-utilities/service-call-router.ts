/**
 * Service call router — R6 slice 1.
 *
 * Maps a service-call type + optional priority/severity hints to:
 *   • a queue slug (technician dispatch pool)
 *   • a suggested priority (caller may override but operator/operator's-
 *     override wins — explicit override always returned)
 *
 * Routing table — slice-1 defaults. Slice-2 reads tenant-configured
 * queues from the DB instead. Built so caller can drop a config layer
 * over it without changing the call-site shape.
 *
 *   outage_report     → "outages"        (severity bumps priority)
 *   new_connection    → "connections"
 *   disconnection     → "connections"
 *   reconnection      → "connections"
 *   meter_inspection  → "field-service"
 *   meter_replacement → "field-service"
 *   billing_dispute   → "billing"
 *   usage_question    → "customer-care"
 *   service_upgrade   → "connections"
 *
 * Priority bump from outage severity:
 *   critical → emergency
 *   major    → urgent
 *   moderate → elevated
 *   minor    → routine (no bump)
 *
 * Pure synchronous.
 */
import {
  OUTAGE_SEVERITIES,
  SERVICE_CALL_PRIORITIES,
  SERVICE_CALL_TYPES,
  type OutageSeverity,
  type RouteServiceCallInput,
  type RouteServiceCallResult,
  type ServiceCallPriority,
  type ServiceCallType,
} from "./types"

/** Per-call-type default queue + base priority. */
const ROUTING_TABLE: Readonly<
  Record<
    ServiceCallType,
    { queueSlug: string; basePriority: ServiceCallPriority }
  >
> = {
  outage_report: { queueSlug: "outages", basePriority: "urgent" },
  new_connection: { queueSlug: "connections", basePriority: "routine" },
  disconnection: { queueSlug: "connections", basePriority: "routine" },
  reconnection: { queueSlug: "connections", basePriority: "elevated" },
  meter_inspection: { queueSlug: "field-service", basePriority: "routine" },
  meter_replacement: { queueSlug: "field-service", basePriority: "elevated" },
  billing_dispute: { queueSlug: "billing", basePriority: "routine" },
  usage_question: { queueSlug: "customer-care", basePriority: "routine" },
  service_upgrade: { queueSlug: "connections", basePriority: "routine" },
}

/** Outage-severity → priority bump for outage_report calls. */
const SEVERITY_TO_PRIORITY: Readonly<
  Record<OutageSeverity, ServiceCallPriority>
> = {
  minor: "routine",
  moderate: "elevated",
  major: "urgent",
  critical: "emergency",
}

function isServiceCallType(v: unknown): v is ServiceCallType {
  return (
    typeof v === "string" &&
    (SERVICE_CALL_TYPES as readonly string[]).includes(v)
  )
}

function isServiceCallPriority(v: unknown): v is ServiceCallPriority {
  return (
    typeof v === "string" &&
    (SERVICE_CALL_PRIORITIES as readonly string[]).includes(v)
  )
}

function isOutageSeverity(v: unknown): v is OutageSeverity {
  return (
    typeof v === "string" &&
    (OUTAGE_SEVERITIES as readonly string[]).includes(v)
  )
}

/** Priority ordering for max() — emergency > urgent > elevated > routine. */
const PRIORITY_RANK: Readonly<Record<ServiceCallPriority, number>> = {
  routine: 0,
  elevated: 1,
  urgent: 2,
  emergency: 3,
}

function maxPriority(
  a: ServiceCallPriority,
  b: ServiceCallPriority
): ServiceCallPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b
}

export function routeServiceCall(
  input: RouteServiceCallInput
): RouteServiceCallResult {
  if (!isServiceCallType(input.callType)) {
    return { ok: false, error: `unknown callType "${String(input.callType)}"` }
  }
  if (
    input.priorityOverride !== undefined &&
    !isServiceCallPriority(input.priorityOverride)
  ) {
    return {
      ok: false,
      error: `unknown priorityOverride "${String(input.priorityOverride)}"`,
    }
  }
  if (
    input.outageSeverity !== undefined &&
    !isOutageSeverity(input.outageSeverity)
  ) {
    return {
      ok: false,
      error: `unknown outageSeverity "${String(input.outageSeverity)}"`,
    }
  }

  const tableEntry = ROUTING_TABLE[input.callType]
  let priority: ServiceCallPriority = tableEntry.basePriority

  // Outage-severity bump (only for outage_report).
  if (input.callType === "outage_report" && input.outageSeverity) {
    const bumped = SEVERITY_TO_PRIORITY[input.outageSeverity]
    priority = maxPriority(priority, bumped)
  }

  // Explicit caller override wins regardless of bump — operator
  // judgment trumps automated routing.
  if (input.priorityOverride !== undefined) {
    priority = input.priorityOverride
  }

  return {
    ok: true,
    route: {
      queueSlug: tableEntry.queueSlug,
      suggestedPriority: priority,
    },
  }
}

/** Test-only export — surfaces routing internals for drift guards. */
export const __ROUTER_INTERNALS = {
  ROUTING_TABLE,
  SEVERITY_TO_PRIORITY,
  PRIORITY_RANK,
}
