/**
 * Case routing classifier — R8 slice 1.
 *
 * Maps a case type to:
 *   • Default agency slug — caller's dispatch system reads this and
 *     picks the responsible department within the tenant's
 *     organizational chart.
 *   • Suggested priority (caller may override).
 *   • Statutory response deadline in days from intake (NULL = no
 *     statutory deadline; slice-2 cron alerts at T-7d for ones with).
 *
 * Routing table — slice-1 defaults. Slice-2 reads per-tenant agency
 * assignments from a config table.
 *
 * Pure synchronous.
 */
import {
  CASE_PRIORITIES,
  CASE_TYPES,
  type CasePriority,
  type CaseType,
  type RouteCaseInput,
  type RouteCaseResult,
} from "./types"

/** Per-case-type default routing. */
const ROUTING_TABLE: Readonly<
  Record<
    CaseType,
    {
      agencySlug: string
      basePriority: CasePriority
      statutoryResponseDays: number | null
    }
  >
> = {
  benefits_application: {
    agencySlug: "benefits",
    basePriority: "routine",
    statutoryResponseDays: 30,
  },
  benefits_recertification: {
    agencySlug: "benefits",
    basePriority: "routine",
    statutoryResponseDays: 45,
  },
  complaint: {
    agencySlug: "ombudsman",
    basePriority: "elevated",
    statutoryResponseDays: 30,
  },
  inquiry: {
    agencySlug: "general-services",
    basePriority: "routine",
    // No statutory deadline for inquiries (free-form Q&A).
    statutoryResponseDays: null,
  },
  inspection_request: {
    agencySlug: "inspections",
    basePriority: "elevated",
    statutoryResponseDays: 14,
  },
  hearing_request: {
    agencySlug: "hearings",
    basePriority: "urgent",
    statutoryResponseDays: 60,
  },
  records_request: {
    // FOIA — Freedom of Information Act, statutory 20-business-day
    // turnaround in US federal. State laws vary; slice-2 wires per-
    // jurisdiction overrides.
    agencySlug: "records-foia",
    basePriority: "elevated",
    statutoryResponseDays: 20,
  },
  appeal: {
    agencySlug: "appeals",
    basePriority: "urgent",
    statutoryResponseDays: 90,
  },
  grievance: {
    agencySlug: "grievances",
    basePriority: "elevated",
    statutoryResponseDays: 30,
  },
}

function isCaseType(v: unknown): v is CaseType {
  return typeof v === "string" && (CASE_TYPES as readonly string[]).includes(v)
}

function isCasePriority(v: unknown): v is CasePriority {
  return (
    typeof v === "string" &&
    (CASE_PRIORITIES as readonly string[]).includes(v)
  )
}

export function routeCase(input: RouteCaseInput): RouteCaseResult {
  if (!isCaseType(input.caseType)) {
    return { ok: false, error: `unknown caseType "${String(input.caseType)}"` }
  }
  if (
    input.priorityOverride !== undefined &&
    !isCasePriority(input.priorityOverride)
  ) {
    return {
      ok: false,
      error: `unknown priorityOverride "${String(input.priorityOverride)}"`,
    }
  }
  if (
    input.jurisdictionSlug !== undefined &&
    typeof input.jurisdictionSlug !== "string"
  ) {
    return { ok: false, error: "jurisdictionSlug must be a string if supplied" }
  }

  const entry = ROUTING_TABLE[input.caseType]
  const priority = input.priorityOverride ?? entry.basePriority

  return {
    ok: true,
    route: {
      agencySlug: entry.agencySlug,
      suggestedPriority: priority,
      statutoryResponseDays: entry.statutoryResponseDays,
    },
  }
}

/** Test-only — surfaces routing table for drift guards. */
export const __ROUTING_INTERNALS = { ROUTING_TABLE }
