import { Prisma } from "@prisma/client"

export type NotificationDomainCapabilities = {
  routeField: boolean
  workforceHrm: boolean
}

/**
 * Scope the shared legacy notification table to the products currently
 * enabled for a tenant. Explicit `metadata.domain` is authoritative. Rows
 * created before domains were introduced remain Workforce when they carry an
 * HRM request id; every other unmarked legacy row remains Route & Field. The
 * old route-replanning projection carried both Workforce and Route ids, so it
 * is visible only when both products are enabled instead of leaking either
 * side's identifiers into a single-product inbox.
 */
export function notificationDomainPredicate(
  capabilities: NotificationDomainCapabilities,
): Prisma.Sql {
  const routeField = capabilities.routeField === true
  const workforce = capabilities.workforceHrm === true
  if (routeField && workforce) return Prisma.sql`TRUE`

  const metadata = Prisma.sql`COALESCE("metadata", '{}'::jsonb)`
  const explicitDomain = Prisma.sql`${metadata} ->> 'domain'`
  const isHistoricalMixedProjection = Prisma.sql`(
    ${explicitDomain} = 'workforce'
    AND ${metadata} ? 'routeIds'
  )`
  const isWorkforce = Prisma.sql`(
    (${explicitDomain} = 'workforce' AND NOT ${isHistoricalMixedProjection})
    OR (${explicitDomain} IS NULL AND ${metadata} ? 'hrmRequestId')
  )`
  const isRoute = Prisma.sql`(
    ${explicitDomain} = 'route'
    OR (${explicitDomain} IS NULL AND NOT (${metadata} ? 'hrmRequestId'))
  )`
  if (workforce) return isWorkforce
  if (routeField) return isRoute
  return Prisma.sql`FALSE`
}
