/**
 * S4 Territory auto-routing — closes TODO(S4-auto-assign).
 *
 * When a Company is created, find every ACTIVE territory whose rules
 * (country / industry / company-size) match the company's profile and
 * notify that territory's member reps. This is the "auto-assign" the
 * matcher (territory-rules.ts) was built for.
 *
 * Why notify-only (no ownership column): the Company model has no
 * territoryId / assignedTo field — territory ownership is expressed via
 * sharing rules + membership, not a column. So routing = alerting the
 * right reps. A hard company↔territory link would need a schema migration
 * (future slice); the actionable value — "the right reps hear about a new
 * company in their patch" — is delivered here without one.
 *
 * Fire-and-forget: the caller does not await this and swallows errors;
 * it must never block (or fail) company creation.
 */
import { findMatchingTerritories } from "./territory-rules"
import { createNotification } from "./notifications"

export interface RouteCompanyInput {
  orgId: string
  company: {
    id: string
    name: string
    country: string | null
    industry: string | null
    employeeCount: number | null
  }
}

/**
 * Returns the number of member-notifications sent (0 if no territory
 * matched or no territories exist). Exported for unit testing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function routeNewCompanyToTerritories(
  prisma: any,
  input: RouteCompanyInput,
): Promise<number> {
  const { orgId, company } = input

  const territories = await prisma.territory.findMany({
    where: { organizationId: orgId, isActive: true },
    select: {
      id: true,
      name: true,
      rules: true,
      members: { select: { userId: true } },
    },
  })
  if (!territories || territories.length === 0) return 0

  const matched = new Set(
    findMatchingTerritories(
      territories.map((t: { id: string; rules: unknown }) => ({
        id: t.id,
        rules: t.rules,
      })),
      {
        country: company.country,
        industry: company.industry,
        employeeCount: company.employeeCount,
      },
    ),
  )
  if (matched.size === 0) return 0

  let notified = 0
  for (const t of territories) {
    if (!matched.has(t.id)) continue
    for (const m of t.members as Array<{ userId: string }>) {
      await createNotification({
        organizationId: orgId,
        userId: m.userId,
        type: "info",
        title: "Ərazinizdə yeni şirkət",
        message: `«${company.name}» → ${t.name}`,
        entityType: "company",
        entityId: company.id,
      })
      notified++
    }
  }
  return notified
}
