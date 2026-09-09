/**
 * Seed Sales Forecast 2026 from Excel "Copy of Sales forecast 2026.xlsx"
 * Source: "2026 Forecast Monthly" sheet — monthly revenue per service category
 * All amounts are in AZN, excl. VAT
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

// Excel data: departmentKey → [Jan..Dec] monthly amounts
// Mapped from Excel service categories to BudgetDepartment keys
const FORECAST_DATA: Record<string, number[]> = {
  it: [
    367241.382, 367241.382, 367241.382, 369241.382,
    375692.468, 375692.468, 376315.950, 376615.950,
    376615.950, 376615.950, 376615.950, 376615.950,
  ],
  erp: [
    16271.410, 16271.410, 16271.410, 17185.410,
    17253.651, 17253.651, 17393.155, 17530.255,
    17530.255, 17530.255, 17530.255, 17530.255,
  ],
  infosec: [
    226826.759, 226826.759, 226826.759, 228886.759,
    233122.152, 233122.152, 233559.283, 233709.283,
    233709.283, 233709.283, 233709.283, 233709.283,
  ],
  grc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pm: [
    5792.171, 5792.171, 5792.171, 5792.171,
    3128.000, 3128.000, 3128.000, 3128.000,
    3128.000, 3128.000, 3128.000, 3128.000,
  ],
  helpdesk: [
    81842.750, 81842.750, 81842.750, 83522.750,
    86052.750, 86052.750, 86382.750, 86382.750,
    86382.750, 86382.750, 86382.750, 86382.750,
  ],
  waf: [
    3583.400, 3583.400, 3583.400, 3583.400,
    3583.400, 3583.400, 3583.400, 3583.400,
    3583.400, 3583.400, 3583.400, 3583.400,
  ],
  saas: [
    0, 19319.713, 19319.713, 19319.713,
    19803.368, 19803.368, 19803.368, 19803.368,
    19803.368, 19803.368, 19803.368, 19803.368,
  ],
}

async function main() {
  prisma = await makeScriptPrisma()
  // Auto-detect organization
  const org = await prisma.organization.findFirst()
  if (!org) throw new Error("No organization found")
  const orgId = org.id
  console.log(`Org: ${org.name} (${orgId})`)

  // Load departments
  const departments = await prisma.budgetDepartment.findMany({
    where: { organizationId: orgId, isActive: true },
  })

  const YEAR = 2026
  let upserted = 0

  for (const [deptKey, monthlyAmounts] of Object.entries(FORECAST_DATA)) {
    const dept = departments.find((d) => d.key === deptKey)
    if (!dept) {
      console.warn(`⚠ Department "${deptKey}" not found, skipping`)
      continue
    }

    for (let month = 1; month <= 12; month++) {
      const amount = monthlyAmounts[month - 1]
      await prisma.salesForecast.upsert({
        where: {
          organizationId_departmentId_year_month: {
            organizationId: orgId,
            departmentId: dept.id,
            year: YEAR,
            month,
          },
        },
        update: { amount },
        create: {
          organizationId: orgId,
          departmentId: dept.id,
          year: YEAR,
          month,
          amount,
        },
      })
      upserted++
    }
    const total = monthlyAmounts.reduce((s, v) => s + v, 0)
    console.log(`✓ ${dept.label} (${deptKey}): 12 months, total = ${total.toLocaleString("en")} AZN`)
  }

  console.log(`\n✅ Upserted ${upserted} forecast entries for ${YEAR}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
