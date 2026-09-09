/**
 * KPI Arena (Phase C) per-org config loader. Mirrors the account-engagement
 * config-loader pattern:
 *   • Defaults baked here = single source of truth (today's hardcoded constants
 *     from mtm.ts `mtmAttainment` 0.5/0.3/0.2 and types.ts `statusFromAttainment`
 *     110/90/70/50).
 *   • Per-org `LeaderboardConfig` row is optional. No row → defaults verbatim.
 *   • Override merge is shallow + per-key: each present, well-typed key in the
 *     JSONB overrides the default; a missing or malformed key keeps the default
 *     (defensive — admin garbage in the JSONB must never make the loader throw).
 *   • Returns frozen objects (no caller-side mutation leak).
 *   • Injectable Prisma client (any client exposing `leaderboardConfig.findUnique`);
 *     defaults to the global prisma.
 *
 * WIRED (slice C3): the arena route calls `loadLeaderboardConfig(orgId)` once and
 * passes `mtmWeights` to `mtm.ts mtmAttainment` and `statusThresholds` to
 * `statusFromAttainment` across mtm/tickets/projects/tasks (sales keeps the quota
 * engine's own bands). `mtmAttainment` normalises by the weight sum, so a partial
 * admin override (e.g. only `task: 0.6`) no longer skews attainment past 100 —
 * the old C3 [P2] TODO is closed.
 */
import { prisma as defaultPrisma } from "@/lib/prisma"
import { DEFAULT_MTM_WEIGHTS, DEFAULT_STATUS_THRESHOLDS, type MtmWeightKey } from "./types"

export type StatusThresholdKey = "exceeding" | "on_track" | "behind" | "at_risk"

// MTM weights + status defaults are owned by types.ts (prisma-free). This module
// imports `@/lib/prisma`, so a "use client" page must NOT import from here — it
// imports the constants from types.ts directly. Re-exported here so server
// consumers (mtm.ts) + slice-1 tests keep a single import surface.
export { DEFAULT_MTM_WEIGHTS, DEFAULT_STATUS_THRESHOLDS, type MtmWeightKey }

const MTM_WEIGHT_KEYS: readonly MtmWeightKey[] = ["task", "photo", "route"]
const STATUS_THRESHOLD_KEYS: readonly StatusThresholdKey[] = ["exceeding", "on_track", "behind", "at_risk"]

export interface LeaderboardConfigResolved {
  mtmWeights: Readonly<Record<MtmWeightKey, number>>
  statusThresholds: Readonly<Record<StatusThresholdKey, number>>
}

/**
 * Merge per-key: defaults first, then each present override key that is a finite
 * number ≥ 0. Defaults win for any malformed override (non-object/array/garbage).
 */
function mergeNumberRecord<K extends string>(
  defaults: Readonly<Record<K, number>>,
  overrides: unknown,
  keys: readonly K[],
): Record<K, number> {
  const out = { ...defaults } as Record<K, number>
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) return out
  for (const k of keys) {
    if (Object.hasOwn(overrides, k)) {
      const v = (overrides as Record<string, unknown>)[k]
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v
    }
  }
  return out
}

/** Pure resolver (no Prisma) — exported for unit tests. */
export function resolveLeaderboardConfig(
  row: { mtmWeights: unknown; statusThresholds: unknown } | null,
): LeaderboardConfigResolved {
  return Object.freeze({
    mtmWeights: Object.freeze(mergeNumberRecord(DEFAULT_MTM_WEIGHTS, row?.mtmWeights, MTM_WEIGHT_KEYS)),
    statusThresholds: Object.freeze(
      mergeNumberRecord(DEFAULT_STATUS_THRESHOLDS, row?.statusThresholds, STATUS_THRESHOLD_KEYS),
    ),
  })
}

/** Minimal Prisma surface — any client exposing leaderboardConfig.findUnique. */
type ConfigClient = {
  leaderboardConfig: {
    findUnique(args: {
      where: { organizationId: string }
    }): Promise<{ mtmWeights: unknown; statusThresholds: unknown } | null>
  }
}

export async function loadLeaderboardConfig(
  orgId: string,
  client: ConfigClient = defaultPrisma,
): Promise<LeaderboardConfigResolved> {
  const row = await client.leaderboardConfig.findUnique({ where: { organizationId: orgId } })
  return resolveLeaderboardConfig(row)
}
