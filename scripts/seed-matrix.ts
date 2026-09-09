/**
 * Seed default BudgetCostType + BudgetDepartment for an organization.
 *
 * Usage:
 *   npx tsx scripts/seed-matrix.ts [orgId]
 *
 * If orgId is omitted, seeds the first organization found.
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

const DEFAULT_COST_TYPES = [
  {
    key: "labor",
    label: "ФОТ (зарплаты)",
    costModelPattern: "serviceDetails.{dept}.directLabor",
    isShared: false,
    color: "#3B82F6", // blue
    sortOrder: 1,
  },
  {
    key: "overhead_admin",
    label: "Админ. накладные",
    costModelPattern: "serviceDetails.{dept}.adminShare",
    isShared: false,
    color: "#F59E0B", // amber
    sortOrder: 2,
  },
  {
    key: "overhead_tech",
    label: "IT-инфраструктура",
    costModelPattern: "serviceDetails.{dept}.techDirect",
    isShared: false,
    color: "#8B5CF6", // violet
    sortOrder: 3,
  },
  {
    key: "backoffice",
    label: "Бэк-офис",
    costModelPattern: "backOfficeCost",
    isShared: true,
    allocationMethod: null,
    color: "#6B7280", // gray
    sortOrder: 4,
  },
  {
    key: "risk",
    label: "Риск-резерв",
    costModelPattern: "riskCost",
    isShared: true,
    allocationMethod: "proportional",
    color: "#EF4444", // red
    sortOrder: 5,
  },
  {
    key: "misc",
    label: "Прочие",
    costModelPattern: "misc",
    isShared: true,
    allocationMethod: "proportional",
    color: "#64748B", // slate
    sortOrder: 6,
  },
  {
    key: "grc_direct",
    label: "GRC прямые",
    costModelPattern: "grcDirectCost",
    isShared: true,
    allocationMethod: null,
    color: "#14B8A6", // teal
    sortOrder: 7,
  },
]

const DEFAULT_DEPARTMENTS = [
  { key: "it",        label: "Daimi IT",   serviceKey: "permanent_it", hasRevenue: true, color: "#3B82F6", sortOrder: 1 },
  { key: "infosec",   label: "InfoSec",    serviceKey: "infosec",      hasRevenue: true, color: "#8B5CF6", sortOrder: 2 },
  { key: "erp",       label: "ERP",        serviceKey: "erp",          hasRevenue: true, color: "#F59E0B", sortOrder: 3 },
  { key: "grc",       label: "GRC",        serviceKey: "grc",          hasRevenue: true, color: "#14B8A6", sortOrder: 4 },
  { key: "pm",        label: "PM",         serviceKey: "projects",     hasRevenue: true, color: "#EC4899", sortOrder: 5 },
  { key: "helpdesk",  label: "HelpDesk",   serviceKey: "helpdesk",     hasRevenue: true, color: "#22C55E", sortOrder: 6 },
  { key: "cloud",     label: "Cloud",      serviceKey: "cloud",        hasRevenue: true, color: "#06B6D4", sortOrder: 7 },
  { key: "backoffice", label: "BackOffice", serviceKey: null,           hasRevenue: false, color: "#6B7280", sortOrder: 8 },
]

async function main() {
  prisma = await makeScriptPrisma()
  const orgId = process.argv[2]
    || (await prisma.organization.findFirst().then((o) => o?.id))

  if (!orgId) {
    console.error("No organization found. Provide orgId as argument.")
    process.exit(1)
  }

  console.log(`Seeding matrix budget config for org: ${orgId}`)

  // Upsert cost types
  for (const ct of DEFAULT_COST_TYPES) {
    await prisma.budgetCostType.upsert({
      where: { organizationId_key: { organizationId: orgId, key: ct.key } },
      create: { organizationId: orgId, ...ct },
      update: { label: ct.label, costModelPattern: ct.costModelPattern, isShared: ct.isShared, color: ct.color, sortOrder: ct.sortOrder },
    })
    console.log(`  ✓ CostType: ${ct.key} → ${ct.label}`)
  }

  // Upsert departments
  for (const dept of DEFAULT_DEPARTMENTS) {
    await prisma.budgetDepartment.upsert({
      where: { organizationId_key: { organizationId: orgId, key: dept.key } },
      create: { organizationId: orgId, ...dept },
      update: { label: dept.label, serviceKey: dept.serviceKey, hasRevenue: dept.hasRevenue, color: dept.color, sortOrder: dept.sortOrder },
    })
    console.log(`  ✓ Department: ${dept.key} → ${dept.label}`)
  }

  console.log("\nDone! Seeded cost types and departments.")
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
