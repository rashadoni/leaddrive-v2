import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {

  try {
    const [params, overhead, employees, services, companies, wonDeals] = await Promise.all([
      prisma.pricingParameters.findUnique({ where: { organizationId: orgId } }),
      prisma.overheadCost.findMany({ where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } }),
      prisma.costEmployee.findMany({ where: { organizationId: orgId } }),
      prisma.clientService.findMany({ where: { organizationId: orgId, isActive: true }, include: { } }),
      prisma.company.findMany({
        where: { organizationId: orgId, status: "active" },
        select: { id: true, name: true, userCount: true, costCode: true },
      }),
      prisma.deal.groupBy({
        by: ["companyId"],
        where: { organizationId: orgId, stage: "won", companyId: { not: null } },
        _sum: { value: true },
      }),
    ])

    // Calculate totals
    const totalOverhead = overhead.reduce((s: number, o: any) => {
      const monthly = o.isAnnual ? o.amount / 12 : o.amount
      const withVat = o.hasVat ? monthly * 1.18 : monthly
      return s + withVat
    }, 0)

    const totalEmployeeCost = employees.reduce((s: number, e: any) => s + e.superGross * e.count, 0)
    const totalRevenue = services.reduce((s: number, cs: any) => s + cs.monthlyRevenue, 0)
    const totalCost = totalOverhead + totalEmployeeCost

    // Service type breakdown
    const serviceTypes = ["permanent_it", "infosec", "helpdesk", "erp", "grc", "projects", "cloud"]
    const serviceRevenues: Record<string, number> = {}
    for (const t of serviceTypes) {
      serviceRevenues[t] = services
        .filter((s: any) => s.serviceType === t)
        .reduce((sum: number, s: any) => sum + s.monthlyRevenue, 0)
    }

    // Employee cost by department
    const deptCosts: Record<string, number> = {}
    for (const e of employees) {
      deptCosts[e.department] = (deptCosts[e.department] || 0) + e.superGross * e.count
    }

    return NextResponse.json({
      success: true,
      data: {
        params,
        summary: {
          totalCost: Math.round(totalCost * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalOverhead: Math.round(totalOverhead * 100) / 100,
          totalEmployeeCost: Math.round(totalEmployeeCost * 100) / 100,
          margin: Math.round((totalRevenue - totalCost) * 100) / 100,
          marginPct: totalCost > 0 ? Math.round((totalRevenue - totalCost) / totalCost * 10000) / 100 : 0,
          profitableClients: wonDeals.filter((d: any) => (d._sum.value || 0) > 0).length,
          lossClients: companies.length - wonDeals.filter((d: any) => (d._sum.value || 0) > 0).length,
        },
        overhead,
        employees,
        serviceRevenues,
        deptCosts,
        companies: companies.length,
        services: services.length,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
