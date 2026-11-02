/**
 * The two facts the Auth callbacks need about an outside reviewer, kept free
 * of imports so the auth layer does not pull the permission matrix in with
 * them. Everything else about reviewers lives in `reviewer-access.ts`.
 */
export const REVIEWER_ROLE = "reviewer"

/** Open while the grant exists, is not revoked and its end date is ahead. */
export function reviewerAccessOpen(
  grant: { expiresAt: Date | string; revokedAt?: Date | string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!grant || grant.revokedAt) return false
  const expiresAt = new Date(grant.expiresAt).getTime()
  return Number.isFinite(expiresAt) && expiresAt > now.getTime()
}
