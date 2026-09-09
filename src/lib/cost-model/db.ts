/**
 * Cost Model — Database helpers
 * Loads data from Prisma and runs computeCostModel()
 */

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { computeCostModel } from "./compute"
import type {
  CostModelParams,
  OverheadItem,
  EmployeeRow,
  ClientCompany,
  ClientServiceRow,
  PricingRevenueRow,
  CostModelResult,
} from "./types"

// AI cache (module-level, lives in memory)
const aiCache = new Map<string, { analysis: string; thinking: string; timestamp: number }>()

export function invalidateAiCache() {
  aiCache.clear()
}

export function getAiCache(key: string) {
  return aiCache.get(key) ?? null
}

export function setAiCache(key: string, analysis: string, thinking: string) {
  aiCache.set(key, { analysis, thinking, timestamp: Date.now() })
}

/** Write an audit log entry */
export async function writeCostModelLog(
  orgId: string,
  tableName: string,
  recordId: string,
  action: string,
  oldValue: unknown,
  newValue: unknown,
  changedBy?: string,
) {
  await prisma.costModelLog.create({
    data: {
      organizationId: orgId,
      tableName,
      recordId,
      action,
      oldValue: oldValue ? JSON.stringify(oldValue) : null,
      newValue: newValue ? JSON.stringify(newValue) : null,
      changedBy: changedBy ?? null,
    },
  })
}

/** Load all cost model data and compute */
export async function loadAndCompute(orgId: string): Promise<CostModelResult> {
  // Self-wrap the org-scoped reads in tenant context. loadAndCompute is called from
  // BOTH context-wrapped routes (nested same-org → harmless) AND a few that delegate
  // without wrapping (cost-model/{ai-analysis,client-analytics,client-costs,analytics},
  // budgeting/resolve-costs). Without context every read returns null/[] under RLS and
  // `params` silently falls back to the hardcoded defaults below — wrong data, not an
  // error. The await stays INSIDE the runWithTenant scope so the queries run in-context.
  const [paramsRow, overheadRows, employeeRows, companies, services, pricingProfiles] = await runWithTenant(orgId, () => Promise.all([
    prisma.pricingParameters.findUnique({ where: { organizationId: orgId } }),
    prisma.overheadCost.findMany({ where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } }),
    prisma.costEmployee.findMany({ where: { organizationId: orgId } }),
    prisma.company.findMany({
      where: { organizationId: orgId, category: "client" },
      select: { id: true, name: true, costCode: true, userCount: true },
    }),
    prisma.clientService.findMany({
      where: { organizationId: orgId, isActive: true },
    }),
    prisma.pricingProfile.findMany({
      where: { organizationId: orgId },
      select: { companyId: true, monthlyTotal: true },
    }),
  ]))

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
        totalUsers: 3566,
        totalEmployees: 137,
        technicalStaff: 107,
        backOfficeStaff: 30,
        monthlyWorkHours: 160,
        vatRate: 0.18,
        employerTaxRate: 0.175,
        riskRate: 0.05,
        miscExpenseRate: 0.01,
        fixedOverheadRatio: 0.25,
      }

  const overhead: OverheadItem[] = overheadRows.map((r: any) => ({
    id: r.id,
    category: r.category,
    label: r.label,
    amount: r.amount,
    isAnnual: r.isAnnual,
    hasVat: r.hasVat,
    isAdmin: r.isAdmin,
    targetService: r.targetService ?? "",
    amortMonths: (r as any).amortMonths ?? 0,
    sortOrder: r.sortOrder,
    notes: r.notes ?? "",
  }))

  const emps: EmployeeRow[] = employeeRows.map((r: any) => ({
    id: r.id,
    department: r.department,
    position: r.position,
    count: r.count,
    netSalary: r.netSalary,
    grossSalary: r.grossSalary,
    superGross: r.superGross,
    inOverhead: r.inOverhead,
    notes: r.notes ?? "",
  }))

  const clientComps: ClientCompany[] = companies.map((c: any) => ({
    id: c.id,
    name: c.name,
    costCode: c.costCode ?? "",
    userCount: c.userCount,
  }))

  const clientSvcs: ClientServiceRow[] = services.map((s: any) => ({
    id: s.id,
    companyId: s.companyId,
    serviceType: s.serviceType,
    monthlyRevenue: s.monthlyRevenue,
    isActive: s.isActive,
    notes: s.notes ?? "",
  }))

  const pricingRevenues: PricingRevenueRow[] = pricingProfiles
    .filter((p: any) => p.companyId)
    .map((p: any) => ({
      companyId: p.companyId!,
      monthlyTotal: p.monthlyTotal,
    }))

  return computeCostModel(params, overhead, emps, clientComps, clientSvcs, pricingRevenues)
}
