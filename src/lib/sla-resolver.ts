import { prisma } from "@/lib/prisma"

/**
 * SLA window for a ticket. All three fields are present together (a policy
 * matched) or all absent (no policy → ticket carries no SLA, same as before
 * this resolver existed). Safe to spread straight into a `prisma.ticket.create`
 * / `update` `data` block: when empty, Prisma drops the `undefined` keys.
 */
export interface ResolvedSla {
  slaDueAt?: Date
  slaFirstResponseDueAt?: Date
  slaPolicyName?: string
}

/** The four priority tiers an SlaPolicy is keyed by AND the only values the SLA
 *  escalation cron's `increase_priority` step understands (PRIORITY_ORDER in
 *  cron/sla-escalation/route.ts). The ticket `priority` column is free-form
 *  text, and some inbound paths (WhatsApp AI) historically wrote "normal" — a
 *  value that matches no policy AND makes the cron's `indexOf` return -1 →
 *  silent downgrade to "low". Callers writing a ticket from a free-form source
 *  should run the value through `normalizeTicketPriority` first. */
export const PRIORITY_TIERS = ["low", "medium", "high", "critical"] as const
export type PriorityTier = (typeof PRIORITY_TIERS)[number]

const POLICY_PRIORITIES = new Set<string>(PRIORITY_TIERS)

/** Coerce a free-form / possibly non-tier priority to a valid tier. Anything
 *  not in {low,medium,high,critical} (including "normal", "", null) → "medium".
 *  Single source of truth for both the SLA-window lookup and ticket writes. */
export function normalizeTicketPriority(priority?: string | null): PriorityTier {
  const p = (priority || "").toLowerCase()
  return (POLICY_PRIORITIES.has(p) ? p : "medium") as PriorityTier
}

/**
 * Resolve the SLA window for a ticket — the single source of truth shared by
 * every ticket-creation path and by reopen.
 *
 * Resolution order (mirrors the original inline logic in ticket-factory.ts):
 *   1. Company-assigned SlaPolicy (when the ticket has a companyId).
 *   2. Active SlaPolicy matching the ticket priority.
 *   3. None → returns `{}` (ticket has no SLA).
 *
 * MUST run inside the tenant RLS scope (or an explicit bypass): it reads the
 * `company` and `slaPolicy` tables, which are RLS-protected.
 *
 * @param opts.now  Epoch millis to anchor the due dates to. Defaults to
 *                  `Date.now()`, which is what every caller uses in production
 *                  (incl. reopen). Currently only the unit test passes an
 *                  explicit value, to make the due-date math deterministic.
 */
type SlaPolicyRow = {
  id: string
  name: string
  resolutionHours: number
  firstResponseHours: number
}

export async function resolveTicketSla(
  orgId: string,
  opts: { companyId?: string | null; priority?: string | null; now?: number },
): Promise<ResolvedSla> {
  const priority = normalizeTicketPriority(opts.priority)

  let slaPolicy: SlaPolicyRow | null = null

  if (opts.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: opts.companyId, organizationId: orgId },
      select: { slaPolicy: true },
    })
    if (company?.slaPolicy) slaPolicy = company.slaPolicy as SlaPolicyRow
  }

  if (!slaPolicy) {
    slaPolicy = (await prisma.slaPolicy.findFirst({
      where: { organizationId: orgId, priority, isActive: true },
    })) as SlaPolicyRow | null
  }

  if (!slaPolicy) return {}

  const base = opts.now ?? Date.now()
  return {
    slaDueAt: new Date(base + slaPolicy.resolutionHours * 3600000),
    slaFirstResponseDueAt: new Date(base + slaPolicy.firstResponseHours * 3600000),
    slaPolicyName: slaPolicy.name,
  }
}
