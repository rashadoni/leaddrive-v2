/**
 * Fix script: recalculate service totals (qty * price) for all PricingService records
 * Run: npx tsx scripts/fix-service-totals.ts
 */
import type { PrismaClient } from '@prisma/client'
import { makeScriptPrisma } from './_rls.mjs'

let prisma!: PrismaClient

async function main() {
  prisma = await makeScriptPrisma()
  const services = await prisma.pricingService.findMany()
  console.log(`Total services: ${services.length}`)

  let updated = 0
  for (const svc of services) {
    const correctTotal = Math.round(svc.qty * svc.price * 100) / 100
    if (svc.total !== correctTotal) {
      await prisma.pricingService.update({
        where: { id: svc.id },
        data: { total: correctTotal },
      })
      updated++
    }
  }

  console.log(`Fixed ${updated} service totals (qty * price)`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Fix failed:', e)
  prisma.$disconnect()
  process.exit(1)
})
