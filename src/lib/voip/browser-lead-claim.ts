/**
 * A call-centre lease is deliberately short-lived. The initial claim protects
 * the dispatch boundary; active browser calls renew it before expiry, while a
 * dead tab becomes available again without an operator cleanup job.
 */
export const BROWSER_LEAD_CALL_CLAIM_LEASE_MS = 2 * 60_000
export const BROWSER_LEAD_CALL_CLAIM_RENEW_INTERVAL_MS = 30_000
