/**
 * M3-5b — Visit anomaly: burst upload detection.
 *
 * Anti-fraud signal: an agent who uploads >5 photos within 30 seconds is
 * likely automating uploads to create the appearance of a longer visit.
 *
 * Pure function. Caller performs the DB count (photos from same agent in
 * the last 30 s, including the photo just uploaded), then passes the result
 * here. The audit log write is the caller's responsibility.
 */

export interface BurstCheckInput {
  /**
   * Number of photos from the same agent in the burst window (including
   * the photo just uploaded). Caller queries:
   *   prisma.mtmPhoto.count({
   *     where: { agentId, organizationId, createdAt: { gte: now - windowSeconds * 1000 } }
   *   })
   */
  count: number
  /**
   * Burst threshold. Default 5 — >5 photos triggers the flag.
   * "greater-than" is strict: exactly 5 is not a burst.
   */
  maxPhotos?: number
}

export interface BurstCheckResult {
  /** True when count > maxPhotos. */
  isBurst: boolean
  /** The count passed in (for inclusion in newData when writing the audit). */
  count: number
}

/** Default burst threshold (strict: >5 photos triggers, exactly 5 does not). */
export const BURST_MAX_PHOTOS = 5

/** Default burst window in seconds (per M3-5b spec). */
export const BURST_WINDOW_SECONDS = 30

export function checkBurstUpload(input: BurstCheckInput): BurstCheckResult {
  const { count, maxPhotos = BURST_MAX_PHOTOS } = input
  return {
    isBurst: count > maxPhotos,
    count,
  }
}
