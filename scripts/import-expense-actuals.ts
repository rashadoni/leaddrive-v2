/**
 * Import expense actuals from cost model into budget plan.
 * Reads cost model data dynamically (NOT hardcoded),
 * computes via the same engine as Прибыльность page,
 * and creates BudgetActual records for Q1-Q2 2026.
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { computeCostModel } from "../src/lib/cost-model/compute"
import type {
  CostModelParams,
  OverheadItem,
  EmployeeRow,
  ClientCompany,
  ClientServiceRow,
  PricingRevenueRow,
} from "../src/lib/cost-model/types"

let prisma!: PrismaClient

const PLAN_ID = "cmn802plo0001tdgm19xmpo0q"
const ORG_ID = "cmmxg74k10000td3rr37dl6am"

// Service key → budget department name
const SVC_TO_DEPT: Record<string, string> = {
  permanent_it: "Daimi IT",
  infosec: "InfoSec",
  erp: "ERP",
  grc: "GRC",
  projects: "PM",
  helpdesk: "HelpDesk",
  cloud: "Cloud",
  waf: "WAF",
}

const MONTHS = [
  { label: "Январь 2026", date: "2026-01-31" },
  { label: "Февраль 2026", date: "2026-02-28" },
  { label: "Март 2026", date: "2026-03-31" },
  { label: "Апрель 2026", date: "2026-04-30" },
  { label: "Май 2026", date: "2026-05-31" },
  { label: "Июнь 2026", date: "2026-06-30" },
]

async function loadAndCompute(orgId: string) {
  const [paramsRow, overheadRows, employeeRows, companies, services, pricingProfiles] = await Promise.all([
    prisma.pricingParameters.findUnique({ where: { organizationId: orgId } }),
    prisma.overheadCost.findMany({ where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } }),
    prisma.costEmployee.findMany({ where: { organizationId: orgId } }),
    prisma.company.findMany({
      where: { organizationId: orgId, category: "client" },
      select: { id: true, name: true, costCode: true, userCount: true },
    }),
    prisma.clientService.findMany({ where: { organizationId: orgId, isActive: true } }),
    prisma.pricingProfile.findMany({
      where: { organizationId: orgId },
      select: { companyId: true, monthlyTotal: true },
    }),
  ])

  const params: CostModelParams = paramsRow
    ? {
        totalUsers: paramsRow.totalUsers,
        totalEmployees: paramsRow.totalEmployees,
        technicalStaff: paramsRow.technicalStaff,
        backOfficeStaff: paramsRow.backOfficeStaff,
        monthlyWorkHours: paramsRow.monthlyWorkHours,
        vatRate: paramsRow.vatRate,
        employerTaxRate: paramsRow.employerTaxRate,
        riskRate: paramsRow.riskRate,
        miscExpenseRate: paramsRow.miscExpenseRate,
        fixedOverheadRatio: paramsRow.fixedOverheadRatio,
      }
    : {
        totalUsers: 3566, totalEmployees: 137, technicalStaff: 107,
        backOfficeStaff: 30, monthlyWorkHours: 160, vatRate: 0.18,
        employerTaxRate: 0.175, riskRate: 0.05, miscExpenseRate: 0.01,
        fixedOverheadRatio: 0.25,
      }

  const overhead: OverheadItem[] = overheadRows.map((r: any) => ({
    id: r.id, category: r.category, label: r.label, amount: r.amount,
    isAnnual: r.isAnnual, hasVat: r.hasVat, isAdmin: r.isAdmin,
    targetService: r.targetService ?? "", amortMonths: (r as any).amortMonths ?? 0,
    sortOrder: r.sortOrder, notes: r.notes ?? "",
  }))

  const emps: EmployeeRow[] = employeeRows.map((r: any) => ({
    id: r.id, department: r.department, position: r.position, count: r.count,
    netSalary: r.netSalary, grossSalary: r.grossSalary, superGross: r.superGross,
    inOverhead: r.inOverhead, notes: r.notes ?? "",
  }))

  const clientComps: ClientCompany[] = companies.map((c: any) => ({
    id: c.id, name: c.name, costCode: c.costCode ?? "", userCount: c.userCount,
  }))

  const clientSvcs: ClientServiceRow[] = services.map((s: any) => ({
    id: s.id, companyId: s.companyId, serviceType: s.serviceType,
    monthlyRevenue: s.monthlyRevenue, isActive: s.isActive, notes: s.notes ?? "",
  }))

  const pricingRevenues: PricingRevenueRow[] = pricingProfiles
    .filter((p: any) => p.companyId)
    .map((p: any) => ({ companyId: p.companyId!, monthlyTotal: p.monthlyTotal }))

  return computeCostModel(params, overhead, emps, clientComps, clientSvcs, pricingRevenues)
}

async function main() {
  prisma = await makeScriptPrisma()
  console.log("=== Import Expense Actuals from Cost Model ===\n")

  // 1. Compute cost model
  const result = await loadAndCompute(ORG_ID)

  console.log("Cost Model computed:")
  console.log(`  Grand Total G (monthly): ${result.grandTotalG.toLocaleString()} ₼`)
  console.log("")

  // 2. Get budget lines to match categories
  const expenseLines = await prisma.budgetLine.findMany({
    where: { planId: PLAN_ID, lineType: "expense" },
  })

  console.log(`Budget expense lines: ${expenseLines.length}`)
  console.log("")

  // 3. For each expense line, resolve the cost model value and create actuals
  let created = 0
  let totalExpenseMonthly = 0

  for (const line of expenseLines) {
    if (!line.costModelKey) continue

    // Resolve value from cost model
    const parts = line.costModelKey.split(".")
    let monthlyAmount = 0

    if (parts[0] === "serviceDetails" && parts.length === 3) {
      const svc = parts[1]
      const field = parts[2]
      const detail = result.serviceDetails[svc]
      if (detail && field in detail) {
        monthlyAmount = (detail as any)[field] ?? 0
      }
    }

    if (monthlyAmount <= 0) {
      console.log(`  SKIP ${line.category}: costModelKey=${line.costModelKey} → 0`)
      continue
    }

    // Update planned amount (annual = monthly × 12)
    const annualAmount = Math.round(monthlyAmount * 12 * 100) / 100
    await prisma.budgetLine.update({
      where: { id: line.id },
      data: { plannedAmount: annualAmount, isAutoPlanned: false },
    })

    totalExpenseMonthly += monthlyAmount
    console.log(`  ${line.category}: ${monthlyAmount.toLocaleString()} ₼/мес (план: ${annualAmount.toLocaleString()} ₼/год)`)

    // Create actuals for each month
    for (const month of MONTHS) {
      await prisma.budgetActual.create({
        data: {
          organizationId: ORG_ID,
          planId: PLAN_ID,
          category: line.category,
          department: line.department ?? undefined,
          lineType: "expense",
          actualAmount: monthlyAmount,
          expenseDate: month.date,
          description: `Факт расходов — ${month.label}`,
        },
      })
      created++
    }
  }

  console.log("")
  console.log(`✅ Created ${created} expense actual records`)
  console.log(`   Monthly expense total: ${totalExpenseMonthly.toLocaleString()} ₼`)
  console.log(`   6-month total: ${(totalExpenseMonthly * 6).toLocaleString()} ₼`)

  // 4. Summary
  const summary = await prisma.budgetActual.groupBy({
    by: ["lineType"],
    where: { planId: PLAN_ID },
    _sum: { actualAmount: true },
    _count: true,
  })

  console.log("\n=== Full Summary ===")
  for (const row of summary) {
    console.log(`  ${row.lineType}: ${row._count} records, total ${row._sum.actualAmount?.toLocaleString()} ₼`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("ERROR:", e)
  prisma.$disconnect()
  process.exit(1)
})
