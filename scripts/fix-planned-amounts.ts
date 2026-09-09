import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

const PLAN_ID = "cmn802plo0001tdgm19xmpo0q"

// Monthly actuals → annual plan (× 12)
const PLAN_DATA: { category: string; monthlyAmount: number }[] = [
  { category: "Выручка — Daimi IT", monthlyAmount: 305057.32 },
  { category: "Выручка — ERP", monthlyAmount: 14130.87 },
  { category: "Выручка — InfoSec", monthlyAmount: 186798.21 },
  { category: "Выручка — GRC", monthlyAmount: 0 },
  { category: "Выручка — PM", monthlyAmount: 0 },
  { category: "Выручка — HelpDesk", monthlyAmount: 70785.0 },
  { category: "Выручка — WAF", monthlyAmount: 3116.0 },
  { category: "Выручка — Cloud", monthlyAmount: 17220.32 },
]

async function main() {
  prisma = await makeScriptPrisma()
  console.log("=== Fix Planned Amounts (annual = monthly × 12) ===\n")

  for (const item of PLAN_DATA) {
    const annualAmount = Math.round(item.monthlyAmount * 12 * 100) / 100

    const result = await prisma.budgetLine.updateMany({
      where: { planId: PLAN_ID, category: item.category },
      data: { plannedAmount: annualAmount },
    })

    console.log(`  ${item.category}: ${annualAmount.toLocaleString()} ₼/год (${item.monthlyAmount.toLocaleString()}/мес) — updated ${result.count} line(s)`)
  }

  // Verify
  const lines = await prisma.budgetLine.findMany({
    where: { planId: PLAN_ID, lineType: "revenue" },
    select: { category: true, plannedAmount: true },
    orderBy: { category: "asc" },
  })

  console.log("\n=== Verification ===")
  let totalPlan = 0
  for (const l of lines) {
    console.log(`  ${l.category}: ${l.plannedAmount.toLocaleString()} ₼`)
    totalPlan += l.plannedAmount
  }
  console.log(`\n  Итого план: ${totalPlan.toLocaleString()} ₼`)
  console.log(`  Факт за 6 мес: ~${Math.round(totalPlan / 2).toLocaleString()} ₼ (50% исполнение)`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("ERROR:", e)
  prisma.$disconnect()
  process.exit(1)
})
