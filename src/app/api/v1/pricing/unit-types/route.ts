import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

const DEFAULT_UNIT_TYPES = [
  "Per Device",
  "Per Systems",
  "Per Company",
  "Per User",
  "Per VM",
  "Per 2 vCPU",
  "Per GB",
  "Per Resource",
  "Project based",
  "Man/Day",
  "Hourly",
  "Hourly Rates",
]

export const GET = withRls(async (_req, { orgId }) => {
  // Get unique unit types from existing services
  const dbUnits = await prisma.pricingService.findMany({
    where: { organizationId: orgId },
    select: { unit: true },
    distinct: ["unit"],
  })

  const unitSet = new Set(DEFAULT_UNIT_TYPES)
  for (const { unit } of dbUnits) {
    if (unit) unitSet.add(unit)
  }

  return NextResponse.json({ success: true, data: Array.from(unitSet).sort() })
})
