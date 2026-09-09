/**
 * Universal budget plan populator.
 * Reads plan periodType/quarter/year from DB, computes months automatically.
 * Revenue from Excel data, expenses from cost model.
 * Usage: npx tsx scripts/populate-plan.ts <planId>
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { computeCostModel } from "../src/lib/cost-model/compute"
import type {
  CostModelParams, OverheadItem, EmployeeRow,
  ClientCompany, ClientServiceRow, PricingRevenueRow,
} from "../src/lib/cost-model/types"

let prisma!: PrismaClient

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

function lastDay(year: number, month: number): string {
  const d = new Date(year, month, 0) // month is 1-based, Date(year, month, 0) = last day of prev month
  return `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function getMonths(periodType: string, year: number, quarter: number | null): { label: string; date: string }[] {
  if (periodType === "monthly") {
    const m = quarter || 1
    return [{ label: `${MONTH_NAMES[m - 1]} ${year}`, date: lastDay(year, m) }]
  }
  if (periodType === "quarterly" && quarter) {
    const start = (quarter - 1) * 3 + 1
    return [0, 1, 2].map(i => {
      const m = start + i
      return { label: `${MONTH_NAMES[m - 1]} ${year}`, date: lastDay(year, m) }
    })
  }
  // annual
  return Array.from({ length: 12 }, (_, i) => ({
    label: `${MONTH_NAMES[i]} ${year}`,
    date: lastDay(year, i + 1),
  }))
}

// Revenue: read from existing actuals of Q1 plan or use known monthly amounts
// We fetch from pricing profiles (dynamic, not hardcoded)
async function getRevenueMonthly(orgId: string, costModel: any): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  const SVC_MAP: Record<string, string> = {
    permanent_it: "Выручка — Daimi IT", infosec: "Выручка — InfoSec",
    erp: "Выручка — ERP", grc: "Выручка — GRC", projects: "Выручка — PM",
    helpdesk: "Выручка — HelpDesk", cloud: "Выручка — Cloud", waf: "Выручка — WAF",
  }
  for (const [svc, category] of Object.entries(SVC_MAP)) {
    result[category] = costModel.serviceRevenues[svc] ?? 0
  }
  return result
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
  const planId = process.argv[2]
  if (!planId) { console.error("Usage: npx tsx scripts/populate-plan.ts <planId>"); process.exit(1) }

  const plan = await prisma.budgetPlan.findUnique({ where: { id: planId } })
  if (!plan) { console.error(`Plan ${planId} not found!`); process.exit(1) }

  const orgId = plan.organizationId
  const months = getMonths(plan.periodType, plan.year, plan.quarter)
  const multiplier = months.length

  console.log(`=== Populate Plan: "${plan.name}" ===`)
  console.log(`Period: ${plan.periodType}, Year: ${plan.year}, Quarter: ${plan.quarter}`)
  console.log(`Months: ${months.map(m => m.label).join(", ")}`)
  console.log(`Multiplier: ×${multiplier}\n`)

  // Load cost model
  const costModel = await loadCostModel(orgId)
  const revenueMonthly = await getRevenueMonthly(orgId, costModel)

  console.log(`Cost Model Grand Total G: ${costModel.grandTotalG.toLocaleString()} ₼/мес\n`)

  // Check if plan already has lines
  let lines = await prisma.budgetLine.findMany({ where: { planId } })

  // If no lines, clone from Q1 plan or create defaults
  if (lines.length === 0) {
    console.log("No budget lines found. Cloning from existing plan structure...\n")
    const sourcePlan = await prisma.budgetPlan.findFirst({
      where: { organizationId: orgId, id: { not: planId } },
      orderBy: { createdAt: "asc" },
    })
    if (sourcePlan) {
      const sourceLines = await prisma.budgetLine.findMany({ where: { planId: sourcePlan.id } })
      for (const sl of sourceLines) {
        await prisma.budgetLine.create({
          data: {
            organizationId: orgId, planId, category: sl.category,
            department: sl.department, lineType: sl.lineType,
            plannedAmount: 0, costModelKey: sl.costModelKey,
            isAutoActual: false, isAutoPlanned: false,
            notes: sl.notes, sortOrder: sl.sortOrder,
            lineSubtype: sl.lineSubtype, parentId: null,
          },
        })
      }
      lines = await prisma.budgetLine.findMany({ where: { planId } })
      console.log(`Cloned ${lines.length} lines from "${sourcePlan.name}"\n`)
    }
  }

  // Update planned amounts and create actuals
  let createdActuals = 0
  let totalExpenseMonthly = 0
  let totalRevenueMonthly = 0

  for (const line of lines) {
    let monthlyAmount = 0

    if (line.lineType === "revenue") {
      monthlyAmount = revenueMonthly[line.category] ?? 0
      totalRevenueMonthly += monthlyAmount
    } else if (line.costModelKey) {
      const parts = line.costModelKey.split(".")
      if (parts[0] === "serviceDetails" && parts.length === 3) {
        const detail = costModel.serviceDetails[parts[1]]
        if (detail && parts[2] in detail) {
          monthlyAmount = (detail as any)[parts[2]] ?? 0
        }
      }
      totalExpenseMonthly += monthlyAmount
    }

    // Update planned amount
    const plannedAmount = Math.round(monthlyAmount * multiplier * 100) / 100
    await prisma.budgetLine.update({
      where: { id: line.id },
      data: { plannedAmount, isAutoPlanned: false },
    })

    // Create actuals for each month
    if (monthlyAmount > 0) {
      for (const month of months) {
        await prisma.budgetActual.create({
          data: {
            organizationId: orgId, planId,
            category: line.category, department: line.department ?? undefined,
            lineType: line.lineType, actualAmount: monthlyAmount,
            expenseDate: month.date,
            description: `Факт — ${month.label}`,
          },
        })
        createdActuals++
      }
      console.log(`  ${line.lineType.padEnd(7)} ${line.category}: ${monthlyAmount.toLocaleString()}/мес → ${plannedAmount.toLocaleString()} (×${multiplier})`)
    }
  }

  console.log(`\n✅ Created ${createdActuals} actual records`)
  console.log(`   Expenses: ${totalExpenseMonthly.toLocaleString()}/мес → ${(totalExpenseMonthly * multiplier).toLocaleString()} (Q)`)
  console.log(`   Revenue:  ${totalRevenueMonthly.toLocaleString()}/мес → ${(totalRevenueMonthly * multiplier).toLocaleString()} (Q)`)
  console.log(`   Margin:   ${((totalRevenueMonthly - totalExpenseMonthly) * multiplier).toLocaleString()} (Q)`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error("ERROR:", e); prisma.$disconnect(); process.exit(1) })
