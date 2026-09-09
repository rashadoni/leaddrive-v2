/**
 * LeadDrive CRM v2 — Cost Model Compute Engine
 * Ported from Python services/compute/cost_model.py
 *
 * All string constants (service types, departments, categories) are
 * imported from ./types.ts — do NOT hardcode strings here.
 *
 * Target numbers (verified from v1):
 *   Grand Total G: 645,205.59
 *   Section F:     462,679.16
 */

import {
  INCOME_TAX_RATE,
  SERVICE_DEPT_MAP,
  TECH_DEPT_FALLBACK,
  PER_EMPLOYEE_CATEGORIES,
  isValidServiceType,
  isValidDepartment,
  isKnownOverheadCategory,
} from "./types"

import type {
  CostModelParams,
  OverheadItem,
  OverheadItemComputed,
  EmployeeRow,
  EmployeeRowComputed,
  ClientCompany,
  ClientServiceRow,
  PricingRevenueRow,
  ServiceDetail,
  ClientMargin,
  CostModelResult,
} from "./types"

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeCostModel(
  params: CostModelParams,
  overheadItems: OverheadItem[],
  employees: EmployeeRow[],
  clientCompanies: ClientCompany[] = [],
  clientServices: ClientServiceRow[] = [],
  pricingRevenues: PricingRevenueRow[] = [],
): CostModelResult {
  const warnings: string[] = []

  const vat = params.vatRate ?? 0.18
  const empTax = params.employerTaxRate ?? 0.175
  const riskRate = params.riskRate ?? 0.05
  const miscRate = params.miscExpenseRate ?? 0.01
  const fixedRatio = params.fixedOverheadRatio ?? 0.25
  const variableRatio = 1.0 - fixedRatio
  const totalEmployeesParam = params.totalEmployees ?? 137

  // Portfolio users from client companies
  let totalUsers = clientCompanies
    .filter((c) => c.userCount > 0)
    .reduce((sum, c) => sum + c.userCount, 0)
  if (totalUsers === 0) {
    totalUsers = params.totalUsers ?? 0
  }

  // ═══ Stage 1: Parse Overhead Costs ═══
  let adminOverhead = 0
  let techInfraTotal = 0
  const overheadBreakdown: OverheadItemComputed[] = []

  for (const item of overheadItems) {
    // Validate category
    if (!isKnownOverheadCategory(item.category)) {
      warnings.push(`Unknown overhead category "${item.category}" (label: ${item.label}). Cost included but may not route correctly.`)
    }

    // Validate targetService if provided
    if (item.targetService && !isValidServiceType(item.targetService)) {
      warnings.push(`Invalid targetService "${item.targetService}" on overhead "${item.label}". Must be one of: ${Object.keys(SERVICE_DEPT_MAP).join(", ")}`)
    }

    let amt = item.amount ?? 0

    // Amortization: divide by custom period (e.g. 60 months, 84 months)
    if (item.amortMonths && item.amortMonths > 0) {
      amt = amt / item.amortMonths
    } else if (item.isAnnual) {
      amt = amt / 12
    }

    if (item.hasVat) {
      amt = amt * (1 + vat)
    }

    if ((PER_EMPLOYEE_CATEGORIES as readonly string[]).includes(item.category)) {
      amt = amt * totalEmployeesParam
    }

    const monthlyAmount = r2(amt)

    if (item.isAdmin) {
      adminOverhead += monthlyAmount
    } else {
      techInfraTotal += monthlyAmount
    }

    overheadBreakdown.push({ ...item, monthlyAmount })
  }

  // ═══ Stage 2: Employee Costs by Department ═══
  const deptCosts: Record<string, number> = {}
  let backOfficeCost = 0
  let grcDirectCost = 0
  const processedEmployees: EmployeeRowComputed[] = []

  for (const emp of employees) {
    // Validate department
    if (!isValidDepartment(emp.department)) {
      warnings.push(`Unknown department "${emp.department}" for position "${emp.position}". Must be one of: IT, InfoSec, ERP, GRC, PM, HelpDesk, BackOffice`)
    }

    const net = emp.netSalary ?? 0
    const count = emp.count ?? 1
    const gross = INCOME_TAX_RATE < 1 ? net / (1 - INCOME_TAX_RATE) : net
    const superGross = gross * (1 + empTax)
    const totalDept = count * superGross

    processedEmployees.push({
      ...emp,
      grossSalary: r2(gross),
      superGross: r2(superGross),
      totalLaborCost: r2(totalDept),
    })

    const dept = emp.department ?? ""
    if (dept === "BackOffice") {
      backOfficeCost += totalDept
    } else if (emp.inOverhead) {
      grcDirectCost += totalDept
    } else {
      deptCosts[dept] = (deptCosts[dept] ?? 0) + totalDept
    }
  }

  // ═══ Stage 3: Section F (Core Maya) ═══
  const adminForF = adminOverhead + backOfficeCost
  const adminForG = adminOverhead + backOfficeCost + grcDirectCost
  const totalOverhead = adminForG + techInfraTotal

  const coreLabor = (deptCosts["IT"] ?? 0) + (deptCosts["InfoSec"] ?? 0)
  const sectionFSubtotal = adminForF + techInfraTotal + coreLabor
  const misc = sectionFSubtotal * miscRate
  const riskCost = (sectionFSubtotal + misc) * riskRate
  const grandTotalF = r2(sectionFSubtotal + misc + riskCost)

  // ═══ Stage 4: Section G (Full Service Distribution) ═══
  const allDeptEmployees = processedEmployees.filter((e) => e.department !== "BackOffice")
  const totalHeadcount = allDeptEmployees.reduce((sum, e) => sum + (e.count ?? 0), 0)

  // Build per-service tech costs from overhead
  const svcTechCosts: Record<string, number> = {}
  for (const oh of overheadBreakdown) {
    const targetSvc = (oh.targetService ?? "").trim() || TECH_DEPT_FALLBACK[oh.category] || ""
    if (targetSvc && !oh.isAdmin) {
      // Only non-admin items go to svcTechCosts (admin items are in adminOverhead)
      svcTechCosts[targetSvc] = (svcTechCosts[targetSvc] ?? 0) + oh.monthlyAmount
    }
  }

  // Admin items with targetService: subtract from admin share to avoid double-counting
  let techInAdmin = 0
  for (const oh of overheadBreakdown) {
    const targetSvc = (oh.targetService ?? "").trim() || TECH_DEPT_FALLBACK[oh.category] || ""
    if (oh.isAdmin && targetSvc) {
      techInAdmin += oh.monthlyAmount
      // These admin items have a service target — add to svcTechCosts too
      svcTechCosts[targetSvc] = (svcTechCosts[targetSvc] ?? 0) + oh.monthlyAmount
    }
  }
  const adminForGAdjusted = adminForG - techInAdmin

  const serviceCosts: Record<string, number> = {}
  const serviceDetails: Record<string, ServiceDetail> = {}

  for (const [svc, depts] of Object.entries(SERVICE_DEPT_MAP) as [string, string[]][]) {
    const directLabor = depts.reduce((sum, d) => sum + (deptCosts[d] ?? 0), 0)
    const deptHeadcount = allDeptEmployees
      .filter((e) => depts.includes(e.department))
      .reduce((sum, e) => sum + (e.count ?? 0), 0)
    const ratio = totalHeadcount > 0 ? deptHeadcount / totalHeadcount : 0
    const adminShare = adminForGAdjusted * ratio
    const techDirect = svcTechCosts[svc] ?? 0
    const total = r2(directLabor + adminShare + techDirect)

    serviceCosts[svc] = total
    serviceDetails[svc] = {
      directLabor: r2(directLabor),
      adminShare: r2(adminShare),
      techDirect: r2(techDirect),
      total,
      headcount: deptHeadcount,
      ratio: r2(ratio * 10000) / 10000,
    }
  }

  const grandTotalG = r2(Object.values(serviceCosts).reduce((a, b) => a + b, 0))

  // ═══ Stage 5: Client Margins ═══
  // Build pricing revenue lookup (from PricingProfile.monthlyTotal)
  const pricingRevenueMap = new Map<string, number>()
  for (const pr of pricingRevenues) {
    if (pr.companyId) pricingRevenueMap.set(String(pr.companyId), pr.monthlyTotal)
  }

  const activeCompanies = clientCompanies.filter((c) => c.userCount > 0)
  const totalActiveClients = Math.max(1, activeCompanies.length)
  const clients: ClientMargin[] = []

  for (const company of clientCompanies) {
    const users = company.userCount ?? 0
    const companyId = company.id

    const fixedCost = totalActiveClients > 0 ? (grandTotalG * fixedRatio) / totalActiveClients : 0
    const variableCost = totalUsers > 0 ? (grandTotalG * variableRatio * users) / totalUsers : 0
    const totalCost = r2(fixedCost + variableCost)

    const companyServices = clientServices.filter(
      (s) => s.companyId === companyId && s.isActive,
    )
    const dbRevenue = r2(companyServices.reduce((sum, s) => sum + (s.monthlyRevenue ?? 0), 0))
    // Prefer pricing module revenue over client_services (matches V1 behavior)
    const pricingRev = pricingRevenueMap.get(String(companyId)) ?? 0
    const totalRevenue = r2(pricingRev > 0 ? pricingRev : dbRevenue)
    const helpdeskRevenue = r2(
      companyServices
        .filter((s) => s.serviceType === "helpdesk")
        .reduce((sum, s) => sum + (s.monthlyRevenue ?? 0), 0),
    )

    const margin = r2(totalRevenue - totalCost)
    const marginPct = totalRevenue > 0 ? r2((margin / totalRevenue) * 100) : 0

    let status: ClientMargin["status"]
    if (totalRevenue === 0) status = "no_revenue"
    else if (marginPct >= 15) status = "good"
    else if (marginPct >= 0) status = "low"
    else status = "loss"

    clients.push({
      id: companyId,
      name: company.name ?? "",
      costCode: company.costCode ?? "",
      userCount: users,
      fixedCost: r2(fixedCost),
      variableCost: r2(variableCost),
      totalCost,
      totalRevenue,
      margin,
      marginPct,
      status,
      services: Object.fromEntries(companyServices.map((s) => [s.serviceType, s.monthlyRevenue])),
      helpdeskRevenue,
    })
  }

  clients.sort((a, b) => a.margin - b.margin)

  const profitable = clients.filter((c) => c.status === "good").length
  const loss = clients.filter((c) => c.status === "loss").length

  // Service revenues from client_services
  const serviceRevenues: Record<string, number> = {}
  const serviceClients: Record<string, number> = {}
  for (const svc of Object.keys(SERVICE_DEPT_MAP)) {
    const svcServices = clientServices.filter((s) => s.serviceType === svc && s.isActive)
    serviceRevenues[svc] = r2(svcServices.reduce((sum, s) => sum + (s.monthlyRevenue ?? 0), 0))
    serviceClients[svc] = new Set(svcServices.filter((s) => s.monthlyRevenue > 0).map((s) => s.companyId)).size
  }

  const totalRevenue = r2(clients.reduce((sum, c) => sum + c.totalRevenue, 0))
  const totalMargin = r2(totalRevenue - grandTotalG)
  const marginPct = totalRevenue > 0 ? r2((totalMargin / totalRevenue) * 100) : 0

  return {
    grandTotalF,
    grandTotalG,
    adminOverhead: r2(adminForG),
    techInfraTotal: r2(techInfraTotal),
    totalOverhead: r2(totalOverhead),
    backOfficeCost: r2(backOfficeCost),
    grcDirectCost: r2(grcDirectCost),
    coreLabor: r2(coreLabor),
    sectionFSubtotal: r2(sectionFSubtotal),
    misc: r2(misc),
    riskCost: r2(riskCost),
    serviceCosts,
    serviceDetails,
    deptCosts: Object.fromEntries(Object.entries(deptCosts).map(([k, v]) => [k, r2(v)])),
    overheadBreakdown,
    employees: processedEmployees,
    clients,
    totalUsers,
    totalHeadcount,
    summary: {
      totalRevenue,
      totalMargin,
      marginPct,
      profitableClients: profitable,
      lossClients: loss,
      totalClients: clients.length,
    },
    params,
    costPerUserF: totalUsers > 0 ? r2(grandTotalF / totalUsers) : 0,
    costPerUserG: totalUsers > 0 ? r2(grandTotalG / totalUsers) : 0,
    serviceRevenues,
    serviceClients,
    warnings,
  }
}
