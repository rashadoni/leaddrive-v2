/**
 * External social provider policy (owner decision, 2026-07-28).
 *
 * Facebook, Instagram and TikTok external discovery and known-publication
 * comment extraction use the pinned Apify actors. Bright Data code and verified
 * proofs remain available for rollback, but new routes pause that provider
 * while Apify is configured.
 *
 * The helpers here are the single source of truth for that capability-scoped
 * policy and exist so it can be enforced at route-compile time and re-checked
 * as a defensive regression control at observation time.
 *
 * This module is intentionally free of Prisma / side effects so both the route
 * compiler and the pure observation evaluator can depend on it.
 */

/**
 * Platforms guarded by the legacy Bright Data policy boundary, with
 * capability-scoped Apify routes defined below.
 */
export const BRIGHT_DATA_ONLY_PLATFORMS = ["tiktok", "instagram", "facebook"] as const

export type BrightDataOnlyPlatform = (typeof BRIGHT_DATA_ONLY_PLATFORMS)[number]

export function isBrightDataOnlyPlatform(platform: string | null | undefined): boolean {
  return typeof platform === "string"
    && (BRIGHT_DATA_ONLY_PLATFORMS as readonly string[]).includes(platform.toLowerCase())
}

/**
 * True when an adapter key, provider key or acquisition mode references Apify in
 * any form. Substring match keeps the guard robust against adapter-key variants
 * (`APIFY_ASYNC`, `apify`, `APIFY_FALLBACK`, ...).
 */
export function isApifyRouteReference(value: string | null | undefined): boolean {
  return typeof value === "string" && /apify/i.test(value)
}

/**
 * Owner routing policy (2026-07-28):
 * - Facebook, Instagram and TikTok external discovery may use their pinned
 *   Apify actors.
 * - Facebook, Instagram and TikTok public comment extraction may use the
 *   platform-specific pinned Apify actor, but only for already-known matched
 *   publication URLs.
 * - Unrelated social capabilities remain outside Apify.
 */
export function isApifySocialReadRouteAllowed(
  platform: string | null | undefined,
  capability: string | null | undefined,
): boolean {
  if (typeof platform !== "string") return false
  const normalizedPlatform = platform.toLowerCase()
  const normalizedCapability = capability ?? ""
  if (
    ["facebook", "instagram", "tiktok"].includes(normalizedPlatform)
    && ["READ_EXTERNAL_COMMENTS", "EXTRACT_COMMENTS_FROM_CANDIDATES"].includes(normalizedCapability)
  ) return true
  return ["facebook", "instagram", "tiktok"].includes(normalizedPlatform)
    && ["DISCOVER_POSTS", "DISCOVER_CANDIDATE_POSTS"].includes(normalizedCapability)
}

/** Backward-compatible export retained for older callers and persisted tests. */
export function isApifyInstagramReadRouteAllowed(
  platform: string | null | undefined,
  capability: string | null | undefined,
): boolean {
  return typeof platform === "string"
    && platform.toLowerCase() === "instagram"
    && isApifySocialReadRouteAllowed(platform, capability)
}

/** Backward-compatible discovery-only name used by older callers/tests. */
export function isApifyDiscoveryFallbackAllowed(
  platform: string | null | undefined,
  capability: string | null | undefined,
): boolean {
  return isApifySocialReadRouteAllowed(platform, capability)
    && typeof platform === "string"
    && ["facebook", "instagram", "tiktok"].includes(platform.toLowerCase())
    && (capability === "DISCOVER_POSTS" || capability === "DISCOVER_CANDIDATE_POSTS")
}
