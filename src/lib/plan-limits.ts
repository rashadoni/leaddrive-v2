// NOTE (configurable-plans audit, 2026-06-09): the plan-NAME-based helpers below
// (`getLimit`/`checkLimit`/`getRemainingLimit`/`getPercentageUsed`) read the legacy
// `PLANS` const and are NOT wired into any runtime route — they are referenced only by
// `lib-lead-segment-contact.test.ts`. Live limit enforcement uses the DB-backed
// `checkUserLimit`/`checkContactLimit` (below), which read `Organization.maxUsers/maxContacts`
// and are therefore safe for custom (DB-backed) plan keys. Do not add new callers of the
// plan-name helpers — they return 0 for unknown plan keys.
import { PLANS, type PlanId } from "@/lib/modules"
import { prisma } from "@/lib/prisma"

export type Resource = "users" | "contacts" | "ai_calls"

interface OrgContext {
  plan: string
  currentUsage?: Record<Resource, number>
}

function getLimit(plan: string, resource: Resource): number {
  const planLimits = PLANS[plan as PlanId]?.limits
  if (!planLimits) return 0

  if (resource === "users") return planLimits.users
  if (resource === "contacts") return planLimits.contacts
  if (resource === "ai_calls") return 1000 // Default AI call limit

  return 0
}

export function checkLimit(
  org: OrgContext,
  resource: Resource,
  current: number = 0
): boolean {
  const limit = getLimit(org.plan, resource)
  if (limit === -1) return true // Unlimited

  const usage = org.currentUsage?.[resource] ?? current
  return usage < limit
}

export function getRemainingLimit(
  org: OrgContext,
  resource: Resource,
  current: number = 0
): number {
  const limit = getLimit(org.plan, resource)
  if (limit === -1) return Infinity

  const usage = org.currentUsage?.[resource] ?? current
  return Math.max(0, limit - usage)
}

export function getPercentageUsed(
  org: OrgContext,
  resource: Resource,
  current: number = 0
): number {
  const limit = getLimit(org.plan, resource)
  if (limit === -1 || limit === 0) return 0

  const usage = org.currentUsage?.[resource] ?? current
  return Math.min(100, (usage / limit) * 100)
}

/**
 * Check if organization can add more users (DB-backed check using org.maxUsers).
 */
export async function checkUserLimit(orgId: string): Promise<{ allowed: boolean; message?: string }> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { maxUsers: true, _count: { select: { users: true } } },
  })
  if (!org) return { allowed: false, message: "Organization not found" }
  if (org.maxUsers === -1) return { allowed: true }
  if (org._count.users >= org.maxUsers) {
    return {
      allowed: false,
      message: `User limit reached (${org._count.users}/${org.maxUsers}). Upgrade your plan to add more users.`,
    }
  }
  return { allowed: true }
}

/**
 * Check if organization can add more contacts (DB-backed check using org.maxContacts).
 */
export async function checkContactLimit(orgId: string): Promise<{ allowed: boolean; message?: string }> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { maxContacts: true, _count: { select: { contacts: true } } },
  })
  if (!org) return { allowed: false, message: "Organization not found" }
  if (org.maxContacts === -1) return { allowed: true }
  if (org._count.contacts >= org.maxContacts) {
    return {
      allowed: false,
      message: `Contact limit reached (${org._count.contacts}/${org.maxContacts}). Upgrade your plan to add more contacts.`,
    }
  }
  return { allowed: true }
}
