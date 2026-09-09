import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import * as fs from "fs"
import * as path from "path"

let prisma!: PrismaClient

const dataDir = path.join(__dirname, "..", "cost_model_migration_data")

function readJSON(filename: string) {
  const filePath = path.join(dataDir, filename)
  const raw = fs.readFileSync(filePath, "utf-8")
  return JSON.parse(raw)
}

async function main() {
  prisma = await makeScriptPrisma()
  console.log("=== Cost Model Seed Script ===")
  console.log(`Data directory: ${dataDir}`)

  // Get the first organization
  const org = await prisma.organization.findFirst()
  if (!org) {
    throw new Error("No organization found in database. Run create-admin.ts first.")
  }
  const orgId = org.id
  console.log(`Using organization: ${org.name} (${orgId})`)

  // 1. Pricing Parameters
  console.log("\n--- Seeding PricingParameters ---")
  const pricingData = readJSON("pricing_parameters.json")
  await prisma.pricingParameters.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      totalUsers: pricingData.total_users || 0,
      totalEmployees: pricingData.total_employees || 137,
      technicalStaff: pricingData.technical_staff || 107,
      backOfficeStaff: pricingData.back_office_staff || 30,
      monthlyWorkHours: pricingData.monthly_work_hours || 160,
      vatRate: pricingData.vat_rate || 0.18,
      employerTaxRate: pricingData.employer_tax_rate || 0.175,
      riskRate: pricingData.risk_rate || 0.05,
      miscExpenseRate: pricingData.misc_expense_rate || 0.01,
      fixedOverheadRatio: pricingData.fixed_overhead_ratio || 0.25,
    },
    update: {
      totalUsers: pricingData.total_users || 0,
      totalEmployees: pricingData.total_employees || 137,
      technicalStaff: pricingData.technical_staff || 107,
      backOfficeStaff: pricingData.back_office_staff || 30,
      monthlyWorkHours: pricingData.monthly_work_hours || 160,
      vatRate: pricingData.vat_rate || 0.18,
      employerTaxRate: pricingData.employer_tax_rate || 0.175,
      riskRate: pricingData.risk_rate || 0.05,
      miscExpenseRate: pricingData.misc_expense_rate || 0.01,
      fixedOverheadRatio: pricingData.fixed_overhead_ratio || 0.25,
    },
  })
  console.log("PricingParameters upserted successfully.")

  // 2. Overhead Costs
  console.log("\n--- Seeding OverheadCosts ---")
  const overheadData: any[] = readJSON("overhead_costs.json")
  await prisma.overheadCost.deleteMany({ where: { organizationId: orgId } })
  console.log(`Deleted existing overhead costs for org.`)

  const overheadRecords = overheadData.map((item: any) => ({
    organizationId: orgId,
    category: item.category || "",
    label: item.label || "",
    amount: item.amount || 0,
    isAnnual: item.is_annual === 1 || item.is_annual === true,
    hasVat: item.has_vat === 1 || item.has_vat === true,
    isAdmin: item.is_admin === 1 || item.is_admin === true,
    targetService: item.target_service || "",
    sortOrder: item.sort_order || 0,
    notes: item.notes || null,
  }))

  await prisma.overheadCost.createMany({ data: overheadRecords })
  console.log(`Created ${overheadRecords.length} overhead cost records.`)

  // 3. Cost Employees
  console.log("\n--- Seeding CostEmployees ---")
  const employeeData: any[] = readJSON("cost_employees.json")
  await prisma.costEmployee.deleteMany({ where: { organizationId: orgId } })
  console.log(`Deleted existing cost employees for org.`)

  const employeeRecords = employeeData.map((item: any) => ({
    organizationId: orgId,
    department: item.department || "",
    position: item.position || "",
    count: item.count || 1,
    netSalary: item.net_salary || 0,
    grossSalary: item.gross_salary || 0,
    superGross: item.super_gross || 0,
    inOverhead: item.in_overhead === 1 || item.in_overhead === true,
    notes: item.notes || null,
  }))

  await prisma.costEmployee.createMany({ data: employeeRecords })
  console.log(`Created ${employeeRecords.length} cost employee records.`)

  // 4. Client Companies (update userCount and costCode on existing Company records)
  console.log("\n--- Updating Client Companies ---")
  const clientCompanies: any[] = readJSON("client_companies.json")
  let companiesUpdated = 0
  let companiesNotFound = 0

  for (const cc of clientCompanies) {
    const company = await prisma.company.findFirst({
      where: {
        organizationId: orgId,
        name: { equals: cc.name, mode: "insensitive" },
      },
    })

    if (company) {
      await prisma.company.update({
        where: { id: company.id },
        data: {
          userCount: cc.user_count || 0,
          costCode: cc.cost_code || null,
        },
      })
      companiesUpdated++
    } else {
      console.log(`  Company not found: "${cc.name}"`)
      companiesNotFound++
    }
  }
  console.log(`Updated ${companiesUpdated} companies, ${companiesNotFound} not found.`)

  // 5. Client Services
  console.log("\n--- Seeding ClientServices ---")
  const clientServices: any[] = readJSON("client_services.json")

  // Build v1 company_id → company_name map from client_companies.json
  const v1IdToName: Record<number, string> = {}
  for (const cc of clientCompanies) {
    v1IdToName[cc.id] = cc.name
  }

  // Cache v2 company lookups by name (case-insensitive)
  const companyCache: Record<string, string | null> = {}

  let servicesCreated = 0
  let servicesSkipped = 0

  for (const svc of clientServices) {
    const companyName = v1IdToName[svc.company_id]
    if (!companyName) {
      console.log(`  No company name for v1 company_id=${svc.company_id}, skipping service id=${svc.id}`)
      servicesSkipped++
      continue
    }

    const cacheKey = companyName.toLowerCase()
    let companyId: string | null

    if (cacheKey in companyCache) {
      companyId = companyCache[cacheKey]
    } else {
      const company = await prisma.company.findFirst({
        where: {
          organizationId: orgId,
          name: { equals: companyName, mode: "insensitive" },
        },
      })
      companyId = company?.id || null
      companyCache[cacheKey] = companyId
    }

    if (!companyId) {
      console.log(`  Company "${companyName}" not found in v2, skipping service id=${svc.id}`)
      servicesSkipped++
      continue
    }

    try {
      await prisma.clientService.upsert({
        where: {
          organizationId_companyId_serviceType: {
            organizationId: orgId,
            companyId: companyId,
            serviceType: svc.service_type || "",
          },
        },
        create: {
          organizationId: orgId,
          companyId: companyId,
          serviceType: svc.service_type || "",
          monthlyRevenue: svc.monthly_revenue || 0,
          isActive: svc.is_active === 1 || svc.is_active === true,
          notes: svc.notes || null,
        },
        update: {
          monthlyRevenue: svc.monthly_revenue || 0,
          isActive: svc.is_active === 1 || svc.is_active === true,
          notes: svc.notes || null,
        },
      })
      servicesCreated++
    } catch (err: any) {
      console.log(`  Error upserting service id=${svc.id}: ${err.message}`)
      servicesSkipped++
    }
  }
  console.log(`Upserted ${servicesCreated} client services, ${servicesSkipped} skipped.`)

  console.log("\n=== Cost Model Seed Complete ===")
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
