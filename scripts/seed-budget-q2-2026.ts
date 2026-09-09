/**
 * Seed script: Create Q2 2026 budget plan with matrix lines.
 * Revenue data from "Copy of Sales forecast 2026.xlsx".
 * Expense lines left at 0 for manual entry.
 *
 * Usage: npx tsx scripts/seed-budget-q2-2026.ts
 */

import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

// Auto-detect: use first org in DB (works for both local and production)
let ORG_ID = ""

// ── Default cost types (created if not exist) ──────────────────────────
const DEFAULT_COST_TYPES = [
  { key: "labor", label: "ФОТ (зарплаты)", costModelPattern: "serviceDetails.{dept}.directLabor", isShared: false, sortOrder: 1 },
  { key: "overhead_admin", label: "Админ. накладные", costModelPattern: "serviceDetails.{dept}.adminShare", isShared: false, sortOrder: 2 },
  { key: "overhead_tech", label: "IT-инфраструктура", costModelPattern: "serviceDetails.{dept}.techDirect", isShared: false, sortOrder: 3 },
  { key: "backoffice", label: "Бэк-офис", costModelPattern: "backOfficeCost", isShared: true, allocationMethod: "proportional", sortOrder: 4 },
  { key: "risk", label: "Риск-резерв", costModelPattern: "riskCost", isShared: true, allocationMethod: "proportional", sortOrder: 5 },
  { key: "misc", label: "Прочие расходы", costModelPattern: "misc", isShared: true, allocationMethod: "proportional", sortOrder: 6 },
  { key: "grc_direct", label: "GRC прямые", costModelPattern: "grcDirectCost", isShared: true, sortOrder: 7 },
]

// ── Default departments (created if not exist) ─────────────────────────
const DEFAULT_DEPARTMENTS = [
  { key: "it", label: "Daimi IT", serviceKey: "permanent_it", hasRevenue: true, sortOrder: 1 },
  { key: "infosec", label: "InfoSec", serviceKey: "infosec", hasRevenue: true, sortOrder: 2 },
  { key: "erp", label: "ERP", serviceKey: "erp", hasRevenue: true, sortOrder: 3 },
  { key: "grc", label: "GRC", serviceKey: "grc", hasRevenue: true, sortOrder: 4 },
  { key: "pm", label: "Projects", serviceKey: "pm", hasRevenue: true, sortOrder: 5 },
  { key: "helpdesk", label: "Additional IT", serviceKey: "helpdesk", hasRevenue: true, sortOrder: 6 },
  { key: "waf", label: "WAF", serviceKey: "waf", hasRevenue: true, sortOrder: 7 },
  { key: "saas", label: "SaaS", serviceKey: "saas", hasRevenue: true, sortOrder: 8 },
  { key: "backoffice", label: "BackOffice", serviceKey: null, hasRevenue: false, sortOrder: 9 },
]

// ── Q2 2026 revenue from Excel (April + May + June) ───────────────────
// Source: "Copy of Sales forecast 2026.xlsx" → "2026 Forecast Monthly" sheet
const Q2_REVENUE: Record<string, number> = {
  it:       369_241 + 375_692 + 375_692,   // Permanent IT service = 1,120,625
  infosec:  228_887 + 233_122 + 233_122,   // Information security  = 695,131
  erp:       17_185 +  17_254 +  17_254,   // ERP                   = 51,693
  grc:            0 +       0 +       0,   // GRC                   = 0
  pm:         5_792 +   3_128 +   3_128,   // Projects              = 12,048
  helpdesk:  83_523 +  86_053 +  86_053,   // Additional IT         = 255,629
  waf:        3_583 +   3_583 +   3_583,   // WAF                   = 10,749
  saas:      19_320 +  19_803 +  19_803,   // SaaS                  = 58,926
}

async function main() {
  prisma = await makeScriptPrisma()
  console.log("=== Seed Budget Q2 2026 ===\n")

  // Auto-detect org
  const org = await prisma.organization.findFirst()
  if (!org) throw new Error("No organization found in database")
  ORG_ID = org.id
  console.log(`Org: ${org.name} (${ORG_ID})\n`)

  // 1. Ensure cost types exist
  console.log("1. Ensuring cost types...")
  const costTypeMap: Record<string, string> = {} // key → id
  for (const ct of DEFAULT_COST_TYPES) {
    const existing = await prisma.budgetCostType.findFirst({
      where: { organizationId: ORG_ID, key: ct.key },
    })
    if (existing) {
      costTypeMap[ct.key] = existing.id
      console.log(`   ✓ ${ct.key} exists (${existing.id})`)
    } else {
      const created = await prisma.budgetCostType.create({
        data: { organizationId: ORG_ID, ...ct },
      })
      costTypeMap[ct.key] = created.id
      console.log(`   + ${ct.key} created (${created.id})`)
    }
  }

  // 2. Ensure departments exist
  console.log("\n2. Ensuring departments...")
  const deptMap: Record<string, { id: string; serviceKey: string | null; hasRevenue: boolean; label: string }> = {}
  for (const d of DEFAULT_DEPARTMENTS) {
    const existing = await prisma.budgetDepartment.findFirst({
      where: { organizationId: ORG_ID, key: d.key },
    })
    if (existing) {
      deptMap[d.key] = { id: existing.id, serviceKey: existing.serviceKey, hasRevenue: existing.hasRevenue, label: existing.label }
      console.log(`   ✓ ${d.key} exists (${existing.id})`)
    } else {
      const created = await prisma.budgetDepartment.create({
        data: { organizationId: ORG_ID, ...d },
      })
      deptMap[d.key] = { id: created.id, serviceKey: created.serviceKey, hasRevenue: created.hasRevenue, label: created.label }
      console.log(`   + ${d.key} created (${created.id})`)
    }
  }

  // 3. Create budget plan
  console.log("\n3. Creating budget plan Q2 2026...")
  const plan = await prisma.budgetPlan.create({
    data: {
      organizationId: ORG_ID,
      name: "Q2 2026 — Matrix Budget",
      periodType: "quarterly",
      year: 2026,
      quarter: 2,
      status: "draft",
      notes: "Matrix budget plan seeded from Excel forecast. Revenue from 'Sales forecast 2026.xlsx'. Expenses to be entered manually.",
    },
  })
  console.log(`   ✓ Plan created: ${plan.id} (${plan.name})`)

  // 4. Generate matrix lines
  console.log("\n4. Generating matrix lines...")
  const lines: any[] = []
  let sortOrder = 0

  // Non-shared cost types × departments (expense lines)
  const nonSharedTypes = DEFAULT_COST_TYPES.filter((ct) => !ct.isShared)
  const sharedTypes = DEFAULT_COST_TYPES.filter((ct) => ct.isShared)
  const activeDepts = DEFAULT_DEPARTMENTS.filter((d) => d.serviceKey)

  for (const ct of nonSharedTypes) {
    for (const dept of activeDepts) {
      sortOrder++
      const costModelKey = ct.costModelPattern.includes("{dept}")
        ? ct.costModelPattern.replace("{dept}", dept.serviceKey!)
        : ct.costModelPattern
      lines.push({
        organizationId: ORG_ID,
        planId: plan.id,
        category: `${ct.label} — ${deptMap[dept.key].label}`,
        lineType: "expense",
        plannedAmount: 0,
        forecastAmount: 0,
        costModelKey,
        isAutoActual: false, // manual entry, no integration
        costTypeId: costTypeMap[ct.key],
        departmentId: deptMap[dept.key].id,
        department: deptMap[dept.key].label,
        sortOrder,
      })
    }
  }

  // Shared cost types (one line each, no department)
  for (const ct of sharedTypes) {
    sortOrder++
    lines.push({
      organizationId: ORG_ID,
      planId: plan.id,
      category: ct.label,
      lineType: "expense",
      plannedAmount: 0,
      forecastAmount: 0,
      costModelKey: ct.costModelPattern,
      isAutoActual: false,
      costTypeId: costTypeMap[ct.key],
      departmentId: null,
      department: null,
      sortOrder,
    })
  }

  // Revenue lines per department (with Excel data)
  for (const dept of DEFAULT_DEPARTMENTS) {
    if (!dept.hasRevenue || !dept.serviceKey) continue
    sortOrder++
    const revenue = Q2_REVENUE[dept.key] || 0
    lines.push({
      organizationId: ORG_ID,
      planId: plan.id,
      category: `Выручка — ${deptMap[dept.key].label}`,
      lineType: "revenue",
      plannedAmount: revenue,
      forecastAmount: revenue,
      costModelKey: `serviceRevenues.${dept.serviceKey}`,
      isAutoActual: false,
      costTypeId: null,
      departmentId: deptMap[dept.key].id,
      department: deptMap[dept.key].label,
      sortOrder,
    })
  }

  // Batch create all lines
  const created = await prisma.$transaction(
    lines.map((data) => prisma.budgetLine.create({ data }))
  )

  const expenseCount = lines.filter((l) => l.lineType === "expense").length
  const revenueCount = lines.filter((l) => l.lineType === "revenue").length
  const totalRevenue = Object.values(Q2_REVENUE).reduce((s, v) => s + v, 0)

  console.log(`   ✓ Created ${created.length} lines (${expenseCount} expense + ${revenueCount} revenue)`)

  console.log("\n5. Revenue summary (Q2 2026, AZN):")
  for (const [key, val] of Object.entries(Q2_REVENUE)) {
    if (val > 0) {
      console.log(`   ${deptMap[key]?.label || key}: ${val.toLocaleString()}`)
    }
  }
  console.log(`   ─────────────────────`)
  console.log(`   TOTAL: ${totalRevenue.toLocaleString()}`)

  console.log("\n=== Done! ===")
  console.log(`Plan ID: ${plan.id}`)
  console.log(`Open: http://localhost:3000/budgeting → select "${plan.name}"`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
