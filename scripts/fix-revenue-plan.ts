/**
 * Fix revenue planned amounts: use cost model serviceRevenues (target),
 * keep actuals from Excel (factual sales).
 * Expenses already from cost model — no change needed.
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { computeCostModel } from "../src/lib/cost-model/compute"
import type {
  CostModelParams, OverheadItem, EmployeeRow,
  ClientCompany, ClientServiceRow, PricingRevenueRow,
} from "../src/lib/cost-model/types"

let prisma!: PrismaClient
const ORG_ID = "cmmxg74k10000td3rr37dl6am"

const SVC_TO_CAT: Record<string, string> = {
  permanent_it: "Выручка — Daimi IT", infosec: "Выручка — InfoSec",
  erp: "Выручка — ERP", grc: "Выручка — GRC", projects: "Выручка — PM",
  helpdesk: "Выручка — HelpDesk", cloud: "Выручка — Cloud", waf: "Выручка — WAF",
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
  const costModel = await loadCostModel(ORG_ID)

  console.log("=== Cost Model Revenue (monthly, from pricing) ===\n")

  const plans = await prisma.budgetPlan.findMany({ where: { organizationId: ORG_ID } })

  for (const plan of plans) {
    console.log(`\nPlan: "${plan.name}" (Q${plan.quarter}, ${plan.periodType})`)

    for (const [svc, category] of Object.entries(SVC_TO_CAT)) {
      const monthlyRevenue = costModel.serviceRevenues[svc] ?? 0
      // Plan is ANNUAL (×12)
      const annualPlan = Math.round(monthlyRevenue * 12 * 100) / 100

      const result = await prisma.budgetLine.updateMany({
        where: { planId: plan.id, category },
        data: { plannedAmount: annualPlan },
      })

      if (result.count > 0) {
        console.log(`  ${category}: ${monthlyRevenue.toLocaleString()}/мес → ${annualPlan.toLocaleString()}/год`)
      }
    }
  }

  // Summary
  console.log("\n=== Summary ===")
  for (const plan of plans) {
    const revPlan = await prisma.budgetLine.aggregate({ where: { planId: plan.id, lineType: "revenue" }, _sum: { plannedAmount: true } })
    const expPlan = await prisma.budgetLine.aggregate({ where: { planId: plan.id, lineType: "expense" }, _sum: { plannedAmount: true } })
    const revFact = await prisma.budgetActual.aggregate({ where: { planId: plan.id, lineType: "revenue" }, _sum: { actualAmount: true } })
    const expFact = await prisma.budgetActual.aggregate({ where: { planId: plan.id, lineType: "expense" }, _sum: { actualAmount: true } })

    console.log(`\n  ${plan.name} Q${plan.quarter}:`)
    console.log(`    Доходы:  план ${revPlan._sum.plannedAmount?.toLocaleString()}, факт ${revFact._sum.actualAmount?.toLocaleString()}`)
    console.log(`    Расходы: план ${expPlan._sum.plannedAmount?.toLocaleString()}, факт ${expFact._sum.actualAmount?.toLocaleString()}`)
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error("ERROR:", e); prisma.$disconnect(); process.exit(1) })
