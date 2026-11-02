// The SQL of fund-balance-source.ts, apart from Prisma so the real-Postgres
// test of the Fund pilot (scripts/event-platform/fund-shadow/pilot.integration.ts)
// runs exactly these statements.

export const FUND_BALANCE_SOURCE_SETTING = "fundBalanceSource"

// A running shadow build of the Fund projection is what makes the switch
// available at all; organizations without the pilot never see it.
export const FUND_BALANCE_SOURCE_SQL = `SELECT o.settings ->> '${FUND_BALANCE_SOURCE_SETTING}' AS source,
  EXISTS (SELECT 1 FROM projection_builds b WHERE b."organizationId" = o.id
    AND b."projectionName" = 'finance.fund-balance' AND b.mode = 'shadow' AND b.status = 'running') AS available
  FROM organizations o WHERE o.id = $1`

/**
 * Per fund of the organization: the shadow balance when it is current, and
 * whether the fund has an event history at all. One row per fund with a head;
 * "fresh" is false while the shadow is behind the head or in another currency.
 */
export const KAFKA_FUND_BALANCES_SQL = `SELECT h."aggregateId" AS "fundId", p.balance::text AS balance,
    (p.id IS NOT NULL AND p."aggregateVersion" = h."currentVersion" AND p.currency = f.currency) AS fresh
  FROM event_aggregate_heads h
  JOIN funds f ON f."organizationId" = h."organizationId" AND f.id = h."aggregateId"
  -- One build is the source: the newest running shadow build. An older one,
  -- even a current one, is never mixed in.
  LEFT JOIN LATERAL (SELECT b."buildKey", b."projectionVersion" FROM projection_builds b
    WHERE b."organizationId" = h."organizationId" AND b."projectionName" = 'finance.fund-balance'
      AND b.mode = 'shadow' AND b.status = 'running'
    ORDER BY b."createdAt" DESC, b.id DESC LIMIT 1) b ON true
  LEFT JOIN fund_balance_projections p ON p."organizationId" = h."organizationId" AND p."fundId" = h."aggregateId"
    AND p."buildKey" = b."buildKey" AND p."projectionVersion" = b."projectionVersion" AND p.status = 'shadow'
  WHERE h."organizationId" = $1 AND h."aggregateType" = 'fund'`
