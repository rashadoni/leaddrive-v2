/**
 * Re-seed Q2 2026 budget with exact data from Profitability cost model.
 *
 * Revenue: from CostModelSnapshot.serviceRevenues (monthly × 3, WITHOUT VAT)
 * Expenses: from CostModelSnapshot.serviceDetails (monthly × 3, VAT depends on type)
 *   - directLabor: salaries — NO VAT
 *   - adminShare: allocated overhead — MIXED (VAT baked in from compute.ts)
 *   - techDirect: tech infrastructure — WITH VAT (licenses, servers)
 * Shared: backOfficeCost, riskCost — MIXED
 *
 * Usage: npx tsx scripts/reseed-budget-q2-2026.ts
 */

import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient
const Q2_MONTHS = 3
const VAT_RATE = 0.18

async function main() {
  prisma = await makeScriptPrisma()
  console.log("=== Re-seed Budget Q2 2026 (Exact from Profitability) ===\n")

  const org = await prisma.organization.findFirst()
  if (!org) throw new Error("No org")
  const orgId = org.id
  console.log(`Org: ${org.name} (${orgId})\n`)

  // 1. Get latest cost model snapshot
  const snapshot = await prisma.costModelSnapshot.findFirst({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
  })
  if (!snapshot) throw new Error("No cost model snapshot found — run profitability first")

  const d: any = typeof snapshot.dataJson === "string" ? JSON.parse(snapshot.dataJson as string) : snapshot.dataJson
  console.log(`Cost model snapshot: ${snapshot.id} (${snapshot.createdAt})`)
  console.log(`Monthly totals: cost=${snapshot.totalCost}, revenue=${snapshot.totalRevenue}\n`)

  // 2. Find existing plan or create
  let plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: orgId, name: { contains: "Q2 2026" } },
  })

  if (plan) {
    // Delete all existing lines
    const deleted = await prisma.budgetLine.deleteMany({ where: { planId: plan.id } })
    console.log(`Deleted ${deleted.count} old lines from plan ${plan.id}`)
  } else {
    plan = await prisma.budgetPlan.create({
      data: {
        organizationId: orgId,
        name: "Q2 2026 — Matrix Budget",
        periodType: "quarterly",
        year: 2026,
        quarter: 2,
        status: "draft",
        notes: "Exact data from Profitability cost model. Revenue without VAT. Expenses include VAT where applicable.",
      },
    })
    console.log(`Created plan: ${plan.id}`)
  }

  // 3. Get cost types and departments
  const costTypes = await prisma.budgetCostType.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { sortOrder: "asc" },
  })
  const departments = await prisma.budgetDepartment.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { sortOrder: "asc" },
  })

  const ctMap: Record<string, string> = {}
  for (const ct of costTypes) ctMap[ct.key] = ct.id

  const deptMap: Record<string, { id: string; serviceKey: string | null; label: string; hasRevenue: boolean }> = {}
  for (const d of departments) deptMap[d.key] = { id: d.id, serviceKey: d.serviceKey, label: d.label, hasRevenue: d.hasRevenue }

  // 4. Service revenues (monthly, from cost model)
  const serviceRevenues: Record<string, number> = d.serviceRevenues || {}

  // Map department key → service key for revenue lookup
  const deptToServiceKey: Record<string, string> = {}
  for (const dept of departments) {
    if (dept.serviceKey) deptToServiceKey[dept.key] = dept.serviceKey
  }

  // 5. Service details (monthly costs per department)
  const serviceDetails: Record<string, any> = d.serviceDetails || {}

  // 6. Shared costs (monthly)
  const sharedCosts: Record<string, { amount: number; vatIncluded: boolean; note: string }> = {
    backoffice: {
      amount: d.backOfficeCost || 0,
      vatIncluded: false, // salaries + office overhead, mostly no VAT
      note: `Back office: ${Math.round(d.backOfficeCost || 0).toLocaleString()}/mo × ${Q2_MONTHS}`,
    },
    risk: {
      amount: d.riskCost || 0,
      vatIncluded: false, // calculated as % of subtotal, no separate VAT
      note: `Risk reserve 5%: ${Math.round(d.riskCost || 0).toLocaleString()}/mo × ${Q2_MONTHS}`,
    },
    misc: {
      amount: d.miscCost || 0,
      vatIncluded: false,
      note: `Misc expenses 1%: ${Math.round(d.miscCost || 0).toLocaleString()}/mo × ${Q2_MONTHS}`,
    },
    grc_direct: {
      amount: d.grcDirectCost || 0,
      vatIncluded: false,
      note: `GRC direct costs: ${Math.round(d.grcDirectCost || 0).toLocaleString()}/mo × ${Q2_MONTHS}`,
    },
  }

  const lines: any[] = []
  let sortOrder = 0

  // ── EXPENSE LINES ────────────────────────────────────────────

  // Non-shared cost types × departments
  const costTypeConfig: Record<string, { detailField: string; vatIncluded: boolean; vatRate: number | null }> = {
    labor: { detailField: "directLabor", vatIncluded: false, vatRate: null }, // salaries — no VAT
    overhead_admin: { detailField: "adminShare", vatIncluded: false, vatRate: null }, // allocated OH — mixed, but majority is rent/salaries
    overhead_tech: { detailField: "techDirect", vatIncluded: true, vatRate: VAT_RATE }, // licenses, servers — WITH VAT
  }

  for (const [ctKey, config] of Object.entries(costTypeConfig)) {
    if (!ctMap[ctKey]) continue

    for (const dept of departments) {
      if (!dept.serviceKey || dept.key === "backoffice") continue

      const detail = serviceDetails[dept.serviceKey]
      if (!detail) continue

      const monthlyAmount = detail[config.detailField] || 0
      if (monthlyAmount === 0) continue // skip zero lines

      const q2Amount = Math.round(monthlyAmount * Q2_MONTHS * 100) / 100
      const amountExVat = config.vatIncluded ? Math.round(q2Amount / (1 + VAT_RATE) * 100) / 100 : null

      sortOrder++
      lines.push({
        organizationId: orgId,
        planId: plan.id,
        category: `${costTypes.find(c => c.key === ctKey)?.label} — ${dept.label}`,
        lineType: "expense",
        plannedAmount: q2Amount,
        forecastAmount: q2Amount,
        costModelKey: `serviceDetails.${dept.serviceKey}.${config.detailField}`,
        isAutoActual: false,
        costTypeId: ctMap[ctKey],
        departmentId: dept.id,
        department: dept.label,
        vatIncluded: config.vatIncluded,
        vatRate: config.vatRate,
        amountExVat,
        sortOrder,
        notes: `${Math.round(monthlyAmount).toLocaleString()}/mo × ${Q2_MONTHS} = ${Math.round(q2Amount).toLocaleString()}${config.vatIncluded ? " (incl. VAT 18%)" : " (no VAT)"}`,
      })
    }
  }

  // Shared cost types
  for (const [ctKey, info] of Object.entries(sharedCosts)) {
    if (!ctMap[ctKey] || info.amount === 0) continue

    const q2Amount = Math.round(info.amount * Q2_MONTHS * 100) / 100
    sortOrder++
    lines.push({
      organizationId: orgId,
      planId: plan.id,
      category: costTypes.find(c => c.key === ctKey)?.label || ctKey,
      lineType: "expense",
      plannedAmount: q2Amount,
      forecastAmount: q2Amount,
      isAutoActual: false,
      costTypeId: ctMap[ctKey],
      departmentId: null,
      department: null,
      vatIncluded: info.vatIncluded,
      vatRate: null,
      amountExVat: null,
      sortOrder,
      notes: info.note,
    })
  }

  // ── REVENUE LINES ────────────────────────────────────────────
  // Revenue from cost model is WITHOUT VAT (client service fees, net)

  for (const dept of departments) {
    if (!dept.hasRevenue || !dept.serviceKey) continue

    const monthlyRevenue = serviceRevenues[dept.serviceKey] || 0
    if (monthlyRevenue === 0) continue

    const q2Revenue = Math.round(monthlyRevenue * Q2_MONTHS * 100) / 100
    sortOrder++
    lines.push({
      organizationId: orgId,
      planId: plan.id,
      category: `Выручка — ${dept.label}`,
      lineType: "revenue",
      plannedAmount: q2Revenue,
      forecastAmount: q2Revenue,
      costModelKey: `serviceRevenues.${dept.serviceKey}`,
      isAutoActual: false,
      costTypeId: null,
      departmentId: dept.id,
      department: dept.label,
      vatIncluded: false, // revenue is always NET (without VAT)
      vatRate: VAT_RATE,
      amountExVat: q2Revenue, // same as planned since vatIncluded=false
      sortOrder,
      notes: `${Math.round(monthlyRevenue).toLocaleString()}/mo × ${Q2_MONTHS} (without VAT)`,
    })
  }

  // Create all lines
  const created = await prisma.$transaction(
    lines.map((data) => prisma.budgetLine.create({ data }))
  )

  // Summary
  const expenseLines = lines.filter(l => l.lineType === "expense")
  const revenueLines = lines.filter(l => l.lineType === "revenue")
  const totalExpense = expenseLines.reduce((s, l) => s + l.plannedAmount, 0)
  const totalRevenue = revenueLines.reduce((s, l) => s + l.plannedAmount, 0)
  const vatLines = lines.filter(l => l.vatIncluded)
  const noVatLines = lines.filter(l => !l.vatIncluded)

  console.log(`\n✓ Created ${created.length} lines`)
  console.log(`  Expenses: ${expenseLines.length} lines, total: ${Math.round(totalExpense).toLocaleString()} ₼`)
  console.log(`  Revenue:  ${revenueLines.length} lines, total: ${Math.round(totalRevenue).toLocaleString()} ₼`)
  console.log(`  With VAT: ${vatLines.length} lines`)
  console.log(`  No VAT:   ${noVatLines.length} lines`)

  console.log(`\n── Expense breakdown ──`)
  for (const line of expenseLines) {
    const vat = line.vatIncluded ? " [VAT✓]" : ""
    console.log(`  ${line.category}: ${Math.round(line.plannedAmount).toLocaleString()}${vat}`)
  }

  console.log(`\n── Revenue breakdown ──`)
  for (const line of revenueLines) {
    console.log(`  ${line.category}: ${Math.round(line.plannedAmount).toLocaleString()} (ex VAT)`)
  }

  console.log(`\n── Margin ──`)
  console.log(`  Revenue:  ${Math.round(totalRevenue).toLocaleString()}`)
  console.log(`  Expenses: ${Math.round(totalExpense).toLocaleString()}`)
  console.log(`  Margin:   ${Math.round(totalRevenue - totalExpense).toLocaleString()}`)

  console.log(`\nPlan ID: ${plan.id}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
