/**
 * R11 Media slice-2 — per-tenant ad-campaign pacing config loader.
 *
 * Slice-1 `ad-pacing-calculator.ts` ships hardcoded
 *   OVER_PACE_THRESHOLD = 1.1
 *   UNDER_PACE_THRESHOLD = 0.9
 * Per-tenant overrides (table `media_pacing_config`, migration
 * `20260521090000_r11_r7_config_primitives`) let marketing teams
 * tighten/loosen pacing flags by business contract (e.g. premium
 * advertiser accepts only ±5%).
 *
 * Same defensive-merge pattern as PR #91 C5 config-loader:
 *   • Defaults baked here as the single source of truth.
 *   • Per-org row optional. Absent → defaults verbatim.
 *   • Malformed / out-of-range overrides fall back to defaults
 *     without throwing.
 *   • Result is frozen — caller can't mutate.
 *
 * Route consumer (admin UI + cron) is slice-2-mini follow-up.
 */
import { prisma as defaultPrisma } from "@/lib/prisma"

/* ─── Defaults (single source of truth) ──────────────────────────── */

/**
 * Slice-1 hardcoded defaults. Mirrored from
 * `src/lib/media/ad-pacing-calculator.ts:38-39`. Slice-3 may move the
 * canonical defaults here entirely — for now keep in sync.
 */
export const DEFAULT_OVER_PACE_THRESHOLD = 1.1
export const DEFAULT_UNDER_PACE_THRESHOLD = 0.9

export interface PacingThresholds {
  overPaceThreshold: number
  underPaceThreshold: number
  /** Reserved opaque JSON for slice-3 per-campaign curves. */
  perCampaignOverrides: Readonly<Record<string, unknown>>
}

/* ─── Loader ─────────────────────────────────────────────────────── */

type PacingConfigClient = {
  mediaPacingConfig: {
    findUnique(args: {
      where: { organizationId: string }
      select?: never
    }): Promise<{
      overPaceThreshold: number | null
      underPaceThreshold: number | null
      perCampaignOverrides: unknown
    } | null>
  }
}

function validOver(v: number | null): number {
  // Must be a finite number > 1.0 (otherwise "over" is meaningless).
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 1.0) {
    return DEFAULT_OVER_PACE_THRESHOLD
  }
  return v
}

function validUnder(v: number | null): number {
  // Must be a finite number in (0, 1.0) — under-paced is below
  // expected, so the threshold itself must be < 1.0.
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v >= 1.0) {
    return DEFAULT_UNDER_PACE_THRESHOLD
  }
  return v
}

export async function loadPacingThresholds(
  orgId: string,
  client: PacingConfigClient = defaultPrisma as unknown as PacingConfigClient,
): Promise<PacingThresholds> {
  if (typeof orgId !== "string" || !orgId) {
    throw new Error("loadPacingThresholds: orgId required")
  }
  const row = await client.mediaPacingConfig.findUnique({
    where: { organizationId: orgId },
  })
  if (!row) {
    return Object.freeze({
      overPaceThreshold: DEFAULT_OVER_PACE_THRESHOLD,
      underPaceThreshold: DEFAULT_UNDER_PACE_THRESHOLD,
      perCampaignOverrides: Object.freeze({}),
    })
  }
  const perCampaign =
    row.perCampaignOverrides !== null &&
    typeof row.perCampaignOverrides === "object" &&
    !Array.isArray(row.perCampaignOverrides)
      ? Object.freeze({ ...(row.perCampaignOverrides as Record<string, unknown>) })
      : Object.freeze({})

  return Object.freeze({
    overPaceThreshold: validOver(row.overPaceThreshold),
    underPaceThreshold: validUnder(row.underPaceThreshold),
    perCampaignOverrides: perCampaign,
  })
}
