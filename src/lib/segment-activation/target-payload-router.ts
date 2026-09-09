/**
 * Target payload router — G5 slice 1.
 *
 * Given an activation target type, returns the route descriptor
 * (which slice-2 module + method to call). Decoupled from the
 * actual dispatch — slice-2 worker resolves the route to actual
 * function via a registry.
 *
 * Pure synchronous.
 */
import {
  ACTIVATION_TARGET_TYPES,
  type ActivationTargetType,
  type RouteTargetInput,
  type RouteTargetResult,
  type TargetRoute,
} from "./types"

const ROUTES: Readonly<Record<ActivationTargetType, TargetRoute>> = {
  ad_audience_sync: {
    targetType: "ad_audience_sync",
    helper: "advertising-studio.audience-payload-builder",
    method: "buildAudiencePayload",
    /**
     * FB Custom Audience + Google Customer Match support add-members
     * and remove-members operations independently; LinkedIn similar.
     * Slice-2 dispatcher sends diff.added + diff.removed as separate
     * API calls — true incremental.
     */
    supportsIncremental: true,
  },
  mobile_campaign: {
    targetType: "mobile_campaign",
    helper: "mobile-studio.dispatcher",
    method: "enrollMembersInCampaign",
    /**
     * Push/SMS campaigns enroll on add (slice-2 idempotent UPSERT);
     * removes don't trigger un-sending (they affect future enrollments
     * only). Effectively incremental for adds but not retroactive.
     */
    supportsIncremental: true,
  },
  email_campaign: {
    targetType: "email_campaign",
    helper: "email-campaign.dispatcher",
    method: "enrollMembersInJourney",
    /**
     * Email journeys re-enroll the entire current set on each run
     * (slice-2 dispatcher de-dupes via journey-enrollment UNIQUE).
     * Diff math still valuable for reporting but dispatch sends full
     * current set.
     */
    supportsIncremental: false,
  },
  webhook: {
    targetType: "webhook",
    helper: "webhook.poster",
    method: "postMemberSet",
    /**
     * Generic HTTP delivery — webhook receivers vary in semantic.
     * Slice-2 dispatcher posts the full current set; receiver dedupes.
     */
    supportsIncremental: false,
  },
}

export function routeTarget(input: RouteTargetInput): RouteTargetResult {
  if (
    typeof input.targetType !== "string" ||
    !(ACTIVATION_TARGET_TYPES as readonly string[]).includes(input.targetType)
  ) {
    return {
      ok: false,
      error: `targetType "${String(input.targetType)}" not in allowed set: ${ACTIVATION_TARGET_TYPES.join(", ")}`,
    }
  }
  const route = ROUTES[input.targetType]
  if (!route) {
    // Shouldn't reach — caught by allowlist above.
    return {
      ok: false,
      error: `no route configured for targetType "${input.targetType}"`,
    }
  }
  return { ok: true, route }
}

/**
 * Drift-guard accessor: returns all known routes for caller-side
 * iteration / registration with slice-2 dispatcher registry.
 */
export function allRoutes(): Readonly<TargetRoute[]> {
  return ACTIVATION_TARGET_TYPES.map((t) => ROUTES[t])
}
