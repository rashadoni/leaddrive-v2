import {
  consumePublicRateLimitBatch,
  type PublicGuardDecision,
  type PublicRatePolicy,
} from "@/lib/public-abuse-guard"
import type { MtmMobileSyncV2Stream } from "@/lib/mtm/mobile-sync-v2"

/**
 * v2 pull traffic is a new, cohort-gated contract, so it can use the shared
 * Redis guard without changing v1's established rate-limit behaviour. A
 * production Redis outage deliberately fails this optional read path closed;
 * the APK keeps its compatible v1 adapter and no mutation/outbox is touched.
 */
const PULL_DEVICE_POLICY: PublicRatePolicy = { maxRequests: 60, windowSeconds: 60 }
const PULL_USER_POLICY: PublicRatePolicy = { maxRequests: 60, windowSeconds: 60 }
const PULL_TENANT_POLICY: PublicRatePolicy = { maxRequests: 180, windowSeconds: 60 }
const INITIAL_SNAPSHOT_DEVICE_POLICY: PublicRatePolicy = { maxRequests: 3, windowSeconds: 60 }
const INITIAL_SNAPSHOT_USER_POLICY: PublicRatePolicy = { maxRequests: 3, windowSeconds: 60 }
const INITIAL_SNAPSHOT_TENANT_POLICY: PublicRatePolicy = { maxRequests: 30, windowSeconds: 60 }

export type MtmMobileSyncV2RateLimitPhase = "pull" | "initial-snapshot"

type MtmMobileSyncV2RateLimitInput = {
  stream: MtmMobileSyncV2Stream
  phase: MtmMobileSyncV2RateLimitPhase
  organizationId: string
  agentId: string
  userId: string
  deviceId: string
}

function policiesFor(phase: MtmMobileSyncV2RateLimitPhase): {
  device: PublicRatePolicy
  user: PublicRatePolicy
  tenant: PublicRatePolicy
} {
  return phase === "initial-snapshot"
    ? {
        device: INITIAL_SNAPSHOT_DEVICE_POLICY,
        user: INITIAL_SNAPSHOT_USER_POLICY,
        tenant: INITIAL_SNAPSHOT_TENANT_POLICY,
      }
    : { device: PULL_DEVICE_POLICY, user: PULL_USER_POLICY, tenant: PULL_TENANT_POLICY }
}

/**
 * The all-or-nothing batch checks device, authenticated user and tenant before
 * charging any of them. A denial in one bucket cannot burn the others with a
 * retry storm. Exact identifiers preserve the same case-sensitive device
 * identity used by the cohort and opaque-cursor contracts; the guard hashes
 * them before they enter Redis or the non-production fallback.
 */
export async function consumeMtmMobileSyncV2RateLimit(
  input: MtmMobileSyncV2RateLimitInput,
): Promise<PublicGuardDecision> {
  const policies = policiesFor(input.phase)
  const userId = input.userId || input.agentId
  const redisHashTag = `mtm-mobile-sync-v2:${input.organizationId}`
  return consumePublicRateLimitBatch([
    {
      scope: `mtm-mobile-sync-v2:${input.stream}:${input.phase}:device`,
      identifier: `${input.organizationId}:${input.agentId}:${input.deviceId}`,
      policy: policies.device,
      identifierMode: "exact",
      redisHashTag,
    },
    {
      scope: `mtm-mobile-sync-v2:${input.stream}:${input.phase}:user`,
      identifier: `${input.organizationId}:${userId}`,
      policy: policies.user,
      identifierMode: "exact",
      redisHashTag,
    },
    {
      scope: `mtm-mobile-sync-v2:${input.stream}:${input.phase}:tenant`,
      identifier: input.organizationId,
      policy: policies.tenant,
      identifierMode: "exact",
      redisHashTag,
    },
  ])
}
