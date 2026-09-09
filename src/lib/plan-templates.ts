// src/lib/plan-templates.ts — SERVER ONLY (imports prisma). Do not import from client components.
//
// Storage note: PlanTemplate.features/addons are native Postgres String[]. When provisioning,
// tenant-provisioning.ts serializes `features` to a JSON column via JSON.stringify (Organization.features
// is `Json`), while Organization.addons is String[]. getPlanDefaults returns plain string[] — the caller
// handles the Json serialization. Do not double-stringify here.
import { prisma } from "@/lib/prisma"
import { TENANT_PLANS, type TenantPlan } from "@/lib/tenant-plans"

export interface PlanDefaults {
  maxUsers: number
  maxContacts: number
  features: string[]
  addons: string[]
}

const LEGACY_PLAN_KEYS = new Set<string>(["starter", "professional", "enterprise"])

/**
 * Resolve provisioning defaults for a plan key.
 * - Active DB PlanTemplate wins.
 * - For the 3 legacy keys, fall back to the TENANT_PLANS const (rollout/empty-table safety).
 * - Unknown/inactive keys hard-fail (never silently default to starter).
 */
export async function getPlanDefaults(key: string): Promise<PlanDefaults> {
  const row = await prisma.planTemplate.findFirst({ where: { key, isActive: true } })
  if (row) {
    return { maxUsers: row.maxUsers, maxContacts: row.maxContacts, features: row.features, addons: row.addons }
  }
  if (LEGACY_PLAN_KEYS.has(key)) {
    const d = TENANT_PLANS[key as TenantPlan]
    console.warn(`[plans] DB miss for legacy key "${key}" — using const fallback`)
    return { maxUsers: d.maxUsers, maxContacts: d.maxContacts, features: [...d.features], addons: [...d.addons] }
  }
  throw new Error(`Unknown or inactive plan "${key}"`)
}

export async function listActivePlans() {
  return prisma.planTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })
}
