import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { writeCostModelLog, invalidateAiCache } from "@/lib/cost-model/db"

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRlsAuth<RouteContext>("profitability", "read", async (_req, { orgId }, { params }) => {
  try {
    const { id } = await params

    const services = await prisma.clientService.findMany({
      where: { organizationId: orgId, companyId: id },
    })

    return NextResponse.json({ success: true, data: services })
  } catch (error) {
    console.error("Get client services error:", error)
    return NextResponse.json({ error: "Failed to load client services" }, { status: 500 })
  }
})

export const PUT = withRlsAuth<RouteContext>("profitability", "write", async (req, { orgId }, { params }) => {
  try {
    const { id: companyId } = await params
    const body = await req.json()
    const { services } = body as {
      services: Array<{ serviceType: string; monthlyRevenue: number; isActive: boolean; notes?: string }>
    }

    if (!services || !Array.isArray(services)) {
      return NextResponse.json({ error: "Services array is required" }, { status: 400 })
    }

    // Get old services for logging
    const oldServices = await prisma.clientService.findMany({
      where: { organizationId: orgId, companyId },
    })

    // Upsert each service
    const results = await Promise.all(
      services.map((svc) =>
        prisma.clientService.upsert({
          where: {
            organizationId_companyId_serviceType: {
              organizationId: orgId,
              companyId,
              serviceType: svc.serviceType,
            },
          },
          update: {
            monthlyRevenue: svc.monthlyRevenue,
            isActive: svc.isActive,
            notes: svc.notes ?? null,
          },
          create: {
            organizationId: orgId,
            companyId,
            serviceType: svc.serviceType,
            monthlyRevenue: svc.monthlyRevenue,
            isActive: svc.isActive,
            notes: svc.notes ?? null,
          },
        }),
      ),
    )

    await writeCostModelLog(orgId, "client_services", companyId, "update", oldServices, results)
    invalidateAiCache()

    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    console.error("Update client services error:", error)
    return NextResponse.json({ error: "Failed to update client services" }, { status: 500 })
  }
})
