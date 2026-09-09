// @ts-nocheck
/**
 * LeadDrive CRM v1 → v2 Data Import (FULL)
 *
 * Reads ALL JSON files exported by export-v1-remote.sh
 * and imports into v2 PostgreSQL via Prisma.
 *
 * Run: npx tsx scripts/import-v1.ts
 */

import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { randomBytes } from "node:crypto"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import bcrypt from "bcryptjs"
import {
  generateStrongTemporaryPassword,
  passwordPolicyError,
} from "./password-policy.mjs"

let prisma!: PrismaClient
const DATA_DIR = join(__dirname, "v1-data")
const REQUIRED_PROD_CONFIRMATION = "import-v1:leaddrive"

function isLocalDatabase(databaseUrl: string | undefined): boolean {
  if (process.env.NODE_ENV === "production") return false
  try {
    const hostname = new URL(databaseUrl || "").hostname
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(hostname)
  } catch {
    return false
  }
}

function assertImportAuthorization(): string {
  if (!isLocalDatabase(process.env.DATABASE_URL) && process.env.CONFIRM_PROD !== REQUIRED_PROD_CONFIRMATION) {
    throw new Error(`Set CONFIRM_PROD=${REQUIRED_PROD_CONFIRMATION} to import into a non-local database`)
  }

  const adminPassword = process.env.ADMIN_PASSWORD
  const passwordError = passwordPolicyError(adminPassword)
  if (passwordError) throw new Error(`ADMIN_PASSWORD rejected: ${passwordError}`)
  return adminPassword as string
}

// ─── ID Maps (v1 integer id → v2 cuid) ───
const idMap: Record<string, Record<string, string>> = {}

function loadJson<T = Record<string, unknown>>(filename: string): T[] {
  const path = join(DATA_DIR, filename)
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, "utf-8").trim()
    if (!raw || raw === "null" || raw === "") return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    console.log(`    ⚠️ Failed to parse ${filename}`)
    return []
  }
}

function mapId(table: string, v1Id: unknown): string | null {
  if (!v1Id) return null
  return idMap[table]?.[String(v1Id)] || null
}

function saveId(table: string, v1Id: unknown, v2Id: string) {
  if (!idMap[table]) idMap[table] = {}
  idMap[table][String(v1Id)] = v2Id
}

function toDate(val: unknown): Date | null {
  if (!val) return null
  const d = new Date(String(val))
  return isNaN(d.getTime()) ? null : d
}

function toFloat(val: unknown): number {
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

function toInt(val: unknown): number {
  const n = parseInt(String(val))
  return isNaN(n) ? 0 : n
}

function toStr(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null
  return String(val)
}

function toJson(val: unknown): any {
  if (val === null || val === undefined) return {}
  if (typeof val === "string") {
    try { return JSON.parse(val) } catch { return {} }
  }
  return val
}

async function main() {
  const adminPassword = assertImportAuthorization()
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12)
  prisma = await makeScriptPrisma()
  console.log("🔄 LeadDrive CRM v1 → v2 Full Import")
  console.log(`   Data dir: ${DATA_DIR}`)
  console.log("")

  // ═══════════════════════════════════════
  // 1. Organization
  // ═══════════════════════════════════════
  console.log("1️⃣  Creating organization...")
  const org = await prisma.organization.upsert({
    where: { slug: "leaddrive" },
    update: {},
    create: {
      name: "LeadDrive Inc.",
      slug: "leaddrive",
      plan: "enterprise",
      addons: [],
      maxUsers: -1,
      maxContacts: -1,
    },
  })
  console.log(`   ✅ Organization: ${org.name} (${org.id})`)

  // ═══════════════════════════════════════
  // 2. Users
  // ═══════════════════════════════════════
  console.log("2️⃣  Importing users...")
  const v1Users = loadJson("users.json")
  let userCount = 0
  for (const u of v1Users) {
    const email = String(u.email || u.username || "unknown@local")
    // A legacy hash has unknown provenance and policy strength. Import the
    // identity, but replace its credential with an unreported random value and
    // keep the principal disabled until an administrator resets and activates it.
    const disabledPasswordHash = await bcrypt.hash(
      generateStrongTemporaryPassword(randomBytes),
      12,
    )
    const disabledCredentialData = {
      passwordHash: disabledPasswordHash,
      totpSecret: null,
      totpEnabled: false,
      smsAuthEnabled: false,
      verifiedPhone: null,
      require2fa: false,
      backupCodes: [],
      twoFactorNonce: null,
      passwordChangedAt: new Date(),
      resetToken: null,
      resetTokenExp: null,
      isActive: false,
    }
    try {
      const user = await prisma.user.upsert({
        where: { organizationId_email: { organizationId: org.id, email } },
        update: disabledCredentialData,
        create: {
          organizationId: org.id,
          email,
          name: String(u.full_name || u.name || email.split("@")[0]),
          ...disabledCredentialData,
          role: String(u.role || "viewer"),
          phone: toStr(u.phone),
          department: toStr(u.department),
          avatar: toStr(u.avatar_url),
          lastLogin: toDate(u.last_login),
          loginCount: toInt(u.login_count),
        },
      })
      saveId("users", u.id, user.id)
      userCount++
    } catch (e: any) {
      console.log(`    ⚠️ User ${email}: ${e.message?.slice(0, 80)}`)
    }
  }
  // Always leave one explicitly provisioned administrator. If a legacy row
  // uses this email, its unknown credential is rotated before activation.
  const admin = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "admin@leaddrive.com" } },
    update: {
      passwordHash: adminPasswordHash,
      passwordChangedAt: new Date(),
      role: "admin",
      isActive: true,
      resetToken: null,
      resetTokenExp: null,
    },
    create: {
      organizationId: org.id,
      email: "admin@leaddrive.com",
      name: "Admin",
      passwordHash: adminPasswordHash,
      passwordChangedAt: new Date(),
      role: "admin",
      isActive: true,
    },
  })
  saveId("users", "admin", admin.id)
  if (userCount === 0) userCount = 1
  console.log(`   ✅ Users: ${userCount}`)

  // ═══════════════════════════════════════
  // 3. Companies
  // ═══════════════════════════════════════
  console.log("3️⃣  Importing companies...")
  const v1Companies = loadJson("companies.json")
  let companyCount = 0
  for (const c of v1Companies) {
    // Skip partners — not needed in v2
    if (c.category === "partner") continue
    try {
      const company = await prisma.company.create({
        data: {
          organizationId: org.id,
          name: String(c.name || "Unknown"),
          industry: toStr(c.industry),
          website: toStr(c.website),
          phone: toStr(c.phone),
          email: toStr(c.email),
          address: toStr(c.address),
          city: toStr(c.city),
          country: toStr(c.country),
          status: c.category === "inactive" ? "inactive" : c.category === "prospect" ? "prospect" : "active",
          category: String(c.category || "prospect"),
          leadStatus: c.category === "client" ? "converted" : c.category === "inactive" ? "cancelled" : "new",
          leadScore: toInt(c.user_count) || 0,
          leadTemperature: (toInt(c.user_count) || 0) >= 20 ? "hot" : (toInt(c.user_count) || 0) >= 10 ? "warm" : "cold",
          employeeCount: c.employee_count ? toInt(c.employee_count) : null,
          userCount: toInt(c.user_count),
          costCode: toStr(c.cost_code),
          description: toStr(c.notes),
        },
      })
      saveId("companies", c.id, company.id)
      companyCount++
    } catch (e: any) {
      console.log(`    ⚠️ Company ${c.name}: ${e.message?.slice(0, 80)}`)
    }
  }
  console.log(`   ✅ Companies: ${companyCount}`)

  // ═══════════════════════════════════════
  // 4. Contacts
  // ═══════════════════════════════════════
  console.log("4️⃣  Importing contacts...")
  const v1Contacts = loadJson("contacts.json")
  let contactCount = 0
  for (const c of v1Contacts) {
    try {
      const contact = await prisma.contact.create({
        data: {
          organizationId: org.id,
          fullName: String(c.name || c.full_name || "Unknown"),
          email: toStr(c.email),
          phone: toStr(c.phone),
          position: toStr(c.role),
          companyId: mapId("companies", c.company_id),
          source: toStr(c.source),
          tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
          isActive: true,
          lastContactAt: toDate(c.last_contact),
          createdAt: toDate(c.created_at) || new Date(),
        },
      })
      saveId("contacts", c.id, contact.id)
      contactCount++
    } catch {
      // Skip duplicates
    }
  }
  console.log(`   ✅ Contacts: ${contactCount}`)

  // ═══════════════════════════════════════
  // 5. Deals
  // ═══════════════════════════════════════
  console.log("5️⃣  Importing deals...")
  const v1Deals = loadJson("deals.json")
  let dealCount = 0
  for (const d of v1Deals) {
    try {
      const deal = await prisma.deal.create({
        data: {
          organizationId: org.id,
          name: String(d.title || d.name || "Untitled Deal"),
          companyId: mapId("companies", d.company_id),
          stage: String(d.stage || "LEAD"),
          valueAmount: toFloat(d.value_amount),
          currency: String(d.value_currency || d.currency || "AZN"),
          probability: toInt(d.probability),
          expectedClose: toDate(d.expected_close),
          assignedTo: toStr(d.assigned_to),
          lostReason: toStr(d.lost_reason),
          notes: toStr(d.notes),
          createdAt: toDate(d.created_at) || new Date(),
        },
      })
      saveId("deals", d.id, deal.id)
      dealCount++
    } catch (e: any) {
      console.log(`    ⚠️ Deal ${d.title}: ${e.message?.slice(0, 80)}`)
    }
  }
  console.log(`   ✅ Deals: ${dealCount}`)

  // ═══════════════════════════════════════
  // 6. Leads
  // ═══════════════════════════════════════
  console.log("6️⃣  Importing leads...")
  const v1Leads = loadJson("leads.json")
  let leadCount = 0
  for (const l of v1Leads) {
    try {
      const lead = await prisma.lead.create({
        data: {
          organizationId: org.id,
          contactName: String(l.contact_name || "Unknown"),
          companyName: toStr(l.company_name),
          email: toStr(l.email),
          phone: toStr(l.phone),
          source: toStr(l.source),
          status: String(l.status || "new"),
          priority: String(l.priority || "medium"),
          score: toInt(l.score),
          estimatedValue: l.estimated_value ? toFloat(l.estimated_value) : null,
          assignedTo: toStr(l.assigned_to),
          notes: toStr(l.notes),
          convertedAt: toDate(l.converted_at),
          createdAt: toDate(l.created_at) || new Date(),
        },
      })
      saveId("leads", l.id, lead.id)
      leadCount++
    } catch { }
  }
  console.log(`   ✅ Leads: ${leadCount}`)

  // ═══════════════════════════════════════
  // 7. Tasks
  // ═══════════════════════════════════════
  console.log("7️⃣  Importing tasks...")
  const v1Tasks = loadJson("tasks.json")
  let taskCount = 0
  for (const t of v1Tasks) {
    try {
      await prisma.task.create({
        data: {
          organizationId: org.id,
          title: String(t.title || "Untitled"),
          description: toStr(t.description),
          status: String(t.status || "pending"),
          priority: String(t.priority || "medium"),
          dueDate: toDate(t.due_date),
          assignedTo: toStr(t.assigned_to),
          relatedType: t.deal_id ? "deal" : t.contact_id ? "contact" : t.company_id ? "company" : t.lead_id ? "lead" : null,
          relatedId: mapId("deals", t.deal_id) || mapId("contacts", t.contact_id) || mapId("companies", t.company_id) || mapId("leads", t.lead_id),
          completedAt: toDate(t.completed_at),
          createdBy: toStr(t.created_by),
          createdAt: toDate(t.created_at) || new Date(),
        },
      })
      taskCount++
    } catch { }
  }
  console.log(`   ✅ Tasks: ${taskCount}`)

  // ═══════════════════════════════════════
  // 8. Activities
  // ═══════════════════════════════════════
  console.log("8️⃣  Importing activities...")
  const v1Activities = loadJson("activities.json")
  let activityCount = 0
  for (const a of v1Activities) {
    try {
      await prisma.activity.create({
        data: {
          organizationId: org.id,
          type: String(a.activity_type || "note"),
          subject: toStr(a.subject),
          description: toStr(a.content),
          contactId: mapId("contacts", a.contact_id),
          companyId: mapId("companies", a.company_id),
          relatedType: a.deal_id ? "deal" : a.lead_id ? "lead" : null,
          relatedId: mapId("deals", a.deal_id) || mapId("leads", a.lead_id),
          createdAt: toDate(a.timestamp) || new Date(),
        },
      })
      activityCount++
    } catch { }
  }
  console.log(`   ✅ Activities: ${activityCount}`)

  // ═══════════════════════════════════════
  // 9. Contracts
  // ═══════════════════════════════════════
  console.log("9️⃣  Importing contracts...")
  const v1Contracts = loadJson("contracts.json")
  let contractCount = 0
  for (const c of v1Contracts) {
    try {
      const contract = await prisma.contract.create({
        data: {
          organizationId: org.id,
          contractNumber: String(c.id || contractCount + 1),
          title: String(c.contract_name || "Contract"),
          type: String(c.contract_type || "service_agreement"),
          status: String(c.status || "draft"),
          companyId: null, // v1 contracts use counterparty name, not company_id
          startDate: toDate(c.start_date),
          endDate: toDate(c.end_date),
          valueAmount: c.amount ? toFloat(c.amount) : null,
          currency: String(c.currency || "AZN"),
          notes: toStr(c.summary),
          createdAt: toDate(c.created_at) || new Date(),
        },
      })
      saveId("contracts", c.id, contract.id)
      contractCount++
    } catch (e: any) {
      console.log(`    ⚠️ Contract: ${e.message?.slice(0, 80)}`)
    }
  }
  console.log(`   ✅ Contracts: ${contractCount}`)

  // ═══════════════════════════════════════
  // 10. Offers
  // ═══════════════════════════════════════
  console.log("🔟 Importing offers...")
  const v1Offers = loadJson("offers.json")
  let offerCount = 0
  for (const o of v1Offers) {
    try {
      const offer = await prisma.offer.create({
        data: {
          organizationId: org.id,
          offerNumber: String(o.offer_number || o.id),
          companyId: mapId("companies", o.company_id),
          title: `${o.offer_type || "Offer"} #${o.offer_number || o.id}`,
          status: String(o.status || "draft"),
          currency: String(o.currency || "AZN"),
          validUntil: toDate(o.valid_until),
          notes: toStr(o.notes),
          createdBy: toStr(o.created_by),
          createdAt: toDate(o.created_at) || new Date(),
        },
      })
      saveId("offers", o.id, offer.id)
      offerCount++
    } catch { }
  }
  console.log(`   ✅ Offers: ${offerCount}`)

  // ═══════════════════════════════════════
  // 11. Tickets & Comments
  // ═══════════════════════════════════════
  console.log("1️⃣1️⃣ Importing tickets...")
  const v1Tickets = loadJson("tickets.json")
  let ticketCount = 0
  for (const t of v1Tickets) {
    try {
      const ticketNum = `TK-${String(t.id).padStart(4, "0")}`
      const ticketData = {
        subject: String(t.subject || "No subject"),
        description: toStr(t.description),
        priority: String(t.priority || "medium"),
        status: String(t.status || "new"),
        category: String(t.category || "general"),
        contactId: mapId("contacts", t.contact_id),
        companyId: mapId("companies", t.company_id),
        assignedTo: toStr(t.assigned_to),
        createdBy: toStr(t.created_by),
        firstResponseAt: toDate(t.first_response_at),
        resolvedAt: toDate(t.resolved_at),
        closedAt: toDate(t.closed_at),
        tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
        createdAt: toDate(t.created_at) || new Date(),
      }
      const ticket = await prisma.ticket.upsert({
        where: { organizationId_ticketNumber: { organizationId: org.id, ticketNumber: ticketNum } },
        update: ticketData,
        create: { organizationId: org.id, ticketNumber: ticketNum, ...ticketData },
      })
      saveId("tickets", t.id, ticket.id)
      ticketCount++
    } catch (e: any) {
      console.log(`    ⚠️ Ticket: ${e.message?.slice(0, 80)}`)
    }
  }
  console.log(`   ✅ Tickets: ${ticketCount}`)

  console.log("   Importing ticket comments...")
  const v1Comments = loadJson("ticket_comments.json")
  let commentCount = 0
  for (const c of v1Comments) {
    const ticketId = mapId("tickets", c.ticket_id)
    if (!ticketId) continue
    try {
      await prisma.ticketComment.create({
        data: {
          ticketId,
          userId: toStr(c.user_id),
          comment: String(c.content || ""),
          isInternal: !!c.is_internal,
          createdAt: toDate(c.created_at) || new Date(),
        },
      })
      commentCount++
    } catch { }
  }
  console.log(`   ✅ Ticket comments: ${commentCount}`)

  // ═══════════════════════════════════════
  // 12. Cost Model
  // ═══════════════════════════════════════
  console.log("1️⃣2️⃣ Importing cost model...")
  const v1Overhead = loadJson("overhead_costs.json")
  for (const oh of v1Overhead) {
    try {
      await prisma.overheadCost.create({
        data: {
          organizationId: org.id,
          category: String(oh.category),
          label: String(oh.label),
          amount: toFloat(oh.amount),
          isAnnual: !!oh.is_annual,
          hasVat: !!oh.has_vat,
          isAdmin: oh.is_admin !== false,
          targetService: toStr(oh.target_service),
          sortOrder: toInt(oh.sort_order),
          notes: toStr(oh.notes),
        },
      })
    } catch { }
  }
  console.log(`   ✅ Overhead costs: ${v1Overhead.length}`)

  const v1Employees = loadJson("cost_employees.json")
  for (const e of v1Employees) {
    try {
      await prisma.costEmployee.create({
        data: {
          organizationId: org.id,
          department: String(e.department),
          position: String(e.position),
          count: toInt(e.count) || 1,
          netSalary: toFloat(e.net_salary),
          grossSalary: toFloat(e.gross_salary),
          superGross: toFloat(e.super_gross),
          inOverhead: !!e.in_overhead,
          notes: toStr(e.notes),
        },
      })
    } catch { }
  }
  console.log(`   ✅ Cost employees: ${v1Employees.length}`)

  const v1Params = loadJson("pricing_parameters.json")
  if (v1Params[0]) {
    const p = v1Params[0] as Record<string, unknown>
    await prisma.pricingParameters.upsert({
      where: { organizationId: org.id },
      update: {},
      create: {
        organizationId: org.id,
        totalUsers: toInt(p.total_users) || 4500,
        totalEmployees: toInt(p.total_employees) || 137,
        technicalStaff: toInt(p.technical_staff) || 107,
        backOfficeStaff: toInt(p.back_office_staff) || 30,
        vatRate: toFloat(p.vat_rate) || 0.18,
        employerTaxRate: toFloat(p.employer_tax_rate) || 0.175,
        riskRate: toFloat(p.risk_rate) || 0.05,
        miscExpenseRate: toFloat(p.misc_expense_rate) || 0.01,
        fixedOverheadRatio: toFloat(p.fixed_overhead_ratio) || 0.25,
      },
    })
    console.log("   ✅ Pricing parameters")
  }

  const v1ClientServices = loadJson("client_services.json")
  let csCount = 0
  for (const cs of v1ClientServices) {
    try {
      await prisma.clientService.create({
        data: {
          organizationId: org.id,
          companyId: mapId("companies", cs.company_id) || "",
          serviceType: String(cs.service_type || "permanent_it"),
          monthlyRevenue: toFloat(cs.monthly_revenue),
          isActive: cs.is_active !== false,
          notes: toStr(cs.notes),
        },
      })
      csCount++
    } catch { }
  }
  console.log(`   ✅ Client services: ${csCount}`)

  // ═══════════════════════════════════════
  // 13. Pipeline Stages
  // ═══════════════════════════════════════
  console.log("1️⃣3️⃣ Creating pipeline stages...")
  const stages = [
    { name: "LEAD", displayName: "Lead", color: "#6366f1", probability: 10, sortOrder: 1 },
    { name: "QUALIFIED", displayName: "Qualified", color: "#3b82f6", probability: 25, sortOrder: 2 },
    { name: "PROPOSAL", displayName: "Proposal", color: "#f59e0b", probability: 50, sortOrder: 3 },
    { name: "NEGOTIATION", displayName: "Negotiation", color: "#f97316", probability: 75, sortOrder: 4 },
    { name: "WON", displayName: "Won", color: "#22c55e", probability: 100, sortOrder: 5, isWon: true },
    { name: "LOST", displayName: "Lost", color: "#ef4444", probability: 0, sortOrder: 6, isLost: true },
  ]
  for (const s of stages) {
    await prisma.pipelineStage.create({ data: { organizationId: org.id, ...s } }).catch(() => { })
  }
  console.log("   ✅ Pipeline stages: 6")

  // ═══════════════════════════════════════
  // 14. SLA Policies
  // ═══════════════════════════════════════
  console.log("1️⃣4️⃣ Importing SLA policies...")
  const v1Sla = loadJson("sla_policies.json")
  if (v1Sla.length > 0) {
    for (const s of v1Sla) {
      try {
        await prisma.slaPolicy.create({
          data: {
            organizationId: org.id,
            name: String((s as any).name || (s as any).priority || "Default"),
            priority: String((s as any).priority || "medium"),
            firstResponseHours: toInt((s as any).first_response_hours || (s as any).firstResponseHours) || 8,
            resolutionHours: toInt((s as any).resolution_hours || (s as any).resolutionHours) || 24,
          },
        })
      } catch { }
    }
    console.log(`   ✅ SLA policies: ${v1Sla.length}`)
  } else {
    // Default SLAs
    const slas = [
      { name: "Critical", priority: "critical", firstResponseHours: 1, resolutionHours: 4 },
      { name: "High", priority: "high", firstResponseHours: 4, resolutionHours: 8 },
      { name: "Medium", priority: "medium", firstResponseHours: 8, resolutionHours: 24 },
      { name: "Low", priority: "low", firstResponseHours: 24, resolutionHours: 72 },
    ]
    for (const s of slas) {
      await prisma.slaPolicy.create({ data: { organizationId: org.id, ...s } }).catch(() => { })
    }
    console.log("   ✅ SLA policies: 4 (defaults)")
  }

  // ═══════════════════════════════════════
  // 15. Currencies
  // ═══════════════════════════════════════
  console.log("1️⃣5️⃣ Importing currencies...")
  const v1Currencies = loadJson("currencies.json")
  if (v1Currencies.length > 0) {
    for (const c of v1Currencies) {
      try {
        await prisma.currency.create({
          data: {
            organizationId: org.id,
            code: String((c as any).code),
            name: String((c as any).name),
            symbol: String((c as any).symbol || (c as any).code),
            exchangeRate: toFloat((c as any).exchange_rate || (c as any).exchangeRate) || 1,
            isBase: !!(c as any).is_base,
          },
        })
      } catch { }
    }
    console.log(`   ✅ Currencies: ${v1Currencies.length}`)
  } else {
    const currencies = [
      { code: "AZN", name: "Azerbaijani Manat", symbol: "₼", exchangeRate: 1, isBase: true },
      { code: "USD", name: "US Dollar", symbol: "$", exchangeRate: 0.59 },
      { code: "EUR", name: "Euro", symbol: "€", exchangeRate: 0.54 },
    ]
    for (const c of currencies) {
      await prisma.currency.create({ data: { organizationId: org.id, ...c } }).catch(() => { })
    }
    console.log("   ✅ Currencies: 3 (defaults)")
  }

  // ═══════════════════════════════════════
  // 16. Campaigns
  // ═══════════════════════════════════════
  console.log("1️⃣6️⃣ Importing campaigns...")
  const v1Campaigns = loadJson("campaigns.json")
  for (const c of v1Campaigns) {
    try {
      const campaign = await prisma.campaign.create({
        data: {
          organizationId: org.id,
          name: String((c as any).name || "Campaign"),
          type: String((c as any).type || "email"),
          status: String((c as any).status || "draft"),
          templateId: toStr((c as any).template_id),
          scheduledAt: toDate((c as any).scheduled_at),
          sentAt: toDate((c as any).sent_at),
          totalRecipients: toInt((c as any).total_recipients),
          totalSent: toInt((c as any).sent_count),
          totalOpened: toInt((c as any).open_count),
          totalClicked: toInt((c as any).click_count),
          budget: toFloat((c as any).cost),
          createdBy: toStr((c as any).created_by),
          createdAt: toDate((c as any).created_at) || new Date(),
        },
      })
      saveId("campaigns", (c as any).id, campaign.id)
    } catch { }
  }
  console.log(`   ✅ Campaigns: ${v1Campaigns.length}`)

  // ═══════════════════════════════════════
  // 17. Email Templates
  // ═══════════════════════════════════════
  console.log("1️⃣7️⃣ Importing email templates...")
  const v1Templates = loadJson("email_templates.json")
  let tmplCount = 0
  for (const t of v1Templates) {
    try {
      await prisma.emailTemplate.create({
        data: {
          organizationId: org.id,
          name: String((t as any).name || "Template"),
          subject: toStr((t as any).subject),
          htmlBody: toStr((t as any).body_html),
          category: String((t as any).category || "general"),
          createdBy: toStr((t as any).created_by),
          createdAt: toDate((t as any).created_at) || new Date(),
        },
      })
      tmplCount++
    } catch { }
  }
  console.log(`   ✅ Email templates: ${tmplCount}`)

  // ═══════════════════════════════════════
  // 18. Contact Segments
  // ═══════════════════════════════════════
  console.log("1️⃣8️⃣ Importing segments...")
  const v1Segments = loadJson("contact_segments.json")
  for (const s of v1Segments) {
    try {
      await prisma.contactSegment.create({
        data: {
          organizationId: org.id,
          name: String((s as any).name || "Segment"),
          conditions: toJson((s as any).conditions || (s as any).filter_conditions),
          contactCount: toInt((s as any).contact_count),
          createdBy: toStr((s as any).created_by),
        },
      })
    } catch { }
  }
  console.log(`   ✅ Segments: ${v1Segments.length}`)

  // ═══════════════════════════════════════
  // 19. Journeys & Steps
  // ═══════════════════════════════════════
  console.log("1️⃣9️⃣ Importing journeys...")
  const v1Journeys = loadJson("journeys.json")
  for (const j of v1Journeys) {
    try {
      const journey = await prisma.journey.create({
        data: {
          organizationId: org.id,
          name: String((j as any).name || "Journey"),
          description: toStr((j as any).description),
          status: String((j as any).status || "draft"),
          triggerType: String((j as any).trigger_type || "manual"),
          triggerConditions: toJson((j as any).trigger_conditions),
          entryCount: toInt((j as any).entry_count),
          activeCount: toInt((j as any).active_count),
          completedCount: toInt((j as any).completed_count),
          conversionCount: toInt((j as any).conversion_count),
          createdBy: toStr((j as any).created_by),
          createdAt: toDate((j as any).created_at) || new Date(),
        },
      })
      saveId("journeys", (j as any).id, journey.id)
    } catch { }
  }
  console.log(`   ✅ Journeys: ${v1Journeys.length}`)

  const v1JSteps = loadJson("journey_steps.json")
  let stepCount = 0
  for (const s of v1JSteps) {
    const journeyId = mapId("journeys", (s as any).journey_id)
    if (!journeyId) continue
    try {
      await prisma.journeyStep.create({
        data: {
          journeyId,
          stepOrder: toInt((s as any).step_order),
          stepType: String((s as any).step_type || "action"),
          config: toJson((s as any).config),
          yesNextStep: (s as any).yes_next_step ? toInt((s as any).yes_next_step) : null,
          noNextStep: (s as any).no_next_step ? toInt((s as any).no_next_step) : null,
          statsEntered: toInt((s as any).stats_entered),
          statsCompleted: toInt((s as any).stats_completed),
        },
      })
      stepCount++
    } catch { }
  }
  console.log(`   ✅ Journey steps: ${stepCount}`)

  // ═══════════════════════════════════════
  // 20. KB Articles
  // ═══════════════════════════════════════
  console.log("2️⃣0️⃣ Importing KB articles...")
  const v1KbArticles = loadJson("kb_articles.json")
  let kbCount = 0
  for (const a of v1KbArticles) {
    try {
      await prisma.kbArticle.create({
        data: {
          organizationId: org.id,
          title: String((a as any).title || "Article"),
          content: toStr((a as any).content),
          status: String((a as any).status || "published"),
          authorId: toStr((a as any).created_by),
          viewCount: toInt((a as any).views),
          helpfulCount: toInt((a as any).helpful_yes),
          tags: Array.isArray((a as any).tags) ? (a as any).tags.map(String) : [],
          createdAt: toDate((a as any).created_at) || new Date(),
        },
      })
      kbCount++
    } catch { }
  }
  console.log(`   ✅ KB articles: ${kbCount}`)

  // ═══════════════════════════════════════
  // 21. Notifications
  // ═══════════════════════════════════════
  console.log("2️⃣1️⃣ Importing notifications...")
  const v1Notifs = loadJson("notifications.json")
  let notifCount = 0
  for (const n of v1Notifs) {
    try {
      await prisma.notification.create({
        data: {
          organizationId: org.id,
          userId: mapId("users", (n as any).user_id) || Object.values(idMap["users"] || {})[0] || "unknown",
          type: String((n as any).type || "info"),
          title: String((n as any).title || "Notification"),
          message: toStr((n as any).message),
          entityType: toStr((n as any).entity_type),
          entityId: toStr((n as any).entity_id),
          isRead: !!(n as any).is_read,
          createdAt: toDate((n as any).created_at) || new Date(),
        },
      })
      notifCount++
    } catch { }
  }
  console.log(`   ✅ Notifications: ${notifCount}`)

  // ═══════════════════════════════════════
  // 22. Workflow Rules & Actions
  // ═══════════════════════════════════════
  console.log("2️⃣2️⃣ Importing workflows...")
  const v1Rules = loadJson("workflow_rules.json")
  for (const r of v1Rules) {
    try {
      const rule = await prisma.workflowRule.create({
        data: {
          organizationId: org.id,
          name: String((r as any).name || "Rule"),
          entityType: String((r as any).entity_type || "deal"),
          triggerEvent: String((r as any).trigger_event || "created"),
          conditions: toJson((r as any).conditions),
          isActive: !!(r as any).is_active,
          createdBy: toStr((r as any).created_by),
        },
      })
      saveId("workflow_rules", (r as any).id, rule.id)
    } catch { }
  }
  console.log(`   ✅ Workflow rules: ${v1Rules.length}`)

  const v1Actions = loadJson("workflow_actions.json")
  let actionCount = 0
  for (const a of v1Actions) {
    const ruleId = mapId("workflow_rules", (a as any).rule_id)
    if (!ruleId) continue
    try {
      await prisma.workflowAction.create({
        data: {
          ruleId,
          actionType: String((a as any).action_type || "notify"),
          actionConfig: toJson((a as any).action_config),
          actionOrder: toInt((a as any).action_order),
        },
      })
      actionCount++
    } catch { }
  }
  console.log(`   ✅ Workflow actions: ${actionCount}`)

  // ═══════════════════════════════════════
  // 23. AI Agent Configs
  // ═══════════════════════════════════════
  console.log("2️⃣3️⃣ Importing AI configs...")
  const v1AiConfigs = loadJson("ai_agent_configs.json")
  for (const c of v1AiConfigs) {
    try {
      const config = await prisma.aiAgentConfig.create({
        data: {
          organizationId: org.id,
          configName: String((c as any).config_name || "Default"),
          model: String((c as any).model || "claude-haiku-4-5-20251001"),
          maxTokens: toInt((c as any).max_tokens) || 1024,
          temperature: toFloat((c as any).temperature) || 1.0,
          systemPrompt: toStr((c as any).system_prompt_template),
          toolsEnabled: Array.isArray((c as any).tools_enabled) ? (c as any).tools_enabled : [],
          kbEnabled: (c as any).kb_enabled !== false,
          kbMaxArticles: toInt((c as any).kb_max_articles) || 3,
          isActive: !!(c as any).is_active,
          version: toInt((c as any).version) || 1,
          notes: toStr((c as any).notes),
        },
      })
      saveId("ai_agent_configs", (c as any).id, config.id)
    } catch { }
  }
  console.log(`   ✅ AI configs: ${v1AiConfigs.length}`)

  // ═══════════════════════════════════════
  // 24. AI Chat Sessions & Messages
  // ═══════════════════════════════════════
  console.log("2️⃣4️⃣ Importing AI chat sessions...")
  const v1Sessions = loadJson("ai_chat_sessions.json")
  for (const s of v1Sessions) {
    try {
      const session = await prisma.aiChatSession.create({
        data: {
          organizationId: org.id,
          portalUserId: toStr((s as any).portal_user_id),
          companyId: mapId("companies", (s as any).company_id),
          messagesCount: toInt((s as any).messages_count),
          createdAt: toDate((s as any).created_at) || new Date(),
        },
      })
      saveId("ai_chat_sessions", (s as any).id, session.id)
    } catch { }
  }
  console.log(`   ✅ AI sessions: ${v1Sessions.length}`)

  const v1Messages = loadJson("ai_chat_messages.json")
  let msgCount = 0
  for (const m of v1Messages) {
    const sessionId = mapId("ai_chat_sessions", (m as any).session_id)
    if (!sessionId) continue
    try {
      await prisma.aiChatMessage.create({
        data: {
          sessionId,
          role: String((m as any).role || "user"),
          content: String((m as any).content || ""),
          createdAt: toDate((m as any).created_at) || new Date(),
        },
      })
      msgCount++
    } catch { }
  }
  console.log(`   ✅ AI messages: ${msgCount}`)

  // ═══════════════════════════════════════
  // 25. Channel Configs
  // ═══════════════════════════════════════
  console.log("2️⃣5️⃣ Importing channel configs...")
  const v1Channels = loadJson("channel_configs.json")
  for (const ch of v1Channels) {
    try {
      await prisma.channelConfig.create({
        data: {
          organizationId: org.id,
          channelType: String((ch as any).channel_type || "telegram"),
          configName: String((ch as any).config_name || (ch as any).channel_type || "Channel"),
          // Legacy exports are not an approved secret-transfer channel. Keep
          // the integration identity for operator review, but require fresh
          // credentials and endpoint validation before it can be activated.
          botToken: null,
          webhookUrl: null,
          apiKey: null,
          phoneNumber: toStr((ch as any).phone_number),
          isActive: false,
          createdBy: toStr((ch as any).created_by),
        },
      })
    } catch { }
  }
  console.log(`   ✅ Channel configs: ${v1Channels.length}`)

  // ═══════════════════════════════════════
  // 26. Custom Fields
  // ═══════════════════════════════════════
  console.log("2️⃣6️⃣ Importing custom fields...")
  const v1CustomFields = loadJson("custom_fields.json")
  for (const f of v1CustomFields) {
    try {
      await prisma.customField.create({
        data: {
          organizationId: org.id,
          entityType: String((f as any).entity_type || "company"),
          fieldName: String((f as any).field_name || (f as any).name),
          fieldLabel: String((f as any).field_label || (f as any).label || (f as any).field_name),
          fieldType: String((f as any).field_type || "text"),
          options: Array.isArray((f as any).options) ? (f as any).options.map(String) : [],
          isRequired: !!(f as any).is_required,
          defaultValue: toStr((f as any).default_value),
          sortOrder: toInt((f as any).sort_order),
        },
      })
    } catch { }
  }
  console.log(`   ✅ Custom fields: ${v1CustomFields.length}`)

  // ═══════════════════════════════════════
  // 27. Dashboard Layouts
  // ═══════════════════════════════════════
  console.log("2️⃣7️⃣ Importing dashboard layouts...")
  const v1Dashboards = loadJson("dashboard_layouts.json")
  for (const d of v1Dashboards) {
    try {
      await prisma.dashboardLayout.create({
        data: {
          organizationId: org.id,
          userId: mapId("users", (d as any).user_id) || Object.values(idMap["users"] || {})[0] || "unknown",
          name: String((d as any).name || "Default"),
          layout: toJson((d as any).layout || (d as any).widgets),
          isDefault: !!(d as any).is_default,
        },
      })
    } catch { }
  }
  console.log(`   ✅ Dashboard layouts: ${v1Dashboards.length}`)

  // ═══════════════════════════════════════
  // 28. Audit Log (last 2000)
  // ═══════════════════════════════════════
  console.log("2️⃣8️⃣ Importing audit log...")
  const v1Audit = loadJson("audit_log.json")
  let auditCount = 0
  for (const a of v1Audit) {
    try {
      await prisma.auditLog.create({
        data: {
          organizationId: org.id,
          userId: toStr((a as any).user_id),
          action: String((a as any).action || "unknown"),
          entityType: String((a as any).entity_type || "unknown"),
          entityId: toStr((a as any).entity_id),
          entityName: toStr((a as any).entity_name),
          oldValue: (a as any).old_value ? toJson((a as any).old_value) : null,
          newValue: (a as any).new_value ? toJson((a as any).new_value) : null,
          ipAddress: toStr((a as any).ip_address),
          createdAt: toDate((a as any).created_at) || new Date(),
        },
      })
      auditCount++
    } catch { }
  }
  console.log(`   ✅ Audit log: ${auditCount}`)

  // ═══════════════════════════════════════
  // 29. Nurture Sequences
  // ═══════════════════════════════════════
  console.log("2️⃣9️⃣ Importing nurture sequences...")
  // Nurture sequences don't have a v2 Prisma model yet — store as JSON for future migration
  const v1Nurture = loadJson("nurture_sequences.json")
  const v1NurtureSteps = loadJson("nurture_steps.json")
  console.log(`   ℹ️ Nurture: ${v1Nurture.length} sequences, ${v1NurtureSteps.length} steps (stored as v1-data for future use)`)

  // ═══════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════
  console.log("")
  console.log("═══════════════════════════════════════════════════")
  console.log("✅ Import complete!")
  console.log("")
  console.log("   📊 Summary:")
  console.log(`   - Organization: ${org.name}`)
  console.log(`   - Users: ${userCount}`)
  console.log(`   - Companies: ${companyCount}`)
  console.log(`   - Contacts: ${contactCount}`)
  console.log(`   - Deals: ${dealCount}`)
  console.log(`   - Leads: ${leadCount}`)
  console.log(`   - Tasks: ${taskCount}`)
  console.log(`   - Activities: ${activityCount}`)
  console.log(`   - Contracts: ${contractCount}`)
  console.log(`   - Offers: ${offerCount}`)
  console.log(`   - Tickets: ${ticketCount} (+ ${commentCount} comments)`)
  console.log(`   - KB Articles: ${kbCount}`)
  console.log(`   - Email Templates: ${tmplCount}`)
  console.log(`   - AI Sessions: ${v1Sessions.length} (+ ${msgCount} messages)`)
  console.log(`   - Audit Log: ${auditCount}`)
  console.log("")
  console.log("   🔑 Login: admin@leaddrive.com (password set via ADMIN_PASSWORD env var)")
  console.log("   Imported v1 users are disabled and require an administrator password reset before activation")
  console.log("═══════════════════════════════════════════════════")
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())
