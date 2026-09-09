// @ts-nocheck
/**
 * Seed script: Restructure expense lines in budget plans
 * Values sourced from production DB (v2.leaddrivecrm.org/profitability)
 * Run: npx tsx scripts/seed-expense-structure.ts
 */

import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

const PLAN_DEFS = [
  { name: "Q1 2026 (Факт)", periodType: "quarterly", year: 2026, quarter: 1, status: "closed" },
  { name: "Q2 2026 (Бюджет компании)", periodType: "quarterly", year: 2026, quarter: 2, status: "draft" },
]

// ─── Production values (computed from prod DB, verified against /profitability) ──
// Parameters: totalEmployees=137, vatRate=0.18, employerTaxRate=0.175, riskRate=0.05, miscRate=0.01

const ADMIN_OVERHEAD_ITEMS = [
  { label: "Ofis icarəsi",                         amount: 30000.00 },
  { label: "İşçi sığortası (1 nəfər/ay)",          amount: 5480.00  }, // 40 × 137
  { label: "Mobil rabitə (1 nəfər/ay)",            amount: 4110.00  }, // 30 × 137
  { label: "LMS Platforma (illik, ƏDV xaric)",     amount: 4916.67  }, // 50000/12 × 1.18
  { label: "Treninqlər (illik)",                   amount: 20833.33 }, // 250000/12
  { label: "AI Lisenziyaları (illik, ƏDV xaric)",  amount: 373.67   }, // 3800/12 × 1.18
  { label: "Maşın amortizasiyası (150k÷60 ay)",    amount: 2500.00  },
  { label: "Maşın cari xərcləri",                  amount: 1200.00  },
  { label: "Laptop xərci",                         amount: 8500.00  },
  { label: "İnternet xərci",                       amount: 439.00   },
  { label: "Team building",                        amount: 10000.00 }, // 120000/12
  { label: "BackOffice (17 ppl.)", amount: 109302.18, note: "Distributed by headcount ratio" }, // 6429.54 × 17
]
// Total: 197,655 ₼

const TECH_INFRA_ITEMS = [
  { label: "Bulud serverləri (ƏDV xaric)",          amount: 23600.00 }, // 20000 × 1.18
  { label: "Cortex/Crowdstrike (illik, ƏDV xaric)", amount: 49166.67 }, // 500000/12 × 1.18
  { label: "MS Lisenziya (aylıq, ƏDV xaric)",       amount: 8024.00  }, // 6800 × 1.18
  { label: "Service Desk (illik, ƏDV xaric)",       amount: 4916.67  }, // 50000/12 × 1.18
  { label: "Firewall Palo Alto (illik, ƏDV xaric)", amount: 7473.33  }, // 76000/12 × 1.18
  { label: "PAM Lisenziya (illik, ƏDV xaric)",      amount: 3933.33  }, // 40000/12 × 1.18
  { label: "Firewall amortizasiyası (130k÷84 ay)",  amount: 1547.62  },
]
// Total: 98,661.62 ≈ 98,662 ₼

// Direct Labor: superGross × count per department
const DIRECT_LABOR_ITEMS = [
  { department: "IT",       amount: 80880.28, costModelKey: "deptCosts.IT"       }, // (4835.02×8)+(2373.61×4)+(4088.21×8)
  { department: "InfoSec",  amount: 59087.16, costModelKey: "deptCosts.InfoSec"  }, // 4923.93 × 12
  { department: "ERP",      amount: 26045.46, costModelKey: "deptCosts.ERP"      }, // 4340.91 × 6
  { department: "GRC",      amount: 26798.24, costModelKey: "deptCosts.GRC"      }, // 3349.78 × 8
  { department: "PM",       amount: 23155.70, costModelKey: "deptCosts.PM"       }, // 4631.14 × 5
  { department: "HelpDesk", amount: 132922.16, costModelKey: "deptCosts.HelpDesk" }, // 2373.61 × 56
]
// Total: 348,889 ₼

// Risk + Misc: based on sectionFSubtotal = adminForF + techInfra + IT + InfoSec = 436,285
// misc = 436285 × 0.01 = 4363; risk = (436285 + 4363) × 0.05 = 22032
const RISK_MISC_ITEMS = [
  { label: "Prочие расходы (1%)",  amount: 4362.85,  costModelKey: "misc"     },
  { label: "Резерв рисков (5%)",   amount: 22032.37, costModelKey: "riskCost" },
]

function r2(n: number): number { return Math.round(n * 100) / 100 }

async function seedPlan(planId: string, orgId: string) {
  console.log(`\n📋 Seeding plan: ${planId}`)

  // Delete all existing expense lines (children first via CASCADE, parents second)
  const existing = await prisma.budgetLine.findMany({
    where: { planId, organizationId: orgId, lineType: "expense" },
    select: { id: true },
  })
  if (existing.length > 0) {
    console.log(`  🗑  Deleting ${existing.length} existing expense lines...`)
    await prisma.budgetForecastEntry.deleteMany({ where: { planId, organizationId: orgId, lineType: "expense" } })
    // Delete children first, then parents
    await prisma.budgetLine.deleteMany({ where: { planId, organizationId: orgId, lineType: "expense", parentId: { not: null } } })
    await prisma.budgetLine.deleteMany({ where: { planId, organizationId: orgId, lineType: "expense" } })
  }

  // ── Group 1: Admin Overhead ──────────────────────────────────────────────
  const adminTotal = r2(ADMIN_OVERHEAD_ITEMS.reduce((s, i) => s + i.amount, 0))
  const adminParent = await prisma.budgetLine.create({
    data: { organizationId: orgId, planId, category: "Admin Overhead", lineType: "expense",
            plannedAmount: 0, sortOrder: 10, notes: "group:admin", isAutoActual: false },
  })
  for (let i = 0; i < ADMIN_OVERHEAD_ITEMS.length; i++) {
    const item = ADMIN_OVERHEAD_ITEMS[i]
    await prisma.budgetLine.create({
      data: { organizationId: orgId, planId, category: item.label, lineType: "expense",
              plannedAmount: r2(item.amount), parentId: adminParent.id, sortOrder: i + 1,
              notes: (item as any).note ?? null, isAutoActual: false },
    })
  }
  console.log(`  ✅ Admin Overhead: ${adminTotal.toLocaleString()} ₼ (${ADMIN_OVERHEAD_ITEMS.length} items)`)

  // ── Group 2: Technical Infrastructure ───────────────────────────────────
  const techTotal = r2(TECH_INFRA_ITEMS.reduce((s, i) => s + i.amount, 0))
  const techParent = await prisma.budgetLine.create({
    data: { organizationId: orgId, planId, category: "Technical Infrastructure", lineType: "expense",
            plannedAmount: 0, sortOrder: 20, notes: "group:tech_infra", isAutoActual: false },
  })
  for (let i = 0; i < TECH_INFRA_ITEMS.length; i++) {
    const item = TECH_INFRA_ITEMS[i]
    await prisma.budgetLine.create({
      data: { organizationId: orgId, planId, category: item.label, lineType: "expense",
              plannedAmount: r2(item.amount), parentId: techParent.id, sortOrder: i + 1,
              isAutoActual: false },
    })
  }
  console.log(`  ✅ Tech Infrastructure: ${techTotal.toLocaleString()} ₼ (${TECH_INFRA_ITEMS.length} items)`)

  // ── Group 3: Direct Labor ────────────────────────────────────────────────
  const laborTotal = r2(DIRECT_LABOR_ITEMS.reduce((s, i) => s + i.amount, 0))
  const laborParent = await prisma.budgetLine.create({
    data: { organizationId: orgId, planId, category: "Direct Labor Costs", lineType: "expense",
            plannedAmount: 0, sortOrder: 30, notes: "group:labor", isAutoActual: false },
  })
  for (let i = 0; i < DIRECT_LABOR_ITEMS.length; i++) {
    const item = DIRECT_LABOR_ITEMS[i]
    await prisma.budgetLine.create({
      data: { organizationId: orgId, planId, category: `${item.department} dept`, department: item.department,
              lineType: "expense", plannedAmount: r2(item.amount), costModelKey: item.costModelKey,
              parentId: laborParent.id, sortOrder: i + 1, isAutoActual: true },
    })
  }
  console.log(`  ✅ Direct Labor: ${laborTotal.toLocaleString()} ₼ (${DIRECT_LABOR_ITEMS.length} items)`)

  // ── Group 4: Risk + Misc ─────────────────────────────────────────────────
  const riskTotal = r2(RISK_MISC_ITEMS.reduce((s, i) => s + i.amount, 0))
  const riskParent = await prisma.budgetLine.create({
    data: { organizationId: orgId, planId, category: "Risk & Misc", lineType: "expense",
            plannedAmount: 0, sortOrder: 40, notes: "group:risk", isAutoActual: false },
  })
  for (let i = 0; i < RISK_MISC_ITEMS.length; i++) {
    const item = RISK_MISC_ITEMS[i]
    await prisma.budgetLine.create({
      data: { organizationId: orgId, planId, category: item.label, lineType: "expense",
              plannedAmount: r2(item.amount), costModelKey: item.costModelKey,
              parentId: riskParent.id, sortOrder: i + 1, isAutoActual: true },
    })
  }
  console.log(`  ✅ Risk + Misc: ${riskTotal.toLocaleString()} ₼ (${RISK_MISC_ITEMS.length} items)`)

  const grandTotal = r2(adminTotal + techTotal + laborTotal + riskTotal)
  console.log(`\n  📊 Total expense: ${grandTotal.toLocaleString()} ₼/mo`)
  console.log(`     Admin Overhead:       ${Math.round(adminTotal).toLocaleString()} ₼`)
  console.log(`     Tech Infrastructure:  ${Math.round(techTotal).toLocaleString()} ₼`)
  console.log(`     Direct Labor:         ${Math.round(laborTotal).toLocaleString()} ₼`)
  console.log(`     Risk + Misc:          ${Math.round(riskTotal).toLocaleString()} ₼`)
}

async function main() {
  prisma = await makeScriptPrisma()
  console.log("🚀 Seeding expense structure from production data...")

  const org = await prisma.organization.findFirst()
  if (!org) { console.error("❌ No organization found"); process.exit(1) }
  const orgId = org.id
  console.log(`🏢 Organization: ${org.name} (${orgId})`)

  for (const def of PLAN_DEFS) {
    let plan = await prisma.budgetPlan.findFirst({
      where: { organizationId: orgId, year: def.year, quarter: def.quarter, periodType: def.periodType },
    })
    if (!plan) {
      plan = await prisma.budgetPlan.create({
        data: { organizationId: orgId, name: def.name, periodType: def.periodType,
                year: def.year, quarter: def.quarter, status: def.status },
      })
      console.log(`📋 Created plan: ${plan.name}`)
    }
    console.log(`\n📅 Plan: ${plan.name}`)
    await seedPlan(plan.id, orgId)
  }

  console.log("\n✅ Done!")
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
