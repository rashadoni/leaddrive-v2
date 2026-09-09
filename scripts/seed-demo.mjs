// Seed demo data for proposal screenshots
// Local run: ADMIN_PASSWORD='...' node scripts/seed-demo.mjs
// Non-local run additionally requires DEMO_ORG_SLUG and
// CONFIRM_PROD=seed-demo:<tenant-slug>.

import { makeScriptPrisma } from "./_rls.mjs"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "./password-policy.mjs"

const requestedOrgSlug = process.env.DEMO_ORG_SLUG?.trim() || ""

function isLocalDatabase(databaseUrl) {
  if (process.env.NODE_ENV === "production") return false
  try {
    const hostname = new URL(databaseUrl || "").hostname
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(hostname)
  } catch {
    return false
  }
}

if (!isLocalDatabase(process.env.DATABASE_URL)) {
  if (!requestedOrgSlug) {
    throw new Error("Set DEMO_ORG_SLUG before seeding a non-local database")
  }
  const requiredConfirmation = `seed-demo:${requestedOrgSlug}`
  if (process.env.CONFIRM_PROD !== requiredConfirmation) {
    throw new Error(`Set CONFIRM_PROD=${requiredConfirmation} to seed this non-local tenant`)
  }
}

const prisma = await makeScriptPrisma()

async function main() {
  // Find demo organization or use existing
  let org = requestedOrgSlug
    ? await prisma.organization.findUnique({ where: { slug: requestedOrgSlug } })
    : await prisma.organization.findFirst({ where: { slug: "demo-company" } })
  if (!org && !requestedOrgSlug) {
    org = await prisma.organization.findFirst()
  }
  if (!org) {
    console.error("No organization found!")
    process.exit(1)
  }

  const orgId = org.id
  console.log(`Using org: ${org.name} (${orgId})`)

  // Get or create demo user
  let user = await prisma.user.findFirst({ where: { organizationId: orgId, role: "admin" } })
  if (!user) {
    const adminPassword = process.env.ADMIN_PASSWORD
    const passwordError = passwordPolicyError(adminPassword)
    if (passwordError) throw new Error(`ADMIN_PASSWORD rejected: ${passwordError}`)
    const hash = await bcrypt.hash(adminPassword, 12)
    user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: "demo@leaddrivecrm.org",
        name: "Rashad Rahimov",
        passwordHash: hash,
        passwordChangedAt: new Date(),
        role: "admin",
        isActive: true,
      },
    })
  }
  console.log(`User: ${user.email}`)

  // Get pipeline stages
  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId: orgId },
    orderBy: { sortOrder: "asc" },
  })
  if (stages.length === 0) {
    // Create default stages
    const stageData = [
      { name: "LEAD", displayName: "Yeni Lead", color: "#6366f1", probability: 10, sortOrder: 0 },
      { name: "QUALIFIED", displayName: "Kvalifikasiya", color: "#3b82f6", probability: 25, sortOrder: 1 },
      { name: "PROPOSAL", displayName: "Teklif", color: "#f59e0b", probability: 50, sortOrder: 2 },
      { name: "NEGOTIATION", displayName: "Danisiq", color: "#8b5cf6", probability: 75, sortOrder: 3 },
      { name: "WON", displayName: "Uduldu", color: "#10b981", probability: 100, sortOrder: 4, isWon: true },
      { name: "LOST", displayName: "Itirildi", color: "#ef4444", probability: 0, sortOrder: 5, isLost: true },
    ]
    for (const s of stageData) {
      await prisma.pipelineStage.create({ data: { ...s, organizationId: orgId } })
    }
  }

  // ─── Companies ───
  const companies = [
    { name: "Azercell Telekom MMC", industry: "Telekommunikasiya", website: "azercell.com", phone: "+994 50 200 0000", email: "info@azercell.com", city: "Baki", country: "Azerbaycan", employeeCount: 1500, annualRevenue: 450000, status: "active", category: "client" },
    { name: "SOCAR Trading", industry: "Neft ve Qaz", website: "socar.az", phone: "+994 12 521 0000", email: "info@socar.az", city: "Baki", country: "Azerbaycan", employeeCount: 5000, annualRevenue: 2500000, status: "active", category: "client" },
    { name: "Pasha Holding", industry: "Maliyye", website: "pashaholding.az", phone: "+994 12 496 5000", email: "info@pashaholding.az", city: "Baki", country: "Azerbaycan", employeeCount: 3000, annualRevenue: 1200000, status: "active", category: "client" },
    { name: "Kapital Bank", industry: "Bankcilik", website: "kapitalbank.az", phone: "+994 12 310 0000", email: "info@kapitalbank.az", city: "Baki", country: "Azerbaycan", employeeCount: 2000, annualRevenue: 800000, status: "active", category: "client" },
    { name: "ABB Sigorta", industry: "Sigorta", website: "abbsigorta.az", phone: "+994 12 404 4040", email: "info@abbsigorta.az", city: "Baki", country: "Azerbaycan", employeeCount: 400, annualRevenue: 350000, status: "active", category: "prospect" },
    { name: "AzerGold QSC", industry: "Madencilik", website: "azergold.az", phone: "+994 12 598 0000", email: "info@azergold.az", city: "Baki", country: "Azerbaycan", employeeCount: 800, annualRevenue: 600000, status: "active", category: "client" },
    { name: "Bravo Supermarket", industry: "Pereknde", website: "bravo.az", phone: "+994 12 555 0000", email: "info@bravo.az", city: "Baki", country: "Azerbaycan", employeeCount: 1200, annualRevenue: 500000, status: "active", category: "prospect" },
    { name: "Azersun Holding", industry: "FMCG", website: "azersun.com", phone: "+994 12 404 5050", email: "info@azersun.com", city: "Baki", country: "Azerbaycan", employeeCount: 2500, annualRevenue: 900000, status: "active", category: "client" },
    { name: "ASAN Xidmet", industry: "Dovlet", website: "asan.gov.az", phone: "+994 12 130", email: "info@asan.gov.az", city: "Baki", country: "Azerbaycan", employeeCount: 600, annualRevenue: 0, status: "active", category: "partner" },
    { name: "Bakcell MMC", industry: "Telekommunikasiya", website: "bakcell.com", phone: "+994 55 000 0000", email: "info@bakcell.com", city: "Baki", country: "Azerbaycan", employeeCount: 900, annualRevenue: 380000, status: "active", category: "prospect" },
    { name: "Port of Baku", industry: "Logistika", website: "portofbaku.com", phone: "+994 12 525 0000", email: "info@portofbaku.com", city: "Baki", country: "Azerbaycan", employeeCount: 700, annualRevenue: 450000, status: "active", category: "client" },
    { name: "Silk Way Airlines", industry: "Aviasiya", website: "silkwayairlines.com", phone: "+994 12 437 0000", email: "info@silkwayairlines.com", city: "Baki", country: "Azerbaycan", employeeCount: 400, annualRevenue: 700000, status: "active", category: "client" },
  ]

  const createdCompanies = []
  for (const c of companies) {
    const existing = await prisma.company.findFirst({ where: { organizationId: orgId, name: c.name } })
    if (existing) {
      createdCompanies.push(existing)
    } else {
      const created = await prisma.company.create({ data: { ...c, organizationId: orgId } })
      createdCompanies.push(created)
    }
  }
  console.log(`Companies: ${createdCompanies.length}`)

  // ─── Contacts ───
  const contacts = [
    { fullName: "Elvin Mammadov", email: "elvin@azercell.com", phone: "+994 50 200 1234", position: "IT Direktor", department: "IT", companyIdx: 0, engagementScore: 85 },
    { fullName: "Kamala Hesenova", email: "kamala@socar.az", phone: "+994 55 300 5678", position: "CTO", department: "Texnologiya", companyIdx: 1, engagementScore: 92 },
    { fullName: "Tural Aliyev", email: "tural@pashaholding.az", phone: "+994 50 400 9012", position: "VP of Sales", department: "Satis", companyIdx: 2, engagementScore: 78 },
    { fullName: "Nigar Babayeva", email: "nigar@kapitalbank.az", phone: "+994 55 500 3456", position: "COO", department: "Emeliyyatlar", companyIdx: 3, engagementScore: 88 },
    { fullName: "Rashad Veliyev", email: "rashad@abbsigorta.az", phone: "+994 50 600 7890", position: "CEO", department: "Rehberlik", companyIdx: 4, engagementScore: 65 },
    { fullName: "Sevda Alizada", email: "sevda@azergold.az", phone: "+994 55 700 1234", position: "CFO", department: "Maliyye", companyIdx: 5, engagementScore: 72 },
    { fullName: "Farid Huseynov", email: "farid@bravo.az", phone: "+994 50 800 5678", position: "IT Manager", department: "IT", companyIdx: 6, engagementScore: 55 },
    { fullName: "Leyla Quliyeva", email: "leyla@azersun.com", phone: "+994 55 900 9012", position: "Marketing Director", department: "Marketinq", companyIdx: 7, engagementScore: 80 },
    { fullName: "Orxan Ismayilov", email: "orxan@asan.gov.az", phone: "+994 50 100 3456", position: "Layihe Meneceri", department: "Layiheler", companyIdx: 8, engagementScore: 70 },
    { fullName: "Gunay Mehdiyeva", email: "gunay@bakcell.com", phone: "+994 55 200 7890", position: "HR Director", department: "HR", companyIdx: 9, engagementScore: 60 },
    { fullName: "Samir Kazimov", email: "samir@portofbaku.com", phone: "+994 50 300 1234", position: "CIO", department: "IT", companyIdx: 10, engagementScore: 75 },
    { fullName: "Aysel Nuriyeva", email: "aysel@silkwayairlines.com", phone: "+994 55 400 5678", position: "VP Operations", department: "Emeliyyatlar", companyIdx: 11, engagementScore: 82 },
    { fullName: "Vuqar Hasanov", email: "vuqar@azercell.com", phone: "+994 50 201 0000", position: "Sales Manager", department: "Satis", companyIdx: 0, engagementScore: 68 },
    { fullName: "Nazrin Mammadova", email: "nazrin@socar.az", phone: "+994 55 301 0000", position: "Project Lead", department: "Layiheler", companyIdx: 1, engagementScore: 77 },
    { fullName: "Emin Aghayev", email: "emin@pashaholding.az", phone: "+994 50 401 0000", position: "DevOps Engineer", department: "IT", companyIdx: 2, engagementScore: 50 },
  ]

  const createdContacts = []
  for (const c of contacts) {
    const existing = await prisma.contact.findFirst({ where: { organizationId: orgId, email: c.email } })
    if (existing) {
      createdContacts.push(existing)
    } else {
      const { companyIdx, ...rest } = c
      const created = await prisma.contact.create({
        data: {
          ...rest,
          organizationId: orgId,
          companyId: createdCompanies[companyIdx].id,
          isActive: true,
          tags: [],
        },
      })
      createdContacts.push(created)
    }
  }
  console.log(`Contacts: ${createdContacts.length}`)

  // ─── Deals ───
  const deals = [
    { name: "Azercell CRM Inteqrasiya", companyIdx: 0, contactIdx: 0, stage: "NEGOTIATION", valueAmount: 145000, probability: 75, currency: "AZN" },
    { name: "SOCAR ERP Modernizasiya", companyIdx: 1, contactIdx: 1, stage: "PROPOSAL", valueAmount: 320000, probability: 50, currency: "AZN" },
    { name: "Pasha Holding Data Analytics", companyIdx: 2, contactIdx: 2, stage: "WON", valueAmount: 185000, probability: 100, currency: "AZN" },
    { name: "Kapital Bank Mobil App", companyIdx: 3, contactIdx: 3, stage: "NEGOTIATION", valueAmount: 95000, probability: 70, currency: "AZN" },
    { name: "ABB Sigorta Portal", companyIdx: 4, contactIdx: 4, stage: "LEAD", valueAmount: 67000, probability: 15, currency: "AZN" },
    { name: "AzerGold SAP Inteqrasiya", companyIdx: 5, contactIdx: 5, stage: "WON", valueAmount: 256000, probability: 100, currency: "AZN" },
    { name: "Bravo ERP Sistemi", companyIdx: 6, contactIdx: 6, stage: "QUALIFIED", valueAmount: 120000, probability: 25, currency: "AZN" },
    { name: "Azersun CRM Tətbiqi", companyIdx: 7, contactIdx: 7, stage: "PROPOSAL", valueAmount: 89000, probability: 45, currency: "AZN" },
    { name: "ASAN Dijital Transform.", companyIdx: 8, contactIdx: 8, stage: "NEGOTIATION", valueAmount: 210000, probability: 80, currency: "AZN" },
    { name: "Bakcell Cloud Migration", companyIdx: 9, contactIdx: 9, stage: "LEAD", valueAmount: 78000, probability: 10, currency: "AZN" },
    { name: "Port of Baku WMS", companyIdx: 10, contactIdx: 10, stage: "WON", valueAmount: 167000, probability: 100, currency: "AZN" },
    { name: "Silk Way Cargo Track", companyIdx: 11, contactIdx: 11, stage: "PROPOSAL", valueAmount: 134000, probability: 55, currency: "AZN" },
  ]

  for (const d of deals) {
    const existing = await prisma.deal.findFirst({ where: { organizationId: orgId, name: d.name } })
    if (!existing) {
      await prisma.deal.create({
        data: {
          organizationId: orgId,
          name: d.name,
          companyId: createdCompanies[d.companyIdx].id,
          contactId: createdContacts[d.contactIdx].id,
          stage: d.stage,
          valueAmount: d.valueAmount,
          probability: d.probability,
          currency: d.currency,
          assignedTo: user.id,
          expectedClose: new Date(Date.now() + Math.random() * 90 * 24 * 60 * 60 * 1000),
          tags: [],
        },
      })
    }
  }
  console.log(`Deals: ${deals.length}`)

  // ─── Leads ───
  const leads = [
    { contactName: "Ali Hasanov", companyName: "TechVision MMC", email: "ali@techvision.az", phone: "+994 50 111 2233", source: "website", status: "new", priority: "high", score: 85, estimatedValue: 45000 },
    { contactName: "Gunel Rzayeva", companyName: "DataPro LLC", email: "gunel@datapro.az", phone: "+994 55 222 3344", source: "referral", status: "contacted", priority: "high", score: 78, estimatedValue: 67000 },
    { contactName: "Murad Ahmadov", companyName: "CloudAz", email: "murad@cloudaz.com", phone: "+994 50 333 4455", source: "linkedin", status: "qualified", priority: "medium", score: 72, estimatedValue: 34000 },
    { contactName: "Narmin Aliyeva", companyName: "InnoTech Baku", email: "narmin@innotech.az", phone: "+994 55 444 5566", source: "exhibition", status: "new", priority: "medium", score: 65, estimatedValue: 28000 },
    { contactName: "Ilkin Mammadov", companyName: "DigiServ", email: "ilkin@digiserv.az", phone: "+994 50 555 6677", source: "cold_call", status: "contacted", priority: "low", score: 45, estimatedValue: 15000 },
    { contactName: "Sevinc Huseynli", companyName: "AzNet Solutions", email: "sevinc@aznet.az", phone: "+994 55 666 7788", source: "website", status: "new", priority: "high", score: 90, estimatedValue: 89000 },
    { contactName: "Fuad Ibrahimov", companyName: "SmartBaku LLC", email: "fuad@smartbaku.az", phone: "+994 50 777 8899", source: "partner", status: "qualified", priority: "medium", score: 68, estimatedValue: 52000 },
    { contactName: "Lala Mammadzada", companyName: "GreenTech AZ", email: "lala@greentech.az", phone: "+994 55 888 9900", source: "webinar", status: "contacted", priority: "high", score: 82, estimatedValue: 73000 },
  ]

  for (const l of leads) {
    const existing = await prisma.lead.findFirst({ where: { organizationId: orgId, email: l.email } })
    if (!existing) {
      await prisma.lead.create({
        data: { ...l, organizationId: orgId, assignedTo: user.id },
      })
    }
  }
  console.log(`Leads: ${leads.length}`)

  // ─── Tasks ───
  const tasks = [
    { title: "Azercell ile demo gorusu", status: "in_progress", priority: "high", dueDate: new Date("2026-04-08") },
    { title: "SOCAR teklif hazirla", status: "pending", priority: "high", dueDate: new Date("2026-04-10") },
    { title: "Pasha Holding muqavile imzala", status: "completed", priority: "high", dueDate: new Date("2026-04-05") },
    { title: "Kapital Bank texniki audit", status: "in_progress", priority: "medium", dueDate: new Date("2026-04-12") },
    { title: "ABB Sigorta ilk gorusme", status: "pending", priority: "medium", dueDate: new Date("2026-04-15") },
    { title: "AzerGold son sprint", status: "completed", priority: "high", dueDate: new Date("2026-04-03") },
    { title: "Bravo ERP requirementlar", status: "pending", priority: "low", dueDate: new Date("2026-04-20") },
    { title: "Azersun marketinq plani", status: "in_progress", priority: "medium", dueDate: new Date("2026-04-09") },
    { title: "ASAN layihe kick-off", status: "pending", priority: "high", dueDate: new Date("2026-04-11") },
    { title: "Bakcell prezentasiya", status: "pending", priority: "low", dueDate: new Date("2026-04-18") },
  ]

  for (const t of tasks) {
    const existing = await prisma.task.findFirst({ where: { organizationId: orgId, title: t.title } })
    if (!existing) {
      await prisma.task.create({
        data: {
          ...t,
          organizationId: orgId,
          assignedTo: user.id,
          createdBy: user.id,
        },
      })
    }
  }
  console.log(`Tasks: ${tasks.length}`)

  // ─── Tickets ───
  const tickets = [
    { ticketNumber: "TK-001", subject: "CRM giris problemi", description: "Istifadeci sisteme daxil ola bilmir", priority: "high", status: "new", category: "technical", contactIdx: 0, companyIdx: 0 },
    { ticketNumber: "TK-002", subject: "Hesabat yuklenmesi yavas", description: "Dashboard-da hesabatlar gec yuklenir", priority: "medium", status: "in_progress", category: "performance", contactIdx: 1, companyIdx: 1 },
    { ticketNumber: "TK-003", subject: "Faktura PDF xetasi", description: "PDF yaradilarkrn xeta bas verir", priority: "high", status: "new", category: "bug", contactIdx: 3, companyIdx: 3 },
    { ticketNumber: "TK-004", subject: "Yeni istifadeci elave etmek", description: "Yeni komanda uzvu ucun hesab yaratmaq lazimdir", priority: "low", status: "resolved", category: "general", contactIdx: 5, companyIdx: 5 },
    { ticketNumber: "TK-005", subject: "API inteqrasiya sorgusu", description: "Webhook konfiqurasiyasi haqqinda melumat lazimdir", priority: "medium", status: "new", category: "integration", contactIdx: 7, companyIdx: 7 },
    { ticketNumber: "TK-006", subject: "Mobil gorunus optimizasiyasi", description: "Mobil cihazlarda sidebar duzgun gorsenmir", priority: "low", status: "in_progress", category: "ui", contactIdx: 10, companyIdx: 10 },
  ]

  for (const t of tickets) {
    const existing = await prisma.ticket.findFirst({ where: { organizationId: orgId, ticketNumber: t.ticketNumber } })
    if (!existing) {
      const { contactIdx, companyIdx, ...rest } = t
      await prisma.ticket.create({
        data: {
          ...rest,
          organizationId: orgId,
          contactId: createdContacts[contactIdx].id,
          companyId: createdCompanies[companyIdx].id,
          assignedTo: user.id,
          createdBy: user.id,
          tags: [],
          escalationLevel: 0,
        },
      })
    }
  }
  console.log(`Tickets: ${tickets.length}`)

  // ─── Campaigns ───
  const campaigns = [
    { name: "Novruz Bayram Kampaniyasi", type: "email", status: "sent", subject: "Novruz tebriki ve xususi teklif!", totalRecipients: 1250, totalSent: 1230, totalOpened: 485, totalClicked: 156, budget: 500, actualCost: 420 },
    { name: "Yeni Mehsul Lansmani", type: "email", status: "running", subject: "LeadDrive v2 — yeni imkanlar!", totalRecipients: 890, totalSent: 870, totalOpened: 342, totalClicked: 98, budget: 800, actualCost: 650 },
    { name: "Webinar Deveti — AI CRM", type: "email", status: "draft", subject: "AI ile satisinizi artirinr", totalRecipients: 0, totalSent: 0, totalOpened: 0, totalClicked: 0, budget: 300, actualCost: 0 },
    { name: "Referral Proqrami", type: "email", status: "sent", subject: "Dostunuzu devetl edin — 20% endirim!", totalRecipients: 650, totalSent: 640, totalOpened: 312, totalClicked: 145, budget: 200, actualCost: 180 },
    { name: "Yilsonu Endirim", type: "email", status: "sent", subject: "Ilin son fursetleri!", totalRecipients: 2100, totalSent: 2050, totalOpened: 890, totalClicked: 267, budget: 1200, actualCost: 1100 },
  ]

  for (const c of campaigns) {
    const existing = await prisma.campaign.findFirst({ where: { organizationId: orgId, name: c.name } })
    if (!existing) {
      await prisma.campaign.create({
        data: {
          ...c,
          organizationId: orgId,
          createdBy: user.id,
          sentAt: c.status === "sent" ? new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) : undefined,
        },
      })
    }
  }
  console.log(`Campaigns: ${campaigns.length}`)

  console.log("\n✅ Demo data seeded successfully!")
  console.log(`Login: ${user.email}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
