/**
 * LeadDrive CRM v2 — Migrate data from v1 PostgreSQL
 *
 * Prerequisites:
 *   - v2 database running (docker compose up db)
 *   - npx prisma migrate dev completed
 *   - v1 server accessible at V1_DATABASE_URL
 *
 * Usage:
 *   V1_DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/<db>" npx tsx scripts/migrate-v1.ts
 *
 * What it does:
 *   1. Creates LeadDrive Inc. organization
 *   2. Creates admin user (rashad)
 *   3. Imports companies (59)
 *   4. Imports contacts (577)
 *   5. Imports deals (12)
 *   6. Imports leads, tasks, contracts
 *   7. Imports cost model data (overhead, employees, parameters)
 *   8. Imports tickets, KB articles
 *   9. Creates default pipeline stages, SLA policies, currencies
 */

// NOTE(RLS): this migration is fully commented out (historical). If revived, create the
// client via `const v2 = await makeScriptPrisma()` from scripts/_rls.mjs — a raw
// `new PrismaClient()` would bypass the RLS session bootstrap (see scripts/_rls.mjs).
// import { PrismaClient } from "@prisma/client"
// import pg from "pg"

// const v2 = new PrismaClient()
// const v1Pool = new pg.Pool({ connectionString: process.env.V1_DATABASE_URL })

async function main() {
  console.log("🔄 LeadDrive CRM v1 → v2 Migration")
  console.log("")

  // Step 1: Create organization
  console.log("1️⃣ Creating organization...")
  // const org = await v2.organization.upsert({
  //   where: { slug: "leaddrive" },
  //   update: {},
  //   create: {
  //     name: "LeadDrive Inc.",
  //     slug: "leaddrive",
  //     plan: "enterprise",
  //     maxUsers: -1,
  //     maxContacts: -1,
  //   },
  // })
  // console.log(`   ✅ Organization: ${org.name} (${org.id})`)

  // Step 2: Create admin user
  console.log("2️⃣ Creating admin user...")
  // const bcrypt = require("bcryptjs")
  // Derive adminHash from an explicitly supplied, policy-compliant credential.
  // const admin = await v2.user.upsert({
  //   where: { organizationId_email: { organizationId: org.id, email: "rashadrahimsoy@gmail.com" } },
  //   update: {},
  //   create: {
  //     organizationId: org.id,
  //     email: "rashadrahimsoy@gmail.com",
  //     name: "Rashad Rahimov",
  //     passwordHash: adminHash,
  //     role: "admin",
  //   },
  // })
  // console.log(`   ✅ Admin: ${admin.email}`)

  // Step 3: Import companies
  console.log("3️⃣ Importing companies...")
  // const v1Companies = await v1Pool.query("SELECT * FROM companies ORDER BY id")
  // let companyMap: Record<number, string> = {} // v1 id -> v2 id
  // for (const c of v1Companies.rows) {
  //   const company = await v2.company.create({
  //     data: {
  //       organizationId: org.id,
  //       name: c.name,
  //       industry: c.industry,
  //       website: c.website,
  //       phone: c.phone,
  //       email: c.email,
  //       address: c.address,
  //       city: c.city,
  //       country: c.country,
  //       status: c.category === "client" ? "active" : "prospect",
  //       employeeCount: c.employee_count,
  //       userCount: c.user_count || 0,
  //       costCode: c.cost_code,
  //       description: c.description,
  //     },
  //   })
  //   companyMap[c.id] = company.id
  // }
  // console.log(`   ✅ Companies: ${v1Companies.rows.length}`)

  // Step 4: Import contacts
  console.log("4️⃣ Importing contacts...")
  // const v1Contacts = await v1Pool.query("SELECT * FROM contacts ORDER BY id")
  // for (const c of v1Contacts.rows) {
  //   await v2.contact.create({
  //     data: {
  //       organizationId: org.id,
  //       fullName: c.full_name || c.name,
  //       email: c.email,
  //       phone: c.phone,
  //       position: c.position,
  //       companyId: c.company_id ? companyMap[c.company_id] : null,
  //       source: c.source,
  //       isActive: true,
  //     },
  //   })
  // }
  // console.log(`   ✅ Contacts: ${v1Contacts.rows.length}`)

  // Step 5: Import deals
  console.log("5️⃣ Importing deals...")
  // const v1Deals = await v1Pool.query("SELECT * FROM deals ORDER BY id")
  // for (const d of v1Deals.rows) {
  //   await v2.deal.create({
  //     data: {
  //       organizationId: org.id,
  //       name: d.name,
  //       companyId: d.company_id ? companyMap[d.company_id] : null,
  //       stage: d.stage || "LEAD",
  //       valueAmount: d.value_amount || 0,
  //       currency: d.currency || "AZN",
  //       probability: d.probability || 0,
  //       assignedTo: d.assigned_to?.toString(),
  //       notes: d.notes,
  //     },
  //   })
  // }
  // console.log(`   ✅ Deals: ${v1Deals.rows.length}`)

  // Step 6: Import cost model
  console.log("6️⃣ Importing cost model...")
  // const v1Overhead = await v1Pool.query("SELECT * FROM overhead_costs ORDER BY sort_order")
  // for (const oh of v1Overhead.rows) {
  //   await v2.overheadCost.create({
  //     data: {
  //       organizationId: org.id,
  //       category: oh.category,
  //       label: oh.label,
  //       amount: oh.amount,
  //       isAnnual: !!oh.is_annual,
  //       hasVat: !!oh.has_vat,
  //       isAdmin: !!oh.is_admin,
  //       targetService: oh.target_service || "",
  //       sortOrder: oh.sort_order,
  //       notes: oh.notes,
  //     },
  //   })
  // }
  // console.log(`   ✅ Overhead: ${v1Overhead.rows.length}`)
  //
  // const v1Employees = await v1Pool.query("SELECT * FROM cost_employees")
  // for (const e of v1Employees.rows) {
  //   await v2.costEmployee.create({
  //     data: {
  //       organizationId: org.id,
  //       department: e.department,
  //       position: e.position,
  //       count: e.count,
  //       netSalary: e.net_salary,
  //       grossSalary: e.gross_salary,
  //       superGross: e.super_gross,
  //       inOverhead: !!e.in_overhead,
  //       notes: e.notes,
  //     },
  //   })
  // }
  // console.log(`   ✅ Employees: ${v1Employees.rows.length}`)
  //
  // const v1Params = await v1Pool.query("SELECT * FROM pricing_parameters WHERE id=1")
  // if (v1Params.rows[0]) {
  //   const p = v1Params.rows[0]
  //   await v2.pricingParameters.create({
  //     data: {
  //       organizationId: org.id,
  //       totalUsers: p.total_users,
  //       totalEmployees: p.total_employees,
  //       technicalStaff: p.technical_staff,
  //       backOfficeStaff: p.back_office_staff,
  //       vatRate: p.vat_rate,
  //       employerTaxRate: p.employer_tax_rate,
  //       riskRate: p.risk_rate,
  //       miscExpenseRate: p.misc_expense_rate,
  //       fixedOverheadRatio: p.fixed_overhead_ratio,
  //     },
  //   })
  //   console.log("   ✅ Pricing parameters")
  // }

  // Step 7: Create defaults
  console.log("7️⃣ Creating defaults...")
  // Pipeline stages
  // const stages = [
  //   { name: "LEAD", displayName: "Lead", color: "#6366f1", probability: 10, sortOrder: 1 },
  //   { name: "QUALIFIED", displayName: "Qualified", color: "#3b82f6", probability: 25, sortOrder: 2 },
  //   { name: "PROPOSAL", displayName: "Proposal", color: "#f59e0b", probability: 50, sortOrder: 3 },
  //   { name: "NEGOTIATION", displayName: "Negotiation", color: "#f97316", probability: 75, sortOrder: 4 },
  //   { name: "WON", displayName: "Won", color: "#22c55e", probability: 100, sortOrder: 5, isWon: true },
  //   { name: "LOST", displayName: "Lost", color: "#ef4444", probability: 0, sortOrder: 6, isLost: true },
  // ]
  // for (const s of stages) {
  //   await v2.pipelineStage.create({ data: { organizationId: org.id, ...s } })
  // }
  //
  // // SLA policies
  // const slas = [
  //   { name: "Critical", priority: "critical", firstResponseHours: 1, resolutionHours: 4 },
  //   { name: "High", priority: "high", firstResponseHours: 4, resolutionHours: 8 },
  //   { name: "Medium", priority: "medium", firstResponseHours: 8, resolutionHours: 24 },
  //   { name: "Low", priority: "low", firstResponseHours: 24, resolutionHours: 72 },
  // ]
  // for (const s of slas) {
  //   await v2.slaPolicy.create({ data: { organizationId: org.id, ...s } })
  // }
  //
  // // Currencies
  // const currencies = [
  //   { code: "AZN", name: "Azerbaijani Manat", symbol: "₼", exchangeRate: 1, isBase: true },
  //   { code: "USD", name: "US Dollar", symbol: "$", exchangeRate: 0.59 },
  //   { code: "EUR", name: "Euro", symbol: "€", exchangeRate: 0.54 },
  // ]
  // for (const c of currencies) {
  //   await v2.currency.create({ data: { organizationId: org.id, ...c } })
  // }

  console.log("")
  console.log("✅ Migration complete!")
  console.log("   Uncomment the code and run with V1_DATABASE_URL to migrate real data.")
}

main()
  .catch(console.error)
  // .finally(() => { v2.$disconnect(); v1Pool.end() })
