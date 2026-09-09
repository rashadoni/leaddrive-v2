/**
 * Energy & Utilities Cloud types — R6 slice 1.
 *
 * Salesforce E&U Cloud analogue. Shared shape between 4 pure helpers:
 *   1. state-machine            — customer + meter + outage + service-call lifecycle
 *   2. meter-reading-validator  — cumulative > prior, source/quality enums
 *   3. outage-impact-calculator — CMI / SAIDI inputs from outage window × meters
 *   4. service-call-router      — call type + priority → queue slug
 *
 * Pure — no Prisma imports.
 */

/* ─── Customer class + status + transitions ───────────────────────────── */

export const CUSTOMER_CLASSES = [
  "residential",
  "small_commercial",
  "large_commercial",
  "industrial",
  "agricultural",
  "municipal",
] as const

export type CustomerClass = (typeof CUSTOMER_CLASSES)[number]

export const CUSTOMER_STATUSES = [
  "prospect",
  "active",
  "suspended",
  "terminated",
] as const

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

/**
 *   prospect    → active | terminated
 *   active      → suspended | terminated
 *   suspended   → active | terminated
 *   terminated  → []                              (terminal)
 */
export const CUSTOMER_TRANSITIONS: Readonly<
  Record<CustomerStatus, readonly CustomerStatus[]>
> = {
  prospect: ["active", "terminated"],
  active: ["suspended", "terminated"],
  suspended: ["active", "terminated"],
  terminated: [],
}

/* ─── Commodity type + meter status + transitions ─────────────────────── */

export const COMMODITY_TYPES = [
  "electricity",
  "gas",
  "water",
  "district_heating",
  "sewer",
] as const

export type CommodityType = (typeof COMMODITY_TYPES)[number]

export const METER_STATUSES = [
  "pending_install",
  "active",
  "disconnected",
  "retired",
] as const

export type MeterStatus = (typeof METER_STATUSES)[number]

/**
 *   pending_install → active | retired (cancelled before install)
 *   active          → disconnected | retired
 *   disconnected    → active (reconnection) | retired
 *   retired         → []                          (terminal)
 */
export const METER_TRANSITIONS: Readonly<
  Record<MeterStatus, readonly MeterStatus[]>
> = {
  pending_install: ["active", "retired"],
  active: ["disconnected", "retired"],
  disconnected: ["active", "retired"],
  retired: [],
}

/* ─── Meter reading source + quality ──────────────────────────────────── */

export const READING_SOURCES = [
  "manual",
  "amr",
  "ami",
  "estimated",
  "corrected",
  // Slice-2: legitimate counter reset on physical meter swap.
  // New meter starts at 0 even though prior cumulative was higher.
  // No supersedesReadingId required (this isn't a correction —
  // the prior readings remain valid for the OLD meter; we're
  // beginning a new monotonic series for the NEW meter).
  "meter_replacement",
] as const

export type ReadingSource = (typeof READING_SOURCES)[number]

export const READING_QUALITIES = ["raw", "validated", "flagged"] as const

export type ReadingQuality = (typeof READING_QUALITIES)[number]

/* ─── Outage cause + severity + status + transitions ──────────────────── */

export const OUTAGE_CAUSES = [
  "planned_maintenance",
  "equipment_failure",
  "weather",
  "third_party_damage",
  "overload",
  "unknown",
] as const

export type OutageCause = (typeof OUTAGE_CAUSES)[number]

export const OUTAGE_SEVERITIES = [
  "minor",
  "moderate",
  "major",
  "critical",
] as const

export type OutageSeverity = (typeof OUTAGE_SEVERITIES)[number]

export const OUTAGE_STATUSES = [
  "pending",
  "active",
  "resolved",
  "cancelled",
] as const

export type OutageStatus = (typeof OUTAGE_STATUSES)[number]

/**
 *   pending   → active | cancelled
 *   active    → resolved
 *   resolved  → []                                (terminal)
 *   cancelled → []                                (terminal)
 *
 * (No transition from active back to pending — once power's out it's out.)
 */
export const OUTAGE_TRANSITIONS: Readonly<
  Record<OutageStatus, readonly OutageStatus[]>
> = {
  pending: ["active", "cancelled"],
  active: ["resolved"],
  resolved: [],
  cancelled: [],
}

/* ─── Service call type + priority + status + transitions ─────────────── */

export const SERVICE_CALL_TYPES = [
  "outage_report",
  "new_connection",
  "disconnection",
  "reconnection",
  "meter_inspection",
  "meter_replacement",
  "billing_dispute",
  "usage_question",
  "service_upgrade",
] as const

export type ServiceCallType = (typeof SERVICE_CALL_TYPES)[number]

export const SERVICE_CALL_PRIORITIES = [
  "routine",
  "elevated",
  "urgent",
  "emergency",
] as const

export type ServiceCallPriority = (typeof SERVICE_CALL_PRIORITIES)[number]

export const SERVICE_CALL_STATUSES = [
  "received",
  "dispatched",
  "in_progress",
  "resolved",
  "cancelled",
] as const

export type ServiceCallStatus = (typeof SERVICE_CALL_STATUSES)[number]

/**
 *   received    → dispatched | cancelled
 *   dispatched  → in_progress | cancelled
 *   in_progress → resolved | cancelled
 *   resolved    → []                              (terminal)
 *   cancelled   → []                              (terminal)
 */
export const SERVICE_CALL_TRANSITIONS: Readonly<
  Record<ServiceCallStatus, readonly ServiceCallStatus[]>
> = {
  received: ["dispatched", "cancelled"],
  dispatched: ["in_progress", "cancelled"],
  in_progress: ["resolved", "cancelled"],
  resolved: [],
  cancelled: [],
}

/* ─── Transition result ───────────────────────────────────────────────── */

export type TransitionResult = { ok: true } | { ok: false; error: string }

/* ─── Meter reading validator I/O ─────────────────────────────────────── */

/**
 * Prior reading context: caller (slice-2 ingestion worker) fetches the
 * most-recent reading for the same meter ordered by readingAt DESC and
 * passes it here. NULL means "first ever reading for this meter".
 */
export interface PriorReading {
  readingAt: Date
  cumulativeValue: number
  unit: string
}

export interface ValidateMeterReadingInput {
  source: ReadingSource
  quality: ReadingQuality
  readingAt: Date
  cumulativeValue: number
  /** Optional interval value — if supplied, validator checks it equals
   *  (cumulative − prior.cumulative) within `intervalTolerance` units. */
  intervalValue?: number | null
  unit: string
  prior: PriorReading | null
  /** Tolerance for intervalValue mismatch (default 0.0001 — DECIMAL(18,4)
   *  granularity). Caller can widen for known noisy meters. */
  intervalTolerance?: number
  /** For source="corrected", caller must supply supersededReadingId. */
  supersedesReadingId?: string | null
}

export type ValidateMeterReadingResult =
  | { ok: true }
  | { ok: false; error: string; field?: string }

/* ─── Outage impact calculator I/O ────────────────────────────────────── */

export interface OutageImpactInput {
  /** Outage window — both required (calculator only evaluates resolved/
   *  active outages with both timestamps populated). */
  actualStartAt: Date
  actualEndAt: Date
  /** Snapshot of meters that were down. */
  affectedMeterCount: number
  /**
   * Optional per-meter restoration timestamps (overrides the bulk window
   * for those meters). Useful when partial restoration happens before
   * the outage is officially resolved.
   *
   * Each entry: { restoredAt } — meter was down from actualStartAt until
   * restoredAt. Caller passes an array; calculator sums per-meter
   * down-minutes.
   */
  perMeterRestorations?: readonly { restoredAt: Date }[]
}

export interface OutageImpactSummary {
  /** Customer-minutes-interrupted — sum of (downMinutes × affectedCount). */
  customerMinutesInterrupted: number
  /** Bulk outage duration in minutes (actualEndAt − actualStartAt). */
  outageDurationMinutes: number
  /** Effective average down-time per meter in minutes. */
  averagePerMeterMinutes: number
}

export type OutageImpactResult =
  | { ok: true; summary: OutageImpactSummary }
  | { ok: false; error: string }

/* ─── Service call router I/O ─────────────────────────────────────────── */

/**
 * Routing decision: which queue + suggested priority a given call type
 * should land in. Caller's dispatch system reads `queueSlug` and looks
 * up technician availability.
 */
export interface ServiceCallRoute {
  queueSlug: string
  suggestedPriority: ServiceCallPriority
}

export interface RouteServiceCallInput {
  callType: ServiceCallType
  /** Caller-supplied severity override (e.g. operator escalates a
   *  routine call to urgent based on customer-relayed safety info). */
  priorityOverride?: ServiceCallPriority
  /**
   * Linked outage severity (when callType=outage_report). Calculator
   * uses outage severity to bump priority — a critical-severity outage
   * report jumps from routine to emergency.
   */
  outageSeverity?: OutageSeverity
}

export type RouteServiceCallResult =
  | { ok: true; route: ServiceCallRoute }
  | { ok: false; error: string }
