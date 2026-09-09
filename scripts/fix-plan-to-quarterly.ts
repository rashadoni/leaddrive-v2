/**
 * Fix planned amounts: read plan periodType from DB,
 * compute correct multiplier (quarterly=3, annual=12, monthly=1),
 * recalculate plannedAmount for ALL lines dynamically.
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { computeCostModel } from "../src/lib/cost-model/compute"
import type {
  CostModelParams, OverheadItem, EmployeeRow,
  ClientCompany, ClientServiceRow, PricingRevenueRow,
} from "../src/lib/cost-model/types"

let prisma!: PrismaClient

const PLAN_ID = "cmn802plo0001tdgm19xmpo0q"
const ORG_ID = "cmmxg74k10000td3rr37dl6am"

// Revenue monthly amounts from Excel
const REVENUE_MONTHLY: Record<string, number> = {
  "Выручка — Daimi IT": 305057.32,
  "Выручка — ERP": 14130.87,
  "Выручка — InfoSec": 186798.21,
  "Выручка — GRC": 0,
  "Выручка — PM": 0,
  "Выручка — HelpDesk": 70785.0,
  "Выручка — WAF": 3116.0,
  "Выручка — Cloud": 17220.32,
}

async function loadCostModel(orgId: string) {
  const [paramsRow, overheadRows, employeeRows, companies, services, pricingProfiles] = await Promise.all([
    prisma.pricingParameters.findUnique({ where: { organizationId: orgId } }),
    prisma.overheadCost.findMany({ where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } }),
    prisma.costEmployee.findMany({ where: { organizationId: orgId } }),
    prisma.company.findMany({ where: { organizationId: orgId, category: "client" }, select: { id: true, name: true, costCode: true, userCount: true } }),
    prisma.clientService.findMany({ where: { organizationId: orgId, isActive: true } }),
    prisma.pricingProfile.findMany({ where: { organizationId: orgId }, select: { companyId: true, monthlyTotal: true } }),
  ])
  const params: CostModelParams = paramsRow
    ? { totalUsers: paramsRow.totalUsers, totalEmployees: paramsRow.totalEmployees, technicalStaff: paramsRow.technicalStaff, backOfficeStaff: paramsRow.backOfficeStaff, monthlyWorkHours: paramsRow.monthlyWorkHours, vatRate: paramsRow.vatRate, employerTaxRate: paramsRow.employerTaxRate, riskRate: paramsRow.riskRate, miscExpenseRate: paramsRow.miscExpenseRate, fixedOverheadRatio: paramsRow.fixedOverheadRatio }
    : { totalUsers: 3566, totalEmployees: 137, technicalStaff: 107, backOfficeStaff: 30, monthlyWorkHours: 160, vatRate: 0.18, employerTaxRate: 0.175, riskRate: 0.05, miscExpenseRate: 0.01, fixedOverheadRatio: 0.25 }
  const overhead: OverheadItem[] = overheadRows.map((r: any) => ({ id: r.id, category: r.category, label: r.label, amount: r.amount, isAnnual: r.isAnnual, hasVat: r.hasVat, isAdmin: r.isAdmin, targetService: r.targetService ?? "", amortMonths: (r as any).amortMonths ?? 0, sortOrder: r.sortOrder, notes: r.notes ?? "" }))
  const emps: EmployeeRow[] = employeeRows.map((r: any) => ({ id: r.id, department: r.department, position: r.position, count: r.count, netSalary: r.netSalary, grossSalary: r.grossSalary, superGross: r.superGross, inOverhead: r.inOverhead, notes: r.notes ?? "" }))
  const clientComps: ClientCompany[] = companies.map((c: any) => ({ id: c.id, name: c.name, costCode: c.costCode ?? "", userCount: c.userCount }))
  const clientSvcs: ClientServiceRow[] = services.map((s: any) => ({ id: s.id, companyId: s.companyId, serviceType: s.serviceType, monthlyRevenue: s.monthlyRevenue, isActive: s.isActive, notes: s.notes ?? "" }))
  const pricingRevenues: PricingRevenueRow[] = pricingProfiles.filter((p: any) => p.companyId).map((p: any) => ({ companyId: p.companyId!, monthlyTotal: p.monthlyTotal }))
  return computeCostModel(params, overhead, emps, clientComps, clientSvcs, pricingRevenues)
}

async function main() {
  prisma = await makeScriptPrisma()
  // 1. Read plan from DB to get periodType
  const plan = await prisma.budgetPlan.findUnique({ where: { id: PLAN_ID } })
  if (!plan) { console.error("Plan not found!"); return }

  const multiplier = plan.periodType === "quarterly" ? 3 : plan.periodType === "annual" ? 12 : 1
  console.log(`=== Fix Plan: "${plan.name}" ===`)
  console.log(`Period: ${plan.periodType}, Year: ${plan.year}, Quarter: ${plan.quarter}`)
  console.log(`Multiplier: monthly × ${multiplier}\n`)

  // 2. Compute cost model for expenses
  const costModel = await loadCostModel(ORG_ID)
  console.log(`Cost Model Grand Total G (monthly): ${costModel.grandTotalG.toLocaleString()} ₼\n`)

  // 3. Update ALL budget lines
  const lines = await prisma.budgetLine.findMany({ where: { planId: PLAN_ID } })

  for (const line of lines) {
    let monthlyAmount = 0

    if (line.lineType === "revenue") {
      monthlyAmount = REVENUE_MONTHLY[line.category] ?? 0
    } else if (line.costModelKey) {
      // Resolve from cost model
      const parts = line.costModelKey.split(".")
      if (parts[0] === "serviceDetails" && parts.length === 3) {
        const svc = parts[1]
        const field = parts[2]
        const detail = costModel.serviceDetails[svc]
        if (detail && field in detail) {
          monthlyAmount = (detail as any)[field] ?? 0
        }
      }
    }

    const plannedAmount = Math.round(monthlyAmount * multiplier * 100) / 100

    await prisma.budgetLine.update({
      where: { id: line.id },
      data: { plannedAmount, isAutoPlanned: false },
    })

    if (monthlyAmount > 0) {
      console.log(`  ${line.lineType.padEnd(7)} ${line.category}: ${monthlyAmount.toLocaleString()}/мес → ${plannedAmount.toLocaleString()} ₼ (×${multiplier})`)
    }
  }

  // 4. Summary
  const summary = await prisma.budgetLine.groupBy({
    by: ["lineType"],
    where: { planId: PLAN_ID },
    _sum: { plannedAmount: true },
  })

  console.log("\n=== Plan Totals ===")
  for (const row of summary) {
    console.log(`  ${row.lineType}: ${row._sum.plannedAmount?.toLocaleString()} ₼`)
  }

  // Actuals summary
  const actuals = await prisma.budgetActual.groupBy({
    by: ["lineType"],
    where: { planId: PLAN_ID },
    _sum: { actualAmount: true },
    _count: true,
  })

  console.log("\n=== Actual Totals (Q1) ===")
  for (const row of actuals) {
    console.log(`  ${row.lineType}: ${row._count} records, ${row._sum.actualAmount?.toLocaleString()} ₼`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error("ERROR:", e); prisma.$disconnect(); process.exit(1) })
