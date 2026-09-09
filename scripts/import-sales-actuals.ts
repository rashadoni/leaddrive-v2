import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

const PLAN_ID = "cmn802plo0001tdgm19xmpo0q"
const ORG_ID = "cmmxg74k10000td3rr37dl6am"

const SALES_DATA: { category: string; department: string; amount: number }[] = [
  { category: "Выручка — Daimi IT", department: "Daimi IT", amount: 305057.32 },
  { category: "Выручка — ERP", department: "ERP", amount: 14130.87 },
  { category: "Выручка — InfoSec", department: "InfoSec", amount: 186798.21 },
  // GRC = 0, PM = 0 — skip
  { category: "Выручка — HelpDesk", department: "HelpDesk", amount: 70785.0 },
  { category: "Выручка — WAF", department: "WAF", amount: 3116.0 },
  { category: "Выручка — Cloud", department: "Cloud", amount: 17220.32 },
]

const MONTHS = [
  { month: 1, label: "Январь 2026", date: "2026-01-31" },
  { month: 2, label: "Февраль 2026", date: "2026-02-28" },
  { month: 3, label: "Март 2026", date: "2026-03-31" },
  { month: 4, label: "Апрель 2026", date: "2026-04-30" },
  { month: 5, label: "Май 2026", date: "2026-05-31" },
  { month: 6, label: "Июнь 2026", date: "2026-06-30" },
]

async function main() {
  prisma = await makeScriptPrisma()
  console.log("=== Import Sales Actuals Q1-Q2 2026 ===")
  console.log(`Plan: ${PLAN_ID}`)
  console.log(`Org:  ${ORG_ID}`)
  console.log(`Services: ${SALES_DATA.length}, Months: ${MONTHS.length}`)
  console.log(`Total records to create: ${SALES_DATA.length * MONTHS.length}`)
  console.log("")

  let created = 0

  for (const month of MONTHS) {
    for (const service of SALES_DATA) {
      await prisma.budgetActual.create({
        data: {
          organizationId: ORG_ID,
          planId: PLAN_ID,
          category: service.category,
          department: service.department,
          lineType: "revenue",
          actualAmount: service.amount,
          expenseDate: month.date,
          description: `Факт продаж — ${month.label}`,
        },
      })
      created++
      console.log(`  [${created}] ${service.category} — ${month.label}: ${service.amount.toLocaleString()} ₼`)
    }
  }

  console.log("")
  console.log(`✅ Created ${created} budget actual records`)

  // Summary
  const summary = await prisma.budgetActual.groupBy({
    by: ["category"],
    where: { planId: PLAN_ID, lineType: "revenue" },
    _sum: { actualAmount: true },
    _count: true,
  })

  console.log("")
  console.log("=== Summary ===")
  for (const row of summary) {
    console.log(`  ${row.category}: ${row._count} records, total ${row._sum.actualAmount?.toLocaleString()} ₼`)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("ERROR:", e)
  prisma.$disconnect()
  process.exit(1)
})
