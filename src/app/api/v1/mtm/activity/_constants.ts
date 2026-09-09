/**
 * Shared constants for the MTM Activity route.
 *
 * Lives outside route.ts so the route file exports only handlers (Next.js
 * route-type constraint), while the regression test asserts against this
 * single source of truth (src/__tests__/api-mtm-activity.test.ts).
 */

/** Hard cap on page size. Bumping the cap is a one-line change here. */
export const MAX_PAGE_LIMIT = 100
