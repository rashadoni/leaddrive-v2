// Seed demo financial data: Cost Model, Client Services, Contract values
import { makeScriptPrisma } from "./_rls.mjs"
const prisma = await makeScriptPrisma()

const orgId = "cmnmya8oa0000u6vhhmo3vq4s" // Demo Company

async function main() {
  const companies = await prisma.company.findMany({ where: { organizationId: orgId } })
  console.log(`Found ${companies.length} companies`)

  // ─── 1. PricingParameters ───
  await prisma.pricingParameters.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      totalUsers: 320,
      totalEmployees: 45,
      technicalStaff: 35,
      backOfficeStaff: 10,
      monthlyWorkHours: 160,
      vatRate: 0.18,
      employerTaxRate: 0.175,
      riskRate: 0.05,
      miscExpenseRate: 0.01,
      fixedOverheadRatio: 0.25,
    },
    update: {
      totalUsers: 320,
      totalEmployees: 45,
      technicalStaff: 35,
      backOfficeStaff: 10,
    },
  })
  console.log("✅ PricingParameters upserted")

  // ─── 2. OverheadCosts (replace existing demo ones with proper data) ───
  await prisma.overheadCost.deleteMany({ where: { organizationId: orgId } })
  const overheads = [
    { category: "admin", label: "Ofis icarəsi", amount: 3500, isAnnual: false, isAdmin: true, sortOrder: 1 },
    { category: "admin", label: "Kommunal xidmətlər", amount: 800, isAnnual: false, isAdmin: true, sortOrder: 2 },
    { category: "admin", label: "İnternet & Telekom", amount: 450, isAnnual: false, isAdmin: true, sortOrder: 3 },
    { category: "admin", label: "Ofis ləvazimatları", amount: 200, isAnnual: false, isAdmin: true, sortOrder: 4 },
    { category: "admin", label: "Mühasibat xidməti", amount: 600, isAnnual: false, isAdmin: true, sortOrder: 5 },
    { category: "admin", label: "Hüquqi xidmət", amount: 400, isAnnual: false, isAdmin: true, sortOrder: 6 },
    { category: "tech", label: "Server hostinq (Hetzner)", amount: 1200, isAnnual: false, isAdmin: false, targetService: "cloud", sortOrder: 7 },
    { category: "tech", label: "AWS / Azure bulud", amount: 2800, isAnnual: false, isAdmin: false, targetService: "cloud", sortOrder: 8 },
    { category: "tech", label: "Domain & SSL", amount: 120, isAnnual: true, isAdmin: false, sortOrder: 9 },
    { category: "tech", label: "GitHub Enterprise", amount: 420, isAnnual: false, isAdmin: false, sortOrder: 10 },
    { category: "tech", label: "Claude API (Anthropic)", amount: 650, isAnnual: false, isAdmin: false, targetService: "permanent_it", sortOrder: 11 },
    { category: "tech", label: "Monitoring (Datadog)", amount: 380, isAnnual: false, isAdmin: false, sortOrder: 12 },
    { category: "tech", label: "Microsoft 365", amount: 900, isAnnual: false, isAdmin: false, sortOrder: 13 },
    { category: "tech", label: "WAF & Firewall", amount: 550, isAnnual: false, isAdmin: false, targetService: "infosec", sortOrder: 14 },
    { category: "tech", label: "SIEM License", amount: 1100, isAnnual: false, isAdmin: false, targetService: "infosec", sortOrder: 15 },
    { category: "admin", label: "Sığorta", amount: 2400, isAnnual: true, isAdmin: true, sortOrder: 16 },
    { category: "tech", label: "Twilio SMS/VoIP", amount: 350, isAnnual: false, isAdmin: false, sortOrder: 17 },
    { category: "tech", label: "SendGrid email", amount: 250, isAnnual: false, isAdmin: false, sortOrder: 18 },
  ]
  for (const o of overheads) {
    await prisma.overheadCost.create({ data: { ...o, organizationId: orgId } })
  }
  console.log(`✅ OverheadCosts: ${overheads.length}`)

  // ─── 3. CostEmployees ───
  await prisma.costEmployee.deleteMany({ where: { organizationId: orgId } })
  const employees = [
    { department: "IT", position: "Senior Developer", count: 5, netSalary: 4500, grossSalary: 5233, superGross: 6149 },
    { department: "IT", position: "Junior Developer", count: 8, netSalary: 2200, grossSalary: 2558, superGross: 3006 },
    { department: "IT", position: "DevOps Engineer", count: 2, netSalary: 4000, grossSalary: 4651, superGross: 5465 },
    { department: "InfoSec", position: "Security Engineer", count: 3, netSalary: 4200, grossSalary: 4884, superGross: 5738 },
    { department: "InfoSec", position: "SOC Analyst", count: 4, netSalary: 2800, grossSalary: 3256, superGross: 3826 },
    { department: "ERP", position: "ERP Consultant", count: 3, netSalary: 3800, grossSalary: 4419, superGross: 5192 },
    { department: "HelpDesk", position: "Support Specialist", count: 6, netSalary: 1800, grossSalary: 2093, superGross: 2459 },
    { department: "PM", position: "Project Manager", count: 2, netSalary: 3500, grossSalary: 4070, superGross: 4782 },
    { department: "GRC", position: "Compliance Officer", count: 2, netSalary: 3200, grossSalary: 3721, superGross: 4372 },
    { department: "BackOffice", position: "HR & Admin", count: 4, netSalary: 2000, grossSalary: 2326, superGross: 2733, inOverhead: true },
    { department: "BackOffice", position: "Accountant", count: 2, netSalary: 2500, grossSalary: 2907, superGross: 3416, inOverhead: true },
    { department: "BackOffice", position: "Office Manager", count: 1, netSalary: 1800, grossSalary: 2093, superGross: 2459, inOverhead: true },
  ]
  for (const e of employees) {
    await prisma.costEmployee.create({ data: { ...e, organizationId: orgId } })
  }
  console.log(`✅ CostEmployees: ${employees.length}`)

  // ─── 4. Update companies with userCount and seed ClientServices ───
  const serviceTypes = ["permanent_it", "infosec", "erp", "helpdesk", "cloud", "projects"]
  const companyRevenues = [
    { name: "Azercell", userCount: 85, services: { permanent_it: 12000, infosec: 8500, cloud: 4500, helpdesk: 3200 } },
    { name: "SOCAR Trading", userCount: 120, services: { permanent_it: 18000, infosec: 12000, erp: 9500, cloud: 6000, helpdesk: 4800 } },
    { name: "Pasha Holding", userCount: 65, services: { permanent_it: 9500, infosec: 6500, erp: 5000, projects: 8000 } },
    { name: "Kapital Bank", userCount: 45, services: { permanent_it: 7500, infosec: 5200, helpdesk: 2800, cloud: 3500 } },
    { name: "Port of Baku", userCount: 30, services: { permanent_it: 5500, infosec: 3800, erp: 4200 } },
    { name: "Azersun Holding", userCount: 40, services: { permanent_it: 6800, cloud: 4200, helpdesk: 2500, projects: 3500 } },
    { name: "Bravo Supermarket", userCount: 55, services: { permanent_it: 8200, erp: 6500, helpdesk: 3000, cloud: 2800 } },
    { name: "ASAN Xidmet", userCount: 25, services: { permanent_it: 4500, infosec: 3200, helpdesk: 1800 } },
  ]

  for (const cr of companyRevenues) {
    const company = companies.find(c => c.name.toLowerCase().includes(cr.name.toLowerCase().split(" ")[0].toLowerCase()))
    if (!company) {
      console.log(`  Company "${cr.name}" not found, skipping`)
      continue
    }

    // Update userCount
    await prisma.company.update({
      where: { id: company.id },
      data: { userCount: cr.userCount },
    })

    // Create client services
    for (const [svcType, revenue] of Object.entries(cr.services)) {
      try {
        await prisma.clientService.upsert({
          where: {
            organizationId_companyId_serviceType: {
              organizationId: orgId,
              companyId: company.id,
              serviceType: svcType,
            },
          },
          create: { organizationId: orgId, companyId: company.id, serviceType: svcType, monthlyRevenue: revenue, isActive: true },
          update: { monthlyRevenue: revenue, isActive: true },
        })
      } catch (e) {
        // unique constraint issues — skip
      }
    }
    console.log(`  ${company.name}: userCount=${cr.userCount}, services=${Object.keys(cr.services).length}`)
  }

  // ─── 5. Contracts with valueAmount (for Top-10 report) ───
  const contractValues = [
    { companyName: "SOCAR", value: 580000 },
    { companyName: "Pasha", value: 345000 },
    { companyName: "Azercell", value: 298000 },
    { companyName: "Kapital", value: 215000 },
    { companyName: "Port", value: 178000 },
    { companyName: "Azersun", value: 156000 },
    { companyName: "Bravo", value: 134000 },
    { companyName: "ASAN", value: 98000 },
  ]

  for (const cv of contractValues) {
    const company = companies.find(c => c.name.toLowerCase().includes(cv.companyName.toLowerCase()))
    if (!company) continue

    const existingContract = await prisma.contract.findFirst({
      where: { organizationId: orgId, companyId: company.id },
    })

    if (existingContract) {
      await prisma.contract.update({
        where: { id: existingContract.id },
        data: { valueAmount: cv.value },
      })
    } else {
      await prisma.contract.create({
        data: {
          organizationId: orgId,
          companyId: company.id,
          contractNumber: `CTR-2026-${String(contractValues.indexOf(cv) + 1).padStart(3, "0")}`,
          title: `${company.name} — İllik xidmət müqaviləsi`,
          status: "active",
          valueAmount: cv.value,
          currency: "AZN",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-12-31"),
        },
      })
    }
    console.log(`  Contract: ${company.name} = ${cv.value} AZN`)
  }

  // ─── 6. Update BudgetPlan with actual amounts ───
  const plans = await prisma.budgetPlan.findMany({ where: { organizationId: orgId } })
  if (plans.length > 0) {
    // Add BudgetActuals for first plan
    const plan = plans[0]
    const actuals = [
      { category: "Satış", lineType: "expense", actualAmount: 12500, description: "CRM lisenziyalar" },
      { category: "Satış", lineType: "expense", actualAmount: 4200, description: "Təlim xərcləri" },
      { category: "Satış", lineType: "expense", actualAmount: 2800, description: "Müştəri görüşləri" },
      { category: "Marketinq", lineType: "expense", actualAmount: 6500, description: "Rəqəmsal reklam" },
      { category: "Marketinq", lineType: "expense", actualAmount: 10000, description: "Tədbir sponsorluğu" },
      { category: "IT", lineType: "expense", actualAmount: 22000, description: "Server infrastrukturu" },
    ]
    const existingActuals = await prisma.budgetActual.count({ where: { organizationId: orgId, planId: plan.id } })
    if (existingActuals === 0) {
      for (const a of actuals) {
        await prisma.budgetActual.create({
          data: { ...a, organizationId: orgId, planId: plan.id },
        })
      }
      console.log(`✅ BudgetActuals: ${actuals.length}`)
    }

    // Update budget lines with real planned amounts
    const lines = await prisma.budgetLine.findMany({ where: { organizationId: orgId } })
    for (const line of lines) {
      if (line.plannedAmount > 0) {
        // Add forecast amounts
        await prisma.budgetLine.update({
          where: { id: line.id },
          data: { forecastAmount: line.plannedAmount * 0.92 },
        })
      }
    }
  }

  console.log("\n✅ Demo financial data seeded!")
}

main().catch(console.error).finally(() => prisma.$disconnect())
