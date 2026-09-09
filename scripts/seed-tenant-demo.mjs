// Seed demo data into a specific tenant
// This production-capable script is invoked by the authorized tenant-admin API.
// Manual use requires the same dedicated confirmation and a policy-compliant
// password supplied through SEED_PASSWORD or --password.

import { makeScriptPrisma } from "./_rls.mjs"
import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "./password-policy.mjs"

const REQUIRED_CONFIRMATION = "tenant-demo-seed-v1"
let prisma

if (process.env.CONFIRM_PROD !== REQUIRED_CONFIRMATION) {
  throw new Error(`Set CONFIRM_PROD=${REQUIRED_CONFIRMATION} to run this scoped production seed`)
}

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split("=").slice(1).join("=") : null
}

async function main() {
  const slug = getArg("slug")
  if (!slug) {
    throw new Error("Pass --slug=<tenant-slug>")
  }

  const password = process.env.SEED_PASSWORD ?? getArg("password")
  if (!password) throw new Error("Set SEED_PASSWORD or pass --password=<policy-compliant-secret>")
  const passwordError = passwordPolicyError(password)
  if (passwordError) throw new Error(`Seed password rejected: ${passwordError}`)
  // A repair seed may need to populate a tenant that is already in use. In
  // that case the operator can preserve the existing tenant admin's password
  // while still using the supplied password for any demo teammates created by
  // this script. The normal admin-API path leaves this false and keeps its
  // current behaviour of setting the generated tenant password explicitly.
  const preserveExistingAdminPassword = process.env.SEED_PRESERVE_EXISTING_ADMIN_PASSWORD === "true"

  prisma = await makeScriptPrisma()

  // Find tenant
  const org = await prisma.organization.findUnique({ where: { slug } })
  if (!org) {
    console.error(`Tenant "${slug}" not found!`)
    process.exit(1)
  }

  const orgId = org.id
  console.log(`\nTenant: ${org.name} (${slug})`)
  console.log(`Plan: ${org.plan}`)
  console.log("─".repeat(50))

  // ─── Admin User ───
  let user = await prisma.user.findFirst({ where: { organizationId: orgId, role: "admin" } })
  if (!user) {
    const hash = await bcrypt.hash(password, 12)
    user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `admin@${slug}.com`,
        name: "Demo Admin",
        passwordHash: hash,
        role: "admin",
        isActive: true,
        passwordChangedAt: new Date(),
      },
    })
    console.log(`Created admin user: ${user.email}`)
  } else {
    if (preserveExistingAdminPassword) {
      console.log(`Admin user: ${user.email} (password preserved)`)
    } else {
      // The regular new-tenant flow passes its temporary password here, so the
      // seed and welcome response stay in sync.
      const hash = await bcrypt.hash(password, 12)
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, passwordChangedAt: new Date() },
      })
      console.log(`Admin user: ${user.email} (password updated)`)
    }
  }

  // Create additional team members
  const teamMembers = [
    { name: "Sarah Johnson", email: `sarah@${slug}.com`, role: "manager" },
    { name: "Alex Chen", email: `alex@${slug}.com`, role: "member" },
    { name: "Maria Lopez", email: `maria@${slug}.com`, role: "member" },
  ]

  for (const tm of teamMembers) {
    const existing = await prisma.user.findFirst({ where: { organizationId: orgId, email: tm.email } })
    if (!existing) {
      const hash = await bcrypt.hash(password, 12)
      await prisma.user.create({
        data: { ...tm, organizationId: orgId, passwordHash: hash, isActive: true },
      })
    }
  }
  console.log(`Team members: ${teamMembers.length}`)

  // ─── Preserve the tenant's selected modules ───
  // Demo data may populate Support tickets and knowledge-base articles, but it
  // must never turn on Omni-Channel, AI, or any other commercial entitlement.
  console.log("Features: unchanged (demo content respects the tenant plan)")

  // ─── Pipeline + Stages ───
  let pipeline = await prisma.pipeline.findFirst({ where: { organizationId: orgId, isDefault: true } })
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: { organizationId: orgId, name: "Sales Pipeline", isDefault: true, sortOrder: 0 },
    })
    console.log("Pipeline: created")
  } else {
    console.log(`Pipeline: ${pipeline.name} (existing)`)
  }

  let stages = await prisma.pipelineStage.findMany({
    where: { organizationId: orgId, pipelineId: pipeline.id },
    orderBy: { sortOrder: "asc" },
  })
  if (stages.length === 0) {
    // Check if stages exist without pipelineId (legacy provisioning) and fix them
    const orphanStages = await prisma.pipelineStage.findMany({
      where: { organizationId: orgId, pipelineId: null },
    })
    if (orphanStages.length > 0) {
      for (const s of orphanStages) {
        await prisma.pipelineStage.update({ where: { id: s.id }, data: { pipelineId: pipeline.id } })
      }
      stages = await prisma.pipelineStage.findMany({
        where: { organizationId: orgId, pipelineId: pipeline.id },
        orderBy: { sortOrder: "asc" },
      })
      console.log(`Pipeline stages: ${stages.length} (fixed orphans → linked to pipeline)`)
    } else {
      const stageData = [
        { name: "LEAD", displayName: "New Lead", color: "#6366f1", probability: 10, sortOrder: 0 },
        { name: "QUALIFIED", displayName: "Qualified", color: "#3b82f6", probability: 25, sortOrder: 1 },
        { name: "PROPOSAL", displayName: "Proposal", color: "#f59e0b", probability: 50, sortOrder: 2 },
        { name: "NEGOTIATION", displayName: "Negotiation", color: "#8b5cf6", probability: 75, sortOrder: 3 },
        { name: "WON", displayName: "Won", color: "#10b981", probability: 100, sortOrder: 4, isWon: true },
        { name: "LOST", displayName: "Lost", color: "#ef4444", probability: 0, sortOrder: 5, isLost: true },
      ]
      for (const s of stageData) {
        await prisma.pipelineStage.create({ data: { ...s, organizationId: orgId, pipelineId: pipeline.id } })
      }
      stages = await prisma.pipelineStage.findMany({
        where: { organizationId: orgId, pipelineId: pipeline.id },
        orderBy: { sortOrder: "asc" },
      })
      console.log(`Pipeline stages: ${stages.length} (created)`)
    }
  } else {
    console.log(`Pipeline stages: ${stages.length} (existing)`)
  }

  // ─── Companies ───
  const companies = [
    { name: "Pfizer Inc.", industry: "Pharmaceuticals", website: "pfizer.com", phone: "+1 212-733-2323", email: "contact@pfizer.com", city: "New York", country: "USA", employeeCount: 79000, annualRevenue: 58000000, status: "active", category: "client" },
    { name: "Roche Holding AG", industry: "Pharmaceuticals", website: "roche.com", phone: "+41 61 688 1111", email: "info@roche.com", city: "Basel", country: "Switzerland", employeeCount: 101000, annualRevenue: 65000000, status: "active", category: "client" },
    { name: "Novartis AG", industry: "Pharmaceuticals", website: "novartis.com", phone: "+41 61 324 1111", email: "info@novartis.com", city: "Basel", country: "Switzerland", employeeCount: 108000, annualRevenue: 51000000, status: "active", category: "client" },
    { name: "AstraZeneca PLC", industry: "Biotechnology", website: "astrazeneca.com", phone: "+44 20 3749 5000", email: "info@astrazeneca.com", city: "Cambridge", country: "UK", employeeCount: 83000, annualRevenue: 45000000, status: "active", category: "prospect" },
    { name: "Merck & Co.", industry: "Pharmaceuticals", website: "merck.com", phone: "+1 908-740-4000", email: "contact@merck.com", city: "Rahway", country: "USA", employeeCount: 69000, annualRevenue: 60000000, status: "active", category: "client" },
    { name: "BioGenesis Labs", industry: "Biotechnology", website: "biogenesislabs.com", phone: "+49 30 555 1234", email: "info@biogenesislabs.com", city: "Berlin", country: "Germany", employeeCount: 450, annualRevenue: 12000000, status: "active", category: "client" },
    { name: "MedTech Solutions", industry: "Medical Devices", website: "medtechsol.com", phone: "+44 20 7946 0958", email: "sales@medtechsol.com", city: "London", country: "UK", employeeCount: 320, annualRevenue: 8500000, status: "active", category: "prospect" },
    { name: "PharmaCare Distribution", industry: "Distribution", website: "pharmacare-dist.eu", phone: "+48 22 123 4567", email: "info@pharmacare-dist.eu", city: "Warsaw", country: "Poland", employeeCount: 180, annualRevenue: 25000000, status: "active", category: "partner" },
    { name: "NeuroPharma Inc.", industry: "Neuroscience", website: "neuropharma.com", phone: "+1 617-555-0199", email: "research@neuropharma.com", city: "Boston", country: "USA", employeeCount: 600, annualRevenue: 15000000, status: "active", category: "client" },
    { name: "GreenBio Therapeutics", industry: "Biotechnology", website: "greenbio.co", phone: "+46 8 123 4567", email: "hello@greenbio.co", city: "Stockholm", country: "Sweden", employeeCount: 95, annualRevenue: 3200000, status: "active", category: "prospect" },
    { name: "Apex Clinical Research", industry: "Clinical Trials", website: "apexclinical.com", phone: "+1 415-555-0177", email: "trials@apexclinical.com", city: "San Francisco", country: "USA", employeeCount: 250, annualRevenue: 18000000, status: "active", category: "client" },
    { name: "EuroMed Supplies", industry: "Medical Supplies", website: "euromed-supplies.de", phone: "+49 89 555 7890", email: "orders@euromed-supplies.de", city: "Munich", country: "Germany", employeeCount: 140, annualRevenue: 9500000, status: "active", category: "partner" },
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
    { fullName: "Dr. James Mitchell", email: "j.mitchell@pfizer.com", phone: "+1 212-733-2400", position: "VP of IT", department: "Information Technology", companyIdx: 0, engagementScore: 92 },
    { fullName: "Sophie Dubois", email: "s.dubois@roche.com", phone: "+41 61 688 2200", position: "Chief Digital Officer", department: "Digital", companyIdx: 1, engagementScore: 88 },
    { fullName: "Marco Bernasconi", email: "m.bernasconi@novartis.com", phone: "+41 61 324 3300", position: "Head of Procurement", department: "Procurement", companyIdx: 2, engagementScore: 75 },
    { fullName: "Emily Watson", email: "e.watson@astrazeneca.com", phone: "+44 20 3749 5100", position: "IT Director", department: "IT", companyIdx: 3, engagementScore: 68 },
    { fullName: "Robert Kim", email: "r.kim@merck.com", phone: "+1 908-740-4100", position: "CTO", department: "Technology", companyIdx: 4, engagementScore: 85 },
    { fullName: "Dr. Anna Schneider", email: "a.schneider@biogenesislabs.com", phone: "+49 30 555 1300", position: "CEO", department: "Executive", companyIdx: 5, engagementScore: 95 },
    { fullName: "Thomas Clarke", email: "t.clarke@medtechsol.com", phone: "+44 20 7946 1100", position: "Sales Director", department: "Sales", companyIdx: 6, engagementScore: 62 },
    { fullName: "Katarzyna Nowak", email: "k.nowak@pharmacare-dist.eu", phone: "+48 22 123 4600", position: "Operations Manager", department: "Operations", companyIdx: 7, engagementScore: 80 },
    { fullName: "Dr. Michael Torres", email: "m.torres@neuropharma.com", phone: "+1 617-555-0200", position: "VP Research", department: "R&D", companyIdx: 8, engagementScore: 78 },
    { fullName: "Erik Lindberg", email: "e.lindberg@greenbio.co", phone: "+46 8 123 4600", position: "Co-founder & CTO", department: "Technology", companyIdx: 9, engagementScore: 58 },
    { fullName: "Jennifer Park", email: "j.park@apexclinical.com", phone: "+1 415-555-0200", position: "Director of Partnerships", department: "Business Dev", companyIdx: 10, engagementScore: 82 },
    { fullName: "Hans Muller", email: "h.muller@euromed-supplies.de", phone: "+49 89 555 7900", position: "Managing Director", department: "Management", companyIdx: 11, engagementScore: 73 },
    { fullName: "Lisa Chen", email: "l.chen@pfizer.com", phone: "+1 212-733-2500", position: "Project Manager", department: "PMO", companyIdx: 0, engagementScore: 70 },
    { fullName: "David Fontaine", email: "d.fontaine@roche.com", phone: "+41 61 688 3300", position: "Lab Systems Manager", department: "Lab Ops", companyIdx: 1, engagementScore: 65 },
    { fullName: "Rachel Adams", email: "r.adams@merck.com", phone: "+1 908-740-4200", position: "Compliance Officer", department: "Compliance", companyIdx: 4, engagementScore: 55 },
  ]

  const createdContacts = []
  for (const c of contacts) {
    const existing = await prisma.contact.findFirst({ where: { organizationId: orgId, email: c.email } })
    if (existing) {
      createdContacts.push(existing)
    } else {
      const { companyIdx, ...rest } = c
      const created = await prisma.contact.create({
        data: { ...rest, organizationId: orgId, companyId: createdCompanies[companyIdx].id, isActive: true, tags: [] },
      })
      createdContacts.push(created)
    }
  }
  console.log(`Contacts: ${createdContacts.length}`)

  // ─── Deals ───
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const deals = [
    { name: "Pfizer CRM Integration", companyIdx: 0, contactIdx: 0, stage: "NEGOTIATION", valueAmount: 285000, probability: 75, currency: "USD" },
    { name: "Roche Digital Transformation", companyIdx: 1, contactIdx: 1, stage: "PROPOSAL", valueAmount: 520000, probability: 50, currency: "EUR" },
    { name: "Novartis Procurement Platform", companyIdx: 2, contactIdx: 2, stage: "WON", valueAmount: 195000, probability: 100, currency: "EUR" },
    { name: "AstraZeneca Data Analytics", companyIdx: 3, contactIdx: 3, stage: "LEAD", valueAmount: 150000, probability: 15, currency: "GBP" },
    { name: "Merck Lab Management System", companyIdx: 4, contactIdx: 4, stage: "WON", valueAmount: 410000, probability: 100, currency: "USD" },
    { name: "BioGenesis LIMS Upgrade", companyIdx: 5, contactIdx: 5, stage: "NEGOTIATION", valueAmount: 89000, probability: 80, currency: "EUR" },
    { name: "MedTech Inventory Solution", companyIdx: 6, contactIdx: 6, stage: "QUALIFIED", valueAmount: 67000, probability: 25, currency: "GBP" },
    { name: "PharmaCare WMS Integration", companyIdx: 7, contactIdx: 7, stage: "PROPOSAL", valueAmount: 135000, probability: 50, currency: "PLN" },
    { name: "NeuroPharma Trial Tracker", companyIdx: 8, contactIdx: 8, stage: "PROPOSAL", valueAmount: 175000, probability: 45, currency: "USD" },
    { name: "GreenBio ERP Setup", companyIdx: 9, contactIdx: 9, stage: "LEAD", valueAmount: 42000, probability: 10, currency: "SEK" },
    { name: "Apex Clinical Portal", companyIdx: 10, contactIdx: 10, stage: "NEGOTIATION", valueAmount: 230000, probability: 70, currency: "USD" },
    { name: "EuroMed Supply Chain", companyIdx: 11, contactIdx: 11, stage: "WON", valueAmount: 98000, probability: 100, currency: "EUR" },
  ]

  for (const d of deals) {
    const existing = await prisma.deal.findFirst({ where: { organizationId: orgId, name: d.name } })
    if (!existing) {
      await prisma.deal.create({
        data: {
          organizationId: orgId,
          pipelineId: pipeline.id,
          name: d.name,
          companyId: createdCompanies[d.companyIdx].id,
          contactId: createdContacts[d.contactIdx].id,
          stage: d.stage,
          valueAmount: d.valueAmount,
          probability: d.probability,
          currency: d.currency,
          assignedTo: user.id,
          expectedClose: new Date(now + (15 + Math.random() * 75) * DAY),
          tags: [],
        },
      })
    }
  }
  console.log(`Deals: ${deals.length}`)

  // ─── Leads ───
  const leads = [
    { contactName: "Dr. Sarah Miller", companyName: "VaxTech Innovations", email: "s.miller@vaxtech.io", phone: "+1 858-555-0123", source: "website", status: "new", priority: "high", score: 88, estimatedValue: 120000 },
    { contactName: "Pierre Lefevre", companyName: "Lyon Biotech SAS", email: "p.lefevre@lyonbiotech.fr", phone: "+33 4 72 55 1234", source: "referral", status: "contacted", priority: "high", score: 82, estimatedValue: 95000 },
    { contactName: "Yuki Tanaka", companyName: "OsakaMed Corp", email: "y.tanaka@osakamed.jp", phone: "+81 6 6555 0123", source: "exhibition", status: "qualified", priority: "medium", score: 75, estimatedValue: 180000 },
    { contactName: "Carlos Mendez", companyName: "LatAm Pharma Group", email: "c.mendez@latampharma.com", phone: "+52 55 5555 0123", source: "linkedin", status: "new", priority: "medium", score: 68, estimatedValue: 65000 },
    { contactName: "Aisha Patel", companyName: "Mumbai Medical Tech", email: "a.patel@mumbaimedtech.in", phone: "+91 22 5555 0123", source: "webinar", status: "contacted", priority: "high", score: 91, estimatedValue: 145000 },
    { contactName: "Jan Kowalski", companyName: "PolPharma Digital", email: "j.kowalski@polpharma-dig.pl", phone: "+48 58 555 0123", source: "cold_call", status: "new", priority: "low", score: 45, estimatedValue: 35000 },
    { contactName: "Maria Rossi", companyName: "Torino Life Sciences", email: "m.rossi@torinolife.it", phone: "+39 011 555 0123", source: "partner", status: "qualified", priority: "high", score: 85, estimatedValue: 110000 },
    { contactName: "Brian O'Sullivan", companyName: "Dublin Diagnostics", email: "b.osullivan@dublindiag.ie", phone: "+353 1 555 0123", source: "website", status: "contacted", priority: "medium", score: 72, estimatedValue: 78000 },
  ]

  for (const l of leads) {
    const existing = await prisma.lead.findFirst({ where: { organizationId: orgId, email: l.email } })
    if (!existing) {
      await prisma.lead.create({ data: { ...l, organizationId: orgId, assignedTo: user.id } })
    }
  }
  console.log(`Leads: ${leads.length}`)

  // ─── Tasks ───
  // Fetch created deals and leads for entity linking
  const createdDeals = await prisma.deal.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" }, take: 12 })
  const createdLeads = await prisma.lead.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" }, take: 8 })

  const tasks = [
    {
      title: "Prepare Pfizer Q2 proposal deck", status: "in_progress", priority: "high",
      dueDate: new Date(now + 3 * DAY),
      description: "Create a comprehensive proposal deck for Pfizer covering Q2 deliverables, timeline, and budget breakdown. Include case studies from similar pharma projects.",
      relatedType: "deal", relatedId: createdDeals[0]?.id,
    },
    {
      title: "Schedule Roche demo call", status: "todo", priority: "high",
      dueDate: new Date(now + 5 * DAY),
      description: "Coordinate with Roche's IT team to schedule a live demo of the digital transformation platform. Prepare environment with sample data.",
      relatedType: "deal", relatedId: createdDeals[1]?.id,
    },
    {
      title: "Send Novartis contract for signing", status: "completed", priority: "high",
      dueDate: new Date(now - 2 * DAY), completedAt: new Date(now - 2 * DAY + 4 * 3600000),
      description: "Finalize the procurement platform contract and send via DocuSign. Ensure all legal amendments from last review are incorporated.",
      relatedType: "company", relatedId: createdCompanies[2]?.id,
    },
    {
      title: "Review AstraZeneca requirements doc", status: "pending", priority: "medium",
      dueDate: new Date(now + 7 * DAY),
      description: "Go through the 45-page requirements document from AstraZeneca. Highlight technical risks and prepare estimation for the data analytics module.",
      relatedType: "deal", relatedId: createdDeals[3]?.id,
    },
    {
      title: "Follow up with Merck on Phase 2", status: "in_progress", priority: "high",
      dueDate: new Date(now + 1 * DAY),
      description: "Send Phase 2 progress report and discuss timeline adjustments. Address their concerns about API performance benchmarks.",
      relatedType: "contact", relatedId: createdContacts[4]?.id,
    },
    {
      title: "BioGenesis onboarding kickoff", status: "pending", priority: "medium",
      dueDate: new Date(now + 10 * DAY),
      description: "Organize kickoff meeting with BioGenesis stakeholders. Prepare onboarding checklist, access provisioning plan, and training schedule.",
      relatedType: "company", relatedId: createdCompanies[5]?.id,
    },
    {
      title: "Update MedTech pricing model", status: "in_progress", priority: "medium",
      dueDate: new Date(now + 4 * DAY),
      description: "Revise the pricing tiers based on new feature scope. Calculate ROI projections for the inventory solution module.",
      relatedType: "deal", relatedId: createdDeals[6]?.id,
    },
    {
      title: "PharmaCare integration testing", status: "todo", priority: "low",
      dueDate: new Date(now + 14 * DAY),
      description: "Run end-to-end integration tests for the WMS connector. Verify data mapping for all 12 warehouse endpoints.",
      relatedType: "company", relatedId: createdCompanies[7]?.id,
    },
    {
      title: "NeuroPharma security audit review", status: "completed", priority: "high",
      dueDate: new Date(now - 5 * DAY), completedAt: new Date(now - 6 * DAY),
      description: "Review penetration test results and prepare remediation plan for identified vulnerabilities. Update security documentation.",
      relatedType: "deal", relatedId: createdDeals[8]?.id,
    },
    {
      title: "Prepare monthly sales report", status: "pending", priority: "medium",
      dueDate: new Date(now + 2 * DAY),
      description: "Compile pipeline metrics, conversion rates, and revenue forecast for the monthly leadership review meeting.",
    },
    {
      title: "Contact Dr. Sarah Miller about VaxTech opportunity", status: "completed", priority: "low",
      dueDate: new Date(now - 3 * DAY), completedAt: new Date(now - 4 * DAY),
      description: "Initial outreach to discuss CRM integration needs. Qualify the lead and assess budget timeline.",
      relatedType: "lead", relatedId: createdLeads[0]?.id,
    },
    {
      title: "Apex Clinical API documentation", status: "in_progress", priority: "medium",
      dueDate: new Date(now + 6 * DAY),
      description: "Write OpenAPI specs for all patient portal endpoints. Include authentication flow diagrams and rate limiting documentation.",
      relatedType: "deal", relatedId: createdDeals[10]?.id,
    },
  ]

  const createdTasks = []
  for (const t of tasks) {
    const existing = await prisma.task.findFirst({ where: { organizationId: orgId, title: t.title } })
    if (!existing) {
      // Remove undefined relatedId (when entity arrays are empty)
      const data = { ...t, organizationId: orgId, assignedTo: user.id, createdBy: user.id }
      if (!data.relatedId) { delete data.relatedType; delete data.relatedId }
      const created = await prisma.task.create({ data })
      createdTasks.push(created)
    } else {
      createdTasks.push(existing)
    }
  }
  console.log(`Tasks: ${createdTasks.length}`)

  // ─── Task Checklists ───
  const checklistData = [
    { taskIdx: 0, items: [
      { title: "Draft executive summary slide", completed: true, sortOrder: 0 },
      { title: "Add pricing breakdown table", completed: true, sortOrder: 1 },
      { title: "Include pharma case studies (2-3)", completed: false, sortOrder: 2 },
      { title: "Review with sales director", completed: false, sortOrder: 3 },
      { title: "Export final PDF version", completed: false, sortOrder: 4 },
    ]},
    { taskIdx: 1, items: [
      { title: "Check Roche team availability", completed: false, sortOrder: 0 },
      { title: "Prepare demo environment with sample data", completed: false, sortOrder: 1 },
      { title: "Send calendar invite", completed: false, sortOrder: 2 },
    ]},
    { taskIdx: 4, items: [
      { title: "Compile Phase 1 deliverables summary", completed: true, sortOrder: 0 },
      { title: "Prepare API benchmark results", completed: true, sortOrder: 1 },
      { title: "Draft Phase 2 timeline adjustments", completed: false, sortOrder: 2 },
      { title: "Send report to Merck PM", completed: false, sortOrder: 3 },
    ]},
    { taskIdx: 5, items: [
      { title: "Create onboarding checklist", completed: false, sortOrder: 0 },
      { title: "Set up staging environment", completed: false, sortOrder: 1 },
      { title: "Prepare training materials", completed: false, sortOrder: 2 },
      { title: "Schedule kickoff call", completed: false, sortOrder: 3 },
      { title: "Provision user accounts", completed: false, sortOrder: 4 },
      { title: "Send welcome package", completed: false, sortOrder: 5 },
    ]},
    { taskIdx: 11, items: [
      { title: "Document auth endpoints", completed: true, sortOrder: 0 },
      { title: "Document patient data endpoints", completed: true, sortOrder: 1 },
      { title: "Document reporting endpoints", completed: false, sortOrder: 2 },
      { title: "Add rate limiting section", completed: false, sortOrder: 3 },
      { title: "Create Postman collection", completed: false, sortOrder: 4 },
    ]},
  ]

  let checklistCount = 0
  for (const cl of checklistData) {
    const task = createdTasks[cl.taskIdx]
    if (!task) continue
    const existingItems = await prisma.taskChecklist.count({ where: { taskId: task.id } })
    if (existingItems === 0) {
      for (const item of cl.items) {
        await prisma.taskChecklist.create({
          data: { ...item, organizationId: orgId, taskId: task.id },
        })
        checklistCount++
      }
    }
  }
  console.log(`Task checklist items: ${checklistCount}`)

  // ─── Task Comments ───
  const commentData = [
    { taskIdx: 0, comments: [
      { content: "Started working on the deck. Using the Q1 template as a base.", isSystem: false },
      { content: "Status changed from pending to in_progress", isSystem: true },
      { content: "Added ROI calculations — numbers look strong for this quarter.", isSystem: false },
    ]},
    { taskIdx: 2, comments: [
      { content: "Legal approved all amendments. Ready to send.", isSystem: false },
      { content: "Contract sent via DocuSign. Awaiting signature from Novartis CFO.", isSystem: false },
      { content: "Status changed to completed", isSystem: true },
    ]},
    { taskIdx: 4, comments: [
      { content: "Merck PM raised concerns about response times on the analytics endpoint. Investigating.", isSystem: false },
      { content: "Benchmarks show 240ms p95 — within SLA but close to threshold. Optimizing queries.", isSystem: false },
    ]},
    { taskIdx: 8, comments: [
      { content: "Pentest report received. 2 medium, 5 low severity findings.", isSystem: false },
      { content: "All medium findings addressed. Low severity items tracked in backlog.", isSystem: false },
      { content: "Status changed to completed", isSystem: true },
    ]},
    { taskIdx: 11, comments: [
      { content: "Auth and patient data sections done. Moving to reporting endpoints next.", isSystem: false },
    ]},
  ]

  let commentCount = 0
  for (const cc of commentData) {
    const task = createdTasks[cc.taskIdx]
    if (!task) continue
    const existingComments = await prisma.taskComment.count({ where: { taskId: task.id } })
    if (existingComments === 0) {
      for (const comment of cc.comments) {
        await prisma.taskComment.create({
          data: {
            ...comment,
            organizationId: orgId,
            taskId: task.id,
            userId: user.id,
            createdAt: new Date(now - Math.floor(Math.random() * 5) * DAY),
          },
        })
        commentCount++
      }
    }
  }
  console.log(`Task comments: ${commentCount}`)

  // ─── Tickets ───
  const tickets = [
    { ticketNumber: "TK-1001", subject: "Login issues after SSO migration", description: "Multiple users unable to authenticate after the recent SSO provider change. Error: SAML assertion invalid.", priority: "high", status: "in_progress", category: "technical", contactIdx: 0, companyIdx: 0 },
    { ticketNumber: "TK-1002", subject: "Dashboard loading slowly", description: "Analytics dashboard takes 15+ seconds to load with large datasets. Need query optimization.", priority: "medium", status: "new", category: "performance", contactIdx: 1, companyIdx: 1 },
    { ticketNumber: "TK-1003", subject: "Invoice PDF generation error", description: "PDF generation fails for invoices with more than 50 line items. Returns 500 error.", priority: "high", status: "new", category: "bug", contactIdx: 2, companyIdx: 2 },
    { ticketNumber: "TK-1004", subject: "Request: Custom report builder", description: "Need ability to create custom reports with drag-and-drop fields and scheduling.", priority: "low", status: "new", category: "feature_request", contactIdx: 4, companyIdx: 4 },
    { ticketNumber: "TK-1005", subject: "API rate limit exceeded", description: "Integration hitting 429 errors during batch sync. Need rate limit increase or better queuing.", priority: "medium", status: "in_progress", category: "integration", contactIdx: 5, companyIdx: 5 },
    { ticketNumber: "TK-1006", subject: "Mobile app calendar sync broken", description: "Calendar events not syncing to mobile. Last sync timestamp shows 3 days ago.", priority: "medium", status: "resolved", category: "bug", contactIdx: 7, companyIdx: 7 },
    { ticketNumber: "TK-1007", subject: "Data export compliance question", description: "Need confirmation that data export meets GDPR requirements for EU clinical trial data.", priority: "high", status: "new", category: "compliance", contactIdx: 8, companyIdx: 8 },
    { ticketNumber: "TK-1008", subject: "User role permissions not applying", description: "New 'Lab Technician' role not restricting access to financial modules as configured.", priority: "high", status: "in_progress", category: "bug", contactIdx: 10, companyIdx: 10 },
  ]

  // SLA hours lookup for ticket creation
  const slaHoursMap = { critical: 1, high: 2, medium: 4, low: 8 }
  for (const t of tickets) {
    const existing = await prisma.ticket.findFirst({ where: { organizationId: orgId, ticketNumber: t.ticketNumber } })
    if (!existing) {
      const { contactIdx, companyIdx, ...rest } = t
      // Create tickets with SLA dates so AI auto-acknowledge can work
      const createdAt = t.status === "new"
        ? new Date(now - (1 + Math.random() * 3) * 60 * 60 * 1000) // 1-4 hours ago for "new" tickets
        : new Date(now - (1 + Math.random() * 5) * DAY)
      const slaHours = slaHoursMap[t.priority] || 4
      const slaFirstResponseDueAt = new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000)
      const slaDueAt = new Date(createdAt.getTime() + slaHours * 4 * 60 * 60 * 1000)

      await prisma.ticket.create({
        data: {
          ...rest,
          organizationId: orgId,
          contactId: createdContacts[contactIdx].id,
          companyId: createdCompanies[companyIdx].id,
          assignedTo: user.id,
          createdBy: user.id,
          createdAt,
          slaFirstResponseDueAt: t.status === "new" ? slaFirstResponseDueAt : null,
          slaDueAt,
          slaPolicyName: `${t.priority.charAt(0).toUpperCase() + t.priority.slice(1)} Priority SLA`,
          firstResponseAt: t.status !== "new" ? new Date(createdAt.getTime() + 30 * 60 * 1000) : null,
          tags: [],
          escalationLevel: 0,
        },
      })
    }
  }
  console.log(`Tickets: ${tickets.length} (with SLA dates for AI demo)`)

  // ─── Campaigns ───
  const campaigns = [
    { name: "Q2 Product Launch — Clinical Suite", type: "email", status: "sent", subject: "Introducing Clinical Suite 3.0", totalRecipients: 2400, totalSent: 2350, totalOpened: 980, totalClicked: 312, budget: 5000, actualCost: 4200 },
    { name: "Pharma Innovation Webinar Series", type: "email", status: "running", subject: "Join our free webinar: AI in Drug Discovery", totalRecipients: 1850, totalSent: 1800, totalOpened: 720, totalClicked: 198, budget: 3000, actualCost: 2100 },
    { name: "Customer Success Stories", type: "email", status: "draft", subject: "How Merck saved 40% on lab management", totalRecipients: 0, totalSent: 0, totalOpened: 0, totalClicked: 0, budget: 1500, actualCost: 0 },
    { name: "Annual Conference Invite — BioConnect 2026", type: "email", status: "sent", subject: "You're invited to BioConnect 2026", totalRecipients: 3200, totalSent: 3150, totalOpened: 1450, totalClicked: 567, budget: 8000, actualCost: 7200 },
    { name: "Compliance Update Newsletter", type: "email", status: "sent", subject: "Important: New EU MDR compliance requirements", totalRecipients: 1600, totalSent: 1580, totalOpened: 890, totalClicked: 234, budget: 500, actualCost: 380 },
  ]

  for (const c of campaigns) {
    const existing = await prisma.campaign.findFirst({ where: { organizationId: orgId, name: c.name } })
    if (!existing) {
      await prisma.campaign.create({
        data: {
          ...c,
          organizationId: orgId,
          createdBy: user.id,
          sentAt: c.status === "sent" ? new Date(now - (5 + Math.random() * 25) * DAY) : undefined,
        },
      })
    }
  }
  console.log(`Campaigns: ${campaigns.length}`)

  // ─── Activities (recent timeline) ───
  const activities = [
    { type: "call", subject: "Discovery call with Pfizer IT team", description: "Discussed current pain points with existing CRM. Very interested in our pharma-specific features.", contactId: createdContacts[0].id, companyId: createdCompanies[0].id },
    { type: "email", subject: "Sent proposal to Roche", description: "Emailed digital transformation proposal with ROI analysis and timeline.", contactId: createdContacts[1].id, companyId: createdCompanies[1].id },
    { type: "meeting", subject: "Contract signing — Novartis", description: "Signed 2-year procurement platform contract. Implementation starts next month.", contactId: createdContacts[2].id, companyId: createdCompanies[2].id },
    { type: "note", subject: "AstraZeneca — initial research", description: "Reviewed their annual report. Strong digital transformation budget. Key decision maker is Emily Watson.", contactId: createdContacts[3].id, companyId: createdCompanies[3].id },
    { type: "call", subject: "Merck Phase 2 check-in", description: "Discussed lab module customization. They need GxP validation support.", contactId: createdContacts[4].id, companyId: createdCompanies[4].id },
    { type: "meeting", subject: "BioGenesis CEO meeting", description: "Dr. Schneider wants full demo for board next week. Very promising deal.", contactId: createdContacts[5].id, companyId: createdCompanies[5].id },
    { type: "email", subject: "Follow-up: MedTech pricing", description: "Sent revised pricing with volume discount for 50+ users.", contactId: createdContacts[6].id, companyId: createdCompanies[6].id },
    { type: "call", subject: "PharmaCare integration requirements", description: "Discussed WMS API integration. They use SAP for warehousing.", contactId: createdContacts[7].id, companyId: createdCompanies[7].id },
  ]

  for (const a of activities) {
    const existing = await prisma.activity.findFirst({ where: { organizationId: orgId, subject: a.subject } })
    if (!existing) {
      await prisma.activity.create({
        data: {
          ...a,
          organizationId: orgId,
          createdBy: user.id,
          createdAt: new Date(now - Math.random() * 14 * DAY),
        },
      })
    }
  }
  console.log(`Activities: ${activities.length}`)

  // ─── Deal-linked activities (some stale for AI shadow demo) ───
  const activeDeals = await prisma.deal.findMany({ where: { organizationId: orgId, stage: { notIn: ["WON", "LOST"] } }, select: { id: true, name: true }, take: 12 })
  let dealActCount = 0
  for (let i = 0; i < activeDeals.length; i++) {
    const deal = activeDeals[i]
    const existing = await prisma.activity.findFirst({ where: { organizationId: orgId, relatedType: "deal", relatedId: deal.id } })
    if (existing) continue
    // First 3 deals: recent activity (1-3 days ago) → healthy
    // Next 3 deals: stale activity (10-20 days ago) → triggers AI auto-followup shadow
    // Rest: medium (4-7 days ago)
    let daysAgo
    if (i < 3) daysAgo = 1 + Math.random() * 2
    else if (i < 6) daysAgo = 10 + Math.random() * 10
    else daysAgo = 4 + Math.random() * 3

    await prisma.activity.create({
      data: {
        organizationId: orgId,
        type: ["call", "email", "meeting", "note"][i % 4],
        subject: `Follow-up: ${deal.name}`,
        description: `Activity logged for deal tracking.`,
        relatedType: "deal",
        relatedId: deal.id,
        createdBy: user.id,
        createdAt: new Date(now - daysAgo * DAY),
      },
    })
    dealActCount++
  }
  if (dealActCount > 0) console.log(`Deal activities: ${dealActCount} (${Math.min(3, createdDeals.length)} stale >10d for AI shadow demo)`)

  // ─── 1. Products ───
  try {
    const existingProduct = await prisma.product.findFirst({ where: { organizationId: orgId } })
    if (!existingProduct) {
      const products = [
        { name: "Clinical Suite Platform", description: "End-to-end clinical trial management platform with GxP compliance", category: "product", price: 45000, currency: "USD", features: ["GxP validation", "21 CFR Part 11", "Audit trail"], tags: ["clinical", "enterprise"] },
        { name: "LIMS Integration Module", description: "Laboratory Information Management System connector for major LIMS vendors", category: "addon", price: 12000, currency: "USD", features: ["API gateway", "Bi-directional sync", "HL7 support"], tags: ["integration", "lab"] },
        { name: "Pharma CRM License (Annual)", description: "Per-user annual license for pharma-specific CRM features", category: "service", price: 2400, currency: "USD", features: ["Contact management", "Compliance tracking", "Territory mapping"], tags: ["crm", "license"] },
        { name: "Data Analytics Dashboard", description: "Real-time analytics and reporting for clinical and commercial operations", category: "addon", price: 8500, currency: "USD", features: ["Custom dashboards", "Predictive analytics", "Export to PDF/Excel"], tags: ["analytics", "reporting"] },
        { name: "Regulatory Compliance Package", description: "Automated regulatory submission tracking and documentation management", category: "service", price: 18000, currency: "USD", features: ["FDA submissions", "EMA compliance", "Document versioning"], tags: ["regulatory", "compliance"] },
        { name: "Implementation & Training", description: "On-site implementation, data migration, and team training (per day)", category: "consulting", price: 3500, currency: "USD", features: ["On-site support", "Data migration", "Custom training"], tags: ["services", "onboarding"] },
        { name: "24/7 Premium Support", description: "Round-the-clock dedicated support with 1-hour SLA for critical issues", category: "service", price: 5000, currency: "USD", features: ["24/7 coverage", "1h SLA", "Dedicated engineer"], tags: ["support", "premium"] },
      ]
      for (const p of products) {
        await prisma.product.create({ data: { ...p, organizationId: orgId, isActive: true } })
      }
      console.log(`Products: ${products.length}`)
    } else {
      console.log("Products: (existing, skipped)")
    }
  } catch (e) { console.log(`Products: ERROR — ${e.message}`) }

  // ─── 2. Contracts ───
  try {
    const existingContract = await prisma.contract.findFirst({ where: { organizationId: orgId } })
    if (!existingContract) {
      const contracts = [
        { contractNumber: "CTR-2026-001", title: "Pfizer CRM Implementation Agreement", companyId: createdCompanies[0].id, contactId: createdContacts[0].id, type: "service_agreement", status: "active", startDate: new Date(now - 90 * DAY), endDate: new Date(now + 275 * DAY), valueAmount: 285000, currency: "USD" },
        { contractNumber: "CTR-2026-002", title: "Roche Digital Transformation MSA", companyId: createdCompanies[1].id, contactId: createdContacts[1].id, type: "service_agreement", status: "draft", startDate: new Date(now + 30 * DAY), endDate: new Date(now + 395 * DAY), valueAmount: 520000, currency: "EUR" },
        { contractNumber: "CTR-2025-018", title: "Novartis Procurement Platform License", companyId: createdCompanies[2].id, contactId: createdContacts[2].id, type: "service_agreement", status: "active", startDate: new Date(now - 180 * DAY), endDate: new Date(now + 185 * DAY), valueAmount: 195000, currency: "EUR" },
        { contractNumber: "CTR-2025-015", title: "Merck Lab Management — Phase 1", companyId: createdCompanies[4].id, contactId: createdContacts[4].id, type: "service_agreement", status: "active", startDate: new Date(now - 120 * DAY), endDate: new Date(now + 245 * DAY), valueAmount: 410000, currency: "USD" },
        { contractNumber: "CTR-2024-042", title: "EuroMed Supply Chain SLA", companyId: createdCompanies[11].id, contactId: createdContacts[11].id, type: "service_agreement", status: "expired", startDate: new Date(now - 400 * DAY), endDate: new Date(now - 35 * DAY), valueAmount: 98000, currency: "EUR" },
        { contractNumber: "CTR-2026-003", title: "BioGenesis LIMS Upgrade Contract", companyId: createdCompanies[5].id, contactId: createdContacts[5].id, type: "service_agreement", status: "draft", startDate: new Date(now + 14 * DAY), endDate: new Date(now + 194 * DAY), valueAmount: 89000, currency: "EUR" },
      ]
      for (const c of contracts) {
        await prisma.contract.create({ data: { ...c, organizationId: orgId, createdBy: user.id } })
      }
      console.log(`Contracts: ${contracts.length}`)
    } else {
      console.log("Contracts: (existing, skipped)")
    }
  } catch (e) { console.log(`Contracts: ERROR — ${e.message}`) }

  // ─── 3. Offers + OfferItems ───
  try {
    const existingOffer = await prisma.offer.findFirst({ where: { organizationId: orgId } })
    if (!existingOffer) {
      const offersData = [
        { offerNumber: "OFF-2026-001", title: "Pfizer CRM Integration — Commercial Offer", companyId: createdCompanies[0].id, contactId: createdContacts[0].id, type: "commercial", status: "sent", totalAmount: 285000, currency: "USD", validUntil: new Date(now + 30 * DAY), items: [
          { name: "Clinical Suite Platform License", quantity: 1, unitPrice: 45000, total: 45000 },
          { name: "Implementation & Customization (60 days)", quantity: 60, unitPrice: 3500, total: 210000 },
          { name: "First Year Premium Support", quantity: 1, unitPrice: 30000, total: 30000 },
        ]},
        { offerNumber: "OFF-2026-002", title: "Roche Digital Transformation Proposal", companyId: createdCompanies[1].id, contactId: createdContacts[1].id, type: "commercial", status: "draft", totalAmount: 520000, currency: "EUR", validUntil: new Date(now + 45 * DAY), items: [
          { name: "Platform License (Enterprise)", quantity: 1, unitPrice: 120000, total: 120000 },
          { name: "Data Migration & Integration", quantity: 1, unitPrice: 180000, total: 180000 },
          { name: "Custom Module Development", quantity: 1, unitPrice: 220000, total: 220000 },
        ]},
        { offerNumber: "OFF-2026-003", title: "MedTech Inventory Solution Quote", companyId: createdCompanies[6].id, contactId: createdContacts[6].id, type: "commercial", status: "sent", totalAmount: 67000, currency: "GBP", validUntil: new Date(now + 21 * DAY), items: [
          { name: "Inventory Management Module", quantity: 1, unitPrice: 35000, total: 35000 },
          { name: "Barcode/RFID Integration", quantity: 1, unitPrice: 22000, total: 22000 },
          { name: "Training (5 days)", quantity: 5, unitPrice: 2000, total: 10000 },
        ]},
        { offerNumber: "OFF-2026-004", title: "NeuroPharma Trial Tracker Offer", companyId: createdCompanies[8].id, contactId: createdContacts[8].id, type: "commercial", status: "approved", totalAmount: 175000, currency: "USD", validUntil: new Date(now + 60 * DAY), items: [
          { name: "Trial Tracker Platform", quantity: 1, unitPrice: 85000, total: 85000 },
          { name: "Regulatory Compliance Add-on", quantity: 1, unitPrice: 45000, total: 45000 },
          { name: "Implementation & Go-live Support", quantity: 1, unitPrice: 45000, total: 45000 },
        ]},
        { offerNumber: "OFF-2025-019", title: "Apex Clinical Portal — Renewal", companyId: createdCompanies[10].id, contactId: createdContacts[10].id, type: "commercial", status: "rejected", totalAmount: 280000, currency: "USD", validUntil: new Date(now - 15 * DAY), items: [
          { name: "Portal License Renewal (2 years)", quantity: 1, unitPrice: 180000, total: 180000 },
          { name: "Advanced Analytics Module", quantity: 1, unitPrice: 100000, total: 100000 },
        ]},
      ]
      for (const o of offersData) {
        const { items, ...offerData } = o
        const offer = await prisma.offer.create({ data: { ...offerData, organizationId: orgId, createdBy: user.id } })
        for (let i = 0; i < items.length; i++) {
          await prisma.offerItem.create({ data: { ...items[i], organizationId: orgId, offerId: offer.id, sortOrder: i } })
        }
      }
      console.log(`Offers: ${offersData.length} (with items)`)
    } else {
      console.log("Offers: (existing, skipped)")
    }
  } catch (e) { console.log(`Offers: ERROR — ${e.message}`) }

  // ─── 4. Invoices + InvoiceItems ───
  try {
    const existingInvoice = await prisma.invoice.findFirst({ where: { organizationId: orgId } })
    if (!existingInvoice) {
      const invoicesData = [
        { invoiceNumber: "INV-2026-001", title: "Novartis — Q1 License Fee", companyId: createdCompanies[2].id, contactId: createdContacts[2].id, status: "paid", subtotal: 48750, taxRate: 0, taxAmount: 0, totalAmount: 48750, paidAmount: 48750, balanceDue: 0, currency: "EUR", issueDate: new Date(now - 60 * DAY), dueDate: new Date(now - 30 * DAY), paidAt: new Date(now - 28 * DAY), items: [
          { name: "Procurement Platform License — Q1 2026", quantity: 1, unitPrice: 48750, total: 48750 },
        ]},
        { invoiceNumber: "INV-2026-002", title: "Merck — Implementation Phase 1", companyId: createdCompanies[4].id, contactId: createdContacts[4].id, status: "paid", subtotal: 136000, taxRate: 0, taxAmount: 0, totalAmount: 136000, paidAmount: 136000, balanceDue: 0, currency: "USD", issueDate: new Date(now - 45 * DAY), dueDate: new Date(now - 15 * DAY), paidAt: new Date(now - 12 * DAY), items: [
          { name: "Lab Management System — Phase 1 Delivery", quantity: 1, unitPrice: 100000, total: 100000 },
          { name: "Data Migration Services", quantity: 1, unitPrice: 36000, total: 36000 },
        ]},
        { invoiceNumber: "INV-2026-003", title: "Pfizer — Discovery & Planning", companyId: createdCompanies[0].id, contactId: createdContacts[0].id, status: "sent", subtotal: 85000, taxRate: 0, taxAmount: 0, totalAmount: 85000, paidAmount: 0, balanceDue: 85000, currency: "USD", issueDate: new Date(now - 10 * DAY), dueDate: new Date(now + 20 * DAY), items: [
          { name: "CRM Integration — Discovery Phase", quantity: 1, unitPrice: 55000, total: 55000 },
          { name: "Architecture & Planning", quantity: 1, unitPrice: 30000, total: 30000 },
        ]},
        { invoiceNumber: "INV-2026-004", title: "EuroMed — Final Delivery", companyId: createdCompanies[11].id, contactId: createdContacts[11].id, status: "paid", subtotal: 32500, taxRate: 0, taxAmount: 0, totalAmount: 32500, paidAmount: 32500, balanceDue: 0, currency: "EUR", issueDate: new Date(now - 90 * DAY), dueDate: new Date(now - 60 * DAY), paidAt: new Date(now - 55 * DAY), items: [
          { name: "Supply Chain Module — Final Milestone", quantity: 1, unitPrice: 32500, total: 32500 },
        ]},
        { invoiceNumber: "INV-2026-005", title: "BioGenesis — LIMS Assessment", companyId: createdCompanies[5].id, contactId: createdContacts[5].id, status: "overdue", subtotal: 22000, taxRate: 0.19, taxAmount: 4180, totalAmount: 26180, paidAmount: 0, balanceDue: 26180, currency: "EUR", issueDate: new Date(now - 50 * DAY), dueDate: new Date(now - 20 * DAY), items: [
          { name: "LIMS Assessment & Gap Analysis", quantity: 1, unitPrice: 15000, total: 15000 },
          { name: "Technical Architecture Review", quantity: 1, unitPrice: 7000, total: 7000 },
        ]},
        { invoiceNumber: "INV-2026-006", title: "Apex Clinical — Portal Phase 1", companyId: createdCompanies[10].id, contactId: createdContacts[10].id, status: "sent", subtotal: 115000, taxRate: 0, taxAmount: 0, totalAmount: 115000, paidAmount: 0, balanceDue: 115000, currency: "USD", issueDate: new Date(now - 5 * DAY), dueDate: new Date(now + 25 * DAY), items: [
          { name: "Clinical Portal — Core Platform", quantity: 1, unitPrice: 75000, total: 75000 },
          { name: "Patient Data Integration", quantity: 1, unitPrice: 25000, total: 25000 },
          { name: "Compliance & Validation", quantity: 1, unitPrice: 15000, total: 15000 },
        ]},
        { invoiceNumber: "INV-2026-007", title: "PharmaCare — WMS Integration Deposit", companyId: createdCompanies[7].id, contactId: createdContacts[7].id, status: "draft", subtotal: 40500, taxRate: 0.23, taxAmount: 9315, totalAmount: 49815, paidAmount: 0, balanceDue: 49815, currency: "PLN", issueDate: new Date(now), dueDate: new Date(now + 30 * DAY), items: [
          { name: "WMS Integration — Phase 1 Deposit (30%)", quantity: 1, unitPrice: 40500, total: 40500 },
        ]},
      ]
      for (const inv of invoicesData) {
        const { items, ...invoiceData } = inv
        const invoice = await prisma.invoice.create({ data: { ...invoiceData, organizationId: orgId, createdBy: user.id } })
        for (let i = 0; i < items.length; i++) {
          await prisma.invoiceItem.create({ data: { ...items[i], invoiceId: invoice.id, sortOrder: i } })
        }
      }
      console.log(`Invoices: ${invoicesData.length} (with items)`)
    } else {
      console.log("Invoices: (existing, skipped)")
    }
  } catch (e) { console.log(`Invoices: ERROR — ${e.message}`) }

  // ─── 5. Bills ───
  try {
    const existingBill = await prisma.bill.findFirst({ where: { organizationId: orgId } })
    if (!existingBill) {
      const bills = [
        { billNumber: "BILL-2026-001", vendorName: "AWS", title: "Cloud Infrastructure — March 2026", status: "paid", totalAmount: 8450, paidAmount: 8450, balanceDue: 0, currency: "USD", issueDate: new Date(now - 30 * DAY), dueDate: new Date(now - 15 * DAY), paidAt: new Date(now - 14 * DAY), category: "software" },
        { billNumber: "BILL-2026-002", vendorName: "WeWork Warsaw", title: "Office Rent — April 2026", status: "pending", totalAmount: 4200, paidAmount: 0, balanceDue: 4200, currency: "EUR", issueDate: new Date(now - 5 * DAY), dueDate: new Date(now + 10 * DAY), category: "rent" },
        { billNumber: "BILL-2026-003", vendorName: "Figma Inc.", title: "Design Tool Licenses (Annual)", status: "paid", totalAmount: 1680, paidAmount: 1680, balanceDue: 0, currency: "USD", issueDate: new Date(now - 60 * DAY), dueDate: new Date(now - 45 * DAY), paidAt: new Date(now - 44 * DAY), category: "software" },
        { billNumber: "BILL-2026-004", vendorName: "Hetzner Online GmbH", title: "Dedicated Servers — Q2 2026", status: "overdue", totalAmount: 2890, paidAmount: 0, balanceDue: 2890, currency: "EUR", issueDate: new Date(now - 20 * DAY), dueDate: new Date(now - 5 * DAY), category: "equipment" },
      ]
      for (const b of bills) {
        await prisma.bill.create({ data: { ...b, organizationId: orgId, createdBy: user.id } })
      }
      console.log(`Bills: ${bills.length}`)
    } else {
      console.log("Bills: (existing, skipped)")
    }
  } catch (e) { console.log(`Bills: ERROR — ${e.message}`) }

  // ─── 6. BankAccounts ───
  try {
    const existingBank = await prisma.bankAccount.findFirst({ where: { organizationId: orgId } })
    if (!existingBank) {
      const bankAccounts = [
        { accountName: "Primary Operating Account", bankName: "PKO Bank Polski", accountNumber: "PL61109010140000071219812874", currency: "PLN", isDefault: true, isActive: true, swiftCode: "BPKOPLPW" },
        { accountName: "USD Revenue Account", bankName: "Citibank Europe", accountNumber: "PL27114020040000310276543210", currency: "USD", isDefault: false, isActive: true, swiftCode: "CABORUPW" },
      ]
      for (const ba of bankAccounts) {
        await prisma.bankAccount.create({ data: { ...ba, organizationId: orgId } })
      }
      console.log(`Bank Accounts: ${bankAccounts.length}`)
    } else {
      console.log("Bank Accounts: (existing, skipped)")
    }
  } catch (e) { console.log(`Bank Accounts: ERROR — ${e.message}`) }

  // ─── 7. Funds ───
  try {
    const existingFund = await prisma.fund.findFirst({ where: { organizationId: orgId } })
    if (!existingFund) {
      const funds = [
        // Opening balances, not final snapshots: the append-only transaction
        // inserts below apply their deltas through the fund event bridge.
        { name: "Tax Reserve", description: "Quarterly tax obligations reserve fund", targetAmount: 50000, currentBalance: 5400, currency: "USD", color: "#ef4444", isActive: true },
        { name: "Payroll Buffer", description: "3-month payroll safety buffer", targetAmount: 120000, currentBalance: 85000, currency: "USD", color: "#3b82f6", isActive: true },
        { name: "R&D Investment Fund", description: "Product development and innovation fund", targetAmount: 80000, currentBalance: 0, currency: "USD", color: "#10b981", isActive: true },
      ]
      for (const f of funds) {
        await prisma.fund.create({ data: { ...f, organizationId: orgId, createdBy: user.id } })
      }
      console.log(`Funds: ${funds.length}`)
    } else {
      console.log("Funds: (existing, skipped)")
    }
  } catch (e) { console.log(`Funds: ERROR — ${e.message}`) }

  // ─── 8. KB Categories + Articles ───
  try {
    const existingKb = await prisma.kbCategory.findFirst({ where: { organizationId: orgId } })
    if (!existingKb) {
      const categories = [
        { name: "Getting Started", sortOrder: 0 },
        { name: "Integrations & API", sortOrder: 1 },
        { name: "Troubleshooting", sortOrder: 2 },
      ]
      const createdCategories = []
      for (const cat of categories) {
        const created = await prisma.kbCategory.create({ data: { ...cat, organizationId: orgId } })
        createdCategories.push(created)
      }

      const articles = [
        { title: "Quick Start Guide", content: "# Quick Start Guide\n\nWelcome to the platform. Follow these steps to get started:\n\n1. Set up your organization profile\n2. Import your contacts\n3. Configure your sales pipeline\n4. Invite team members\n\n## Need Help?\nContact our support team or use the in-app chat.", categoryId: createdCategories[0].id, status: "published", viewCount: 342, helpfulCount: 89 },
        { title: "Setting Up Your First Pipeline", content: "# Pipeline Configuration\n\nPipelines help you track deals through your sales process.\n\n## Default Stages\n- **Lead** — Initial contact\n- **Qualified** — Budget and need confirmed\n- **Proposal** — Offer sent\n- **Negotiation** — Terms being finalized\n- **Won/Lost** — Outcome\n\n## Custom Stages\nGo to Settings > Pipelines to add custom stages.", categoryId: createdCategories[0].id, status: "published", viewCount: 218, helpfulCount: 56 },
        { title: "User Roles and Permissions", content: "# User Roles\n\n| Role | Access Level |\n|------|-------------|\n| Admin | Full access to all modules |\n| Manager | Team management + reporting |\n| Sales | Deals, contacts, activities |\n| Support | Tickets, KB, customer portal |\n| Viewer | Read-only access |\n\n## Custom Permissions\nEnterprise plans support field-level permissions.", categoryId: createdCategories[0].id, status: "published", viewCount: 156, helpfulCount: 42 },
        { title: "REST API Authentication", content: "# API Authentication\n\n## API Keys\nGenerate API keys from Settings > API Keys.\n\n```bash\ncurl -H 'Authorization: Bearer YOUR_API_KEY' \\\n     https://api.example.com/v1/contacts\n```\n\n## Rate Limits\n- Standard: 100 requests/minute\n- Enterprise: 1000 requests/minute\n\n## Webhooks\nConfigure webhooks for real-time event notifications.", categoryId: createdCategories[1].id, status: "published", viewCount: 445, helpfulCount: 112 },
        { title: "LIMS Integration Guide", content: "# LIMS Integration\n\nConnect your Laboratory Information Management System.\n\n## Supported Systems\n- LabWare LIMS\n- STARLIMS\n- Thermo Fisher SampleManager\n\n## Setup Steps\n1. Navigate to Settings > Integrations\n2. Select your LIMS vendor\n3. Enter API credentials\n4. Map data fields\n5. Run test sync", categoryId: createdCategories[1].id, status: "published", viewCount: 189, helpfulCount: 34 },
        { title: "Webhook Configuration", content: "# Webhooks\n\nReceive real-time notifications when events occur.\n\n## Available Events\n- `deal.created`, `deal.updated`, `deal.won`\n- `ticket.created`, `ticket.resolved`\n- `contact.created`, `invoice.paid`\n\n## Payload Format\n```json\n{\n  \"event\": \"deal.won\",\n  \"data\": { ... },\n  \"timestamp\": \"2026-04-10T12:00:00Z\"\n}\n```", categoryId: createdCategories[1].id, status: "published", viewCount: 267, helpfulCount: 71 },
        { title: "Login & Authentication Issues", content: "# Authentication Troubleshooting\n\n## Common Issues\n\n### Cannot Login\n1. Verify your email address is correct\n2. Reset your password via 'Forgot Password'\n3. Check if 2FA is enabled on your account\n4. Clear browser cache and cookies\n\n### 2FA Problems\n- Use backup codes if authenticator app is unavailable\n- Contact admin to reset 2FA\n\n### SSO Errors\nVerify SAML configuration with your IT team.", categoryId: createdCategories[2].id, status: "published", viewCount: 534, helpfulCount: 145 },
        { title: "Performance Optimization Tips", content: "# Performance Tips\n\n## Slow Dashboard\n- Reduce date range for reports\n- Use filters to limit data\n- Archive old records\n\n## Import Issues\n- Maximum 10,000 records per CSV\n- Use UTF-8 encoding\n- Remove duplicate emails before import\n\n## Browser Requirements\n- Chrome 90+, Firefox 88+, Safari 15+, Edge 90+", categoryId: createdCategories[2].id, status: "draft", viewCount: 78, helpfulCount: 12 },
      ]
      for (const a of articles) {
        await prisma.kbArticle.create({ data: { ...a, organizationId: orgId, authorId: user.id, tags: [] } })
      }
      console.log(`KB: ${categories.length} categories, ${articles.length} articles`)
    } else {
      console.log("KB: (existing, skipped)")
    }
  } catch (e) { console.log(`KB: ERROR — ${e.message}`) }

  // ─── 9. Email Templates ───
  try {
    const existingTemplate = await prisma.emailTemplate.findFirst({ where: { organizationId: orgId } })
    if (!existingTemplate) {
      const templates = [
        { name: "Welcome Onboarding", subject: "Welcome to {{companyName}} — Let's Get Started!", htmlBody: "<h1>Welcome, {{contactName}}!</h1><p>Thank you for choosing {{companyName}}. Your account is ready.</p><p>Here's what you can do next:</p><ul><li>Complete your profile</li><li>Explore the dashboard</li><li>Schedule a setup call</li></ul><p>Best regards,<br/>{{senderName}}</p>", category: "onboarding", variables: ["contactName", "companyName", "senderName"] },
        { name: "Invoice Reminder", subject: "Payment Reminder: Invoice {{invoiceNumber}} Due {{dueDate}}", htmlBody: "<h2>Payment Reminder</h2><p>Dear {{contactName}},</p><p>This is a friendly reminder that invoice <strong>{{invoiceNumber}}</strong> for <strong>{{amount}}</strong> is due on <strong>{{dueDate}}</strong>.</p><p>Please process the payment at your earliest convenience.</p><p>Thank you,<br/>{{companyName}} Finance Team</p>", category: "finance", variables: ["contactName", "invoiceNumber", "amount", "dueDate", "companyName"] },
        { name: "Deal Follow-Up", subject: "Following Up: {{dealName}}", htmlBody: "<p>Hi {{contactName}},</p><p>I wanted to follow up on our recent discussion about <strong>{{dealName}}</strong>.</p><p>Do you have any questions about the proposal? I'd be happy to schedule a call to discuss further.</p><p>Looking forward to hearing from you.</p><p>Best,<br/>{{senderName}}</p>", category: "sales", variables: ["contactName", "dealName", "senderName"] },
        { name: "Ticket Resolved", subject: "Your Ticket {{ticketNumber}} Has Been Resolved", htmlBody: "<p>Dear {{contactName}},</p><p>Your support ticket <strong>{{ticketNumber}}</strong> — \"{{ticketSubject}}\" has been resolved.</p><p>If the issue persists, simply reply to this email to reopen the ticket.</p><p>We'd appreciate your feedback:</p><p><a href='{{feedbackUrl}}'>Rate your experience</a></p><p>Thank you,<br/>Support Team</p>", category: "support", variables: ["contactName", "ticketNumber", "ticketSubject", "feedbackUrl"] },
        { name: "Monthly Newsletter", subject: "{{companyName}} Monthly Update — {{month}} {{year}}", htmlBody: "<h1>Monthly Update</h1><p>Dear {{contactName}},</p><p>Here's what's new this month:</p><h3>Product Updates</h3><p>{{productUpdates}}</p><h3>Upcoming Events</h3><p>{{events}}</p><h3>Industry Insights</h3><p>{{insights}}</p><p>Stay tuned for more updates!</p>", category: "marketing", variables: ["contactName", "companyName", "month", "year", "productUpdates", "events", "insights"] },
      ]
      for (const t of templates) {
        await prisma.emailTemplate.create({ data: { ...t, organizationId: orgId, createdBy: user.id, isActive: true } })
      }
      console.log(`Email Templates: ${templates.length}`)
    } else {
      console.log("Email Templates: (existing, skipped)")
    }
  } catch (e) { console.log(`Email Templates: ERROR — ${e.message}`) }

  // ─── 10. Contact Segments ───
  try {
    const existingSegment = await prisma.contactSegment.findFirst({ where: { organizationId: orgId } })
    if (!existingSegment) {
      const segments = [
        { name: "Enterprise Decision Makers", description: "C-level and VP contacts at companies with 1000+ employees", conditions: { rules: [{ field: "position", operator: "contains", value: "VP" }, { field: "company.employeeCount", operator: "gte", value: 1000 }] }, contactCount: 5, isDynamic: true },
        { name: "High Engagement (Score 80+)", description: "Contacts with engagement score above 80", conditions: { rules: [{ field: "engagementScore", operator: "gte", value: 80 }] }, contactCount: 6, isDynamic: true },
        { name: "European Pharma Contacts", description: "All contacts from European pharmaceutical companies", conditions: { rules: [{ field: "company.country", operator: "in", value: ["Switzerland", "UK", "Germany", "Sweden", "Poland"] }, { field: "company.industry", operator: "contains", value: "Pharma" }] }, contactCount: 7, isDynamic: true },
        { name: "Inactive Leads (30+ days)", description: "Contacts with no activity in the last 30 days", conditions: { rules: [{ field: "lastActivityDate", operator: "lt", value: "30_days_ago" }] }, contactCount: 3, isDynamic: true },
      ]
      for (const s of segments) {
        await prisma.contactSegment.create({ data: { ...s, organizationId: orgId, createdBy: user.id } })
      }
      console.log(`Segments: ${segments.length}`)
    } else {
      console.log("Segments: (existing, skipped)")
    }
  } catch (e) { console.log(`Segments: ERROR — ${e.message}`) }

  // ─── 11. Journeys + JourneySteps ───
  try {
    const existingJourney = await prisma.journey.findFirst({ where: { organizationId: orgId } })
    if (!existingJourney) {
      const journeysData = [
        { name: "New Lead Nurturing Sequence", description: "Automated email sequence for new inbound leads", status: "active", triggerType: "lead_created", entryCount: 45, activeCount: 12, completedCount: 28, steps: [
          { stepOrder: 0, stepType: "send_email", config: { templateName: "Welcome Onboarding", delay: 0 } },
          { stepOrder: 1, stepType: "wait", config: { days: 3 } },
          { stepOrder: 2, stepType: "condition", config: { field: "emailOpened", operator: "eq", value: true } },
          { stepOrder: 3, stepType: "send_email", config: { templateName: "Deal Follow-Up", delay: 0 } },
          { stepOrder: 4, stepType: "wait", config: { days: 5 } },
          { stepOrder: 5, stepType: "create_task", config: { title: "Follow up with lead", assignTo: "owner" } },
        ]},
        { name: "Invoice Payment Reminder Chain", description: "Automated reminders for unpaid invoices", status: "active", triggerType: "invoice_overdue", entryCount: 18, activeCount: 5, completedCount: 11, steps: [
          { stepOrder: 0, stepType: "send_email", config: { templateName: "Invoice Reminder", delay: 0 } },
          { stepOrder: 1, stepType: "wait", config: { days: 7 } },
          { stepOrder: 2, stepType: "condition", config: { field: "invoicePaid", operator: "eq", value: false } },
          { stepOrder: 3, stepType: "send_email", config: { templateName: "Invoice Reminder", subject: "Second Reminder" } },
          { stepOrder: 4, stepType: "wait", config: { days: 7 } },
          { stepOrder: 5, stepType: "create_task", config: { title: "Call client about overdue invoice", assignTo: "accountManager", priority: "high" } },
        ]},
      ]
      for (const j of journeysData) {
        const { steps, ...journeyData } = j
        const journey = await prisma.journey.create({ data: { ...journeyData, organizationId: orgId, createdBy: user.id } })
        for (const step of steps) {
          await prisma.journeyStep.create({ data: { ...step, journeyId: journey.id } })
        }
      }
      console.log(`Journeys: ${journeysData.length} (with steps)`)
    } else {
      console.log("Journeys: (existing, skipped)")
    }
  } catch (e) { console.log(`Journeys: ERROR — ${e.message}`) }

  // ─── 12. Events + Participants ───
  try {
    const existingEvent = await prisma.event.findFirst({ where: { organizationId: orgId } })
    if (!existingEvent) {
      const eventsData = [
        { name: "BioConnect 2026 — Annual Conference", description: "Annual pharma & biotech technology conference. Keynotes, workshops, and networking.", type: "conference", status: "registration_open", startDate: new Date(now + 45 * DAY), endDate: new Date(now + 47 * DAY), location: "Warsaw Marriott Hotel, Warsaw, Poland", isOnline: false, budget: 25000, expectedRevenue: 40000, maxParticipants: 200, registeredCount: 3, participants: [
          { contactIdx: 0, name: "Dr. James Mitchell", email: "j.mitchell@pfizer.com", role: "speaker", status: "confirmed" },
          { contactIdx: 5, name: "Dr. Anna Schneider", email: "a.schneider@biogenesislabs.com", role: "vip", status: "registered" },
          { contactIdx: 10, name: "Jennifer Park", email: "j.park@apexclinical.com", role: "attendee", status: "registered" },
        ]},
        { name: "AI in Drug Discovery — Webinar", description: "Free webinar covering AI/ML applications in pharmaceutical research and drug discovery pipelines.", type: "webinar", status: "planned", startDate: new Date(now + 21 * DAY), endDate: new Date(now + 21 * DAY), location: "Online (Zoom)", isOnline: true, meetingUrl: "https://zoom.us/j/example", budget: 500, expectedRevenue: 0, maxParticipants: 500, registeredCount: 2, participants: [
          { contactIdx: 1, name: "Sophie Dubois", email: "s.dubois@roche.com", role: "attendee", status: "registered" },
          { contactIdx: 8, name: "Dr. Michael Torres", email: "m.torres@neuropharma.com", role: "attendee", status: "registered" },
        ]},
        { name: "Clinical Suite 3.0 Launch Party", description: "Product launch event for Clinical Suite 3.0 with live demos and partner presentations.", type: "meetup", status: "completed", startDate: new Date(now - 20 * DAY), endDate: new Date(now - 20 * DAY), location: "LeadDrive Office, Warsaw", isOnline: false, budget: 3000, actualCost: 2800, expectedRevenue: 0, actualRevenue: 0, maxParticipants: 50, registeredCount: 3, attendedCount: 3, participants: [
          { contactIdx: 4, name: "Robert Kim", email: "r.kim@merck.com", role: "attendee", status: "attended" },
          { contactIdx: 7, name: "Katarzyna Nowak", email: "k.nowak@pharmacare-dist.eu", role: "attendee", status: "attended" },
          { contactIdx: 11, name: "Hans Muller", email: "h.muller@euromed-supplies.de", role: "attendee", status: "attended" },
        ]},
      ]
      for (const e of eventsData) {
        const { participants, ...eventData } = e
        const event = await prisma.event.create({ data: { ...eventData, organizationId: orgId, createdBy: user.id, tags: [] } })
        for (const p of participants) {
          const { contactIdx, ...pData } = p
          await prisma.eventParticipant.create({ data: { ...pData, eventId: event.id, contactId: createdContacts[contactIdx].id, companyId: createdContacts[contactIdx].companyId || undefined } })
        }
      }
      console.log(`Events: ${eventsData.length} (with participants)`)
    } else {
      console.log("Events: (existing, skipped)")
    }
  } catch (e) { console.log(`Events: ERROR — ${e.message}`) }

  // ─── 13. Projects + Milestones + ProjectTasks ───
  try {
    const existingProject = await prisma.project.findFirst({ where: { organizationId: orgId } })
    if (!existingProject) {
      const projectsData = [
        { name: "Merck Lab Management System", code: "PRJ-001", description: "Full implementation of lab management system with GxP compliance for Merck", status: "active", priority: "high", startDate: new Date(now - 60 * DAY), endDate: new Date(now + 120 * DAY), budget: 410000, actualCost: 136000, currency: "USD", completionPercentage: 35, companyId: createdCompanies[4].id, color: "#3b82f6",
          milestones: [
            { name: "Discovery & Requirements", dueDate: new Date(now - 30 * DAY), status: "completed", completedAt: new Date(now - 28 * DAY), sortOrder: 0 },
            { name: "Core Platform Development", dueDate: new Date(now + 30 * DAY), status: "in_progress", sortOrder: 1 },
            { name: "Integration & Testing", dueDate: new Date(now + 90 * DAY), status: "pending", sortOrder: 2 },
            { name: "Go-Live & Training", dueDate: new Date(now + 120 * DAY), status: "pending", sortOrder: 3 },
          ],
          tasks: [
            { title: "Complete database schema design", status: "done", priority: "high", dueDate: new Date(now - 20 * DAY), completedAt: new Date(now - 18 * DAY), estimatedHours: 24, actualHours: 28 },
            { title: "Build sample management module", status: "in_progress", priority: "high", dueDate: new Date(now + 10 * DAY), estimatedHours: 80, actualHours: 35 },
            { title: "Implement GxP audit trail", status: "in_progress", priority: "high", dueDate: new Date(now + 20 * DAY), estimatedHours: 40, actualHours: 12 },
            { title: "API integration with existing LIMS", status: "todo", priority: "medium", dueDate: new Date(now + 45 * DAY), estimatedHours: 60 },
          ],
        },
        { name: "Pfizer CRM Integration", code: "PRJ-002", description: "CRM system integration with Pfizer's existing IT infrastructure", status: "planning", priority: "high", startDate: new Date(now + 15 * DAY), endDate: new Date(now + 200 * DAY), budget: 285000, actualCost: 0, currency: "USD", completionPercentage: 0, companyId: createdCompanies[0].id, color: "#8b5cf6",
          milestones: [
            { name: "Project Kickoff", dueDate: new Date(now + 15 * DAY), status: "pending", sortOrder: 0 },
            { name: "Phase 1 Delivery", dueDate: new Date(now + 100 * DAY), status: "pending", sortOrder: 1 },
          ],
          tasks: [
            { title: "Prepare project charter", status: "in_progress", priority: "high", dueDate: new Date(now + 5 * DAY), estimatedHours: 16, actualHours: 4 },
            { title: "SSO integration architecture", status: "todo", priority: "medium", dueDate: new Date(now + 25 * DAY), estimatedHours: 32 },
            { title: "Data migration planning", status: "todo", priority: "medium", dueDate: new Date(now + 30 * DAY), estimatedHours: 24 },
          ],
        },
        { name: "EuroMed Supply Chain (Completed)", code: "PRJ-003", description: "Supply chain management solution for EuroMed Supplies", status: "completed", priority: "medium", startDate: new Date(now - 200 * DAY), endDate: new Date(now - 35 * DAY), actualEndDate: new Date(now - 30 * DAY), budget: 98000, actualCost: 92000, currency: "EUR", completionPercentage: 100, companyId: createdCompanies[11].id, color: "#10b981",
          milestones: [
            { name: "Requirements Gathering", dueDate: new Date(now - 170 * DAY), status: "completed", completedAt: new Date(now - 168 * DAY), sortOrder: 0 },
            { name: "Final Delivery", dueDate: new Date(now - 35 * DAY), status: "completed", completedAt: new Date(now - 30 * DAY), sortOrder: 1 },
          ],
          tasks: [
            { title: "Final UAT signoff", status: "done", priority: "high", dueDate: new Date(now - 35 * DAY), completedAt: new Date(now - 33 * DAY), estimatedHours: 16, actualHours: 12 },
            { title: "Knowledge transfer documentation", status: "done", priority: "medium", dueDate: new Date(now - 30 * DAY), completedAt: new Date(now - 30 * DAY), estimatedHours: 24, actualHours: 20 },
          ],
        },
      ]
      for (const proj of projectsData) {
        const { milestones, tasks: projTasks, ...projectData } = proj
        const project = await prisma.project.create({ data: { ...projectData, organizationId: orgId, managerId: user.id, createdBy: user.id, tags: [] } })
        const createdMilestones = []
        for (const ms of milestones) {
          const m = await prisma.projectMilestone.create({ data: { ...ms, organizationId: orgId, projectId: project.id } })
          createdMilestones.push(m)
        }
        for (const t of projTasks) {
          await prisma.projectTask.create({ data: { ...t, organizationId: orgId, projectId: project.id, assignedTo: user.id, createdBy: user.id, tags: [], actualHours: t.actualHours || 0, estimatedHours: t.estimatedHours || 0 } })
        }
      }
      console.log(`Projects: ${projectsData.length} (with milestones & tasks)`)
    } else {
      console.log("Projects: (existing, skipped)")
    }
  } catch (e) { console.log(`Projects: ERROR — ${e.message}`) }

  // ─── 14. Saved Reports ───
  try {
    const existingReport = await prisma.savedReport.findFirst({ where: { organizationId: orgId } })
    if (!existingReport) {
      const reports = [
        { name: "Monthly Revenue by Client", entityType: "deals", columns: [{ field: "company.name", label: "Client" }, { field: "valueAmount", label: "Value", aggregate: "sum" }], filters: [{ field: "stage", op: "eq", value: "WON" }], groupBy: "company.name", sortBy: "valueAmount", sortOrder: "desc", chartType: "bar" },
        { name: "Open Tickets by Priority", entityType: "tickets", columns: [{ field: "priority", label: "Priority" }, { field: "id", label: "Count", aggregate: "count" }], filters: [{ field: "status", op: "in", value: ["new", "in_progress"] }], groupBy: "priority", chartType: "pie" },
        { name: "Pipeline Forecast Report", entityType: "deals", columns: [{ field: "stage", label: "Stage" }, { field: "valueAmount", label: "Weighted Value", aggregate: "sum" }, { field: "probability", label: "Avg Probability", aggregate: "avg" }], filters: [{ field: "stage", op: "nin", value: ["WON", "LOST"] }], groupBy: "stage", chartType: "funnel" },
        { name: "Contact Engagement Scores", entityType: "contacts", columns: [{ field: "fullName", label: "Contact" }, { field: "company.name", label: "Company" }, { field: "engagementScore", label: "Score" }], filters: [], sortBy: "engagementScore", sortOrder: "desc", chartType: "table" },
      ]
      for (const r of reports) {
        await prisma.savedReport.create({ data: { ...r, organizationId: orgId, createdBy: user.id } })
      }
      console.log(`Saved Reports: ${reports.length}`)
    } else {
      console.log("Saved Reports: (existing, skipped)")
    }
  } catch (e) { console.log(`Saved Reports: ERROR — ${e.message}`) }

  // ─── 15. Notifications ───
  try {
    const existingNotification = await prisma.notification.findFirst({ where: { organizationId: orgId } })
    if (!existingNotification) {
      const notifications = [
        { type: "deal_won", title: "Deal Won!", message: "Novartis Procurement Platform deal closed for €195,000", isRead: true, createdAt: new Date(now - 5 * DAY) },
        { type: "ticket_created", title: "New Ticket: TK-1001", message: "Login issues after SSO migration — reported by Dr. James Mitchell (Pfizer)", isRead: true, createdAt: new Date(now - 3 * DAY) },
        { type: "invoice_overdue", title: "Invoice Overdue", message: "INV-2026-005 (BioGenesis) for €26,180 is 10 days overdue", isRead: false, createdAt: new Date(now - 1 * DAY) },
        { type: "task_due", title: "Task Due Tomorrow", message: "Follow up with Merck on Phase 2 — due tomorrow", isRead: false, createdAt: new Date(now) },
        { type: "lead_assigned", title: "New Lead Assigned", message: "Aisha Patel from Mumbai Medical Tech (score: 91) has been assigned to you", isRead: false, createdAt: new Date(now - 2 * DAY) },
        { type: "campaign_completed", title: "Campaign Results Ready", message: "BioConnect 2026 invite campaign: 46% open rate, 18% click rate", isRead: true, createdAt: new Date(now - 7 * DAY) },
      ]
      for (const n of notifications) {
        await prisma.notification.create({ data: { ...n, organizationId: orgId, userId: user.id } })
      }
      console.log(`Notifications: ${notifications.length}`)
    } else {
      console.log("Notifications: (existing, skipped)")
    }
  } catch (e) { console.log(`Notifications: ERROR — ${e.message}`) }

  // ─── 16. Sales Forecasts ───
  try {
    // SalesForecast requires a BudgetDepartment — create departments first if needed
    let salesDept = await prisma.budgetDepartment.findFirst({ where: { organizationId: orgId, key: "sales" } })
    if (!salesDept) {
      salesDept = await prisma.budgetDepartment.create({
        data: { organizationId: orgId, key: "sales", label: "Sales", hasRevenue: true, color: "#3b82f6", sortOrder: 0 },
      })
    }
    const existingForecast = await prisma.salesForecast.findFirst({ where: { organizationId: orgId } })
    if (!existingForecast) {
      const forecasts = [
        { year: 2026, month: 1, amount: 185000, notes: "Q1 conservative estimate" },
        { year: 2026, month: 2, amount: 210000, notes: "Merck Phase 1 delivery" },
        { year: 2026, month: 3, amount: 195000, notes: "Novartis renewal" },
        { year: 2026, month: 4, amount: 245000, notes: "Q2 includes Pfizer kickoff" },
        { year: 2026, month: 5, amount: 280000, notes: "BioGenesis + Apex start" },
        { year: 2026, month: 6, amount: 310000, notes: "Mid-year peak" },
        { year: 2026, month: 7, amount: 265000, notes: "Q3 start — seasonal dip" },
        { year: 2026, month: 8, amount: 240000, notes: "Summer slowdown" },
        { year: 2026, month: 9, amount: 290000, notes: "Q3 recovery" },
        { year: 2026, month: 10, amount: 320000, notes: "Q4 pipeline acceleration" },
        { year: 2026, month: 11, amount: 350000, notes: "Year-end deal push" },
        { year: 2026, month: 12, amount: 380000, notes: "Q4 closes — strongest month" },
      ]
      for (const f of forecasts) {
        await prisma.salesForecast.create({ data: { ...f, organizationId: orgId, departmentId: salesDept.id } })
      }
      console.log(`Sales Forecasts: ${forecasts.length} (monthly)`)
    } else {
      console.log("Sales Forecasts: (existing, skipped)")
    }
  } catch (e) { console.log(`Sales Forecasts: ERROR — ${e.message}`) }

  // ─── 17. Currencies ───
  try {
    const existingCurrency = await prisma.currency.findFirst({ where: { organizationId: orgId } })
    if (!existingCurrency) {
      const currencies = [
        { code: "USD", name: "US Dollar", symbol: "$", exchangeRate: 1.0, isBase: true, isActive: true },
        { code: "EUR", name: "Euro", symbol: "€", exchangeRate: 0.92, isBase: false, isActive: true },
        { code: "GBP", name: "British Pound", symbol: "£", exchangeRate: 0.79, isBase: false, isActive: true },
        { code: "PLN", name: "Polish Zloty", symbol: "zł", exchangeRate: 3.95, isBase: false, isActive: true },
        { code: "CHF", name: "Swiss Franc", symbol: "CHF", exchangeRate: 0.88, isBase: false, isActive: true },
      ]
      for (const c of currencies) {
        await prisma.currency.create({ data: { ...c, organizationId: orgId } })
      }
      console.log(`Currencies: ${currencies.length}`)
    } else {
      console.log("Currencies: (existing, skipped)")
    }
  } catch (e) { console.log(`Currencies: ERROR — ${e.message}`) }

  // ─── 18. SLA Policies ───
  try {
    const existingSla = await prisma.slaPolicy.findFirst({ where: { organizationId: orgId } })
    if (!existingSla) {
      const slaPolicies = [
        { name: "Critical SLA", priority: "critical", firstResponseHours: 1, resolutionHours: 4, businessHoursOnly: false, isActive: true, isDefault: false },
        { name: "High Priority SLA", priority: "high", firstResponseHours: 2, resolutionHours: 8, businessHoursOnly: true, isActive: true, isDefault: true },
        { name: "Medium Priority SLA", priority: "medium", firstResponseHours: 4, resolutionHours: 24, businessHoursOnly: true, isActive: true, isDefault: false },
        { name: "Low Priority SLA", priority: "low", firstResponseHours: 8, resolutionHours: 48, businessHoursOnly: true, isActive: true, isDefault: false },
      ]
      for (const s of slaPolicies) {
        await prisma.slaPolicy.create({ data: { ...s, organizationId: orgId } })
      }
      console.log(`SLA Policies: ${slaPolicies.length}`)
    } else {
      console.log("SLA Policies: (existing, skipped)")
    }
  } catch (e) { console.log(`SLA Policies: ERROR — ${e.message}`) }

  // ─── 19. Ticket Queues ───
  try {
    const existingQueue = await prisma.ticketQueue.findFirst({ where: { organizationId: orgId } })
    if (!existingQueue) {
      const queues = [
        { name: "Technical Support", skills: ["technical", "integration", "api"], priority: 1, autoAssign: true, assignMethod: "least_loaded", isActive: true },
        { name: "Billing & Finance", skills: ["billing", "invoicing", "payments"], priority: 0, autoAssign: true, assignMethod: "round_robin", isActive: true },
        { name: "Compliance & Security", skills: ["compliance", "gdpr", "security", "gxp"], priority: 2, autoAssign: false, assignMethod: "least_loaded", isActive: true },
      ]
      for (const q of queues) {
        await prisma.ticketQueue.create({ data: { ...q, organizationId: orgId } })
      }
      console.log(`Ticket Queues: ${queues.length}`)
    } else {
      console.log("Ticket Queues: (existing, skipped)")
    }
  } catch (e) { console.log(`Ticket Queues: ERROR — ${e.message}`) }

  // ─── 20. Workflow Rules ───
  try {
    const existingWorkflow = await prisma.workflowRule.findFirst({ where: { organizationId: orgId } })
    if (!existingWorkflow) {
      const workflows = [
        { name: "Auto-assign high-value deals to manager", entityType: "deal", triggerEvent: "created", conditions: { rules: [{ field: "valueAmount", operator: "gte", value: 100000 }] }, isActive: true },
        { name: "Notify team on ticket escalation", entityType: "ticket", triggerEvent: "updated", conditions: { rules: [{ field: "escalationLevel", operator: "gte", value: 2 }] }, isActive: true },
      ]
      for (const w of workflows) {
        const rule = await prisma.workflowRule.create({ data: { ...w, organizationId: orgId, createdBy: user.id } })
        // Add actions for each rule
        if (w.entityType === "deal") {
          await prisma.workflowAction.create({ data: { ruleId: rule.id, actionType: "assign_to", actionConfig: { target: "manager" }, actionOrder: 0 } })
          await prisma.workflowAction.create({ data: { ruleId: rule.id, actionType: "send_notification", actionConfig: { message: "High-value deal created: {{deal.name}}" }, actionOrder: 1 } })
        } else {
          await prisma.workflowAction.create({ data: { ruleId: rule.id, actionType: "send_notification", actionConfig: { target: "team", message: "Ticket {{ticket.ticketNumber}} escalated to level {{ticket.escalationLevel}}" }, actionOrder: 0 } })
        }
      }
      console.log(`Workflow Rules: ${workflows.length} (with actions)`)
    } else {
      console.log("Workflow Rules: (existing, skipped)")
    }
  } catch (e) { console.log(`Workflow Rules: ERROR — ${e.message}`) }

  // ─── 21. AI Agent Configs ───
  try {
    const existingAi = await prisma.aiAgentConfig.findFirst({ where: { organizationId: orgId } })
    if (!existingAi) {
      const aiConfigs = [
        { configName: "Da Vinci — Sales Assistant", model: "claude-haiku-4-5-20251001", maxTokens: 2048, temperature: 0.7, systemPrompt: "You are Da Vinci, an AI sales assistant for a pharma/biotech CRM platform. Help users with deal analysis, lead scoring, email drafting, and pipeline optimization. Be concise, data-driven, and professional.", agentType: "sales", department: "Sales", priority: 1, intents: ["sales_inquiry", "pricing", "demo_request", "deal_analysis"], kbEnabled: true, kbMaxArticles: 5, isActive: true, escalationEnabled: true, greeting: "Hello! I'm Da Vinci, your AI sales assistant. How can I help you today?" },
        { configName: "Da Vinci — Support Bot", model: "claude-haiku-4-5-20251001", maxTokens: 1024, temperature: 0.5, systemPrompt: "You are Da Vinci, a support AI for a pharma CRM platform. Help users troubleshoot issues, find KB articles, and create tickets when needed. Be empathetic and solution-oriented.", agentType: "support", department: "Support", priority: 0, intents: ["support_request", "bug_report", "how_to", "ticket_status"], kbEnabled: true, kbMaxArticles: 3, isActive: true, escalationEnabled: true, greeting: "Hi! I'm here to help with any issues you're experiencing. What can I assist with?" },
      ]
      for (const a of aiConfigs) {
        await prisma.aiAgentConfig.create({ data: { ...a, organizationId: orgId } })
      }
      console.log(`AI Agent Configs: ${aiConfigs.length}`)
    } else {
      console.log("AI Agent Configs: (existing, skipped)")
    }
  } catch (e) { console.log(`AI Agent Configs: ERROR — ${e.message}`) }

  // ─── 22. Call Logs ───
  try {
    const existingCall = await prisma.callLog.findFirst({ where: { organizationId: orgId } })
    if (!existingCall) {
      const callLogs = [
        { direction: "outbound", fromNumber: "+48221234567", toNumber: "+12127332400", status: "completed", duration: 1845, contactId: createdContacts[0].id, companyId: createdCompanies[0].id, disposition: "interested", notes: "Discussed CRM requirements. Very interested in clinical suite. Follow-up demo scheduled for next week.", startedAt: new Date(now - 3 * DAY), endedAt: new Date(now - 3 * DAY + 1845000) },
        { direction: "inbound", fromNumber: "+41616882200", toNumber: "+48221234567", status: "completed", duration: 720, contactId: createdContacts[1].id, companyId: createdCompanies[1].id, disposition: "callback", notes: "Sophie called to discuss timeline for digital transformation. Needs updated proposal by Friday.", startedAt: new Date(now - 2 * DAY), endedAt: new Date(now - 2 * DAY + 720000) },
        { direction: "outbound", fromNumber: "+48221234567", toNumber: "+16175550200", status: "completed", duration: 2160, contactId: createdContacts[8].id, companyId: createdCompanies[8].id, disposition: "interested", notes: "Deep dive on trial tracker features. Needs GxP compliance documentation. Sending technical specs.", startedAt: new Date(now - 1 * DAY), endedAt: new Date(now - 1 * DAY + 2160000) },
        { direction: "outbound", fromNumber: "+48221234567", toNumber: "+46812345600", status: "no-answer", duration: 0, contactId: createdContacts[9].id, companyId: createdCompanies[9].id, disposition: "no_answer", notes: "Left voicemail about ERP setup proposal.", startedAt: new Date(now - 4 * DAY) },
        { direction: "inbound", fromNumber: "+19087404100", toNumber: "+48221234567", status: "completed", duration: 960, contactId: createdContacts[4].id, companyId: createdCompanies[4].id, disposition: "interested", notes: "Robert called about Phase 2 customization. Wants to add GxP validation module. Sending revised SOW.", startedAt: new Date(now - 6 * DAY), endedAt: new Date(now - 6 * DAY + 960000) },
      ]
      for (const c of callLogs) {
        await prisma.callLog.create({ data: { ...c, organizationId: orgId, userId: user.id } })
      }
      console.log(`Call Logs: ${callLogs.length}`)
    } else {
      console.log("Call Logs: (existing, skipped)")
    }
  } catch (e) { console.log(`Call Logs: ERROR — ${e.message}`) }

  // ─── 23. Budget Plan + Budget Lines ───
  try {
    const existingPlan = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId } })
    if (!existingPlan) {
      const plan = await prisma.budgetPlan.create({
        data: {
          organizationId: orgId,
          name: "Annual Budget 2026",
          periodType: "annual",
          year: 2026,
          status: "approved",
          notes: "Approved annual operating budget for fiscal year 2026",
          approvedBy: user.id,
          approvedAt: new Date(now - 90 * DAY),
        },
      })
      const budgetLines = [
        { category: "Personnel & Salaries", lineType: "expense", plannedAmount: 1200000, notes: "All staff salaries incl. taxes", sortOrder: 0 },
        { category: "Cloud Infrastructure", lineType: "expense", plannedAmount: 96000, notes: "AWS + Hetzner servers", sortOrder: 1 },
        { category: "Software Licenses", lineType: "expense", plannedAmount: 45000, notes: "Development tools, SaaS subscriptions", sortOrder: 2 },
        { category: "Office & Facilities", lineType: "expense", plannedAmount: 60000, notes: "WeWork rent + utilities", sortOrder: 3 },
        { category: "Marketing & Events", lineType: "expense", plannedAmount: 80000, notes: "Campaigns, conferences, content", sortOrder: 4 },
        { category: "Service Revenue", lineType: "revenue", plannedAmount: 3200000, notes: "Projected service delivery revenue", sortOrder: 5 },
      ]
      for (const line of budgetLines) {
        await prisma.budgetLine.create({ data: { ...line, organizationId: orgId, planId: plan.id } })
      }
      console.log(`Budget Plan: 1 plan, ${budgetLines.length} lines`)
    } else {
      console.log("Budget Plan: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Plan: ERROR — ${e.message}`) }

  // ─── 24. Pricing Parameters ───
  try {
    const existingPricing = await prisma.pricingParameters.findFirst({ where: { organizationId: orgId } })
    if (!existingPricing) {
      await prisma.pricingParameters.create({
        data: {
          organizationId: orgId,
          totalUsers: 45,
          totalEmployees: 137,
          technicalStaff: 107,
          backOfficeStaff: 30,
          monthlyWorkHours: 160,
          vatRate: 0.23,
          employerTaxRate: 0.2,
          riskRate: 0.05,
          miscExpenseRate: 0.01,
          fixedOverheadRatio: 0.25,
          updatedBy: user.id,
        },
      })
      console.log("Pricing Parameters: 1")
    } else {
      console.log("Pricing Parameters: (existing, skipped)")
    }
  } catch (e) { console.log(`Pricing Parameters: ERROR — ${e.message}`) }

  // ─── 25. Overhead Costs ───
  try {
    const existingOverhead = await prisma.overheadCost.findFirst({ where: { organizationId: orgId } })
    if (!existingOverhead) {
      const overheadCosts = [
        { category: "Facilities", label: "Office Rent (WeWork Warsaw)", amount: 4200, isAnnual: false, hasVat: true, isAdmin: true, sortOrder: 0 },
        { category: "Software", label: "AWS Cloud Services", amount: 8450, isAnnual: false, hasVat: false, isAdmin: false, targetService: "cloud", sortOrder: 1 },
        { category: "Software", label: "Development Tools & Licenses", amount: 3750, isAnnual: false, hasVat: true, isAdmin: false, targetService: "permanent_it", sortOrder: 2 },
        { category: "Insurance", label: "Professional Liability Insurance", amount: 24000, isAnnual: true, hasVat: false, isAdmin: true, amortMonths: 12, sortOrder: 3 },
        { category: "Equipment", label: "Workstation Leasing (quarterly)", amount: 15000, isAnnual: false, hasVat: true, isAdmin: true, amortMonths: 60, sortOrder: 4, notes: "40 workstations, 5-year amortization" },
      ]
      for (const oc of overheadCosts) {
        await prisma.overheadCost.create({ data: { ...oc, organizationId: orgId } })
      }
      console.log(`Overhead Costs: ${overheadCosts.length}`)
    } else {
      console.log("Overhead Costs: (existing, skipped)")
    }
  } catch (e) { console.log(`Overhead Costs: ERROR — ${e.message}`) }

  // ─── 26. TicketComment ───
  try {
    const existingTC = await prisma.ticketComment.findFirst({
      where: { ticket: { organizationId: orgId } },
    })
    if (!existingTC) {
      const orgTickets = await prisma.ticket.findMany({ where: { organizationId: orgId }, take: 8 })
      if (orgTickets.length > 0) {
        const comments = [
          { ticketId: orgTickets[0]?.id, userId: user.id, comment: "Confirmed the SAML assertion issue. Root cause is a clock skew between IdP and our SP. Adjusting time tolerance to 5 minutes.", isInternal: false },
          { ticketId: orgTickets[0]?.id, userId: user.id, comment: "Internal note: contacted Okta support — they confirmed a known bug in their latest release. Patch expected Thursday.", isInternal: true },
          { ticketId: orgTickets[1]?.id, userId: user.id, comment: "Profiled the slow queries. The main bottleneck is the aggregation pipeline on the analytics_events table. Adding composite index.", isInternal: false },
          { ticketId: orgTickets[2]?.id, userId: user.id, comment: "Reproduced the issue with 55 line items. The PDF renderer runs out of memory. Switching to streaming generation.", isInternal: false },
          { ticketId: orgTickets[3]?.id, userId: user.id, comment: "Feature request logged in the product backlog. Estimated effort: 3 sprints. Will include in Q3 roadmap review.", isInternal: true },
          { ticketId: orgTickets[4]?.id, userId: user.id, comment: "Increased rate limit to 500 req/min for their API key. Monitoring for the next 24 hours.", isInternal: false },
          { ticketId: orgTickets[5]?.id, userId: user.id, comment: "Calendar sync fix deployed in v3.2.1. Customer confirmed events are syncing correctly now.", isInternal: false },
          { ticketId: orgTickets[6]?.id, userId: user.id, comment: "GDPR compliance review completed. All export endpoints comply with Article 20 (right to data portability). Sending documentation to customer.", isInternal: false },
        ]
        for (const c of comments) {
          if (c.ticketId) {
            await prisma.ticketComment.create({ data: c })
          }
        }
        console.log(`Ticket Comments: ${comments.length}`)
      } else {
        console.log("Ticket Comments: (no tickets found, skipped)")
      }
    } else {
      console.log("Ticket Comments: (existing, skipped)")
    }
  } catch (e) { console.log(`Ticket Comments: ERROR — ${e.message}`) }

  // ─── 27. TicketMacro ───
  try {
    const existingTM = await prisma.ticketMacro.findFirst({ where: { organizationId: orgId } })
    if (!existingTM) {
      const macros = [
        { name: "Quick Close — Resolved", description: "Mark ticket as resolved with standard closing comment", category: "resolution", actions: [{ type: "set_status", value: "resolved" }, { type: "add_comment", value: "Issue resolved." }], shortcutKey: "Ctrl+Shift+R", sortOrder: 0 },
        { name: "Escalate to Manager", description: "Escalate ticket to manager with critical priority", category: "escalation", actions: [{ type: "set_priority", value: "critical" }, { type: "send_notification", target: "manager" }], shortcutKey: "Ctrl+Shift+E", sortOrder: 1 },
        { name: "Request Info", description: "Set ticket to waiting and ask for more details", category: "general", actions: [{ type: "set_status", value: "waiting" }, { type: "add_comment", value: "Could you provide more details?" }], shortcutKey: "Ctrl+Shift+I", sortOrder: 2 },
        { name: "Assign to Me", description: "Assign the current ticket to yourself", category: "assignment", actions: [{ type: "assign_to", value: "{{current_user}}" }], shortcutKey: "Ctrl+Shift+A", sortOrder: 3 },
      ]
      for (const m of macros) {
        await prisma.ticketMacro.create({ data: { ...m, organizationId: orgId, createdBy: user.id } })
      }
      console.log(`Ticket Macros: ${macros.length}`)
    } else {
      console.log("Ticket Macros: (existing, skipped)")
    }
  } catch (e) { console.log(`Ticket Macros: ERROR — ${e.message}`) }

  // ─── 28. EscalationRule ───
  try {
    const existingER = await prisma.escalationRule.findFirst({ where: { organizationId: orgId } })
    if (!existingER) {
      const rules = [
        { name: "First Response Breach", triggerType: "first_response_breach", triggerMinutes: 0, level: 1, actions: [{ type: "notify", target: "manager" }, { type: "increase_priority" }] },
        { name: "Resolution Warning", triggerType: "resolution_warning", triggerMinutes: 60, level: 1, actions: [{ type: "notify", target: "assigned_agent" }, { type: "add_comment", value: "SLA resolution deadline approaching." }] },
        { name: "Critical Escalation", triggerType: "resolution_breach", triggerMinutes: 0, level: 2, actions: [{ type: "notify", target: "admin" }, { type: "increase_priority" }, { type: "reassign", target: "manager" }] },
      ]
      for (const r of rules) {
        await prisma.escalationRule.create({ data: { ...r, organizationId: orgId } })
      }
      console.log(`Escalation Rules: ${rules.length}`)
    } else {
      console.log("Escalation Rules: (existing, skipped)")
    }
  } catch (e) { console.log(`Escalation Rules: ERROR — ${e.message}`) }

  // ─── 29. LeadAssignmentRule ───
  try {
    const existingLAR = await prisma.leadAssignmentRule.findFirst({ where: { organizationId: orgId } })
    if (!existingLAR) {
      const rules = [
        { name: "High Value Leads", description: "Route leads with estimated value > $100K to senior sales", method: "condition", priority: 10, conditions: [{ field: "estimatedValue", operator: "gt", value: 100000 }], assignees: [user.id] },
        { name: "European Leads", description: "Website leads routed to EU sales team", method: "condition", priority: 20, conditions: [{ field: "source", operator: "eq", value: "website" }], assignees: [user.id] },
        { name: "Round Robin Default", description: "Default round-robin distribution for unmatched leads", method: "round_robin", priority: 99, conditions: [], assignees: [user.id] },
      ]
      for (const r of rules) {
        await prisma.leadAssignmentRule.create({ data: { ...r, organizationId: orgId } })
      }
      console.log(`Lead Assignment Rules: ${rules.length}`)
    } else {
      console.log("Lead Assignment Rules: (existing, skipped)")
    }
  } catch (e) { console.log(`Lead Assignment Rules: ERROR — ${e.message}`) }

  // ─── 30. SalesQuota ───
  try {
    const existingSQ = await prisma.salesQuota.findFirst({ where: { organizationId: orgId } })
    if (!existingSQ) {
      const quotas = [
        { userId: user.id, year: 2026, quarter: 1, amount: 250000, currency: "USD" },
        { userId: user.id, year: 2026, quarter: 2, amount: 300000, currency: "USD" },
        { userId: user.id, year: 2026, quarter: 3, amount: 350000, currency: "USD" },
        { userId: user.id, year: 2026, quarter: 4, amount: 400000, currency: "USD" },
      ]
      for (const q of quotas) {
        await prisma.salesQuota.create({ data: { ...q, organizationId: orgId } })
      }
      console.log(`Sales Quotas: ${quotas.length}`)
    } else {
      console.log("Sales Quotas: (existing, skipped)")
    }
  } catch (e) { console.log(`Sales Quotas: ERROR — ${e.message}`) }

  // ─── 31. CustomField ───
  try {
    const existingCF = await prisma.customField.findFirst({ where: { organizationId: orgId } })
    if (!existingCF) {
      const fields = [
        { entityType: "deal", fieldName: "deal_source_channel", fieldLabel: "Source Channel", fieldType: "select", options: ["Direct", "Partner", "Online", "Referral"], sortOrder: 0 },
        { entityType: "company", fieldName: "company_tier", fieldLabel: "Client Tier", fieldType: "select", options: ["Platinum", "Gold", "Silver", "Bronze"], sortOrder: 1 },
        { entityType: "contact", fieldName: "preferred_language", fieldLabel: "Preferred Language", fieldType: "select", options: ["English", "German", "French", "Polish"], sortOrder: 2 },
        { entityType: "ticket", fieldName: "affected_system", fieldLabel: "Affected System", fieldType: "text", options: [], sortOrder: 3 },
        { entityType: "lead", fieldName: "lead_budget_range", fieldLabel: "Budget Range", fieldType: "select", options: ["< $50K", "$50K-$100K", "$100K-$500K", "> $500K"], sortOrder: 4 },
      ]
      for (const f of fields) {
        await prisma.customField.create({ data: { ...f, organizationId: orgId } })
      }
      console.log(`Custom Fields: ${fields.length}`)
    } else {
      console.log("Custom Fields: (existing, skipped)")
    }
  } catch (e) { console.log(`Custom Fields: ERROR — ${e.message}`) }

  // ─── 32. FieldPermission ───
  try {
    const existingFP = await prisma.fieldPermission.findFirst({ where: { organizationId: orgId } })
    if (!existingFP) {
      const perms = [
        { roleId: "viewer", entityType: "deal", fieldName: "valueAmount", access: "hidden" },
        { roleId: "viewer", entityType: "company", fieldName: "annualRevenue", access: "hidden" },
        { roleId: "member", entityType: "deal", fieldName: "valueAmount", access: "visible" },
        { roleId: "member", entityType: "contact", fieldName: "phone", access: "editable" },
        { roleId: "support", entityType: "deal", fieldName: "valueAmount", access: "hidden" },
        { roleId: "support", entityType: "ticket", fieldName: "escalationLevel", access: "visible" },
      ]
      for (const p of perms) {
        await prisma.fieldPermission.create({ data: { ...p, organizationId: orgId } })
      }
      console.log(`Field Permissions: ${perms.length}`)
    } else {
      console.log("Field Permissions: (existing, skipped)")
    }
  } catch (e) { console.log(`Field Permissions: ERROR — ${e.message}`) }

  // ─── 33. DealContactRole ───
  try {
    const existingDCR = await prisma.dealContactRole.findFirst({
      where: { deal: { organizationId: orgId } },
    })
    if (!existingDCR) {
      const orgDeals = await prisma.deal.findMany({ where: { organizationId: orgId }, take: 5 })
      if (orgDeals.length >= 3 && createdContacts.length >= 10) {
        const roles = [
          { dealId: orgDeals[0].id, contactId: createdContacts[0].id, role: "decision_maker", influence: "High", decisionFactor: "ROI", loyalty: "Supportive", isPrimary: true },
          { dealId: orgDeals[0].id, contactId: createdContacts[12].id, role: "technical_evaluator", influence: "Medium", decisionFactor: "Ease of Use", loyalty: "Neutral", isPrimary: false },
          { dealId: orgDeals[1].id, contactId: createdContacts[1].id, role: "decision_maker", influence: "High", decisionFactor: "Innovation", loyalty: "Supportive", isPrimary: true },
          { dealId: orgDeals[2].id, contactId: createdContacts[2].id, role: "budget_holder", influence: "High", decisionFactor: "Cost Savings", loyalty: "Supportive", isPrimary: true },
          { dealId: orgDeals[3]?.id || orgDeals[0].id, contactId: createdContacts[3].id, role: "influencer", influence: "Medium", decisionFactor: "Integration", loyalty: "Neutral", isPrimary: false },
        ]
        for (const r of roles) {
          await prisma.dealContactRole.create({ data: r })
        }
        console.log(`Deal Contact Roles: ${roles.length}`)
      } else {
        console.log("Deal Contact Roles: (insufficient deals/contacts, skipped)")
      }
    } else {
      console.log("Deal Contact Roles: (existing, skipped)")
    }
  } catch (e) { console.log(`Deal Contact Roles: ERROR — ${e.message}`) }

  // ─── 34. DealCompetitor ───
  try {
    const existingDC = await prisma.dealCompetitor.findFirst({
      where: { deal: { organizationId: orgId } },
    })
    if (!existingDC) {
      const orgDeals = await prisma.deal.findMany({ where: { organizationId: orgId }, take: 4 })
      if (orgDeals.length >= 2) {
        const competitors = [
          { dealId: orgDeals[0].id, name: "Salesforce Health Cloud", product: "Health Cloud CRM", strengths: "Brand recognition, large ecosystem", weaknesses: "Expensive, complex customization", price: "$350,000", threat: "High" },
          { dealId: orgDeals[0].id, name: "Veeva Systems", product: "Veeva CRM", strengths: "Pharma-specific, FDA validated", weaknesses: "Vendor lock-in, limited flexibility", price: "$420,000", threat: "High" },
          { dealId: orgDeals[1].id, name: "SAP S/4HANA", product: "Digital Supply Chain", strengths: "Enterprise-grade, strong analytics", weaknesses: "Very long implementation, high TCO", price: "$800,000", threat: "Medium" },
          { dealId: orgDeals[2]?.id || orgDeals[1].id, name: "Oracle NetSuite", product: "NetSuite ERP", strengths: "Integrated suite, cloud-native", weaknesses: "Less pharma-specific, UI dated", price: "$250,000", threat: "Low" },
        ]
        for (const c of competitors) {
          await prisma.dealCompetitor.create({ data: { ...c, organizationId: orgId } })
        }
        console.log(`Deal Competitors: ${competitors.length}`)
      } else {
        console.log("Deal Competitors: (insufficient deals, skipped)")
      }
    } else {
      console.log("Deal Competitors: (existing, skipped)")
    }
  } catch (e) { console.log(`Deal Competitors: ERROR — ${e.message}`) }

  // ─── 35. DealTeamMember ───
  try {
    const existingDTM = await prisma.dealTeamMember.findFirst({
      where: { deal: { organizationId: orgId } },
    })
    if (!existingDTM) {
      const orgDeals = await prisma.deal.findMany({ where: { organizationId: orgId }, take: 4 })
      const teamUsers = await prisma.user.findMany({ where: { organizationId: orgId }, take: 4 })
      if (orgDeals.length >= 2 && teamUsers.length >= 2) {
        const members = [
          { dealId: orgDeals[0].id, userId: teamUsers[0].id, role: "owner" },
          { dealId: orgDeals[0].id, userId: teamUsers[1]?.id || teamUsers[0].id, role: "technical_lead" },
          { dealId: orgDeals[1].id, userId: teamUsers[0].id, role: "owner" },
          { dealId: orgDeals[1].id, userId: teamUsers[2]?.id || teamUsers[0].id, role: "solution_architect" },
          { dealId: orgDeals[2]?.id || orgDeals[0].id, userId: teamUsers[0].id, role: "owner" },
        ]
        // Deduplicate by dealId+userId
        const seen = new Set()
        for (const m of members) {
          const key = `${m.dealId}_${m.userId}`
          if (!seen.has(key)) {
            seen.add(key)
            await prisma.dealTeamMember.create({ data: m })
          }
        }
        console.log(`Deal Team Members: ${seen.size}`)
      } else {
        console.log("Deal Team Members: (insufficient deals/users, skipped)")
      }
    } else {
      console.log("Deal Team Members: (existing, skipped)")
    }
  } catch (e) { console.log(`Deal Team Members: ERROR — ${e.message}`) }

  // ─── 36. LandingPage ───
  try {
    const existingLP = await prisma.landingPage.findFirst({ where: { organizationId: orgId } })
    if (!existingLP) {
      const pages = [
        { name: "Product Launch 2026", slug: "product-launch-2026", description: "Landing page for Clinical Suite 3.0 product launch", status: "published", publishedAt: new Date(now - 14 * DAY), totalViews: 1240, totalSubmissions: 87, metaTitle: "Clinical Suite 3.0 — Next-Gen Pharma CRM", metaDescription: "Discover the future of pharmaceutical CRM with AI-powered insights and compliance." },
        { name: "Free Trial Signup", slug: "free-trial", description: "14-day free trial registration page", status: "published", publishedAt: new Date(now - 30 * DAY), totalViews: 3560, totalSubmissions: 234, metaTitle: "Start Your Free Trial — LeadDrive CRM", metaDescription: "Try LeadDrive CRM free for 14 days. No credit card required." },
        { name: "Webinar Registration", slug: "webinar-q2", description: "Q2 webinar series registration page", status: "draft", totalViews: 0, totalSubmissions: 0, metaTitle: "AI in Drug Discovery Webinar — LeadDrive", metaDescription: "Register for our free webinar on leveraging AI in modern drug discovery pipelines." },
      ]
      for (const p of pages) {
        await prisma.landingPage.create({ data: { ...p, organizationId: orgId, createdBy: user.id } })
      }
      console.log(`Landing Pages: ${pages.length}`)
    } else {
      console.log("Landing Pages: (existing, skipped)")
    }
  } catch (e) { console.log(`Landing Pages: ERROR — ${e.message}`) }

  // ─── 37. FormSubmission ───
  try {
    const existingFS = await prisma.formSubmission.findFirst({ where: { organizationId: orgId } })
    if (!existingFS) {
      const lp = await prisma.landingPage.findFirst({ where: { organizationId: orgId, slug: "free-trial" } })
      const lp2 = await prisma.landingPage.findFirst({ where: { organizationId: orgId, slug: "product-launch-2026" } })
      const submissions = [
        { landingPageId: lp?.id || null, formData: { name: "Dr. Henrik Johansson", email: "h.johansson@scandipharma.se", company: "ScandiPharma AB", role: "CTO", interest: "Clinical Suite" }, source: "organic", ipAddress: "185.22.45.100" },
        { landingPageId: lp?.id || null, formData: { name: "Amira Hassan", email: "a.hassan@cairobiotech.eg", company: "Cairo Biotech", role: "IT Director", interest: "Free Trial" }, source: "linkedin_ad", ipAddress: "102.176.90.55" },
        { landingPageId: lp2?.id || null, formData: { name: "Liam O'Brien", email: "l.obrien@emeraldpharma.ie", company: "Emerald Pharma", role: "VP Sales", interest: "Product Launch" }, source: "email_campaign", ipAddress: "86.45.120.33" },
        { landingPageId: lp2?.id || null, formData: { name: "Yuki Nakamura", email: "y.nakamura@tokyomed.jp", company: "TokyoMed Research", role: "Lab Director", interest: "Product Demo" }, source: "google_ads", ipAddress: "203.141.55.22" },
      ]
      for (const s of submissions) {
        await prisma.formSubmission.create({ data: { ...s, organizationId: orgId } })
      }
      console.log(`Form Submissions: ${submissions.length}`)
    } else {
      console.log("Form Submissions: (existing, skipped)")
    }
  } catch (e) { console.log(`Form Submissions: ERROR — ${e.message}`) }

  // ─── 38. ContactEvent ───
  try {
    const existingCE = await prisma.contactEvent.findFirst({ where: { organizationId: orgId } })
    if (!existingCE) {
      const events = [
        { contactId: createdContacts[0].id, eventType: "page_view", eventData: { url: "/products/clinical-suite", duration: 245 }, source: "website", score: 5 },
        { contactId: createdContacts[0].id, eventType: "email_open", eventData: { campaignName: "Q2 Product Launch", subject: "Clinical Suite 3.0" }, source: "email", score: 10 },
        { contactId: createdContacts[1].id, eventType: "email_click", eventData: { campaignName: "Q2 Product Launch", link: "/demo-request" }, source: "email", score: 15 },
        { contactId: createdContacts[2].id, eventType: "form_submit", eventData: { formName: "Demo Request", fields: { interest: "Procurement Platform" } }, source: "website", score: 25 },
        { contactId: createdContacts[3].id, eventType: "page_view", eventData: { url: "/pricing", duration: 180 }, source: "website", score: 5 },
        { contactId: createdContacts[4].id, eventType: "meeting_attended", eventData: { meetingType: "Demo", duration: 60, attendees: 3 }, source: "calendar", score: 30 },
        { contactId: createdContacts[5].id, eventType: "email_open", eventData: { campaignName: "Customer Success Stories", subject: "How Merck saved 40%" }, source: "email", score: 10 },
        { contactId: createdContacts[8].id, eventType: "email_click", eventData: { campaignName: "Webinar Invite", link: "/register/ai-webinar" }, source: "email", score: 15 },
      ]
      for (const ev of events) {
        await prisma.contactEvent.create({ data: { ...ev, organizationId: orgId } })
      }
      console.log(`Contact Events: ${events.length}`)
    } else {
      console.log("Contact Events: (existing, skipped)")
    }
  } catch (e) { console.log(`Contact Events: ERROR — ${e.message}`) }

  // ─── 39. EmailLog ───
  try {
    const existingEL = await prisma.emailLog.findFirst({ where: { organizationId: orgId } })
    if (!existingEL) {
      const logs = [
        { direction: "outbound", fromEmail: `noreply@${slug}.leaddrivecrm.org`, toEmail: "j.mitchell@pfizer.com", subject: "Pfizer CRM Integration — Next Steps", status: "delivered", contactId: createdContacts[0].id, sentBy: user.id, openedAt: new Date(now - 2 * DAY) },
        { direction: "outbound", fromEmail: `noreply@${slug}.leaddrivecrm.org`, toEmail: "s.dubois@roche.com", subject: "Roche Digital Transformation Proposal", status: "opened", contactId: createdContacts[1].id, sentBy: user.id, openedAt: new Date(now - 1 * DAY) },
        { direction: "outbound", fromEmail: `noreply@${slug}.leaddrivecrm.org`, toEmail: "m.bernasconi@novartis.com", subject: "Novartis Q1 License Renewal", status: "clicked", contactId: createdContacts[2].id, sentBy: user.id, openedAt: new Date(now - 3 * DAY), clickedAt: new Date(now - 3 * DAY + 300000) },
        { direction: "outbound", fromEmail: `noreply@${slug}.leaddrivecrm.org`, toEmail: "e.watson@astrazeneca.com", subject: "AstraZeneca — Data Analytics Platform Overview", status: "sent", contactId: createdContacts[3].id, sentBy: user.id },
        { direction: "outbound", fromEmail: `noreply@${slug}.leaddrivecrm.org`, toEmail: "r.kim@merck.com", subject: "Merck Lab Management — Phase 2 SOW", status: "delivered", contactId: createdContacts[4].id, sentBy: user.id },
        { direction: "outbound", fromEmail: `noreply@${slug}.leaddrivecrm.org`, toEmail: "a.schneider@biogenesislabs.com", subject: "BioGenesis LIMS — Board Presentation Materials", status: "opened", contactId: createdContacts[5].id, sentBy: user.id, openedAt: new Date(now - 4 * DAY) },
      ]
      for (const l of logs) {
        await prisma.emailLog.create({ data: { ...l, organizationId: orgId } })
      }
      console.log(`Email Logs: ${logs.length}`)
    } else {
      console.log("Email Logs: (existing, skipped)")
    }
  } catch (e) { console.log(`Email Logs: ERROR — ${e.message}`) }

  // ─── 40. CampaignVariant ───
  try {
    const existingCV = await prisma.campaignVariant.findFirst({
      where: { campaign: { organizationId: orgId } },
    })
    if (!existingCV) {
      const firstCampaign = await prisma.campaign.findFirst({ where: { organizationId: orgId } })
      if (firstCampaign) {
        const variants = [
          { campaignId: firstCampaign.id, name: "Subject A — Feature Focused", subject: "Introducing Clinical Suite 3.0 — AI-Powered Insights", percentage: 40, totalSent: 940, totalOpened: 420, totalClicked: 145, totalBounced: 12 },
          { campaignId: firstCampaign.id, name: "Subject B — Benefit Focused", subject: "Cut Clinical Trial Costs by 30% with Clinical Suite 3.0", percentage: 40, totalSent: 940, totalOpened: 380, totalClicked: 128, totalBounced: 8, isWinner: true },
          { campaignId: firstCampaign.id, name: "Control", subject: "Clinical Suite 3.0 Now Available", percentage: 20, totalSent: 470, totalOpened: 180, totalClicked: 39, totalBounced: 5 },
        ]
        for (const v of variants) {
          await prisma.campaignVariant.create({ data: v })
        }
        console.log(`Campaign Variants: ${variants.length}`)
      } else {
        console.log("Campaign Variants: (no campaigns found, skipped)")
      }
    } else {
      console.log("Campaign Variants: (existing, skipped)")
    }
  } catch (e) { console.log(`Campaign Variants: ERROR — ${e.message}`) }

  // ─── 41. InvoicePayment ───
  try {
    const existingIP = await prisma.invoicePayment.findFirst({ where: { organizationId: orgId } })
    if (!existingIP) {
      const paidInvoices = await prisma.invoice.findMany({ where: { organizationId: orgId, status: "paid" }, take: 3 })
      if (paidInvoices.length > 0) {
        const payments = [
          { invoiceId: paidInvoices[0].id, amount: paidInvoices[0].totalAmount, currency: paidInvoices[0].currency || "USD", paymentMethod: "bank_transfer", paymentDate: new Date(now - 28 * DAY), reference: "TXN-2026-00481", notes: "Payment received via wire transfer" },
          { invoiceId: paidInvoices[1]?.id || paidInvoices[0].id, amount: paidInvoices[1]?.totalAmount || 50000, currency: paidInvoices[1]?.currency || "USD", paymentMethod: "bank_transfer", paymentDate: new Date(now - 12 * DAY), reference: "TXN-2026-00523", notes: "Full payment received" },
          { invoiceId: paidInvoices[2]?.id || paidInvoices[0].id, amount: paidInvoices[2]?.totalAmount || 30000, currency: paidInvoices[2]?.currency || "EUR", paymentMethod: "bank_transfer", paymentDate: new Date(now - 55 * DAY), reference: "TXN-2026-00389", notes: "Final milestone payment" },
        ]
        for (const p of payments) {
          await prisma.invoicePayment.create({ data: { ...p, organizationId: orgId, createdBy: user.id } })
        }
        console.log(`Invoice Payments: ${payments.length}`)
      } else {
        console.log("Invoice Payments: (no paid invoices, skipped)")
      }
    } else {
      console.log("Invoice Payments: (existing, skipped)")
    }
  } catch (e) { console.log(`Invoice Payments: ERROR — ${e.message}`) }

  // ─── 42. BillPayment ───
  try {
    const existingBP = await prisma.billPayment.findFirst({ where: { organizationId: orgId } })
    if (!existingBP) {
      const paidBills = await prisma.bill.findMany({ where: { organizationId: orgId, status: "paid" }, take: 2 })
      if (paidBills.length > 0) {
        const payments = [
          { billId: paidBills[0].id, amount: paidBills[0].totalAmount, currency: paidBills[0].currency || "USD", paymentMethod: "bank_transfer", paymentDate: new Date(now - 14 * DAY), reference: "BP-2026-001", notes: "Paid via auto-debit" },
          { billId: paidBills[1]?.id || paidBills[0].id, amount: paidBills[1]?.totalAmount || 1680, currency: paidBills[1]?.currency || "USD", paymentMethod: "credit_card", paymentDate: new Date(now - 44 * DAY), reference: "BP-2026-002", notes: "Annual license payment" },
        ]
        for (const p of payments) {
          await prisma.billPayment.create({ data: { ...p, organizationId: orgId, createdBy: user.id } })
        }
        console.log(`Bill Payments: ${payments.length}`)
      } else {
        console.log("Bill Payments: (no paid bills, skipped)")
      }
    } else {
      console.log("Bill Payments: (existing, skipped)")
    }
  } catch (e) { console.log(`Bill Payments: ERROR — ${e.message}`) }

  // ─── 43. FundTransaction ───
  try {
    const existingFT = await prisma.fundTransaction.findFirst({ where: { organizationId: orgId } })
    if (!existingFT) {
      const orgFunds = await prisma.fund.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true },
      })
      const fundByName = new Map(orgFunds.map((fund) => [fund.name, fund]))
      const taxFund = fundByName.get("Tax Reserve")
      const payrollFund = fundByName.get("Payroll Buffer")
      const researchFund = fundByName.get("R&D Investment Fund")
      if (taxFund && payrollFund && researchFund) {
        const txns = [
          { fundId: taxFund.id, type: "deposit", amount: 12000, description: "Quarterly tax provision — Q1 2026", relatedType: "manual" },
          { fundId: taxFund.id, type: "deposit", amount: 15000, description: "Quarterly tax provision — Q2 estimate", relatedType: "manual" },
          { fundId: payrollFund.id, type: "deposit", amount: 45000, description: "January payroll buffer allocation", relatedType: "rule" },
          { fundId: payrollFund.id, type: "withdrawal", amount: 32000, description: "February payroll disbursement", relatedType: "manual" },
          { fundId: researchFund.id, type: "deposit", amount: 15600, description: "R&D budget allocation — Clinical Suite 3.0", relatedType: "manual" },
        ]
        // Keep the production-capable seed compatible with both sides of the
        // Fund event-source cutover. The compatibility trigger deliberately
        // canonicalizes an INSERT-first ledger write but requires the matching
        // source balance mutation in the same database transaction. Seeding
        // the complete fixture atomically also prevents a retry from seeing
        // one partial transaction and skipping the remaining demo history.
        await prisma.$transaction(async (tx) => {
          for (const t of txns) {
            await tx.fundTransaction.create({
              data: { ...t, organizationId: orgId, createdBy: user.id },
            })
            const updated = await tx.fund.updateMany({
              where: {
                id: t.fundId,
                organizationId: orgId,
                ...(t.type === "withdrawal" ? { currentBalance: { gte: t.amount } } : {}),
              },
              data: t.type === "withdrawal"
                ? { currentBalance: { decrement: t.amount } }
                : { currentBalance: { increment: t.amount } },
            })
            if (updated.count !== 1) {
              throw new Error(`Fund balance update failed for demo transaction on ${t.fundId}`)
            }
            // Multiple demo ledger entries may target the same Fund. Flush the
            // deferred compatibility checks while this entry's intermediate
            // balance is still current, then defer them again for the next
            // entry. The outer transaction remains all-or-nothing.
            await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE")
            await tx.$executeRawUnsafe("SET CONSTRAINTS ALL DEFERRED")
          }
        })
        console.log(`Fund Transactions: ${txns.length}`)
      } else {
        console.log("Fund Transactions: (expected demo funds not found, skipped)")
      }
    } else {
      console.log("Fund Transactions: (existing, skipped)")
    }
  } catch (e) { console.log(`Fund Transactions: ERROR — ${e.message}`) }

  // ─── 44. PaymentOrder ───
  try {
    const existingPO = await prisma.paymentOrder.findFirst({ where: { organizationId: orgId } })
    if (!existingPO) {
      const orders = [
        { orderNumber: "PO-2026-001", counterpartyName: "AWS", amount: 8450, currency: "USD", purpose: "Cloud infrastructure payment — March 2026", paymentMethod: "bank_transfer", status: "executed", createdBy: user.id, approvedBy: user.id, approvedAt: new Date(now - 15 * DAY), executedAt: new Date(now - 14 * DAY) },
        { orderNumber: "PO-2026-002", counterpartyName: "WeWork Warsaw", amount: 4200, currency: "EUR", purpose: "Office rent — April 2026", paymentMethod: "bank_transfer", status: "approved", createdBy: user.id, approvedBy: user.id, approvedAt: new Date(now - 2 * DAY) },
        { orderNumber: "PO-2026-003", counterpartyName: "Hetzner Online GmbH", amount: 2890, currency: "EUR", purpose: "Dedicated servers — Q2 2026", paymentMethod: "bank_transfer", status: "draft", createdBy: user.id },
      ]
      for (const o of orders) {
        await prisma.paymentOrder.create({ data: { ...o, organizationId: orgId } })
      }
      console.log(`Payment Orders: ${orders.length}`)
    } else {
      console.log("Payment Orders: (existing, skipped)")
    }
  } catch (e) { console.log(`Payment Orders: ERROR — ${e.message}`) }

  // ─── 45. RecurringInvoice + Items ───
  try {
    const existingRI = await prisma.recurringInvoice.findFirst({ where: { organizationId: orgId } })
    if (!existingRI) {
      const ri1 = await prisma.recurringInvoice.create({
        data: {
          organizationId: orgId,
          title: "Novartis — Monthly License Fee",
          titleTemplate: "Novartis License — {month} {year}",
          companyId: createdCompanies[2].id,
          contactId: createdContacts[2].id,
          frequency: "monthly",
          intervalCount: 1,
          startDate: new Date(now - 90 * DAY),
          nextRunDate: new Date(now + 20 * DAY),
          lastRunDate: new Date(now - 10 * DAY),
          totalGenerated: 3,
          currency: "EUR",
          taxRate: 0,
          paymentTerms: "net30",
          dayOfMonth: 1,
          isActive: true,
          createdBy: user.id,
        },
      })
      await prisma.recurringInvoiceItem.create({
        data: { recurringInvoiceId: ri1.id, name: "Procurement Platform License — Monthly", quantity: 1, unitPrice: 16250, sortOrder: 0 },
      })

      const ri2 = await prisma.recurringInvoice.create({
        data: {
          organizationId: orgId,
          title: "Merck — Quarterly Support",
          titleTemplate: "Merck Support — Q{quarter} {year}",
          companyId: createdCompanies[4].id,
          contactId: createdContacts[4].id,
          frequency: "quarterly",
          intervalCount: 1,
          startDate: new Date(now - 60 * DAY),
          nextRunDate: new Date(now + 30 * DAY),
          lastRunDate: new Date(now - 60 * DAY),
          totalGenerated: 1,
          currency: "USD",
          taxRate: 0,
          paymentTerms: "net30",
          dayOfMonth: 15,
          isActive: true,
          createdBy: user.id,
        },
      })
      await prisma.recurringInvoiceItem.create({
        data: { recurringInvoiceId: ri2.id, name: "Lab Management System — Premium Support", quantity: 1, unitPrice: 12500, sortOrder: 0 },
      })
      await prisma.recurringInvoiceItem.create({
        data: { recurringInvoiceId: ri2.id, name: "System Monitoring & Maintenance", quantity: 1, unitPrice: 3500, sortOrder: 1 },
      })
      console.log("Recurring Invoices: 2 (with items)")
    } else {
      console.log("Recurring Invoices: (existing, skipped)")
    }
  } catch (e) { console.log(`Recurring Invoices: ERROR — ${e.message}`) }

  // ─── 46. CashFlowEntry ───
  try {
    const existingCFE = await prisma.cashFlowEntry.findFirst({ where: { organizationId: orgId } })
    if (!existingCFE) {
      const entries = [
        { year: 2026, month: 1, entryType: "inflow", source: "invoice", amount: 185000, currencyCode: "USD", description: "January service revenue", isProjected: false, activityType: "operating", category: "revenue", plannedAmount: 200000 },
        { year: 2026, month: 1, entryType: "outflow", source: "manual", amount: 98000, currencyCode: "USD", description: "January payroll", isProjected: false, activityType: "operating", category: "salary", plannedAmount: 100000 },
        { year: 2026, month: 2, entryType: "inflow", source: "invoice", amount: 220000, currencyCode: "USD", description: "February service revenue", isProjected: false, activityType: "operating", category: "revenue", plannedAmount: 210000 },
        { year: 2026, month: 2, entryType: "outflow", source: "manual", amount: 102000, currencyCode: "USD", description: "February payroll", isProjected: false, activityType: "operating", category: "salary", plannedAmount: 100000 },
        { year: 2026, month: 3, entryType: "inflow", source: "invoice", amount: 195000, currencyCode: "USD", description: "March service revenue", isProjected: false, activityType: "operating", category: "revenue", plannedAmount: 215000 },
        { year: 2026, month: 3, entryType: "outflow", source: "manual", amount: 35000, currencyCode: "USD", description: "Server hardware purchase", isProjected: false, activityType: "investing", category: "capex", plannedAmount: 30000 },
        { year: 2026, month: 4, entryType: "inflow", source: "budget_line", amount: 250000, currencyCode: "USD", description: "April projected revenue", isProjected: true, activityType: "operating", category: "revenue", plannedAmount: 250000 },
        { year: 2026, month: 4, entryType: "outflow", source: "budget_line", amount: 110000, currencyCode: "USD", description: "April projected payroll", isProjected: true, activityType: "operating", category: "salary", plannedAmount: 110000 },
      ]
      for (const e of entries) {
        await prisma.cashFlowEntry.create({ data: { ...e, organizationId: orgId } })
      }
      console.log(`Cash Flow Entries: ${entries.length}`)
    } else {
      console.log("Cash Flow Entries: (existing, skipped)")
    }
  } catch (e) { console.log(`Cash Flow Entries: ERROR — ${e.message}`) }

  // ─── 47. DashboardLayout ───
  try {
    const existingDL = await prisma.dashboardLayout.findFirst({ where: { organizationId: orgId } })
    if (!existingDL) {
      await prisma.dashboardLayout.create({
        data: {
          organizationId: orgId,
          userId: user.id,
          name: "Default",
          isDefault: true,
          layout: [
            { id: "revenue_chart", x: 0, y: 0, w: 6, h: 4, type: "chart", title: "Revenue Overview" },
            { id: "deal_pipeline", x: 6, y: 0, w: 6, h: 4, type: "pipeline", title: "Deal Pipeline" },
            { id: "tasks_widget", x: 0, y: 4, w: 4, h: 3, type: "tasks", title: "My Tasks" },
            { id: "recent_activity", x: 4, y: 4, w: 4, h: 3, type: "activity", title: "Recent Activity" },
            { id: "kpi_cards", x: 8, y: 4, w: 4, h: 3, type: "kpi", title: "Key Metrics" },
          ],
        },
      })
      console.log("Dashboard Layout: 1")
    } else {
      console.log("Dashboard Layout: (existing, skipped)")
    }
  } catch (e) { console.log(`Dashboard Layout: ERROR — ${e.message}`) }

  // ─── 48. BudgetCostType ───
  try {
    const existingBCT = await prisma.budgetCostType.findFirst({ where: { organizationId: orgId } })
    if (!existingBCT) {
      const costTypes = [
        { key: "labor", label: "Personnel & Salaries", costModelPattern: "serviceDetails.{dept}.directLabor", isShared: false, allocationMethod: "proportional", color: "#3b82f6", sortOrder: 0 },
        { key: "overhead_admin", label: "Admin & Overhead", costModelPattern: null, isShared: true, allocationMethod: "fixed", color: "#f59e0b", sortOrder: 1 },
        { key: "software", label: "Software & Licenses", costModelPattern: null, isShared: true, allocationMethod: "proportional", color: "#10b981", sortOrder: 2 },
        { key: "cloud", label: "Cloud Infrastructure", costModelPattern: "serviceDetails.{dept}.cloudCost", isShared: false, allocationMethod: "proportional", color: "#8b5cf6", sortOrder: 3 },
        { key: "misc", label: "Miscellaneous", costModelPattern: null, isShared: true, allocationMethod: null, color: "#6b7280", sortOrder: 4 },
      ]
      for (const ct of costTypes) {
        await prisma.budgetCostType.create({ data: { ...ct, organizationId: orgId } })
      }
      console.log(`Budget Cost Types: ${costTypes.length}`)
    } else {
      console.log("Budget Cost Types: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Cost Types: ERROR — ${e.message}`) }

  // ─── 49. BudgetSection ───
  try {
    const existingBS = await prisma.budgetSection.findFirst({ where: { organizationId: orgId } })
    if (!existingBS) {
      const budgetPlan = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId } })
      if (budgetPlan) {
        const sections = [
          { planId: budgetPlan.id, name: "Revenue", sectionType: "revenue", sortOrder: 0 },
          { planId: budgetPlan.id, name: "Operating Expenses", sectionType: "expense", sortOrder: 1 },
          { planId: budgetPlan.id, name: "EBITDA", sectionType: "ebitda", sortOrder: 2 },
        ]
        for (const s of sections) {
          await prisma.budgetSection.create({ data: { ...s, organizationId: orgId } })
        }
        console.log(`Budget Sections: ${sections.length}`)
      } else {
        console.log("Budget Sections: (no budget plan, skipped)")
      }
    } else {
      console.log("Budget Sections: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Sections: ERROR — ${e.message}`) }

  // ─── 50. BudgetActual ───
  try {
    const existingBA = await prisma.budgetActual.findFirst({ where: { organizationId: orgId } })
    if (!existingBA) {
      const budgetPlan = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId } })
      if (budgetPlan) {
        const actuals = [
          { planId: budgetPlan.id, category: "Personnel & Salaries", lineType: "expense", actualAmount: 105000, expenseDate: "2026-01", description: "January payroll actual" },
          { planId: budgetPlan.id, category: "Personnel & Salaries", lineType: "expense", actualAmount: 102000, expenseDate: "2026-02", description: "February payroll actual" },
          { planId: budgetPlan.id, category: "Cloud Infrastructure", lineType: "expense", actualAmount: 8200, expenseDate: "2026-01", description: "January AWS + Hetzner" },
          { planId: budgetPlan.id, category: "Cloud Infrastructure", lineType: "expense", actualAmount: 8750, expenseDate: "2026-02", description: "February AWS + Hetzner (scaling increase)" },
          { planId: budgetPlan.id, category: "Service Revenue", lineType: "revenue", actualAmount: 285000, expenseDate: "2026-01", description: "January service revenue actual" },
          { planId: budgetPlan.id, category: "Service Revenue", lineType: "revenue", actualAmount: 310000, expenseDate: "2026-02", description: "February service revenue actual" },
        ]
        for (const a of actuals) {
          await prisma.budgetActual.create({ data: { ...a, organizationId: orgId } })
        }
        console.log(`Budget Actuals: ${actuals.length}`)
      } else {
        console.log("Budget Actuals: (no budget plan, skipped)")
      }
    } else {
      console.log("Budget Actuals: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Actuals: ERROR — ${e.message}`) }

  // ─── 51. ExpenseForecast ───
  try {
    const existingEF = await prisma.expenseForecast.findFirst({ where: { organizationId: orgId } })
    if (!existingEF) {
      const laborType = await prisma.budgetCostType.findFirst({ where: { organizationId: orgId, key: "labor" } })
      const cloudType = await prisma.budgetCostType.findFirst({ where: { organizationId: orgId, key: "cloud" } })
      if (laborType && cloudType) {
        const forecasts = [
          { costTypeId: laborType.id, year: 2026, month: 4, amount: 108000, notes: "Projected payroll — includes new hire" },
          { costTypeId: laborType.id, year: 2026, month: 5, amount: 110000, notes: "Projected payroll — full team" },
          { costTypeId: cloudType.id, year: 2026, month: 4, amount: 9200, notes: "Cloud cost increase — new staging environment" },
          { costTypeId: cloudType.id, year: 2026, month: 5, amount: 9500, notes: "Cloud cost — projected scaling for Clinical Suite launch" },
        ]
        for (const f of forecasts) {
          await prisma.expenseForecast.create({ data: { ...f, organizationId: orgId } })
        }
        console.log(`Expense Forecasts: ${forecasts.length}`)
      } else {
        console.log("Expense Forecasts: (no cost types found, skipped)")
      }
    } else {
      console.log("Expense Forecasts: (existing, skipped)")
    }
  } catch (e) { console.log(`Expense Forecasts: ERROR — ${e.message}`) }

  // ─── 52. CostEmployee ───
  try {
    const existingCEmp = await prisma.costEmployee.findFirst({ where: { organizationId: orgId } })
    if (!existingCEmp) {
      const employees = [
        { department: "IT", position: "Senior Developer", count: 12, netSalary: 4500, grossSalary: 5800, superGross: 6900, inOverhead: false },
        { department: "IT", position: "Junior Developer", count: 8, netSalary: 2800, grossSalary: 3600, superGross: 4300, inOverhead: false },
        { department: "InfoSec", position: "Security Engineer", count: 4, netSalary: 5200, grossSalary: 6700, superGross: 8000, inOverhead: false },
        { department: "PM", position: "Project Manager", count: 5, netSalary: 4800, grossSalary: 6200, superGross: 7400, inOverhead: false },
        { department: "BackOffice", position: "HR & Admin", count: 3, netSalary: 3200, grossSalary: 4100, superGross: 4900, inOverhead: true },
        { department: "BackOffice", position: "Finance & Accounting", count: 2, netSalary: 3800, grossSalary: 4900, superGross: 5800, inOverhead: true },
      ]
      for (const emp of employees) {
        await prisma.costEmployee.create({ data: { ...emp, organizationId: orgId } })
      }
      console.log(`Cost Employees: ${employees.length}`)
    } else {
      console.log("Cost Employees: (existing, skipped)")
    }
  } catch (e) { console.log(`Cost Employees: ERROR — ${e.message}`) }

  // ─── 53. ClientService ───
  try {
    const existingCS = await prisma.clientService.findFirst({ where: { organizationId: orgId } })
    if (!existingCS) {
      const services = [
        { companyId: createdCompanies[0].id, serviceType: "permanent_it", monthlyRevenue: 28500, isActive: true, notes: "CRM integration support team — 6 FTE" },
        { companyId: createdCompanies[2].id, serviceType: "permanent_it", monthlyRevenue: 16250, isActive: true, notes: "Procurement platform maintenance — 3 FTE" },
        { companyId: createdCompanies[4].id, serviceType: "permanent_it", monthlyRevenue: 34000, isActive: true, notes: "Lab management system — 8 FTE" },
        { companyId: createdCompanies[4].id, serviceType: "infosec", monthlyRevenue: 8500, isActive: true, notes: "GxP compliance monitoring" },
        { companyId: createdCompanies[10].id, serviceType: "helpdesk", monthlyRevenue: 5500, isActive: true, notes: "Clinical portal L1/L2 support" },
      ]
      for (const s of services) {
        await prisma.clientService.create({ data: { ...s, organizationId: orgId } })
      }
      console.log(`Client Services: ${services.length}`)
    } else {
      console.log("Client Services: (existing, skipped)")
    }
  } catch (e) { console.log(`Client Services: ERROR — ${e.message}`) }

  // ─── 54. CostModelSnapshot ───
  try {
    const existingCMS = await prisma.costModelSnapshot.findFirst({ where: { organizationId: orgId } })
    if (!existingCMS) {
      const snapshots = [
        { snapshotMonth: "2026-02", totalCost: 185000, totalRevenue: 310000, margin: 125000, marginPct: 40.3, overheadTotal: 42000, employeeCost: 143000, profitableClients: 4, lossClients: 0, dataJson: { departments: { IT: { cost: 95000, revenue: 180000 }, InfoSec: { cost: 32000, revenue: 42000 }, PM: { cost: 37000, revenue: 55000 } } } },
        { snapshotMonth: "2026-03", totalCost: 192000, totalRevenue: 325000, margin: 133000, marginPct: 40.9, overheadTotal: 44000, employeeCost: 148000, profitableClients: 5, lossClients: 0, dataJson: { departments: { IT: { cost: 98000, revenue: 195000 }, InfoSec: { cost: 34000, revenue: 45000 }, PM: { cost: 38000, revenue: 58000 } } } },
      ]
      for (const s of snapshots) {
        await prisma.costModelSnapshot.create({ data: { ...s, organizationId: orgId } })
      }
      console.log(`Cost Model Snapshots: ${snapshots.length}`)
    } else {
      console.log("Cost Model Snapshots: (existing, skipped)")
    }
  } catch (e) { console.log(`Cost Model Snapshots: ERROR — ${e.message}`) }

  // ─── 55. MTM Module ───
  try {
    const existingMtmCustomer = await prisma.mtmCustomer.findFirst({ where: { organizationId: orgId } })
    if (!existingMtmCustomer) {
      const teamUsers = await prisma.user.findMany({ where: { organizationId: orgId }, take: 4 })

      // MtmAgent — 3 agents
      const agent1 = await prisma.mtmAgent.create({
        data: { organizationId: orgId, userId: teamUsers[1]?.id || null, name: "Sarah Johnson", email: `sarah@${slug}.com`, phone: "+48 500 111 001", role: "MANAGER", status: "ACTIVE", isOnline: true, lastSeenAt: new Date() },
      })
      const agent2 = await prisma.mtmAgent.create({
        data: { organizationId: orgId, userId: teamUsers[2]?.id || null, name: "Alex Chen", email: `alex@${slug}.com`, phone: "+48 500 111 002", role: "AGENT", status: "ACTIVE", managerId: agent1.id, isOnline: true, lastSeenAt: new Date(now - 15 * 60000) },
      })
      const agent3 = await prisma.mtmAgent.create({
        data: { organizationId: orgId, userId: teamUsers[3]?.id || null, name: "Maria Lopez", email: `maria@${slug}.com`, phone: "+48 500 111 003", role: "AGENT", status: "ACTIVE", managerId: agent1.id, isOnline: false, lastSeenAt: new Date(now - 2 * 60 * 60000) },
      })
      console.log("MTM Agents: 3")

      // MtmCustomer — 6 customers
      const mtmCustomers = [
        { code: "PH-001", name: "Central Pharmacy Mokotow", category: "A", status: "ACTIVE", address: "ul. Pulawska 45", city: "Warsaw", district: "Mokotow", latitude: 52.1935, longitude: 21.0044, phone: "+48 22 111 0001", contactPerson: "Jan Wiśniewski" },
        { code: "PH-002", name: "Apteka Zdrowie Plus", category: "A", status: "ACTIVE", address: "ul. Marszałkowska 100", city: "Warsaw", district: "Śródmieście", latitude: 52.2297, longitude: 21.0122, phone: "+48 22 111 0002", contactPerson: "Anna Kowalczyk" },
        { code: "PH-003", name: "PharmaCare Express", category: "B", status: "ACTIVE", address: "ul. Nowy Świat 22", city: "Warsaw", district: "Śródmieście", latitude: 52.2319, longitude: 21.0198, phone: "+48 22 111 0003", contactPerson: "Piotr Lewandowski" },
        { code: "ST-001", name: "MedSupply Warehouse", category: "B", status: "ACTIVE", address: "ul. Prosta 69", city: "Warsaw", district: "Wola", latitude: 52.2325, longitude: 20.9858, phone: "+48 22 111 0004", contactPerson: "Marta Zielińska" },
        { code: "ST-002", name: "HealthMart Ursynów", category: "C", status: "ACTIVE", address: "ul. KEN 84", city: "Warsaw", district: "Ursynów", latitude: 52.1527, longitude: 21.0456, phone: "+48 22 111 0005", contactPerson: "Tomasz Wójcik" },
        { code: "PH-004", name: "Apteka Nowa", category: "C", status: "PROSPECT", address: "ul. Grójecka 128", city: "Warsaw", district: "Ochota", latitude: 52.2133, longitude: 20.9645, phone: "+48 22 111 0006", contactPerson: "Katarzyna Nowak" },
      ]
      const createdMtmCustomers = []
      for (const c of mtmCustomers) {
        const created = await prisma.mtmCustomer.create({ data: { ...c, organizationId: orgId } })
        createdMtmCustomers.push(created)
      }
      console.log(`MTM Customers: ${mtmCustomers.length}`)

      // MtmRoute — 3 routes with points
      const routeDate1 = new Date()
      routeDate1.setHours(0, 0, 0, 0)
      const routeDate2 = new Date(now + DAY)
      routeDate2.setHours(0, 0, 0, 0)
      const routeDate3 = new Date(now - DAY)
      routeDate3.setHours(0, 0, 0, 0)

      const route1 = await prisma.mtmRoute.create({
        data: { organizationId: orgId, agentId: agent2.id, date: routeDate1, name: "Warsaw Central — Today", status: "IN_PROGRESS", totalPoints: 4, visitedPoints: 2, startedAt: new Date(now - 3 * 60 * 60000) },
      })
      const route1Points = [
        { routeId: route1.id, customerId: createdMtmCustomers[0].id, orderIndex: 0, status: "VISITED", plannedTime: new Date(now - 3 * 60 * 60000), visitedAt: new Date(now - 2.5 * 60 * 60000) },
        { routeId: route1.id, customerId: createdMtmCustomers[1].id, orderIndex: 1, status: "VISITED", plannedTime: new Date(now - 2 * 60 * 60000), visitedAt: new Date(now - 1.5 * 60 * 60000) },
        { routeId: route1.id, customerId: createdMtmCustomers[2].id, orderIndex: 2, status: "PENDING", plannedTime: new Date(now + 1 * 60 * 60000) },
        { routeId: route1.id, customerId: createdMtmCustomers[3].id, orderIndex: 3, status: "PENDING", plannedTime: new Date(now + 2 * 60 * 60000) },
      ]
      for (const p of route1Points) {
        await prisma.mtmRoutePoint.create({ data: { ...p, organizationId: orgId } })
      }

      const route2 = await prisma.mtmRoute.create({
        data: { organizationId: orgId, agentId: agent3.id, date: routeDate1, name: "South Warsaw", status: "PLANNED", totalPoints: 4, visitedPoints: 0 },
      })
      const route2Points = [
        { routeId: route2.id, customerId: createdMtmCustomers[4].id, orderIndex: 0, status: "PENDING", plannedTime: new Date(now + 1 * 60 * 60000) },
        { routeId: route2.id, customerId: createdMtmCustomers[5].id, orderIndex: 1, status: "PENDING", plannedTime: new Date(now + 2 * 60 * 60000) },
        { routeId: route2.id, customerId: createdMtmCustomers[0].id, orderIndex: 2, status: "PENDING", plannedTime: new Date(now + 3 * 60 * 60000) },
        { routeId: route2.id, customerId: createdMtmCustomers[1].id, orderIndex: 3, status: "PENDING", plannedTime: new Date(now + 4 * 60 * 60000) },
      ]
      for (const p of route2Points) {
        await prisma.mtmRoutePoint.create({ data: { ...p, organizationId: orgId } })
      }

      const route3 = await prisma.mtmRoute.create({
        data: { organizationId: orgId, agentId: agent2.id, date: routeDate3, name: "Warsaw Central — Yesterday", status: "COMPLETED", totalPoints: 4, visitedPoints: 4, startedAt: new Date(now - 27 * 60 * 60000), completedAt: new Date(now - 20 * 60 * 60000) },
      })
      const route3Points = [
        { routeId: route3.id, customerId: createdMtmCustomers[2].id, orderIndex: 0, status: "VISITED", visitedAt: new Date(now - 26 * 60 * 60000) },
        { routeId: route3.id, customerId: createdMtmCustomers[3].id, orderIndex: 1, status: "VISITED", visitedAt: new Date(now - 25 * 60 * 60000) },
        { routeId: route3.id, customerId: createdMtmCustomers[4].id, orderIndex: 2, status: "VISITED", visitedAt: new Date(now - 23 * 60 * 60000) },
        { routeId: route3.id, customerId: createdMtmCustomers[5].id, orderIndex: 3, status: "VISITED", visitedAt: new Date(now - 21 * 60 * 60000) },
      ]
      for (const p of route3Points) {
        await prisma.mtmRoutePoint.create({ data: { ...p, organizationId: orgId } })
      }
      console.log("MTM Routes: 3 (with 12 points)")

      // MtmVisit — 8 visits
      const mtmVisits = [
        { agentId: agent2.id, customerId: createdMtmCustomers[0].id, status: "CHECKED_OUT", checkInAt: new Date(now - 2.5 * 60 * 60000), checkOutAt: new Date(now - 2 * 60 * 60000), checkInLat: 52.1935, checkInLng: 21.0044, checkOutLat: 52.1936, checkOutLng: 21.0045, duration: 30, tasksCompleted: 2, tasksTotal: 2, notes: "Display check completed. Evidence captured." },
        { agentId: agent2.id, customerId: createdMtmCustomers[1].id, status: "CHECKED_OUT", checkInAt: new Date(now - 1.5 * 60 * 60000), checkOutAt: new Date(now - 1 * 60 * 60000), checkInLat: 52.2297, checkInLng: 21.0122, checkOutLat: 52.2298, checkOutLng: 21.0123, duration: 30, tasksCompleted: 1, tasksTotal: 2, notes: "New order placed. Promo materials distributed." },
        { agentId: agent2.id, customerId: createdMtmCustomers[2].id, status: "CHECKED_OUT", checkInAt: new Date(now - 26 * 60 * 60000), checkOutAt: new Date(now - 25.5 * 60 * 60000), checkInLat: 52.2319, checkInLng: 21.0198, checkOutLat: 52.2320, checkOutLng: 21.0199, duration: 30, tasksCompleted: 2, tasksTotal: 2, notes: "Quarterly review completed." },
        { agentId: agent2.id, customerId: createdMtmCustomers[3].id, status: "CHECKED_OUT", checkInAt: new Date(now - 25 * 60 * 60000), checkOutAt: new Date(now - 24.5 * 60 * 60000), checkInLat: 52.2325, checkInLng: 20.9858, checkOutLat: 52.2326, checkOutLng: 20.9859, duration: 30, tasksCompleted: 1, tasksTotal: 1, notes: "Stock audit completed." },
        { agentId: agent3.id, customerId: createdMtmCustomers[4].id, status: "CHECKED_OUT", checkInAt: new Date(now - 25 * 60 * 60000), checkOutAt: new Date(now - 24 * 60 * 60000), checkInLat: 52.1527, checkInLng: 21.0456, checkOutLat: 52.1528, checkOutLng: 21.0457, duration: 60, tasksCompleted: 3, tasksTotal: 3, notes: "Full merchandising check." },
        { agentId: agent3.id, customerId: createdMtmCustomers[5].id, status: "CHECKED_OUT", checkInAt: new Date(now - 23 * 60 * 60000), checkOutAt: new Date(now - 22.5 * 60 * 60000), checkInLat: 52.2133, checkInLng: 20.9645, checkOutLat: 52.2134, checkOutLng: 20.9646, duration: 30, tasksCompleted: 1, tasksTotal: 2, notes: "Initial prospect visit." },
        { agentId: agent2.id, customerId: createdMtmCustomers[0].id, status: "CHECKED_OUT", checkInAt: new Date(now - 50 * 60 * 60000), checkOutAt: new Date(now - 49 * 60 * 60000), checkInLat: 52.1936, checkInLng: 21.0045, checkOutLat: 52.1937, checkOutLng: 21.0046, duration: 60, tasksCompleted: 3, tasksTotal: 3, notes: "Monthly review with manager." },
        { agentId: agent3.id, customerId: createdMtmCustomers[1].id, status: "CHECKED_OUT", checkInAt: new Date(now - 48 * 60 * 60000), checkOutAt: new Date(now - 47.5 * 60 * 60000), checkInLat: 52.2298, checkInLng: 21.0123, checkOutLat: 52.2299, checkOutLng: 21.0124, duration: 30, tasksCompleted: 2, tasksTotal: 2, notes: "Promo display setup." },
      ]
      const createdVisits = []
      for (const v of mtmVisits) {
        const created = await prisma.mtmVisit.create({ data: { ...v, organizationId: orgId } })
        createdVisits.push(created)
      }
      console.log(`MTM Visits: ${mtmVisits.length}`)

      // MtmTask — 6 tasks
      const mtmTasks = [
        { agentId: agent2.id, customerId: createdMtmCustomers[0].id, visitId: createdVisits[0].id, title: "Verify visit evidence", description: "Confirm the required display evidence is captured", status: "COMPLETED", priority: "HIGH", completedAt: new Date(now - 2.2 * 60 * 60000), result: "Required evidence captured. Photo attached." },
        { agentId: agent2.id, customerId: createdMtmCustomers[0].id, visitId: createdVisits[0].id, title: "Collect restock order", description: "Get restocking order from pharmacy manager", status: "COMPLETED", priority: "MEDIUM", completedAt: new Date(now - 2.1 * 60 * 60000), result: "Order collected: 50 units Product A, 30 units Product B." },
        { agentId: agent2.id, customerId: createdMtmCustomers[1].id, visitId: createdVisits[1].id, title: "Distribute promo materials", description: "Hand out Q2 promotional brochures and point-of-sale materials", status: "COMPLETED", priority: "MEDIUM", completedAt: new Date(now - 1.2 * 60 * 60000), result: "Materials distributed. Manager requested extra point-of-sale materials." },
        { agentId: agent2.id, customerId: createdMtmCustomers[2].id, title: "Quarterly review meeting", description: "Conduct Q1 performance review with store manager", status: "PENDING", priority: "HIGH", dueDate: new Date(now + 2 * 60 * 60000) },
        { agentId: agent3.id, customerId: createdMtmCustomers[4].id, title: "Merchandising audit", description: "Full audit of product displays and competitor presence", status: "PENDING", priority: "MEDIUM", dueDate: new Date(now + DAY) },
        { agentId: agent3.id, customerId: createdMtmCustomers[5].id, title: "New customer onboarding", description: "Complete onboarding checklist for new prospect", status: "IN_PROGRESS", priority: "LOW", dueDate: new Date(now + 3 * DAY) },
      ]
      for (const t of mtmTasks) {
        await prisma.mtmTask.create({ data: { ...t, organizationId: orgId } })
      }
      console.log(`MTM Tasks: ${mtmTasks.length}`)

      // MtmPhoto — 4 photos
      const mtmPhotos = [
        { agentId: agent2.id, visitId: createdVisits[0].id, url: "/placeholder.jpg", thumbnailUrl: "/placeholder.jpg", category: "display", status: "APPROVED", hasWatermark: true, latitude: 52.1935, longitude: 21.0044, reviewedBy: agent1.id, reviewedAt: new Date(now - 1 * 60 * 60000), likes: 2 },
        { agentId: agent2.id, visitId: createdVisits[0].id, url: "/placeholder.jpg", thumbnailUrl: "/placeholder.jpg", category: "display", status: "APPROVED", hasWatermark: true, latitude: 52.1935, longitude: 21.0044, reviewedBy: agent1.id, reviewedAt: new Date(now - 1 * 60 * 60000), likes: 1 },
        { agentId: agent2.id, visitId: createdVisits[1].id, url: "/placeholder.jpg", thumbnailUrl: "/placeholder.jpg", category: "promo", status: "PENDING", hasWatermark: true, latitude: 52.2297, longitude: 21.0122 },
        { agentId: agent3.id, visitId: createdVisits[4].id, url: "/placeholder.jpg", thumbnailUrl: "/placeholder.jpg", category: "display", status: "PENDING", hasWatermark: true, latitude: 52.1527, longitude: 21.0456 },
      ]
      for (const p of mtmPhotos) {
        await prisma.mtmPhoto.create({ data: { ...p, organizationId: orgId } })
      }
      console.log(`MTM Photos: ${mtmPhotos.length}`)

      // MtmAlert — 3 alerts
      const mtmAlerts = [
        { agentId: agent2.id, type: "GPS_ANOMALY", category: "WARNING", title: "GPS signal jump detected", description: "Agent location jumped 2.3km in 30 seconds near Central Pharmacy Mokotow. Possible GPS drift.", metadata: { distance: 2300, timespan: 30, lat: 52.1935, lng: 21.0044 } },
        { agentId: agent3.id, type: "LATE_START", category: "WARNING", title: "Route started 45 minutes late", description: "South Warsaw route was scheduled for 09:00 but agent checked in at 09:45.", isResolved: true, resolvedAt: new Date(now - 20 * 60 * 60000), resolvedBy: agent1.id, metadata: { scheduledTime: "09:00", actualTime: "09:45", delayMinutes: 45 } },
        { agentId: agent3.id, type: "MISSED_VISIT", category: "CRITICAL", title: "Missed visit — Apteka Nowa", description: "Scheduled visit to Apteka Nowa was not completed. Customer flagged as prospect.", metadata: { customerId: createdMtmCustomers[5].id, scheduledDate: routeDate3.toISOString() } },
      ]
      for (const a of mtmAlerts) {
        await prisma.mtmAlert.create({ data: { ...a, organizationId: orgId } })
      }
      console.log(`MTM Alerts: ${mtmAlerts.length}`)

      // MtmSetting — 3 settings
      const mtmSettings = [
        { key: "geofence_radius", value: 200, description: "Geofence radius in meters for check-in validation" },
        { key: "check_in_required", value: true, description: "Require GPS check-in at customer location" },
        { key: "photo_required", value: true, description: "Require at least one photo per visit" },
      ]
      for (const s of mtmSettings) {
        await prisma.mtmSetting.create({ data: { ...s, organizationId: orgId } })
      }
      console.log(`MTM Settings: ${mtmSettings.length}`)

      // MtmNotification — 4 notifications
      const mtmNotifications = [
        { agentId: agent2.id, title: "New route assigned", body: "Your route 'Warsaw Central — Today' has been assigned. 4 stops planned.", type: "info", isRead: true, metadata: { routeId: route1.id } },
        { agentId: agent3.id, title: "New route assigned", body: "Your route 'South Warsaw' has been assigned. 4 stops planned.", type: "info", isRead: false, metadata: { routeId: route2.id } },
        { agentId: agent3.id, title: "Overdue task", body: "Task 'Merchandising audit' is approaching deadline.", type: "warning", isRead: false },
        { agentId: agent1.id, title: "GPS anomaly detected", body: "GPS anomaly detected for agent Alex Chen near Central Pharmacy.", type: "alert", isRead: false, metadata: { agentName: "Alex Chen" } },
      ]
      for (const n of mtmNotifications) {
        await prisma.mtmNotification.create({ data: { ...n, organizationId: orgId } })
      }
      console.log(`MTM Notifications: ${mtmNotifications.length}`)

    } else {
      console.log("MTM Module: (existing, skipped)")
    }
  } catch (e) { console.log(`MTM Module: ERROR — ${e.message}`) }

  // ─── 56. Pricing Module v2 (PricingGroup → Profile → Category → Service) ───
  try {
    const existingPG = await prisma.pricingGroup.findFirst({ where: { organizationId: orgId } })
    if (!existingPG) {
      // PricingGroups
      const groupA = await prisma.pricingGroup.create({ data: { organizationId: orgId, name: "Enterprise Clients", sortOrder: 0 } })
      const groupB = await prisma.pricingGroup.create({ data: { organizationId: orgId, name: "SMB Clients", sortOrder: 1 } })
      console.log("Pricing Groups: 2")

      // PricingCategories
      const catIT = await prisma.pricingCategory.create({ data: { organizationId: orgId, name: "IT Infrastructure", boardCategory: "permanent_it", sortOrder: 0 } })
      const catSec = await prisma.pricingCategory.create({ data: { organizationId: orgId, name: "Cybersecurity", boardCategory: "infosec", sortOrder: 1 } })
      const catCloud = await prisma.pricingCategory.create({ data: { organizationId: orgId, name: "Cloud Services", boardCategory: "cloud", sortOrder: 2 } })
      const catHelp = await prisma.pricingCategory.create({ data: { organizationId: orgId, name: "Help Desk", boardCategory: "helpdesk", sortOrder: 3 } })
      console.log("Pricing Categories: 4")

      // PricingProfiles — link to existing companies
      const profileCompanies = [
        { code: "PFIZER", companyIdx: 0, groupId: groupA.id, monthlyTotal: 28500, annualTotal: 342000 },
        { code: "ROCHE", companyIdx: 1, groupId: groupA.id, monthlyTotal: 35200, annualTotal: 422400 },
        { code: "NOVARTIS", companyIdx: 2, groupId: groupA.id, monthlyTotal: 22000, annualTotal: 264000 },
        { code: "BIOGENESIS", companyIdx: 5, groupId: groupB.id, monthlyTotal: 8500, annualTotal: 102000 },
        { code: "MEDTECH", companyIdx: 6, groupId: groupB.id, monthlyTotal: 6200, annualTotal: 74400 },
      ]
      const createdProfiles = []
      for (const p of profileCompanies) {
        const profile = await prisma.pricingProfile.create({
          data: { organizationId: orgId, companyCode: p.code, companyId: createdCompanies[p.companyIdx]?.id || null, groupId: p.groupId, monthlyTotal: p.monthlyTotal, annualTotal: p.annualTotal, isActive: true },
        })
        createdProfiles.push(profile)
      }
      console.log(`Pricing Profiles: ${createdProfiles.length}`)

      // PricingProfileCategory + PricingService for first 2 profiles
      const profileCategoryData = [
        { profileIdx: 0, categoryId: catIT.id, total: 12000, services: [
          { name: "Server Management", unit: "Per Server", qty: 15, price: 400, total: 6000 },
          { name: "Network Monitoring", unit: "Per Device", qty: 40, price: 75, total: 3000 },
          { name: "Backup & Recovery", unit: "Per TB", qty: 12, price: 250, total: 3000 },
        ]},
        { profileIdx: 0, categoryId: catSec.id, total: 8500, services: [
          { name: "SIEM Monitoring", unit: "Flat Rate", qty: 1, price: 4500, total: 4500 },
          { name: "Vulnerability Assessment", unit: "Per Quarter", qty: 1, price: 2000, total: 2000 },
          { name: "Endpoint Protection", unit: "Per Device", qty: 100, price: 20, total: 2000 },
        ]},
        { profileIdx: 0, categoryId: catCloud.id, total: 5000, services: [
          { name: "AWS Management", unit: "Flat Rate", qty: 1, price: 3500, total: 3500 },
          { name: "Cloud Migration Support", unit: "Per Hour", qty: 10, price: 150, total: 1500 },
        ]},
        { profileIdx: 0, categoryId: catHelp.id, total: 3000, services: [
          { name: "L1 Support (8x5)", unit: "Per User", qty: 200, price: 10, total: 2000 },
          { name: "L2 Support (8x5)", unit: "Per Incident", qty: 20, price: 50, total: 1000 },
        ]},
        { profileIdx: 1, categoryId: catIT.id, total: 15000, services: [
          { name: "Server Management", unit: "Per Server", qty: 25, price: 400, total: 10000 },
          { name: "Network Monitoring", unit: "Per Device", qty: 60, price: 75, total: 4500 },
          { name: "Patch Management", unit: "Per Server", qty: 25, price: 20, total: 500 },
        ]},
        { profileIdx: 1, categoryId: catSec.id, total: 12200, services: [
          { name: "SIEM Monitoring", unit: "Flat Rate", qty: 1, price: 6000, total: 6000 },
          { name: "SOC Operations", unit: "Flat Rate", qty: 1, price: 4200, total: 4200 },
          { name: "Endpoint Protection", unit: "Per Device", qty: 100, price: 20, total: 2000 },
        ]},
        { profileIdx: 3, categoryId: catIT.id, total: 4500, services: [
          { name: "Server Management", unit: "Per Server", qty: 5, price: 400, total: 2000 },
          { name: "Network Monitoring", unit: "Per Device", qty: 20, price: 75, total: 1500 },
          { name: "Backup & Recovery", unit: "Per TB", qty: 4, price: 250, total: 1000 },
        ]},
        { profileIdx: 3, categoryId: catHelp.id, total: 4000, services: [
          { name: "L1 Support (8x5)", unit: "Per User", qty: 50, price: 10, total: 500 },
          { name: "L2 Support (24x7)", unit: "Per Incident", qty: 30, price: 80, total: 2400 },
          { name: "On-site Support", unit: "Per Visit", qty: 4, price: 275, total: 1100 },
        ]},
      ]
      let pcCount = 0, svcCount = 0
      for (const pcd of profileCategoryData) {
        const pc = await prisma.pricingProfileCategory.create({
          data: { organizationId: orgId, profileId: createdProfiles[pcd.profileIdx].id, categoryId: pcd.categoryId, total: pcd.total },
        })
        pcCount++
        for (let i = 0; i < pcd.services.length; i++) {
          await prisma.pricingService.create({
            data: { ...pcd.services[i], organizationId: orgId, profileCategoryId: pc.id, sortOrder: i },
          })
          svcCount++
        }
      }
      console.log(`Pricing Profile Categories: ${pcCount}, Services: ${svcCount}`)

      // AdditionalSale — 3 one-off/recurring add-ons
      const additionalSales = [
        { profileId: createdProfiles[0].id, type: "one_time", name: "Active Directory Migration", description: "Full AD migration from on-prem to Azure AD", categoryName: "IT Infrastructure", unit: "Project", qty: 1, price: 15000, total: 15000, effectiveDate: new Date(now - 30 * DAY), status: "completed" },
        { profileId: createdProfiles[0].id, type: "recurring", name: "Extended SOC Hours (24x7)", description: "Upgrade from 8x5 to 24x7 SOC monitoring", categoryName: "Cybersecurity", unit: "Monthly", qty: 1, price: 3500, total: 3500, effectiveDate: new Date(now - 60 * DAY), status: "active" },
        { profileId: createdProfiles[1].id, type: "one_time", name: "Penetration Testing", description: "Annual external + internal penetration test", categoryName: "Cybersecurity", unit: "Project", qty: 1, price: 12000, total: 12000, effectiveDate: new Date(now + 15 * DAY), status: "active" },
      ]
      for (const as of additionalSales) {
        await prisma.additionalSale.create({ data: { ...as, organizationId: orgId, createdBy: user.id } })
      }
      console.log(`Additional Sales: ${additionalSales.length}`)
    } else {
      console.log("Pricing Module v2: (existing, skipped)")
    }
  } catch (e) { console.log(`Pricing Module v2: ERROR — ${e.message}`) }

  // ─── 57. Inbox — ChannelConfig + ChannelMessage + SocialConversation ───
  try {
    const existingCC = await prisma.channelConfig.findFirst({ where: { organizationId: orgId } })
    if (!existingCC) {
      // Channel configs
      const emailChannel = await prisma.channelConfig.create({
        data: { organizationId: orgId, channelType: "email", configName: "Support Email", settings: { inboxEmail: "support@company.com", signature: "Best regards,\nSupport Team" }, isActive: true, createdBy: user.id },
      })
      const whatsappChannel = await prisma.channelConfig.create({
        data: { organizationId: orgId, channelType: "whatsapp", configName: "WhatsApp Business", phoneNumber: "+48 500 100 200", settings: { businessName: "PharmaCare Support" }, isActive: true, createdBy: user.id },
      })
      const telegramChannel = await prisma.channelConfig.create({
        data: { organizationId: orgId, channelType: "telegram", configName: "Telegram Bot", settings: { botName: "PharmaCareBot" }, isActive: false, createdBy: user.id },
      })
      console.log("Channel Configs: 3")

      // Social conversations
      const conv1 = await prisma.socialConversation.create({
        data: { organizationId: orgId, channelConfigId: emailChannel.id, contactId: createdContacts[0]?.id || null, platform: "email", externalId: "conv-email-001", contactName: "Dr. James Mitchell", lastMessage: "I've sent a calendar invite with the Zoom link.", status: "open", lastMessageAt: new Date(now - 2 * 60 * 60000), unreadCount: 1, assignedTo: user.id },
      })
      const conv2 = await prisma.socialConversation.create({
        data: { organizationId: orgId, channelConfigId: whatsappChannel.id, contactId: createdContacts[5]?.id || null, platform: "whatsapp", externalId: "conv-wa-001", contactName: "Dr. Anna Schneider", lastMessage: "Thursday 10am works great!", status: "open", lastMessageAt: new Date(now - 30 * 60000), unreadCount: 2, assignedTo: user.id },
      })
      const conv3 = await prisma.socialConversation.create({
        data: { organizationId: orgId, channelConfigId: emailChannel.id, contactId: createdContacts[7]?.id || null, platform: "email", externalId: "conv-email-002", contactName: "Katarzyna Nowak", lastMessage: "Payment confirmed. Invoice marked as paid.", status: "resolved", lastMessageAt: new Date(now - 3 * DAY), unreadCount: 0 },
      })
      console.log("Social Conversations: 3")

      // Channel messages
      const messages = [
        { channelConfigId: emailChannel.id, direction: "inbound", channelType: "email", contactId: createdContacts[0]?.id, from: "j.mitchell@pfizer.com", to: "support@company.com", subject: "Question about CRM integration timeline", body: "Hi team,\n\nCould you provide an updated timeline for the CRM integration project? We need to align with our Q3 planning.", status: "read", conversationId: conv1.id, createdAt: new Date(now - 5 * 60 * 60000) },
        { channelConfigId: emailChannel.id, direction: "outbound", channelType: "email", contactId: createdContacts[0]?.id, from: "support@company.com", to: "j.mitchell@pfizer.com", subject: "Re: Question about CRM integration timeline", body: "Dear Dr. Mitchell,\n\nThank you for reaching out. The integration is on track for completion by end of Q2. I'll send a detailed Gantt chart by Friday.", status: "delivered", conversationId: conv1.id, createdAt: new Date(now - 4 * 60 * 60000) },
        { channelConfigId: emailChannel.id, direction: "inbound", channelType: "email", contactId: createdContacts[0]?.id, from: "j.mitchell@pfizer.com", to: "support@company.com", subject: "Re: Question about CRM integration timeline", body: "Perfect, looking forward to the Gantt chart. Also, can we schedule a call next week to discuss the data migration phase?", status: "read", conversationId: conv1.id, createdAt: new Date(now - 3 * 60 * 60000) },
        { channelConfigId: emailChannel.id, direction: "outbound", channelType: "email", contactId: createdContacts[0]?.id, from: "support@company.com", to: "j.mitchell@pfizer.com", subject: "Re: Question about CRM integration timeline", body: "Absolutely! I've sent a calendar invite for Tuesday at 2pm EST. We'll cover data migration, API endpoints, and testing schedule.", status: "delivered", conversationId: conv1.id, createdAt: new Date(now - 2 * 60 * 60000) },
        { channelConfigId: whatsappChannel.id, direction: "inbound", channelType: "whatsapp", contactId: createdContacts[5]?.id, from: "+49 30 555 1300", to: "+48 500 100 200", body: "Hello! Dr. Anna Schneider from BioGenesis Labs. We spoke at the Basel conference last month about your LIMS solution.", status: "read", conversationId: conv2.id, messageType: "text", createdAt: new Date(now - 2 * 60 * 60000) },
        { channelConfigId: whatsappChannel.id, direction: "outbound", channelType: "whatsapp", contactId: createdContacts[5]?.id, from: "+48 500 100 200", to: "+49 30 555 1300", body: "Hello Dr. Schneider! Great to hear from you. Yes, I remember our conversation. Would you like to schedule a demo?", status: "delivered", conversationId: conv2.id, messageType: "text", createdAt: new Date(now - 1.5 * 60 * 60000) },
        { channelConfigId: whatsappChannel.id, direction: "inbound", channelType: "whatsapp", contactId: createdContacts[5]?.id, from: "+49 30 555 1300", to: "+48 500 100 200", body: "Yes please! We're evaluating solutions for our Berlin and Munich labs. Can we do a 1-hour demo this week?", status: "read", conversationId: conv2.id, messageType: "text", createdAt: new Date(now - 1 * 60 * 60000) },
        { channelConfigId: whatsappChannel.id, direction: "outbound", channelType: "whatsapp", contactId: createdContacts[5]?.id, from: "+48 500 100 200", to: "+49 30 555 1300", body: "I have Thursday 10am CET or Friday 2pm CET available. Which works better for you?", status: "delivered", conversationId: conv2.id, messageType: "text", createdAt: new Date(now - 45 * 60000) },
        { channelConfigId: whatsappChannel.id, direction: "inbound", channelType: "whatsapp", contactId: createdContacts[5]?.id, from: "+49 30 555 1300", to: "+48 500 100 200", body: "Thursday 10am works great. I'll have our lab director join as well.", status: "read", conversationId: conv2.id, messageType: "text", createdAt: new Date(now - 30 * 60000) },
        { channelConfigId: whatsappChannel.id, direction: "outbound", channelType: "whatsapp", contactId: createdContacts[5]?.id, from: "+48 500 100 200", to: "+49 30 555 1300", body: "Excellent! I'll send a calendar invite with the Zoom link. Looking forward to it! 🎯", status: "delivered", conversationId: conv2.id, messageType: "text", createdAt: new Date(now - 25 * 60000) },
        { channelConfigId: emailChannel.id, direction: "inbound", channelType: "email", contactId: createdContacts[7]?.id, from: "k.nowak@pharmacare-dist.eu", to: "support@company.com", subject: "Invoice #INV-2026-004 payment confirmation", body: "Please find attached the payment confirmation for invoice INV-2026-004. Bank transfer was initiated today.", status: "read", conversationId: conv3.id, createdAt: new Date(now - 4 * DAY) },
        { channelConfigId: emailChannel.id, direction: "outbound", channelType: "email", contactId: createdContacts[7]?.id, from: "support@company.com", to: "k.nowak@pharmacare-dist.eu", subject: "Re: Invoice #INV-2026-004 payment confirmation", body: "Thank you, Katarzyna. We've received and confirmed the payment. The invoice has been marked as paid in our system.", status: "delivered", conversationId: conv3.id, createdAt: new Date(now - 3.5 * DAY) },
      ]
      for (const m of messages) {
        await prisma.channelMessage.create({ data: { ...m, organizationId: orgId } })
      }
      console.log(`Channel Messages: ${messages.length}`)
    } else {
      console.log("Inbox Module: (existing, skipped)")
    }
  } catch (e) { console.log(`Inbox Module: ERROR — ${e.message}`) }

  // ─── 58. ProjectMember + FundRule ───
  try {
    const existingPM = await prisma.projectMember.findFirst({ where: { project: { organizationId: orgId } } })
    if (!existingPM) {
      const orgProjects = await prisma.project.findMany({ where: { organizationId: orgId }, take: 3 })
      const teamUsers = await prisma.user.findMany({ where: { organizationId: orgId }, take: 4 })
      if (orgProjects.length > 0 && teamUsers.length > 1) {
        for (const proj of orgProjects) {
          for (let i = 1; i < Math.min(teamUsers.length, 3); i++) {
            try {
              await prisma.projectMember.create({
                data: { organizationId: orgId, projectId: proj.id, userId: teamUsers[i].id, role: i === 1 ? "lead" : "member" },
              })
            } catch (_) { /* unique constraint — skip */ }
          }
        }
        console.log("Project Members: linked")
      } else {
        console.log("Project Members: (no projects/users, skipped)")
      }
    } else {
      console.log("Project Members: (existing, skipped)")
    }

    // FundRule
    const existingFR = await prisma.fundRule.findFirst({ where: { organizationId: orgId } })
    if (!existingFR) {
      const orgFunds = await prisma.fund.findMany({ where: { organizationId: orgId }, take: 2 })
      if (orgFunds.length >= 2) {
        await prisma.fundRule.create({
          data: { organizationId: orgId, fundId: orgFunds[0].id, name: "Auto-allocate 10% to reserves", triggerType: "revenue_percentage", percentage: 0.10, isActive: true },
        })
        console.log("Fund Rules: 1")
      }
    } else {
      console.log("Fund Rules: (existing, skipped)")
    }
  } catch (e) { console.log(`ProjectMember/FundRule: ERROR — ${e.message}`) }

  // ─── 59. AuditLog ───
  try {
    const existingAL = await prisma.auditLog.findFirst({ where: { organizationId: orgId } })
    if (!existingAL) {
      const auditLogs = [
        { userId: user.id, action: "login", entityType: "user", entityName: user.name, ipAddress: "185.45.12.88", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        { userId: user.id, action: "create", entityType: "company", entityName: "Pfizer Inc.", newValue: { name: "Pfizer Inc.", industry: "Pharmaceuticals" } },
        { userId: user.id, action: "create", entityType: "deal", entityName: "Pfizer CRM Integration", newValue: { valueAmount: 285000, stage: "NEGOTIATION" } },
        { userId: user.id, action: "update", entityType: "deal", entityName: "Novartis Procurement Platform", oldValue: { stage: "PROPOSAL" }, newValue: { stage: "WON" } },
        { userId: user.id, action: "create", entityType: "invoice", entityName: "INV-2026-001", newValue: { total: 48750, status: "sent" } },
        { userId: user.id, action: "update", entityType: "ticket", entityName: "TK-001", oldValue: { status: "new" }, newValue: { status: "in_progress" } },
        { userId: user.id, action: "export", entityType: "report", entityName: "Q1 Sales Summary", newValue: { format: "csv", rows: 156 } },
        { userId: user.id, action: "delete", entityType: "lead", entityName: "Spam Lead", oldValue: { contactName: "Test", source: "unknown" } },
        { userId: user.id, action: "login", entityType: "user", entityName: user.name, ipAddress: "91.108.22.15", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", createdAt: new Date(now - DAY) },
        { userId: user.id, action: "update", entityType: "organization", entityName: "Settings", oldValue: { timezone: "UTC" }, newValue: { timezone: "Europe/Warsaw" } },
      ]
      for (const a of auditLogs) {
        await prisma.auditLog.create({ data: { ...a, organizationId: orgId } })
      }
      console.log(`Audit Logs: ${auditLogs.length}`)
    } else {
      console.log("Audit Logs: (existing, skipped)")
    }
  } catch (e) { console.log(`Audit Logs: ERROR — ${e.message}`) }

  // ─── 60. CustomFieldValue ───
  try {
    const existingCFV = await prisma.customFieldValue.findFirst({ where: { organizationId: orgId } })
    if (!existingCFV) {
      const customFields = await prisma.customField.findMany({ where: { organizationId: orgId } })
      const orgDeals = await prisma.deal.findMany({ where: { organizationId: orgId }, take: 5 })
      const orgCompanies = await prisma.company.findMany({ where: { organizationId: orgId }, take: 5 })
      const orgContacts = await prisma.contact.findMany({ where: { organizationId: orgId }, take: 3 })
      let cfvCount = 0
      for (const cf of customFields) {
        let entities = []
        let values = []
        if (cf.entityType === "deal" && cf.fieldName === "deal_source_channel") {
          entities = orgDeals; values = ["Direct", "Partner", "Online", "Referral", "Direct"]
        } else if (cf.entityType === "company" && cf.fieldName === "company_tier") {
          entities = orgCompanies; values = ["Platinum", "Gold", "Silver", "Bronze", "Gold"]
        } else if (cf.entityType === "contact" && cf.fieldName === "preferred_language") {
          entities = orgContacts; values = ["English", "German", "French"]
        }
        for (let i = 0; i < Math.min(entities.length, values.length); i++) {
          try {
            await prisma.customFieldValue.create({
              data: { organizationId: orgId, fieldId: cf.id, entityId: entities[i].id, value: values[i] },
            })
            cfvCount++
          } catch (_) { /* unique constraint */ }
        }
      }
      console.log(`Custom Field Values: ${cfvCount}`)
    } else {
      console.log("Custom Field Values: (existing, skipped)")
    }
  } catch (e) { console.log(`Custom Field Values: ERROR — ${e.message}`) }

  // ─── 61. CurrencyRateHistory ───
  try {
    const existingCRH = await prisma.currencyRateHistory.findFirst({ where: { organizationId: orgId } })
    if (!existingCRH) {
      const rates = [
        { currencyCode: "EUR", rate: 0.92, rateDate: new Date(now - 30 * DAY) },
        { currencyCode: "EUR", rate: 0.91, rateDate: new Date(now - 20 * DAY) },
        { currencyCode: "EUR", rate: 0.93, rateDate: new Date(now - 10 * DAY) },
        { currencyCode: "EUR", rate: 0.92, rateDate: new Date() },
        { currencyCode: "GBP", rate: 0.79, rateDate: new Date(now - 30 * DAY) },
        { currencyCode: "GBP", rate: 0.78, rateDate: new Date(now - 15 * DAY) },
        { currencyCode: "GBP", rate: 0.80, rateDate: new Date() },
        { currencyCode: "PLN", rate: 4.05, rateDate: new Date(now - 30 * DAY) },
        { currencyCode: "PLN", rate: 4.12, rateDate: new Date(now - 15 * DAY) },
        { currencyCode: "PLN", rate: 4.08, rateDate: new Date() },
      ]
      for (const r of rates) {
        await prisma.currencyRateHistory.create({ data: { ...r, organizationId: orgId } })
      }
      console.log(`Currency Rate History: ${rates.length}`)
    } else {
      console.log("Currency Rate History: (existing, skipped)")
    }
  } catch (e) { console.log(`Currency Rate History: ERROR — ${e.message}`) }

  // ─── 62. StageValidationRule ───
  try {
    const existingSVR = await prisma.stageValidationRule.findFirst({ where: { organizationId: orgId } })
    if (!existingSVR) {
      const orgStages = await prisma.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } })
      if (orgStages.length >= 4) {
        const rules = [
          { pipelineStageId: orgStages[2]?.id, fieldName: "valueAmount", ruleType: "min_value", ruleValue: "1000", errorMessage: "Deal value must be at least $1,000 before moving to Proposal stage" },
          { pipelineStageId: orgStages[2]?.id, fieldName: "contactId", ruleType: "required", errorMessage: "A primary contact must be assigned before moving to Proposal" },
          { pipelineStageId: orgStages[3]?.id, fieldName: "expectedClose", ruleType: "required", errorMessage: "Expected close date is required for Negotiation stage" },
          { pipelineStageId: orgStages[4]?.id, fieldName: "valueAmount", ruleType: "min_value", ruleValue: "0", errorMessage: "Final deal value must be set before marking as Won" },
        ]
        for (const r of rules) {
          if (r.pipelineStageId) {
            await prisma.stageValidationRule.create({ data: { ...r, organizationId: orgId } })
          }
        }
        console.log(`Stage Validation Rules: ${rules.length}`)
      }
    } else {
      console.log("Stage Validation Rules: (existing, skipped)")
    }
  } catch (e) { console.log(`Stage Validation Rules: ERROR — ${e.message}`) }

  // ─── 63. CostModelLog ───
  try {
    const existingCML = await prisma.costModelLog.findFirst({ where: { organizationId: orgId } })
    if (!existingCML) {
      const logs = [
        { tableName: "overhead_costs", action: "insert", newValue: { category: "Facilities", label: "Office Rent", amount: 4200 }, changedBy: user.id, createdAt: new Date(now - 5 * DAY) },
        { tableName: "cost_employees", action: "insert", newValue: { department: "IT", position: "Senior Engineer", netSalary: 6500 }, changedBy: user.id, createdAt: new Date(now - 4 * DAY) },
        { tableName: "pricing_parameters", action: "update", oldValue: { vatRate: 0.20 }, newValue: { vatRate: 0.18 }, changedBy: user.id, createdAt: new Date(now - 3 * DAY) },
        { tableName: "overhead_costs", action: "update", oldValue: { amount: 8000 }, newValue: { amount: 8450 }, changedBy: user.id, createdAt: new Date(now - 2 * DAY) },
        { tableName: "client_services", action: "insert", newValue: { serviceType: "permanent_it", monthlyRevenue: 12000 }, changedBy: user.id, createdAt: new Date(now - DAY) },
      ]
      for (const l of logs) {
        await prisma.costModelLog.create({ data: { ...l, organizationId: orgId } })
      }
      console.log(`Cost Model Logs: ${logs.length}`)
    } else {
      console.log("Cost Model Logs: (existing, skipped)")
    }
  } catch (e) { console.log(`Cost Model Logs: ERROR — ${e.message}`) }

  // ─── 64. BudgetChangeLog ───
  try {
    const existingBCL = await prisma.budgetChangeLog.findFirst({ where: { organizationId: orgId } })
    if (!existingBCL) {
      const plan = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId } })
      if (plan) {
        const budgetLines = await prisma.budgetLine.findMany({ where: { organizationId: orgId, planId: plan.id }, take: 3 })
        const changeLogs = [
          { planId: plan.id, entityType: "line", entityId: budgetLines[0]?.id || "unknown", action: "create", field: null, newValue: { category: "Personnel", amount: 45000 }, userId: user.id, createdAt: new Date(now - 7 * DAY) },
          { planId: plan.id, entityType: "line", entityId: budgetLines[0]?.id || "unknown", action: "update", field: "amount", oldValue: 45000, newValue: 48000, userId: user.id, createdAt: new Date(now - 5 * DAY) },
          { planId: plan.id, entityType: "actual", entityId: "act-1", action: "create", field: null, newValue: { category: "Cloud", actualAmount: 8200 }, userId: user.id, createdAt: new Date(now - 3 * DAY) },
          { planId: plan.id, entityType: "line", entityId: budgetLines[1]?.id || "unknown", action: "update", field: "amount", oldValue: 8500, newValue: 9200, userId: user.id, createdAt: new Date(now - 2 * DAY) },
          { planId: plan.id, entityType: "forecast", entityId: "fc-1", action: "create", field: null, newValue: { month: 4, forecastAmount: 52000 }, userId: user.id, createdAt: new Date(now - DAY) },
        ]
        for (const cl of changeLogs) {
          await prisma.budgetChangeLog.create({ data: { ...cl, organizationId: orgId } })
        }
        console.log(`Budget Change Logs: ${changeLogs.length}`)
      }
    } else {
      console.log("Budget Change Logs: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Change Logs: ERROR — ${e.message}`) }

  // ─── 65. BudgetForecastEntry ───
  try {
    const existingBFE = await prisma.budgetForecastEntry.findFirst({ where: { organizationId: orgId } })
    if (!existingBFE) {
      const plan = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId } })
      const costTypes = await prisma.budgetCostType.findMany({ where: { organizationId: orgId }, take: 3 })
      const depts = await prisma.budgetDepartment.findMany({ where: { organizationId: orgId }, take: 2 })
      if (plan && costTypes.length > 0) {
        const forecasts = [
          { planId: plan.id, month: 4, year: 2026, category: "Personnel", lineType: "expense", forecastAmount: 52000, costTypeId: costTypes[0]?.id, departmentId: depts[0]?.id },
          { planId: plan.id, month: 5, year: 2026, category: "Personnel", lineType: "expense", forecastAmount: 53000, costTypeId: costTypes[0]?.id, departmentId: depts[0]?.id },
          { planId: plan.id, month: 6, year: 2026, category: "Personnel", lineType: "expense", forecastAmount: 54000, costTypeId: costTypes[0]?.id, departmentId: depts[0]?.id },
          { planId: plan.id, month: 4, year: 2026, category: "Cloud Infrastructure", lineType: "expense", forecastAmount: 9500, costTypeId: costTypes.length > 2 ? costTypes[2]?.id : null, departmentId: depts[0]?.id },
          { planId: plan.id, month: 5, year: 2026, category: "Cloud Infrastructure", lineType: "expense", forecastAmount: 9800, costTypeId: costTypes.length > 2 ? costTypes[2]?.id : null, departmentId: depts[0]?.id },
          { planId: plan.id, month: 4, year: 2026, category: "Revenue — IT Services", lineType: "revenue", forecastAmount: 125000, departmentId: depts[0]?.id },
          { planId: plan.id, month: 5, year: 2026, category: "Revenue — IT Services", lineType: "revenue", forecastAmount: 128000, departmentId: depts[0]?.id },
          { planId: plan.id, month: 6, year: 2026, category: "Revenue — IT Services", lineType: "revenue", forecastAmount: 132000, departmentId: depts[0]?.id },
        ]
        for (const f of forecasts) {
          const data = { ...f, organizationId: orgId }
          if (!data.costTypeId) delete data.costTypeId
          if (!data.departmentId) delete data.departmentId
          try {
            await prisma.budgetForecastEntry.create({ data })
          } catch (_) { /* unique constraint */ }
        }
        console.log(`Budget Forecast Entries: ${forecasts.length}`)
      }
    } else {
      console.log("Budget Forecast Entries: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Forecast Entries: ERROR — ${e.message}`) }

  // ─── 66. BudgetDirectionTemplate ───
  try {
    const existingBDT = await prisma.budgetDirectionTemplate.findFirst({ where: { organizationId: orgId } })
    if (!existingBDT) {
      const costTypes = await prisma.budgetCostType.findMany({ where: { organizationId: orgId }, take: 3 })
      const depts = await prisma.budgetDepartment.findMany({ where: { organizationId: orgId }, take: 2 })
      const templates = [
        { name: "IT Infrastructure Revenue", lineType: "revenue", lineSubtype: "service", defaultAmount: 120000, costModelKey: "permanent_it", departmentId: depts[0]?.id, sortOrder: 0 },
        { name: "Cybersecurity Revenue", lineType: "revenue", lineSubtype: "service", defaultAmount: 85000, costModelKey: "infosec", departmentId: depts.length > 1 ? depts[1]?.id : null, sortOrder: 1 },
        { name: "Personnel Costs", lineType: "expense", defaultAmount: 48000, costTypeId: costTypes[0]?.id, sortOrder: 2 },
        { name: "Cloud & Software", lineType: "expense", defaultAmount: 8500, costTypeId: costTypes.length > 2 ? costTypes[2]?.id : null, sortOrder: 3 },
        { name: "Office & Administration", lineType: "expense", defaultAmount: 6000, costTypeId: costTypes.length > 1 ? costTypes[1]?.id : null, sortOrder: 4 },
      ]
      for (const t of templates) {
        const data = { ...t, organizationId: orgId }
        if (!data.costTypeId) delete data.costTypeId
        if (!data.departmentId) delete data.departmentId
        await prisma.budgetDirectionTemplate.create({ data })
      }
      console.log(`Budget Direction Templates: ${templates.length}`)
    } else {
      console.log("Budget Direction Templates: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Direction Templates: ERROR — ${e.message}`) }

  // ─── 67. BudgetDepartmentOwner ───
  try {
    const existingBDO = await prisma.budgetDepartmentOwner.findFirst({ where: { organizationId: orgId } })
    if (!existingBDO) {
      const depts = await prisma.budgetDepartment.findMany({ where: { organizationId: orgId } })
      const teamUsers = await prisma.user.findMany({ where: { organizationId: orgId }, take: 4 })
      if (depts.length > 0 && teamUsers.length > 1) {
        let bdoCount = 0
        for (const dept of depts) {
          try {
            await prisma.budgetDepartmentOwner.create({
              data: { organizationId: orgId, departmentId: dept.id, userId: user.id, canEdit: true, canApprove: true },
            })
            bdoCount++
          } catch (_) { /* unique constraint */ }
          if (teamUsers.length > 1) {
            try {
              await prisma.budgetDepartmentOwner.create({
                data: { organizationId: orgId, departmentId: dept.id, userId: teamUsers[1].id, canEdit: true, canApprove: false },
              })
              bdoCount++
            } catch (_) { /* unique constraint */ }
          }
        }
        console.log(`Budget Department Owners: ${bdoCount}`)
      }
    } else {
      console.log("Budget Department Owners: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Department Owners: ERROR — ${e.message}`) }

  // ─── 68. BudgetApprovalComment ───
  try {
    const existingBAC = await prisma.budgetApprovalComment.findFirst({ where: { organizationId: orgId } })
    if (!existingBAC) {
      const plan = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId } })
      if (plan) {
        const comments = [
          { planId: plan.id, userId: user.id, userName: user.name, status: "submitted", comment: "Q2 2026 budget submitted for review. Key changes: +15% personnel costs due to 3 new hires, cloud costs stable.", createdAt: new Date(now - 5 * DAY) },
          { planId: plan.id, userId: user.id, userName: "Sarah Johnson", status: "review", comment: "Reviewed revenue projections. Pfizer and Roche deals should close in Q2, supporting the 8% growth target.", createdAt: new Date(now - 4 * DAY) },
          { planId: plan.id, userId: user.id, userName: user.name, status: "comment", comment: "Updated cloud costs to reflect new AWS Reserved Instance pricing. Saving ~12% vs on-demand.", createdAt: new Date(now - 3 * DAY) },
          { planId: plan.id, userId: user.id, userName: user.name, status: "approved", comment: "Budget approved. Monitor cloud spend closely — we're near the reserved capacity limit.", createdAt: new Date(now - 2 * DAY) },
        ]
        for (const c of comments) {
          await prisma.budgetApprovalComment.create({ data: { ...c, organizationId: orgId } })
        }
        console.log(`Budget Approval Comments: ${comments.length}`)
      }
    } else {
      console.log("Budget Approval Comments: (existing, skipped)")
    }
  } catch (e) { console.log(`Budget Approval Comments: ERROR — ${e.message}`) }

  // ─── 69. RollingForecastMonth ───
  try {
    const existingRFM = await prisma.rollingForecastMonth.findFirst({ where: { organizationId: orgId } })
    if (!existingRFM) {
      const plan = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId } })
      if (plan) {
        const months = [
          { planId: plan.id, year: 2026, month: 1, status: "actual", lockedAt: new Date(now - 75 * DAY) },
          { planId: plan.id, year: 2026, month: 2, status: "actual", lockedAt: new Date(now - 45 * DAY) },
          { planId: plan.id, year: 2026, month: 3, status: "actual", lockedAt: new Date(now - 15 * DAY) },
          { planId: plan.id, year: 2026, month: 4, status: "forecast" },
          { planId: plan.id, year: 2026, month: 5, status: "forecast" },
          { planId: plan.id, year: 2026, month: 6, status: "forecast" },
          { planId: plan.id, year: 2026, month: 7, status: "forecast" },
          { planId: plan.id, year: 2026, month: 8, status: "forecast" },
          { planId: plan.id, year: 2026, month: 9, status: "forecast" },
          { planId: plan.id, year: 2026, month: 10, status: "forecast" },
          { planId: plan.id, year: 2026, month: 11, status: "forecast" },
          { planId: plan.id, year: 2026, month: 12, status: "forecast" },
        ]
        for (const m of months) {
          try {
            await prisma.rollingForecastMonth.create({ data: { ...m, organizationId: orgId } })
          } catch (_) { /* unique constraint */ }
        }
        console.log(`Rolling Forecast Months: ${months.length}`)
      }
    } else {
      console.log("Rolling Forecast Months: (existing, skipped)")
    }
  } catch (e) { console.log(`Rolling Forecast Months: ERROR — ${e.message}`) }

  // ─── 70. JourneyEnrollment ───
  try {
    const existingJE = await prisma.journeyEnrollment.findFirst({ where: { organizationId: orgId } })
    if (!existingJE) {
      const journeys = await prisma.journey.findMany({ where: { organizationId: orgId }, include: { steps: true } })
      if (journeys.length > 0 && createdContacts.length > 0) {
        const enrollments = [
          { journeyId: journeys[0].id, contactId: createdContacts[0]?.id, currentStepId: journeys[0].steps[1]?.id, status: "active", enrolledAt: new Date(now - 10 * DAY), nextActionAt: new Date(now + 2 * DAY) },
          { journeyId: journeys[0].id, contactId: createdContacts[1]?.id, currentStepId: journeys[0].steps[0]?.id, status: "active", enrolledAt: new Date(now - 5 * DAY), nextActionAt: new Date(now + DAY) },
          { journeyId: journeys[0].id, contactId: createdContacts[2]?.id, status: "completed", enrolledAt: new Date(now - 30 * DAY), completedAt: new Date(now - 5 * DAY), exitReason: "completed" },
          { journeyId: journeys[0].id, contactId: createdContacts[4]?.id, status: "completed", enrolledAt: new Date(now - 25 * DAY), completedAt: new Date(now - 8 * DAY), goalReachedAt: new Date(now - 8 * DAY), exitReason: "goal_reached" },
        ]
        if (journeys.length > 1) {
          enrollments.push({ journeyId: journeys[1].id, contactId: createdContacts[5]?.id, currentStepId: journeys[1].steps[0]?.id, status: "active", enrolledAt: new Date(now - 3 * DAY), nextActionAt: new Date(now + 4 * DAY) })
          enrollments.push({ journeyId: journeys[1].id, contactId: createdContacts[7]?.id, status: "active", enrolledAt: new Date(now - 2 * DAY), nextActionAt: new Date(now + 5 * DAY) })
        }
        for (const e of enrollments) {
          if (e.contactId) {
            await prisma.journeyEnrollment.create({ data: { ...e, organizationId: orgId } })
          }
        }
        console.log(`Journey Enrollments: ${enrollments.length}`)
      }
    } else {
      console.log("Journey Enrollments: (existing, skipped)")
    }
  } catch (e) { console.log(`Journey Enrollments: ERROR — ${e.message}`) }

  // ─── 71. SharingRule ───
  try {
    const existingSR = await prisma.sharingRule.findFirst({ where: { organizationId: orgId } })
    if (!existingSR) {
      const sharingRules = [
        { entityType: "deal", name: "Sales team sees all deals", ruleType: "role", sourceRole: "member", targetRole: "member", accessLevel: "read" },
        { entityType: "deal", name: "Managers edit all deals", ruleType: "role", sourceRole: "member", targetRole: "manager", accessLevel: "readwrite" },
        { entityType: "contact", name: "All contacts visible to team", ruleType: "all", accessLevel: "read" },
        { entityType: "company", name: "Company data shared across team", ruleType: "all", accessLevel: "read" },
      ]
      for (const sr of sharingRules) {
        await prisma.sharingRule.create({ data: { ...sr, organizationId: orgId } })
      }
      console.log(`Sharing Rules: ${sharingRules.length}`)
    } else {
      console.log("Sharing Rules: (existing, skipped)")
    }
  } catch (e) { console.log(`Sharing Rules: ERROR — ${e.message}`) }

  // ─── 72. PaymentRegistryEntry ───
  try {
    const existingPRE = await prisma.paymentRegistryEntry.findFirst({ where: { organizationId: orgId } })
    if (!existingPRE) {
      const invPayments = await prisma.invoicePayment.findMany({ where: { organizationId: orgId }, take: 3, include: { invoice: true } })
      const billPayments = await prisma.billPayment.findMany({ where: { organizationId: orgId }, take: 2, include: { bill: true } })
      const entries = []
      for (const ip of invPayments) {
        entries.push({
          direction: "incoming", amount: ip.amount, currency: "USD",
          counterpartyName: "Client", counterpartyId: ip.invoice?.companyId,
          sourceType: "invoice_payment", sourceId: ip.id, invoiceId: ip.invoiceId,
          category: "revenue", paymentDate: ip.paymentDate, description: `Payment for invoice`,
          createdBy: user.id,
        })
      }
      for (const bp of billPayments) {
        entries.push({
          direction: "outgoing", amount: bp.amount, currency: "USD",
          counterpartyName: "Vendor",
          sourceType: "bill_payment", sourceId: bp.id, billId: bp.billId,
          category: "vendor_payment", paymentDate: bp.paymentDate, description: `Payment for bill`,
          createdBy: user.id,
        })
      }
      for (const e of entries) {
        await prisma.paymentRegistryEntry.create({ data: { ...e, organizationId: orgId } })
      }
      console.log(`Payment Registry Entries: ${entries.length}`)
    } else {
      console.log("Payment Registry Entries: (existing, skipped)")
    }
  } catch (e) { console.log(`Payment Registry Entries: ERROR — ${e.message}`) }

  // ─── 73. CashFlowAlert ───
  try {
    const existingCFA = await prisma.cashFlowAlert.findFirst({ where: { organizationId: orgId } })
    if (!existingCFA) {
      const alerts = [
        { year: 2026, month: 3, alertType: "large_outflow", message: "Large outflow detected: Q1 insurance payment ($24,000) exceeds monthly average by 340%", threshold: 10000, projectedBalance: 185000 },
        { year: 2026, month: 5, alertType: "low_balance", message: "Projected cash balance dropping below $50K safety threshold in May if Pfizer payment delayed", threshold: 50000, projectedBalance: 42000 },
        { year: 2026, month: 7, alertType: "negative_balance", message: "Risk of negative balance in July — 3 large vendor payments scheduled before Q3 invoices collected", threshold: 0, projectedBalance: -15000, isResolved: true },
      ]
      for (const a of alerts) {
        await prisma.cashFlowAlert.create({ data: { ...a, organizationId: orgId } })
      }
      console.log(`Cash Flow Alerts: ${alerts.length}`)
    } else {
      console.log("Cash Flow Alerts: (existing, skipped)")
    }
  } catch (e) { console.log(`Cash Flow Alerts: ERROR — ${e.message}`) }

  // ─── 74. AiAlert ───
  try {
    const existingAiA = await prisma.aiAlert.findFirst({ where: { organizationId: orgId } })
    if (!existingAiA) {
      const aiAlerts = [
        { type: "token_spike", severity: "warning", message: "Token usage spike: 45K tokens consumed in last hour (3x average). Check for recursive agent loops.", metadata: { tokensUsed: 45000, avgHourly: 15000 }, createdAt: new Date(now - 2 * DAY) },
        { type: "high_latency", severity: "info", message: "Average AI response time increased to 4.2s (threshold: 3s). Anthropic API may be under load.", metadata: { avgLatency: 4200, threshold: 3000 }, createdAt: new Date(now - DAY) },
        { type: "error", severity: "critical", message: "AI agent 'Sales Copilot' failed 5 consecutive requests. Auto-disabled. Check API key and rate limits.", metadata: { agentName: "Sales Copilot", consecutiveErrors: 5 }, isRead: true, createdAt: new Date(now - 3 * DAY) },
        { type: "anomaly", severity: "warning", message: "Unusual pattern: 12 identical queries from same session in 2 minutes. Possible automation loop.", metadata: { sessionId: "sess_demo_001", queryCount: 12, timeSpan: 120 }, createdAt: new Date(now - 12 * 60 * 60000) },
      ]
      for (const a of aiAlerts) {
        await prisma.aiAlert.create({ data: { ...a, organizationId: orgId } })
      }
      console.log(`AI Alerts: ${aiAlerts.length}`)
    } else {
      console.log("AI Alerts: (existing, skipped)")
    }
  } catch (e) { console.log(`AI Alerts: ERROR — ${e.message}`) }

  // ─── 75. AiInteractionLog ───
  try {
    const existingAIL = await prisma.aiInteractionLog.findFirst({ where: { organizationId: orgId } })
    if (!existingAIL) {
      const aiConfigs = await prisma.aiAgentConfig.findMany({ where: { organizationId: orgId }, take: 2 })
      const interactions = [
        { userMessage: "Summarize the Pfizer deal status", aiResponse: "The Pfizer CRM Integration deal ($285K) is in Negotiation stage with 75% probability. Expected close in 45 days.", latencyMs: 1850, promptTokens: 420, completionTokens: 85, costUsd: 0.0042, model: "claude-haiku-4-5-20251001", toolsCalled: ["deal_lookup"], agentConfigId: aiConfigs[0]?.id, agentType: "sales_copilot", createdAt: new Date(now - 2 * DAY) },
        { userMessage: "What tickets are overdue?", aiResponse: "2 tickets are approaching SLA breach: TK-003 (Invoice PDF generation, 4h remaining) and TK-005 (API rate limiting, 2h remaining).", latencyMs: 2100, promptTokens: 380, completionTokens: 120, costUsd: 0.0051, model: "claude-haiku-4-5-20251001", toolsCalled: ["ticket_search", "sla_check"], agentConfigId: aiConfigs[0]?.id, agentType: "support_agent", createdAt: new Date(now - DAY) },
        { userMessage: "Generate Q1 revenue report", aiResponse: "Q1 2026 Revenue: $385K (actual) vs $350K (budget) = +10% overperformance. Top contributors: Merck ($410K closed), Novartis ($195K closed).", latencyMs: 3200, promptTokens: 850, completionTokens: 200, costUsd: 0.0098, model: "claude-sonnet-4-20250514", toolsCalled: ["report_builder", "deal_analytics"], agentConfigId: aiConfigs[1]?.id, agentType: "analyst", isCopilot: true, createdAt: new Date(now - 3 * DAY) },
        { userMessage: "Draft email to Dr. Mitchell about project timeline", aiResponse: "Subject: CRM Integration — Updated Timeline\\n\\nDear Dr. Mitchell,\\n\\nI wanted to share the updated project timeline...", latencyMs: 2800, promptTokens: 520, completionTokens: 350, costUsd: 0.0075, model: "claude-sonnet-4-20250514", toolsCalled: ["contact_lookup", "email_draft"], agentConfigId: aiConfigs[0]?.id, agentType: "sales_copilot", createdAt: new Date(now - 12 * 60 * 60000) },
        { userMessage: "Analyze churn risk for BioGenesis Labs", aiResponse: "Low churn risk (Score: 22/100). Strong engagement: 3 active deals, 95% CSAT, regular communication. Renewal in 4 months.", latencyMs: 1500, promptTokens: 300, completionTokens: 90, costUsd: 0.0035, model: "claude-haiku-4-5-20251001", toolsCalled: ["company_analytics"], agentConfigId: aiConfigs[0]?.id, agentType: "analyst", createdAt: new Date(now - 6 * 60 * 60000) },
      ]
      for (const i of interactions) {
        await prisma.aiInteractionLog.create({ data: { ...i, organizationId: orgId } })
      }
      console.log(`AI Interaction Logs: ${interactions.length}`)
    } else {
      console.log("AI Interaction Logs: (existing, skipped)")
    }
  } catch (e) { console.log(`AI Interaction Logs: ERROR — ${e.message}`) }

  // ─── 76. AiGuardrail ───
  try {
    const existingAG = await prisma.aiGuardrail.findFirst({ where: { organizationId: orgId } })
    if (!existingAG) {
      const guardrails = [
        { ruleName: "No PII in responses", ruleType: "filter", description: "Prevent AI from including personal identifiable information (SSN, passport numbers) in responses", promptInjection: "Never include Social Security numbers, passport numbers, or other PII in your responses." },
        { ruleName: "No competitor pricing", ruleType: "restriction", description: "Prevent AI from sharing internal competitor pricing analysis externally", promptInjection: "Do not share competitor pricing or internal competitive analysis in customer-facing responses." },
        { ruleName: "Financial data validation", ruleType: "validation", description: "Ensure AI-generated financial figures are cross-referenced with actual database values", promptInjection: "Always verify financial figures against the database before presenting them. Flag any discrepancies." },
        { ruleName: "Language compliance", ruleType: "filter", description: "Ensure all AI responses maintain professional language standards", promptInjection: "Maintain professional business language. Avoid informal slang, humor about sensitive topics, or speculative statements about company performance." },
      ]
      for (const g of guardrails) {
        await prisma.aiGuardrail.create({ data: { ...g, organizationId: orgId } })
      }
      console.log(`AI Guardrails: ${guardrails.length}`)
    } else {
      console.log("AI Guardrails: (existing, skipped)")
    }
  } catch (e) { console.log(`AI Guardrails: ERROR — ${e.message}`) }

  // ─── 77. MtmAuditLog ───
  try {
    const existingMAL = await prisma.mtmAuditLog.findFirst({ where: { organizationId: orgId } })
    if (!existingMAL) {
      const mtmAgents = await prisma.mtmAgent.findMany({ where: { organizationId: orgId }, take: 3 })
      if (mtmAgents.length > 0) {
        const mtmLogs = [
          { agentId: mtmAgents[0]?.id, action: "login", entity: "agent", entityId: mtmAgents[0]?.id, newData: { platform: "mobile_app", version: "2.1.0" }, ipAddress: "185.45.12.90", userAgent: "LeadDrive-MTM/2.1.0 (Android 14)" },
          { agentId: mtmAgents[1]?.id, action: "check_in", entity: "visit", newData: { customerId: "PH-001", lat: 52.1935, lng: 21.0044 }, ipAddress: "91.108.22.33" },
          { agentId: mtmAgents[1]?.id, action: "create_order", entity: "order", newData: { orderNumber: "MTM-ORD-001", totalAmount: 1192 }, ipAddress: "91.108.22.33" },
          { agentId: mtmAgents[1]?.id, action: "upload_photo", entity: "photo", newData: { category: "display", status: "pending" }, ipAddress: "91.108.22.33" },
          { agentId: mtmAgents[2]?.id, action: "check_in", entity: "visit", newData: { customerId: "PH-004", lat: 52.1527, lng: 21.0456 }, ipAddress: "78.90.11.22" },
          { agentId: mtmAgents[0]?.id, action: "resolve_alert", entity: "alert", oldData: { isResolved: false }, newData: { isResolved: true, resolvedBy: mtmAgents[0]?.id }, ipAddress: "185.45.12.90" },
          { agentId: mtmAgents[1]?.id, action: "complete_task", entity: "task", newData: { title: "Verify visit evidence", result: "Required evidence captured" }, ipAddress: "91.108.22.33" },
          { agentId: mtmAgents[2]?.id, action: "check_out", entity: "visit", newData: { duration: 30, tasksCompleted: 1, tasksTotal: 2 }, ipAddress: "78.90.11.22" },
        ]
        for (const l of mtmLogs) {
          await prisma.mtmAuditLog.create({ data: { ...l, organizationId: orgId } })
        }
        console.log(`MTM Audit Logs: ${mtmLogs.length}`)
      }
    } else {
      console.log("MTM Audit Logs: (existing, skipped)")
    }
  } catch (e) { console.log(`MTM Audit Logs: ERROR — ${e.message}`) }

  // ─── 78. AccountingIntegration ───
  try {
    const existingAI = await prisma.accountingIntegration.findFirst({ where: { organizationId: orgId } })
    if (!existingAI) {
      await prisma.accountingIntegration.create({
        data: {
          organizationId: orgId, provider: "csv", name: "CSV Import (Manual)",
          config: { dateFormat: "YYYY-MM-DD", delimiter: ",", encoding: "UTF-8" },
          categoryMapping: { "Salaries": "labor", "Cloud": "cloud", "Rent": "overhead_admin", "Software": "software" },
          isActive: true, lastSyncAt: new Date(now - 3 * DAY), lastSyncStatus: "success",
        },
      })
      await prisma.accountingIntegration.create({
        data: {
          organizationId: orgId, provider: "1c", name: "1C Enterprise (Planned)",
          config: { endpoint: "https://1c.company.local/api", syncInterval: "daily" },
          categoryMapping: {},
          isActive: false,
        },
      })
      console.log("Accounting Integrations: 2")
    } else {
      console.log("Accounting Integrations: (existing, skipped)")
    }
  } catch (e) { console.log(`Accounting Integrations: ERROR — ${e.message}`) }

  // ─── 79. Webhook ───
  try {
    const webhooks = [
      { url: "https://hooks.slack.com/services/T00000/B00000/XXXXXXXXX", events: ["deal.won", "deal.lost"] },
      { url: "https://api.company.com/webhooks/crm", events: ["contact.created", "company.created", "deal.created"] },
      { url: "https://zapier.com/hooks/catch/123456/abcdef", events: ["ticket.created", "ticket.resolved"] },
      { url: "https://n8n.internal.company.com/webhook/crm-sync", events: ["invoice.paid", "invoice.overdue"] },
    ]
    for (const webhook of webhooks) {
      const existing = await prisma.webhook.findMany({
        where: { organizationId: orgId, url: webhook.url },
        select: { id: true },
      })
      if (existing.length === 0) {
        await prisma.webhook.create({
          data: {
            ...webhook,
            organizationId: orgId,
            secret: `whsec_${randomBytes(32).toString("base64url")}`,
            isActive: false,
            provenance: "generic",
          },
        })
        continue
      }
      for (const row of existing) {
        await prisma.webhook.update({
          where: { id: row.id },
          data: {
            events: webhook.events,
            secret: `whsec_${randomBytes(32).toString("base64url")}`,
            isActive: false,
            provenance: "generic",
          },
        })
      }
    }
    console.log(`Webhooks: ${webhooks.length} inactive demo endpoints (secrets rotated)`)
  } catch (e) {
    throw new Error(`Webhooks: failed to create or secure demo endpoints — ${e.message}`)
  }

  // ─── 80. CustomDomain ───
  try {
    const existingDomain = await prisma.customDomain.findFirst({ where: { organizationId: orgId } })
    if (!existingDomain) {
      await prisma.customDomain.create({
        data: {
          organizationId: orgId, domain: `crm.${slug}-demo.com`,
          status: "dns_verified", dnsVerifiedAt: new Date(now - 10 * DAY),
          lastCheckedAt: new Date(now - 1 * DAY),
        },
      })
      await prisma.customDomain.create({
        data: {
          organizationId: orgId, domain: `portal.${slug}-demo.com`,
          status: "pending", lastCheckedAt: new Date(now - 2 * DAY),
          errorMessage: `CNAME record not found. Please add: portal.${slug}-demo.com CNAME leaddrivecrm.org`,
        },
      })
      console.log("Custom Domains: 2")
    } else {
      console.log("Custom Domains: (existing, skipped)")
    }
  } catch (e) { console.log(`Custom Domains: ERROR — ${e.message}`) }

  // ─── 81. ContractFile ───
  try {
    const existingFile = await prisma.contractFile.findFirst({ where: { organizationId: orgId } })
    if (!existingFile) {
      const contract = await prisma.contract.findFirst({ where: { organizationId: orgId } })
      if (contract) {
        const files = [
          { contractId: contract.id, fileName: "ctr-2026-001-signed.pdf", originalName: "Pfizer_CRM_Agreement_Signed.pdf", fileSize: 2458000, mimeType: "application/pdf", uploadedBy: user.id },
          { contractId: contract.id, fileName: "ctr-2026-001-appendix-a.pdf", originalName: "Appendix_A_SLA_Terms.pdf", fileSize: 845000, mimeType: "application/pdf", uploadedBy: user.id },
          { contractId: contract.id, fileName: "ctr-2026-001-nda.pdf", originalName: "NDA_Pfizer_LeadDrive.pdf", fileSize: 312000, mimeType: "application/pdf", uploadedBy: user.id },
        ]
        for (const f of files) {
          await prisma.contractFile.create({ data: { ...f, organizationId: orgId } })
        }
        console.log(`Contract Files: ${files.length}`)
      } else {
        console.log("Contract Files: (no contracts found, skipped)")
      }
    } else {
      console.log("Contract Files: (existing, skipped)")
    }
  } catch (e) { console.log(`Contract Files: ERROR — ${e.message}`) }

  // ─── 82. AccountingImport ───
  try {
    const existingImport = await prisma.accountingImport.findFirst({ where: { organizationId: orgId } })
    if (!existingImport) {
      const budgetPlan = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId } })
      const accIntegration = await prisma.accountingIntegration.findFirst({ where: { organizationId: orgId, isActive: true } })
      if (budgetPlan) {
        const imports = [
          { planId: budgetPlan.id, integrationId: accIntegration?.id || null, fileName: "q1_2026_actuals.csv", importType: "csv", status: "completed", totalRows: 156, matchedRows: 148, unmatchedRows: 8, errors: { unmatchedCategories: ["Office Renovation", "Team Retreat"] }, createdAt: new Date(now - 30 * DAY) },
          { planId: budgetPlan.id, integrationId: accIntegration?.id || null, fileName: "february_payroll.csv", importType: "csv", status: "completed", totalRows: 42, matchedRows: 42, unmatchedRows: 0, errors: null, createdAt: new Date(now - 45 * DAY) },
          { planId: budgetPlan.id, integrationId: null, fileName: "march_expenses.csv", importType: "csv", status: "failed", totalRows: 0, matchedRows: 0, unmatchedRows: 0, errors: { message: "Invalid CSV format: missing header row" }, createdAt: new Date(now - 15 * DAY) },
          { planId: budgetPlan.id, integrationId: accIntegration?.id || null, importType: "api_sync", status: "completed", totalRows: 89, matchedRows: 85, unmatchedRows: 4, errors: null, createdAt: new Date(now - 7 * DAY) },
        ]
        for (const imp of imports) {
          await prisma.accountingImport.create({ data: { ...imp, organizationId: orgId } })
        }
        console.log(`Accounting Imports: ${imports.length}`)
      } else {
        console.log("Accounting Imports: (no budget plan found, skipped)")
      }
    } else {
      console.log("Accounting Imports: (existing, skipped)")
    }
  } catch (e) { console.log(`Accounting Imports: ERROR — ${e.message}`) }

  // ─── 83. PlanRequest ───
  try {
    const existingReq = await prisma.planRequest.findFirst({ where: { organizationId: orgId } })
    if (!existingReq) {
      await prisma.planRequest.create({
        data: {
          organizationId: orgId, requestedPlan: "enterprise",
          contactName: "Rashad Rahimov", contactEmail: "admin@zeytunpharm.com",
          contactPhone: "+48 500 123 456",
          message: "We need enterprise features: SSO, custom roles, API access, and dedicated support. Currently on professional plan.",
          status: "pending", createdAt: new Date(now - 3 * DAY),
        },
      })
      await prisma.planRequest.create({
        data: {
          organizationId: orgId, requestedPlan: "professional",
          contactName: "Sarah Johnson", contactEmail: "sarah@zeytunpharm.com",
          message: "Requesting upgrade from starter to professional for additional users and reporting.",
          status: "approved", createdAt: new Date(now - 30 * DAY),
        },
      })
      console.log("Plan Requests: 2")
    } else {
      console.log("Plan Requests: (existing, skipped)")
    }
  } catch (e) { console.log(`Plan Requests: ERROR — ${e.message}`) }

  // ─── 84. ApiKey ───
  try {
    const existingKey = await prisma.apiKey.findFirst({ where: { organizationId: orgId } })
    if (!existingKey) {
      await prisma.apiKey.create({
        data: {
          organizationId: orgId, name: "Mobile App Integration",
          keyHash: "sha256_demo_hash_not_real_key_1234567890abcdef",
          keyPrefix: "ld_mob_8f",
          scopes: ["read:contacts", "read:companies", "read:deals", "write:activities"],
          isActive: true, createdBy: user.id,
        },
      })
      await prisma.apiKey.create({
        data: {
          organizationId: orgId, name: "Zapier Automation",
          keyHash: "sha256_demo_hash_not_real_key_abcdef1234567890",
          keyPrefix: "ld_zap_3a",
          scopes: ["read:contacts", "write:contacts", "read:deals", "write:deals", "read:tickets"],
          isActive: true, createdBy: user.id,
          lastUsedAt: new Date(now - 2 * 60 * 60000),
        },
      })
      await prisma.apiKey.create({
        data: {
          organizationId: orgId, name: "Legacy ERP Sync (deprecated)",
          keyHash: "sha256_demo_hash_not_real_key_deprecated_old",
          keyPrefix: "ld_erp_c1",
          scopes: ["read:companies"],
          isActive: false, createdBy: user.id,
          expiresAt: new Date(now - 60 * DAY),
        },
      })
      console.log("API Keys: 3")
    } else {
      console.log("API Keys: (existing, skipped)")
    }
  } catch (e) { console.log(`API Keys: ERROR — ${e.message}`) }

  // ─── 85. AiChatSession + AiChatMessage ───
  try {
    const existingSession = await prisma.aiChatSession.findFirst({ where: { organizationId: orgId } })
    if (!existingSession) {
      const session1 = await prisma.aiChatSession.create({
        data: {
          organizationId: orgId, messagesCount: 4, status: "active",
          createdAt: new Date(now - 2 * 60 * 60000),
        },
      })
      const session1Messages = [
        { sessionId: session1.id, role: "user", content: "What are our top 5 deals by value this quarter?", tokenCount: 18, createdAt: new Date(now - 2 * 60 * 60000) },
        { sessionId: session1.id, role: "assistant", content: "Based on your current pipeline, here are the top 5 deals by value:\n\n1. Roche Digital Transformation — €520,000 (Negotiation)\n2. Merck Lab Management — $410,000 (Proposal)\n3. Pfizer CRM Implementation — $285,000 (Won)\n4. AstraZeneca Analytics — $180,000 (Discovery)\n5. GSK QA Platform — £145,000 (Qualification)\n\nTotal pipeline value: $1.54M. The Roche deal has the highest value and is in negotiation stage.", tokenCount: 156, createdAt: new Date(now - 2 * 60 * 60000 + 5000) },
        { sessionId: session1.id, role: "user", content: "Which deals are at risk of missing their close date?", tokenCount: 14, createdAt: new Date(now - 1.5 * 60 * 60000) },
        { sessionId: session1.id, role: "assistant", content: "I identified 2 deals at risk:\n\n1. **EuroMed Supply Chain** — Close date was 2 weeks ago, still in Proposal stage. Recommend: schedule urgent follow-up.\n2. **BioGenesis LIMS** — Close date is in 5 days, still in Discovery. Very unlikely to close on time.\n\nSuggestion: Move EuroMed to 'Stalled' and extend BioGenesis close date by 30 days.", tokenCount: 132, createdAt: new Date(now - 1.5 * 60 * 60000 + 5000) },
      ]
      for (const m of session1Messages) {
        await prisma.aiChatMessage.create({ data: m })
      }

      const session2 = await prisma.aiChatSession.create({
        data: {
          organizationId: orgId, messagesCount: 2, status: "closed",
          createdAt: new Date(now - 3 * DAY),
        },
      })
      const session2Messages = [
        { sessionId: session2.id, role: "user", content: "Summarize ticket SLA compliance for last month", tokenCount: 12, createdAt: new Date(now - 3 * DAY) },
        { sessionId: session2.id, role: "assistant", content: "SLA Compliance Report — March 2026:\n\n• Total tickets: 47\n• Resolved within SLA: 41 (87.2%)\n• SLA breached: 6 (12.8%)\n• Average resolution time: 4.2 hours\n• Worst category: 'Integration Issues' — 3 breaches\n\nOverall compliance is above the 85% target. Main area for improvement is integration-related tickets.", tokenCount: 118, createdAt: new Date(now - 3 * DAY + 5000) },
      ]
      for (const m of session2Messages) {
        await prisma.aiChatMessage.create({ data: m })
      }
      console.log("AI Chat Sessions: 2, Messages: 6")
    } else {
      console.log("AI Chat Sessions: (existing, skipped)")
    }
  } catch (e) { console.log(`AI Chat Sessions: ERROR — ${e.message}`) }

  // ─── 86. Social Monitoring (SocialAccount + SocialMention) ───
  try {
    const existingSocAcc = await prisma.socialAccount.findFirst({ where: { organizationId: orgId } })
    if (!existingSocAcc) {
      const accounts = [
        { platform: "twitter", handle: "@leaddrivecrm", displayName: "LeadDrive CRM", isActive: true, keywords: ["LeadDrive", "clinical suite", "pharma CRM"], lastPolledAt: new Date(now - 10 * 60000) },
        { platform: "instagram", handle: "@leaddrive_official", displayName: "LeadDrive Inc.", isActive: true, keywords: ["leaddrive", "#pharmaCRM"], lastPolledAt: new Date(now - 25 * 60000) },
        { platform: "facebook", handle: "LeadDrive.CRM", displayName: "LeadDrive CRM (FB Page)", isActive: true, keywords: ["LeadDrive", "Clinical Suite 3.0"], lastPolledAt: new Date(now - 40 * 60000) },
        { platform: "telegram", handle: "@leaddrive_news", displayName: "LeadDrive News Channel", isActive: true, keywords: ["leaddrive"], lastPolledAt: new Date(now - 3 * 60 * 60000) },
        { platform: "youtube", handle: "@LeadDriveCRM", displayName: "LeadDrive (YouTube)", isActive: false, keywords: ["leaddrive review", "pharma crm demo"] },
      ]
      const createdSocAccounts = []
      for (const a of accounts) {
        const created = await prisma.socialAccount.create({ data: { ...a, organizationId: orgId } })
        createdSocAccounts.push(created)
      }
      console.log(`Social Accounts: ${accounts.length}`)

      const mentions = [
        { accountIdx: 0, platform: "twitter", externalId: "tw-mention-001", authorName: "Dr. Julia Rivera", authorHandle: "@juliarivera_md", authorAvatar: null, text: "Just migrated our trial data to @leaddrivecrm — the GxP audit trail is a lifesaver. 🙌 Best onboarding team we've worked with.", url: "https://twitter.com/juliarivera_md/status/001", sentiment: "positive", matchedTerm: "@leaddrivecrm", reach: 4200, engagement: 186, status: "replied", handledBy: user.id, handledAt: new Date(now - 2 * 60 * 60000), publishedAt: new Date(now - 4 * 60 * 60000) },
        { accountIdx: 0, platform: "twitter", externalId: "tw-mention-002", authorName: "Mark Chen", authorHandle: "@markchen_pm", authorAvatar: null, text: "Looking at LeadDrive vs Veeva for our clinical ops. Anyone with real-world experience? Need GxP + FDA 21 CFR Part 11.", url: "https://twitter.com/markchen_pm/status/002", sentiment: "neutral", matchedTerm: "LeadDrive", reach: 1850, engagement: 42, status: "new", publishedAt: new Date(now - 8 * 60 * 60000) },
        { accountIdx: 0, platform: "twitter", externalId: "tw-mention-003", authorName: "Anna K.", authorHandle: "@anna_pharma", authorAvatar: null, text: "Second week of using LeadDrive and login keeps failing on Safari. Support took 4 hours to respond. Not impressed.", url: "https://twitter.com/anna_pharma/status/003", sentiment: "negative", matchedTerm: "LeadDrive", reach: 720, engagement: 28, status: "converted_to_ticket", ticketId: null, handledBy: user.id, handledAt: new Date(now - 1 * 60 * 60000), publishedAt: new Date(now - 3 * 60 * 60000) },
        { accountIdx: 1, platform: "instagram", externalId: "ig-mention-001", authorName: "bio_labs_inc", authorHandle: "@bio_labs_inc", authorAvatar: null, text: "Shoutout to @leaddrive_official for the smooth LIMS integration. Our lab staff love the new dashboard! #pharmaCRM", url: "https://instagram.com/p/XYZ001", sentiment: "positive", matchedTerm: "@leaddrive_official", reach: 12400, engagement: 890, status: "reviewed", handledBy: user.id, handledAt: new Date(now - 6 * 60 * 60000), publishedAt: new Date(now - 12 * 60 * 60000) },
        { accountIdx: 1, platform: "instagram", externalId: "ig-mention-002", authorName: "pharma_insider", authorHandle: "@pharma_insider", authorAvatar: null, text: "Spotted at #BioConnect2026 — the LeadDrive booth was packed. Their AI-powered deal scoring demo drew a crowd.", url: "https://instagram.com/p/XYZ002", sentiment: "positive", matchedTerm: "LeadDrive", reach: 8900, engagement: 412, status: "new", publishedAt: new Date(now - DAY) },
        { accountIdx: 2, platform: "facebook", externalId: "fb-mention-001", authorName: "Hans Weber", authorHandle: "hans.weber.99", authorAvatar: null, text: "Clinical Suite 3.0 looks promising but pricing is way too high for small biotech. Considering competitors.", url: "https://facebook.com/leaddrive.crm/posts/001", sentiment: "negative", matchedTerm: "Clinical Suite 3.0", reach: 450, engagement: 18, status: "converted_to_lead", leadId: null, handledBy: user.id, handledAt: new Date(now - 30 * 60000), publishedAt: new Date(now - 2 * 60 * 60000) },
        { accountIdx: 2, platform: "facebook", externalId: "fb-mention-002", authorName: "Sofia Martinez", authorHandle: "sofia.m.pharma", authorAvatar: null, text: "Congrats to @LeadDrive.CRM on the Series B raise! Well-deserved after building such a polished product.", url: "https://facebook.com/leaddrive.crm/posts/002", sentiment: "positive", matchedTerm: "LeadDrive", reach: 2200, engagement: 140, status: "reviewed", handledBy: user.id, handledAt: new Date(now - 5 * 60 * 60000), publishedAt: new Date(now - 10 * 60 * 60000) },
        { accountIdx: 3, platform: "telegram", externalId: "tg-mention-001", authorName: "Pharma Tech News", authorHandle: "@pharmatech_news", authorAvatar: null, text: "Новый релиз LeadDrive Clinical Suite 3.0 — встроенный AI-ассистент для отслеживания SLA и авто-эскалации тикетов. Смотреть демо 👉 bit.ly/xyz", url: "https://t.me/pharmatech_news/123", sentiment: "neutral", matchedTerm: "leaddrive", reach: 14500, engagement: 320, status: "ignored", publishedAt: new Date(now - 18 * 60 * 60000) },
        { accountIdx: 3, platform: "telegram", externalId: "tg-mention-002", authorName: "Медицинский маркетинг", authorHandle: "@medmarketing_ru", authorAvatar: null, text: "Используем LeadDrive уже 3 месяца — сквозная аналитика от лида до оплаты действительно работает. Рекомендую.", url: "https://t.me/medmarketing_ru/456", sentiment: "positive", matchedTerm: "LeadDrive", reach: 6800, engagement: 215, status: "reviewed", handledBy: user.id, handledAt: new Date(now - 4 * 60 * 60000), publishedAt: new Date(now - 20 * 60 * 60000) },
        { accountIdx: 0, platform: "twitter", externalId: "tw-mention-004", authorName: "Competitor Watch", authorHandle: "@crmwatch", authorAvatar: null, text: "CRM shootout: Salesforce Health Cloud vs Veeva vs LeadDrive. LeadDrive punches above its weight on price/features.", url: "https://twitter.com/crmwatch/status/004", sentiment: "positive", matchedTerm: "LeadDrive", reach: 3400, engagement: 98, status: "converted_to_task", taskId: null, handledBy: user.id, handledAt: new Date(now - 2 * DAY), publishedAt: new Date(now - 2.5 * DAY) },
        { accountIdx: 1, platform: "instagram", externalId: "ig-mention-003", authorName: "startup_lens", authorHandle: "@startup_lens", authorAvatar: null, text: "Poland's pharma tech scene is heating up. Warsaw-based LeadDrive just hit $2M ARR. 🇵🇱🚀", url: "https://instagram.com/p/XYZ003", sentiment: "positive", matchedTerm: "LeadDrive", reach: 5600, engagement: 340, status: "new", publishedAt: new Date(now - 6 * 60 * 60000) },
        { accountIdx: 2, platform: "facebook", externalId: "fb-mention-003", authorName: "Regulatory Rants", authorHandle: "reg.rants", authorAvatar: null, text: "Another pharma CRM claiming 21 CFR Part 11 compliance without showing actual FDA submissions. Prove it LeadDrive.", url: "https://facebook.com/groups/reg/posts/001", sentiment: "negative", matchedTerm: "LeadDrive", reach: 880, engagement: 56, status: "new", publishedAt: new Date(now - 14 * 60 * 60000) },
      ]
      for (const m of mentions) {
        const { accountIdx, ...data } = m
        await prisma.socialMention.create({ data: { ...data, organizationId: orgId, accountId: createdSocAccounts[accountIdx]?.id || null } })
      }
      console.log(`Social Mentions: ${mentions.length} (5 positive, 4 neutral, 3 negative)`)
    } else {
      console.log("Social Monitoring: (existing, skipped)")
    }
  } catch (e) { console.log(`Social Monitoring: ERROR — ${e.message}`) }

  // ─── 87. Surveys + SurveyResponse + SurveyUnsubscribe ───
  try {
    const existingSurvey = await prisma.survey.findFirst({ where: { organizationId: orgId } })
    if (!existingSurvey) {
      const surveysData = [
        {
          name: "Post-Resolution NPS",
          description: "Sent automatically after every ticket is resolved. Measures overall satisfaction with support experience.",
          type: "nps",
          status: "active",
          publicSlug: `nps-support-${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          thankYouText: "Thanks for your feedback! It helps us improve.",
          questions: [
            { id: "q1", type: "nps", label: "How likely are you to recommend our support to a colleague?" },
            { id: "q2", type: "text", label: "What's the main reason for your score?" },
          ],
          triggers: { afterTicketResolve: true, afterInvoicePaid: false },
          channels: ["email"],
          totalSent: 142,
          totalResponses: 48,
          responses: [
            { score: 10, category: "promoter", comment: "Incredible response time. Resolved my SSO issue in under an hour — way beyond expectations.", commentSentiment: "positive", channel: "email", contactIdx: 0, daysAgo: 2 },
            { score: 9, category: "promoter", comment: "Very helpful team. They walked me through the fix step by step.", commentSentiment: "positive", channel: "email", contactIdx: 1, daysAgo: 3 },
            { score: 10, category: "promoter", comment: "Best support I've dealt with in pharma SaaS. Period.", commentSentiment: "positive", channel: "email", contactIdx: 4, daysAgo: 5 },
            { score: 9, category: "promoter", comment: "Fast, knowledgeable. The GxP documentation they sent was exactly what I needed.", commentSentiment: "positive", channel: "email", contactIdx: 8, daysAgo: 6 },
            { score: 8, category: "passive", comment: "Good but took two back-and-forths to get the right person.", commentSentiment: "neutral", channel: "email", contactIdx: 2, daysAgo: 4 },
            { score: 7, category: "passive", comment: "Eventually resolved. Initial ticket got lost in their queue for a day.", commentSentiment: "neutral", channel: "email", contactIdx: 6, daysAgo: 7 },
            { score: 8, category: "passive", comment: "Solved my issue. Docs could be clearer though.", commentSentiment: "neutral", channel: "email", contactIdx: 11, daysAgo: 8 },
            { score: 4, category: "detractor", comment: "Waited 3 days for a reply to a critical issue. Unacceptable for enterprise SLA.", commentSentiment: "negative", channel: "email", contactIdx: 3, daysAgo: 5 },
            { score: 3, category: "detractor", comment: "Support agent didn't understand GxP at all. Had to escalate 3 times.", commentSentiment: "negative", channel: "email", contactIdx: 7, daysAgo: 9 },
            { score: 6, category: "passive", comment: null, commentSentiment: null, channel: "email", contactIdx: 5, daysAgo: 10 },
            { score: 10, category: "promoter", comment: "Perfect.", commentSentiment: "positive", channel: "email", contactIdx: 10, daysAgo: 12 },
            { score: 9, category: "promoter", comment: null, commentSentiment: null, channel: "email", contactIdx: 12, daysAgo: 14 },
          ],
        },
        {
          name: "Onboarding CSAT (first 30 days)",
          description: "Sent 30 days after initial deployment to measure onboarding experience.",
          type: "csat",
          status: "active",
          publicSlug: `csat-onboarding-${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          thankYouText: "Thank you! We read every response.",
          questions: [
            { id: "q1", type: "rating", label: "How satisfied are you with the onboarding process?", options: { max: 5 } },
            { id: "q2", type: "choice", label: "What was most valuable?", options: ["Kickoff workshop", "Data migration", "Training sessions", "Documentation", "Dedicated CSM"] },
            { id: "q3", type: "text", label: "Anything we could have done better?" },
          ],
          triggers: {},
          channels: ["email", "link"],
          totalSent: 24,
          totalResponses: 11,
          responses: [
            { score: 5, category: null, comment: "Dedicated CSM made all the difference.", commentSentiment: "positive", channel: "email", contactIdx: 0, daysAgo: 15, answers: { q1: 5, q2: "Dedicated CSM", q3: "Dedicated CSM made all the difference." } },
            { score: 5, category: null, comment: "Smooth data migration. Zero downtime.", commentSentiment: "positive", channel: "email", contactIdx: 4, daysAgo: 18, answers: { q1: 5, q2: "Data migration", q3: "Smooth data migration. Zero downtime." } },
            { score: 4, category: null, comment: "Training could use more pharma-specific examples.", commentSentiment: "neutral", channel: "link", contactIdx: 5, daysAgo: 12, answers: { q1: 4, q2: "Kickoff workshop", q3: "Training could use more pharma-specific examples." } },
            { score: 5, category: null, comment: "Kickoff workshop was excellent.", commentSentiment: "positive", channel: "email", contactIdx: 8, daysAgo: 20, answers: { q1: 5, q2: "Kickoff workshop", q3: "Kickoff workshop was excellent." } },
            { score: 3, category: null, comment: "Documentation is scattered. Hard to find things.", commentSentiment: "negative", channel: "email", contactIdx: 10, daysAgo: 22, answers: { q1: 3, q2: "Dedicated CSM", q3: "Documentation is scattered. Hard to find things." } },
            { score: 4, category: null, comment: null, commentSentiment: null, channel: "email", contactIdx: 1, daysAgo: 25, answers: { q1: 4, q2: "Data migration" } },
            { score: 5, category: null, comment: "Perfect experience.", commentSentiment: "positive", channel: "link", contactIdx: 2, daysAgo: 28, answers: { q1: 5, q2: "Dedicated CSM", q3: "Perfect experience." } },
          ],
        },
        {
          name: "Q1 2026 Customer Pulse",
          description: "Short pulse survey — quarterly health check.",
          type: "ces",
          status: "paused",
          publicSlug: `pulse-q1-${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          thankYouText: "Appreciated!",
          questions: [
            { id: "q1", type: "rating", label: "How easy is LeadDrive to use day-to-day?", options: { max: 7 } },
          ],
          triggers: {},
          channels: ["email"],
          totalSent: 68,
          totalResponses: 22,
          responses: [
            { score: 6, category: null, comment: "Mostly easy. Budget module has a learning curve.", commentSentiment: "neutral", channel: "email", contactIdx: 0, daysAgo: 45, answers: { q1: 6 } },
            { score: 7, category: null, comment: "Best pharma CRM I've used.", commentSentiment: "positive", channel: "email", contactIdx: 4, daysAgo: 42, answers: { q1: 7 } },
            { score: 5, category: null, comment: null, commentSentiment: null, channel: "email", contactIdx: 5, daysAgo: 40, answers: { q1: 5 } },
          ],
        },
        {
          name: "Closed-Won Deal Survey",
          description: "Sent to champions after a deal closes — captures why they chose us.",
          type: "custom",
          status: "draft",
          publicSlug: `closed-won-${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          thankYouText: "Thank you for choosing LeadDrive!",
          questions: [
            { id: "q1", type: "choice", label: "What was the deciding factor?", options: ["Pharma-specific features", "Pricing", "Implementation speed", "Customer references", "AI capabilities"] },
            { id: "q2", type: "text", label: "Who else did you evaluate?" },
            { id: "q3", type: "text", label: "What nearly made you pick a competitor?" },
          ],
          triggers: {},
          channels: ["email", "link"],
          totalSent: 0,
          totalResponses: 0,
          responses: [],
        },
      ]
      let totalResp = 0
      for (const s of surveysData) {
        const { responses, ...surveyData } = s
        const survey = await prisma.survey.create({ data: { ...surveyData, organizationId: orgId } })
        for (const r of responses) {
          const { contactIdx, daysAgo, answers, ...respData } = r
          await prisma.surveyResponse.create({
            data: {
              ...respData,
              organizationId: orgId,
              surveyId: survey.id,
              contactId: createdContacts[contactIdx]?.id || null,
              email: createdContacts[contactIdx]?.email || null,
              answers: answers || (r.score != null ? { q1: r.score } : {}),
              completedAt: new Date(now - daysAgo * DAY),
              ipAddress: `185.45.12.${Math.floor(Math.random() * 200) + 50}`,
            },
          })
          totalResp++
        }
      }
      console.log(`Surveys: ${surveysData.length} (${totalResp} responses)`)

      // Survey unsubscribes
      const orgSurveys = await prisma.survey.findMany({ where: { organizationId: orgId }, take: 2 })
      const unsubscribes = [
        { surveyId: null, email: "optout@example.com", reason: "No longer a customer" },
        { surveyId: orgSurveys[0]?.id || null, email: "t.clarke@medtechsol.com", reason: "Too many surveys" },
        { surveyId: null, phone: "+44 20 7946 1100", reason: "Prefers not to be contacted" },
      ]
      for (const u of unsubscribes) {
        await prisma.surveyUnsubscribe.create({ data: { ...u, organizationId: orgId } })
      }
      console.log(`Survey Unsubscribes: ${unsubscribes.length}`)
    } else {
      console.log("Surveys: (existing, skipped)")
    }
  } catch (e) { console.log(`Surveys: ERROR — ${e.message}`) }

  // ─── 88. Complaints Register (Ticket + ComplaintMeta) ───
  try {
    const existingCM = await prisma.complaintMeta.findFirst({ where: { organizationId: orgId } })
    if (!existingCM) {
      const complaintsData = [
        { ticketNumber: "CMP-2026-0001", subject: "Упаковка повреждена при доставке", description: "Получил партию Vitamin D 1000IU — внешняя термоусадка порвана, три блистера с трещинами. Фото прилагается. Партия: LOT-VD-2601-A.", priority: "high", status: "in_progress", source: "email", contactIdx: 7, companyIdx: 7, meta: { externalRegistryNumber: 1001, complaintType: "complaint", brand: "PharmaCare", productionArea: "Warsaw Plant 1", productCategory: "Vitamins", complaintObject: "packaging", complaintObjectDetail: "External shrink-wrap torn, 3 blisters cracked", responsibleDepartment: "Quality Control", riskLevel: "medium" }, daysAgo: 2 },
        { ticketNumber: "CMP-2026-0002", subject: "Неверная концентрация активного вещества", description: "Лабораторный анализ нашей партии Omega-3 показал 720mg EPA вместо заявленных 900mg. Расхождение 20%. Требуется срочное расследование и отзыв партии.", priority: "critical", status: "escalated", source: "phone", contactIdx: 2, companyIdx: 2, meta: { externalRegistryNumber: 1002, complaintType: "complaint", brand: "PharmaCare", productionArea: "Berlin Plant 2", productCategory: "Supplements", complaintObject: "composition", complaintObjectDetail: "EPA content 20% below label claim (720mg vs 900mg)", responsibleDepartment: "Quality Assurance", riskLevel: "high" }, daysAgo: 5 },
        { ticketNumber: "CMP-2026-0003", subject: "Истёкший срок годности в поставке", description: "Из 100 упаковок Multivitamin — 12 с истёкшим сроком (06/2025, поставлено 04/2026). Возврат и замена.", priority: "high", status: "resolved", source: "portal", contactIdx: 11, companyIdx: 11, meta: { externalRegistryNumber: 1003, complaintType: "complaint", brand: "PharmaCare", productionArea: "Warsaw Plant 1", productCategory: "Vitamins", complaintObject: "expiry", complaintObjectDetail: "12 of 100 units expired 10 months prior to delivery", responsibleDepartment: "Logistics", riskLevel: "high" }, daysAgo: 15 },
        { ticketNumber: "CMP-2026-0004", subject: "Побочная реакция (non-serious)", description: "Пациент сообщил о лёгкой сыпи через 2 дня приёма Probiotic Plus. Без госпитализации. Заполнен CIOMS-форма, отправлено в pharmacovigilance.", priority: "high", status: "in_progress", source: "email", contactIdx: 8, companyIdx: 8, meta: { externalRegistryNumber: 1004, complaintType: "adverse_event", brand: "PharmaCare", productionArea: "Berlin Plant 2", productCategory: "Probiotics", complaintObject: "adverse_reaction", complaintObjectDetail: "Mild skin rash, non-serious, CIOMS form filed", responsibleDepartment: "Pharmacovigilance", riskLevel: "high" }, daysAgo: 3 },
        { ticketNumber: "CMP-2026-0005", subject: "Маркировка на упаковке плохо читается", description: "На 200+ упаковках Vitamin C смазана печать серии и даты. Оптовый клиент не может принять товар.", priority: "medium", status: "resolved", source: "whatsapp", contactIdx: 6, companyIdx: 6, meta: { externalRegistryNumber: 1005, complaintType: "complaint", brand: "PharmaCare", productionArea: "Warsaw Plant 1", productCategory: "Vitamins", complaintObject: "labeling", complaintObjectDetail: "Batch number and expiry date smudged on 200+ units", responsibleDepartment: "Production", riskLevel: "medium" }, daysAgo: 20 },
        { ticketNumber: "CMP-2026-0006", subject: "Посторонний запах в капсулах", description: "Открыл новую упаковку — заметный химический запах. Предыдущие партии этого же продукта запаха не имели. LOT-MV-2602-C.", priority: "medium", status: "open", source: "facebook", contactIdx: 5, companyIdx: 5, meta: { externalRegistryNumber: 1006, complaintType: "complaint", brand: "PharmaCare", productionArea: "Berlin Plant 2", productCategory: "Supplements", complaintObject: "odor", complaintObjectDetail: "Unusual chemical odor, LOT-MV-2602-C", responsibleDepartment: "Quality Control", riskLevel: "medium" }, daysAgo: 1 },
        { ticketNumber: "CMP-2026-0007", subject: "Недостаток капсул в упаковке", description: "В упаковке заявлено 60 капсул, по факту — 54. Клиент просит замену или возврат.", priority: "low", status: "closed", source: "portal", contactIdx: 4, companyIdx: 4, meta: { externalRegistryNumber: 1007, complaintType: "complaint", brand: "PharmaCare", productionArea: "Warsaw Plant 1", productCategory: "Supplements", complaintObject: "quantity", complaintObjectDetail: "54 capsules in pack labeled 60", responsibleDepartment: "Production", riskLevel: "low" }, daysAgo: 30 },
        { ticketNumber: "CMP-2026-0008", subject: "Контрафакт — подозрение", description: "Клиент прислал фото: упаковка по внешнему виду отличается от оригинала (шрифт, голограмма, серийный номер). Запущена проверка serialization-системы.", priority: "critical", status: "escalated", source: "email", contactIdx: 0, companyIdx: 0, meta: { externalRegistryNumber: 1008, complaintType: "counterfeit_suspicion", brand: "PharmaCare", productionArea: null, productCategory: "Vitamins", complaintObject: "authenticity", complaintObjectDetail: "Suspected counterfeit — packaging differs from genuine (font, hologram, serial)", responsibleDepartment: "Security & Compliance", riskLevel: "high" }, daysAgo: 4 },
      ]

      const slaHoursComplaintMap = { critical: 1, high: 2, medium: 4, low: 8 }
      for (const c of complaintsData) {
        const existing = await prisma.ticket.findFirst({ where: { organizationId: orgId, ticketNumber: c.ticketNumber } })
        if (existing) continue
        const createdAt = new Date(now - c.daysAgo * DAY)
        const slaHours = slaHoursComplaintMap[c.priority] || 4
        const resolvedAt = ["resolved", "closed"].includes(c.status) ? new Date(createdAt.getTime() + slaHours * 3 * 60 * 60 * 1000) : null
        const ticket = await prisma.ticket.create({
          data: {
            organizationId: orgId,
            ticketNumber: c.ticketNumber,
            subject: c.subject,
            description: c.description,
            priority: c.priority,
            status: c.status,
            category: "complaint",
            source: c.source,
            contactId: createdContacts[c.contactIdx]?.id,
            companyId: createdCompanies[c.companyIdx]?.id,
            assignedTo: user.id,
            createdBy: user.id,
            createdAt,
            slaFirstResponseDueAt: new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000),
            slaDueAt: new Date(createdAt.getTime() + slaHours * 4 * 60 * 60 * 1000),
            slaPolicyName: `${c.priority.charAt(0).toUpperCase() + c.priority.slice(1)} Priority SLA`,
            firstResponseAt: new Date(createdAt.getTime() + Math.min(slaHours * 0.5, 2) * 60 * 60 * 1000),
            resolvedAt,
            closedAt: c.status === "closed" ? resolvedAt : null,
            tags: ["complaint", c.meta.brand.toLowerCase()],
            escalationLevel: c.status === "escalated" ? 2 : 0,
          },
        })
        await prisma.complaintMeta.create({
          data: { ...c.meta, ticketId: ticket.id, organizationId: orgId },
        })
      }
      console.log(`Complaints: ${complaintsData.length} (with ComplaintMeta, risk levels, brand/category)`)
    } else {
      console.log("Complaints: (existing, skipped)")
    }
  } catch (e) { console.log(`Complaints: ERROR — ${e.message}`) }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 7 — INDUSTRY CLOUDS (Health / Insurance / Public Sector / Media /
  //  Energy & Utilities). These 5 sidebar groups were enabled above via
  //  org.features; the sections below populate them so the demo isn't 5 empty
  //  vertical groups. PII columns (fullName / taxId / displayName / addresses)
  //  are written as PLAINTEXT — every industry GET route reads through
  //  softDecrypt* which passes non-ciphertext values straight through, so
  //  records display correctly. Blind-index columns are left NULL (exact-match
  //  ?fullName=/?taxId= search won't hit seeded rows; list + detail views are
  //  unaffected). Status↔timestamp values satisfy the per-table coherence
  //  CHECK constraints (e.g. completed encounter ⇒ checkedInAt+startedAt+
  //  completedAt; active policy ⇒ boundAt+activatedAt; trial subscriber ⇒
  //  trialStartedAt).
  // ═══════════════════════════════════════════════════════════════════════

  // ─── 89. Health Cloud (providers, patients, encounters, care plans, records) ───
  try {
    const existingHc = await prisma.healthProvider.findFirst({ where: { organizationId: orgId } })
    if (!existingHc) {
      const providersData = [
        { fullName: "Dr. Emily Carter", email: `e.carter@${slug}-health.com`, phone: "+1 617 555 0110", npiNumber: "1043219876", role: "physician", specialty: "Cardiology", departmentSlug: "cardiology" },
        { fullName: "Dr. Raj Patel", email: `r.patel@${slug}-health.com`, phone: "+1 617 555 0111", npiNumber: "1043219877", role: "physician", specialty: "Internal Medicine", departmentSlug: "internal-medicine" },
        { fullName: "Sarah Nguyen, NP", email: `s.nguyen@${slug}-health.com`, phone: "+1 617 555 0112", npiNumber: "1043219878", role: "nurse_practitioner", specialty: "Primary Care", departmentSlug: "primary-care" },
        { fullName: "Michael Thompson, RN", email: `m.thompson@${slug}-health.com`, phone: "+1 617 555 0113", role: "registered_nurse", specialty: null, departmentSlug: "triage" },
      ]
      const hcProviders = []
      for (const p of providersData) {
        hcProviders.push(await prisma.healthProvider.create({ data: { ...p, organizationId: orgId } }))
      }

      const patientsData = [
        { mrn: "MRN-100001", fullName: "James Wilson", email: "j.wilson@example.com", phone: "+1 617 555 0201", dateOfBirth: new Date("1968-03-14"), sexAtBirth: "male", addressLine1: "42 Beacon St", city: "Boston", postalCode: "02108", country: "US", insuranceCarrier: "Blue Cross", insurancePolicyId: "BC-8842190", status: "active", providerIdx: 0 },
        { mrn: "MRN-100002", fullName: "Maria Gonzalez", email: "m.gonzalez@example.com", phone: "+1 617 555 0202", dateOfBirth: new Date("1981-07-22"), sexAtBirth: "female", addressLine1: "118 Newbury St", city: "Boston", postalCode: "02116", country: "US", insuranceCarrier: "Aetna", insurancePolicyId: "AET-5519023", status: "active", providerIdx: 1 },
        { mrn: "MRN-100003", fullName: "Robert Chen", email: "r.chen@example.com", phone: "+1 617 555 0203", dateOfBirth: new Date("1955-11-02"), sexAtBirth: "male", addressLine1: "7 Charles St", city: "Cambridge", postalCode: "02141", country: "US", insuranceCarrier: "UnitedHealthcare", insurancePolicyId: "UHC-3320981", status: "active", providerIdx: 0 },
        { mrn: "MRN-100004", fullName: "Linda Park", email: "l.park@example.com", phone: "+1 617 555 0204", dateOfBirth: new Date("1992-01-30"), sexAtBirth: "female", addressLine1: "200 Commonwealth Ave", city: "Boston", postalCode: "02115", country: "US", insuranceCarrier: "Cigna", insurancePolicyId: "CIG-7781200", status: "active", providerIdx: 2 },
        { mrn: "MRN-100005", fullName: "David Okafor", email: "d.okafor@example.com", phone: "+1 617 555 0205", dateOfBirth: new Date("1973-09-18"), sexAtBirth: "male", addressLine1: "55 Tremont St", city: "Boston", postalCode: "02111", country: "US", insuranceCarrier: "Blue Cross", insurancePolicyId: "BC-9920134", status: "inactive", providerIdx: 1 },
        { mrn: "MRN-100006", fullName: "Susan Mitchell", email: "s.mitchell@example.com", phone: "+1 617 555 0206", dateOfBirth: new Date("1948-05-09"), sexAtBirth: "female", addressLine1: "12 Louisburg Sq", city: "Boston", postalCode: "02108", country: "US", insuranceCarrier: "Medicare", insurancePolicyId: "MED-1102934", status: "discharged", dischargedAt: new Date(now - 20 * DAY), providerIdx: 0 },
      ]
      const hcPatients = []
      for (const p of patientsData) {
        const { providerIdx, ...rest } = p
        hcPatients.push(await prisma.healthPatient.create({
          data: { ...rest, organizationId: orgId, primaryProviderId: hcProviders[providerIdx]?.id ?? null, contactId: createdContacts[hcPatients.length]?.id ?? null },
        }))
      }

      // Encounters — each status carries its required coherence timestamps.
      const encountersData = [
        { patientIdx: 0, providerIdx: 0, encounterType: "in_person", reason: "Annual cardiac check-up", status: "completed", startOffset: -7, durMin: 30, checkOffset: -7, location: "Cardiology Suite 3" },
        { patientIdx: 1, providerIdx: 1, encounterType: "telehealth", reason: "Medication follow-up", status: "completed", startOffset: -3, durMin: 20, checkOffset: -3, location: "https://telehealth.example/visit/abc" },
        { patientIdx: 2, providerIdx: 0, encounterType: "in_person", reason: "Chest pain evaluation", status: "scheduled", startOffset: 4, durMin: 45, location: "Cardiology Suite 1" },
        { patientIdx: 3, providerIdx: 2, encounterType: "in_person", reason: "New patient intake", status: "no_show", startOffset: -1, durMin: 30, location: "Primary Care 2" },
        { patientIdx: 4, providerIdx: 1, encounterType: "phone", reason: "Lab results discussion", status: "cancelled", startOffset: -2, durMin: 15, location: "Phone" },
        { patientIdx: 1, providerIdx: 2, encounterType: "in_person", reason: "Routine physical", status: "checked_in", startOffset: 0, durMin: 30, checkOffset: 0, location: "Primary Care 1" },
      ]
      for (const e of encountersData) {
        const start = new Date(now + e.startOffset * DAY)
        const end = new Date(start.getTime() + e.durMin * 60 * 1000)
        const checkedInAt = ["checked_in", "in_progress", "completed"].includes(e.status) ? new Date(start.getTime() - 10 * 60 * 1000) : null
        const startedAt = ["in_progress", "completed"].includes(e.status) ? start : null
        const completedAt = e.status === "completed" ? end : null
        const noShowAt = e.status === "no_show" ? new Date(start.getTime() + 20 * 60 * 1000) : null
        const cancelledAt = e.status === "cancelled" ? new Date(start.getTime() - 6 * 60 * 60 * 1000) : null
        await prisma.healthEncounter.create({
          data: {
            organizationId: orgId,
            patientId: hcPatients[e.patientIdx].id,
            providerId: hcProviders[e.providerIdx].id,
            encounterType: e.encounterType,
            reason: e.reason,
            status: e.status,
            scheduledStartAt: start,
            scheduledEndAt: end,
            checkedInAt,
            startedAt,
            completedAt,
            noShowAt,
            cancelledAt,
            cancellationReason: cancelledAt ? "Patient rescheduled" : null,
            location: e.location,
            createdBy: user.id,
          },
        })
      }

      // Care plans
      const carePlansData = [
        { patientIdx: 0, name: "Post-MI Cardiac Recovery", description: "12-week structured recovery after myocardial infarction.", providerIdx: 0, status: "active", startOffset: -14, goals: [{ id: "g1", label: "LDL cholesterol < 70 mg/dL", metric: "ldl", targetValue: 70, comparator: "lte", kpiSource: "medical_record_count" }, { id: "g2", label: "150 min/week moderate exercise", metric: "exercise_minutes", targetValue: 150, comparator: "gte", kpiSource: "medication_adherence" }] },
        { patientIdx: 2, name: "Type 2 Diabetes Management", description: "Glycemic control + lifestyle program.", providerIdx: 1, status: "active", startOffset: -30, goals: [{ id: "g1", label: "HbA1c < 7.0%", metric: "hba1c", targetValue: 7, comparator: "lte", kpiSource: "medical_record_count" }] },
        { patientIdx: 1, name: "Hypertension Monitoring", description: "Home BP monitoring with monthly review.", providerIdx: 2, status: "draft", startOffset: 2, goals: [{ id: "g1", label: "BP < 130/80", metric: "systolic_bp", targetValue: 130, comparator: "lte", kpiSource: "medical_record_count" }] },
        { patientIdx: 5, name: "Geriatric Discharge Plan", description: "Home-care transition after inpatient stay.", providerIdx: 0, status: "completed", startOffset: -60, goals: [{ id: "g1", label: "Zero readmissions in 30 days", metric: "readmissions", targetValue: 0, comparator: "eq", kpiSource: "medical_record_count" }] },
      ]
      for (const c of carePlansData) {
        const startDate = new Date(now + c.startOffset * DAY)
        await prisma.healthCarePlan.create({
          data: {
            organizationId: orgId,
            patientId: hcPatients[c.patientIdx].id,
            name: c.name,
            description: c.description,
            providerId: hcProviders[c.providerIdx]?.id ?? null,
            goals: c.goals,
            startDate,
            status: c.status,
            activatedAt: ["active", "paused", "completed"].includes(c.status) ? startDate : null,
            completedAt: c.status === "completed" ? new Date(now - 5 * DAY) : null,
            createdBy: user.id,
          },
        })
      }

      // Medical records
      const recordsData = [
        { patientIdx: 0, providerIdx: 0, recordType: "diagnosis", recordedOffset: -7, severity: "high", details: { code: "I21.9", label: "Acute myocardial infarction, unspecified" }, clinicianNotes: "STEMI confirmed; PCI performed." },
        { patientIdx: 0, providerIdx: 0, recordType: "lab_result", recordedOffset: -6, severity: "moderate", details: { test: "Troponin I", value: 4.2, unit: "ng/mL", refRange: "<0.04" }, clinicianNotes: "Elevated, consistent with MI." },
        { patientIdx: 2, providerIdx: 1, recordType: "lab_result", recordedOffset: -30, severity: "moderate", details: { test: "HbA1c", value: 8.1, unit: "%", refRange: "<5.7" }, clinicianNotes: "Above target; adjust metformin." },
        { patientIdx: 1, providerIdx: 1, recordType: "medication", recordedOffset: -3, severity: "informational", details: { drug: "Lisinopril", dose: "10mg", frequency: "daily" }, clinicianNotes: "Started ACE inhibitor." },
        { patientIdx: 3, providerIdx: 2, recordType: "immunization", recordedOffset: -45, severity: "informational", details: { vaccine: "Influenza", lot: "FLU-2026-AA" }, clinicianNotes: "Seasonal flu shot administered." },
      ]
      for (const r of recordsData) {
        await prisma.healthMedicalRecord.create({
          data: {
            organizationId: orgId,
            patientId: hcPatients[r.patientIdx].id,
            recordedByProviderId: hcProviders[r.providerIdx]?.id ?? null,
            recordType: r.recordType,
            recordedAt: new Date(now + r.recordedOffset * DAY),
            details: r.details,
            clinicianNotes: r.clinicianNotes,
            severity: r.severity,
            sensitivity: "normal",
          },
        })
      }
      console.log(`Health Cloud: ${hcProviders.length} providers, ${hcPatients.length} patients, ${encountersData.length} encounters, ${carePlansData.length} care plans, ${recordsData.length} records`)
    } else {
      console.log("Health Cloud: (existing, skipped)")
    }
  } catch (e) { console.log(`Health Cloud: ERROR — ${e.message}`) }

  // ─── 90. Insurance Cloud (team, policyholders, policies, beneficiaries, claims) ───
  try {
    const existingIns = await prisma.policyHolder.findFirst({ where: { organizationId: orgId } })
    if (!existingIns) {
      const teamData = [
        { fullName: "Patricia Adams", email: `p.adams@${slug}-insure.com`, phone: "+1 312 555 0301", role: "senior_underwriter", licenseNumber: "UW-IL-44821", licensedRegions: ["IL", "IN", "WI"], linesSpecialty: ["auto", "home"] },
        { fullName: "Kevin Brooks", email: `k.brooks@${slug}-insure.com`, phone: "+1 312 555 0302", role: "underwriter", licenseNumber: "UW-IL-44822", licensedRegions: ["IL"], linesSpecialty: ["life", "health"] },
        { fullName: "Diana Reyes", email: `d.reyes@${slug}-insure.com`, phone: "+1 312 555 0303", role: "senior_adjuster", licenseNumber: "AD-IL-77310", licensedRegions: ["IL", "MI"], linesSpecialty: ["auto", "commercial"] },
      ]
      const insTeam = []
      for (const t of teamData) {
        insTeam.push(await prisma.insuranceServiceTeamMember.create({ data: { ...t, organizationId: orgId } }))
      }

      const holdersData = [
        { holderNumber: "PH-200001", fullName: "Thomas Anderson", email: "t.anderson@example.com", phone: "+1 312 555 0401", dateOfBirth: new Date("1979-04-12"), taxId: "***-**-4821", mailingAddressLine1: "300 W Madison St", mailingCity: "Chicago", mailingPostalCode: "60606", mailingCountry: "US", occupationSlug: "engineer" },
        { holderNumber: "PH-200002", fullName: "Jennifer Lee", email: "j.lee@example.com", phone: "+1 312 555 0402", dateOfBirth: new Date("1986-08-25"), taxId: "***-**-9034", mailingAddressLine1: "120 N LaSalle St", mailingCity: "Chicago", mailingPostalCode: "60602", mailingCountry: "US", occupationSlug: "teacher" },
        { holderNumber: "PH-200003", fullName: "Marcus Johnson", email: "m.johnson@example.com", phone: "+1 312 555 0403", dateOfBirth: new Date("1971-12-03"), taxId: "***-**-1290", mailingAddressLine1: "55 E Monroe St", mailingCity: "Chicago", mailingPostalCode: "60603", mailingCountry: "US", occupationSlug: "physician" },
        { holderNumber: "PH-200004", fullName: "Sofia Martinez", email: "s.martinez@example.com", phone: "+1 312 555 0404", dateOfBirth: new Date("1990-06-17"), taxId: "***-**-5567", mailingAddressLine1: "401 N Wabash Ave", mailingCity: "Chicago", mailingPostalCode: "60611", mailingCountry: "US", occupationSlug: "architect" },
        { holderNumber: "PH-200005", fullName: "William Carter", email: "w.carter@example.com", phone: "+1 312 555 0405", dateOfBirth: new Date("1963-02-28"), taxId: "***-**-7781", mailingAddressLine1: "1 S Dearborn St", mailingCity: "Chicago", mailingPostalCode: "60603", mailingCountry: "US", occupationSlug: "business_owner" },
      ]
      const insHolders = []
      for (const h of holdersData) {
        insHolders.push(await prisma.policyHolder.create({
          data: { ...h, organizationId: orgId, status: "active", activatedAt: new Date(now - 200 * DAY), contactId: createdContacts[insHolders.length]?.id ?? null },
        }))
      }

      // Policies — active policies carry boundAt + activatedAt + effective/expiration.
      const policiesData = [
        { holderIdx: 0, policyNumber: "POL-AUTO-30001", lineOfBusiness: "auto", status: "active", coverageLimit: 100000, deductible: 1000, annualPremium: 1450.0, billingFrequency: "semi_annual", underwriterIdx: 0 },
        { holderIdx: 0, policyNumber: "POL-HOME-30002", lineOfBusiness: "home", status: "active", coverageLimit: 450000, deductible: 2500, annualPremium: 1980.0, billingFrequency: "annual", underwriterIdx: 0 },
        { holderIdx: 1, policyNumber: "POL-LIFE-30003", lineOfBusiness: "life", status: "active", coverageLimit: 500000, deductible: null, annualPremium: 720.0, billingFrequency: "monthly", underwriterIdx: 1 },
        { holderIdx: 2, policyNumber: "POL-HEALTH-30004", lineOfBusiness: "health", status: "active", coverageLimit: 1000000, deductible: 3000, annualPremium: 6200.0, billingFrequency: "monthly", underwriterIdx: 1 },
        { holderIdx: 3, policyNumber: "POL-AUTO-30005", lineOfBusiness: "auto", status: "quote", coverageLimit: 75000, deductible: 500, annualPremium: 1180.0, billingFrequency: "quarterly", underwriterIdx: 0 },
        { holderIdx: 4, policyNumber: "POL-COMM-30006", lineOfBusiness: "commercial", status: "bound", coverageLimit: 2000000, deductible: 10000, annualPremium: 14800.0, billingFrequency: "annual", underwriterIdx: 0 },
      ]
      const insPolicies = []
      for (const p of policiesData) {
        const { holderIdx, underwriterIdx, ...rest } = p
        const boundAt = ["bound", "active", "expired", "lapsed", "cancelled"].includes(p.status) ? new Date(now - 190 * DAY) : null
        const activatedAt = ["active", "expired", "lapsed"].includes(p.status) ? new Date(now - 185 * DAY) : null
        insPolicies.push(await prisma.policy.create({
          data: {
            ...rest,
            organizationId: orgId,
            policyHolderId: insHolders[holderIdx].id,
            underwriterId: insTeam[underwriterIdx]?.id ?? null,
            effectiveDate: activatedAt ? new Date(now - 185 * DAY) : null,
            expirationDate: activatedAt ? new Date(now + 180 * DAY) : null,
            boundAt,
            activatedAt,
          },
        }))
      }

      // Beneficiaries — life policies only.
      const beneficiariesData = [
        { policyIdx: 2, tier: "primary", beneficiaryType: "person", fullName: "Emily Lee", relationship: "spouse", allocationPct: 60, dateOfBirth: new Date("1988-03-19") },
        { policyIdx: 2, tier: "primary", beneficiaryType: "person", fullName: "Daniel Lee", relationship: "child", allocationPct: 40, dateOfBirth: new Date("2014-09-08") },
        { policyIdx: 2, tier: "contingent", beneficiaryType: "person", fullName: "Grace Lee", relationship: "parent", allocationPct: 100, dateOfBirth: new Date("1958-11-22") },
        { policyIdx: 3, tier: "primary", beneficiaryType: "trust", fullName: "Johnson Family Trust", relationship: "trust", allocationPct: 100, dateOfBirth: null },
      ]
      for (const b of beneficiariesData) {
        const { policyIdx, ...rest } = b
        await prisma.beneficiary.create({
          data: { ...rest, organizationId: orgId, policyId: insPolicies[policyIdx].id },
        })
      }

      // Claims — terminal states carry their review/decision timestamps + rationale.
      const claimsData = [
        { policyIdx: 0, claimNumber: "CLM-40001", lossType: "collision", status: "settled", severity: "moderate", lossOffset: -40, initialReserveAmount: 8000, currentReserveAmount: 0, paidAmount: 6250, description: "Rear-end collision, front bumper + radiator damage.", adjusterIdx: 2 },
        { policyIdx: 1, claimNumber: "CLM-40002", lossType: "weather", status: "under_review", severity: "major", lossOffset: -12, initialReserveAmount: 35000, currentReserveAmount: 35000, paidAmount: 0, description: "Hail damage to roof and siding.", adjusterIdx: 2 },
        { policyIdx: 3, claimNumber: "CLM-40003", lossType: "medical", status: "approved", severity: "moderate", lossOffset: -25, initialReserveAmount: 12000, currentReserveAmount: 12000, paidAmount: 0, description: "Emergency room visit + diagnostics.", adjusterIdx: 2 },
        { policyIdx: 0, claimNumber: "CLM-40004", lossType: "theft", status: "denied", severity: "minor", lossOffset: -60, initialReserveAmount: 3000, currentReserveAmount: 0, paidAmount: 0, description: "Reported theft of in-vehicle electronics.", adjusterIdx: 2 },
      ]
      for (const c of claimsData) {
        const { policyIdx, adjusterIdx, lossOffset, ...rest } = c
        const reviewStartedAt = ["under_review", "approved", "settled", "denied", "closed_no_action"].includes(c.status) ? new Date(now + (lossOffset + 2) * DAY) : null
        const approvedAt = ["approved", "settled"].includes(c.status) ? new Date(now + (lossOffset + 6) * DAY) : null
        const settledAt = c.status === "settled" ? new Date(now + (lossOffset + 10) * DAY) : null
        const deniedAt = c.status === "denied" ? new Date(now + (lossOffset + 8) * DAY) : null
        await prisma.claim.create({
          data: {
            ...rest,
            organizationId: orgId,
            policyId: insPolicies[policyIdx].id,
            adjusterId: insTeam[adjusterIdx]?.id ?? null,
            lossDate: new Date(now + lossOffset * DAY),
            reviewStartedAt,
            approvedAt,
            settledAt,
            deniedAt,
            decisionRationale: c.status === "denied" ? "Loss not covered under policy exclusions (unattended vehicle)." : (c.status === "settled" ? "Covered loss; settled per adjuster assessment." : null),
          },
        })
      }
      console.log(`Insurance Cloud: ${insTeam.length} team, ${insHolders.length} policyholders, ${insPolicies.length} policies, ${beneficiariesData.length} beneficiaries, ${claimsData.length} claims`)
    } else {
      console.log("Insurance Cloud: (existing, skipped)")
    }
  } catch (e) { console.log(`Insurance Cloud: ERROR — ${e.message}`) }

  // ─── 91. Public Sector Cloud (officials, citizens, cases, licenses, grants) ───
  try {
    const existingPs = await prisma.citizen.findFirst({ where: { organizationId: orgId } })
    if (!existingPs) {
      const officialsData = [
        { fullName: "Officer Karen White", email: `k.white@${slug}-gov.org`, phone: "+1 916 555 0501", role: "senior_caseworker", agencySlug: "dept-social-services", departmentSlug: "benefits", authorityLevel: "supervisor", specialties: ["benefits", "appeals"] },
        { fullName: "Inspector Paul Green", email: `p.green@${slug}-gov.org`, phone: "+1 916 555 0502", role: "inspector", agencySlug: "dept-licensing", departmentSlug: "food-safety", authorityLevel: "line", specialties: ["food_service", "building_permit"] },
        { fullName: "Grace Holloway", email: `g.holloway@${slug}-gov.org`, phone: "+1 916 555 0503", role: "grant_officer", agencySlug: "dept-economic-dev", departmentSlug: "grants", authorityLevel: "director", specialties: ["grants"] },
      ]
      const psOfficials = []
      for (const o of officialsData) {
        psOfficials.push(await prisma.publicSectorOfficial.create({ data: { ...o, organizationId: orgId } }))
      }

      const citizensData = [
        { citizenNumber: "CIT-300001", fullName: "Angela Foster", email: "a.foster@example.com", phone: "+1 916 555 0601", dateOfBirth: new Date("1985-05-21"), taxId: "***-**-3301", addressLine1: "1400 J St", city: "Sacramento", stateProvince: "CA", postalCode: "95814", country: "US", jurisdictionSlug: "sacramento-county" },
        { citizenNumber: "CIT-300002", fullName: "Brian Cooper", email: "b.cooper@example.com", phone: "+1 916 555 0602", dateOfBirth: new Date("1977-10-09"), taxId: "***-**-4412", addressLine1: "920 K St", city: "Sacramento", stateProvince: "CA", postalCode: "95814", country: "US", jurisdictionSlug: "sacramento-county" },
        { citizenNumber: "CIT-300003", fullName: "Denise Ramirez", email: "d.ramirez@example.com", phone: "+1 916 555 0603", dateOfBirth: new Date("1994-02-14"), taxId: "***-**-5523", addressLine1: "770 L St", city: "Sacramento", stateProvince: "CA", postalCode: "95814", country: "US", jurisdictionSlug: "yolo-county" },
        { citizenNumber: "CIT-300004", fullName: "Frank Nguyen", email: "f.nguyen@example.com", phone: "+1 916 555 0604", dateOfBirth: new Date("1968-07-30"), taxId: "***-**-6634", addressLine1: "1100 M St", city: "Sacramento", stateProvince: "CA", postalCode: "95814", country: "US", jurisdictionSlug: "sacramento-county" },
        { citizenNumber: "CIT-300005", fullName: "Helen Baker", email: "h.baker@example.com", phone: "+1 916 555 0605", dateOfBirth: new Date("1990-12-11"), taxId: "***-**-7745", addressLine1: "630 N St", city: "Sacramento", stateProvince: "CA", postalCode: "95814", country: "US", jurisdictionSlug: "placer-county" },
      ]
      const psCitizens = []
      for (const c of citizensData) {
        psCitizens.push(await prisma.citizen.create({
          data: { ...c, organizationId: orgId, status: "active", contactId: createdContacts[psCitizens.length]?.id ?? null },
        }))
      }

      // Cases — advanced statuses carry intake/assigned/work/resolved timestamps + assigned official.
      const casesData = [
        { citizenIdx: 0, caseNumber: "CASE-50001", caseType: "benefits_application", status: "in_progress", priority: "routine", officialIdx: 0, subject: "SNAP benefits application", description: "Initial application for food assistance.", openedOffset: -10, dueOffset: 20 },
        { citizenIdx: 1, caseNumber: "CASE-50002", caseType: "complaint", status: "resolved", priority: "elevated", officialIdx: 0, subject: "Service complaint — delayed payment", description: "Citizen reports delayed benefit disbursement.", openedOffset: -25, dueOffset: -5 },
        { citizenIdx: 2, caseNumber: "CASE-50003", caseType: "inspection_request", status: "assigned", priority: "urgent", officialIdx: 1, subject: "Restaurant food-safety inspection", description: "Routine annual food-service inspection request.", openedOffset: -5, dueOffset: 10 },
        { citizenIdx: 3, caseNumber: "CASE-50004", caseType: "records_request", status: "submitted", priority: "routine", officialIdx: null, subject: "FOIA records request", description: "Request for public meeting minutes 2025.", openedOffset: -2, dueOffset: 18 },
        { citizenIdx: 4, caseNumber: "CASE-50005", caseType: "benefits_recertification", status: "escalated", priority: "elevated", officialIdx: 0, subject: "Medicaid recertification", description: "Annual eligibility recertification, escalated for review.", openedOffset: -15, dueOffset: 5 },
      ]
      const psCases = []
      for (const c of casesData) {
        const submittedAt = new Date(now + c.openedOffset * DAY)
        const advanced = ["intake", "assigned", "in_progress", "escalated", "resolved"].includes(c.status)
        const assignedStates = ["assigned", "in_progress", "escalated", "resolved"].includes(c.status)
        const workStates = ["in_progress", "escalated", "resolved"].includes(c.status)
        psCases.push(await prisma.publicSectorCase.create({
          data: {
            organizationId: orgId,
            citizenId: psCitizens[c.citizenIdx].id,
            caseNumber: c.caseNumber,
            caseType: c.caseType,
            status: c.status,
            priority: c.priority,
            agencySlug: c.officialIdx !== null ? officialsData[c.officialIdx].agencySlug : "dept-records",
            assignedOfficialId: c.officialIdx !== null ? psOfficials[c.officialIdx].id : null,
            subject: c.subject,
            description: c.description,
            statutoryDueAt: new Date(now + c.dueOffset * DAY),
            submittedAt,
            intakeStartedAt: advanced ? new Date(submittedAt.getTime() + 1 * DAY) : null,
            assignedAt: assignedStates ? new Date(submittedAt.getTime() + 2 * DAY) : null,
            workStartedAt: workStates ? new Date(submittedAt.getTime() + 3 * DAY) : null,
            escalatedAt: c.status === "escalated" ? new Date(submittedAt.getTime() + 4 * DAY) : null,
            resolvedAt: c.status === "resolved" ? new Date(submittedAt.getTime() + 12 * DAY) : null,
            decisionRationale: c.status === "resolved" ? "Resolved — corrected disbursement issued and confirmed." : null,
          },
        }))
      }

      // Licenses
      const licensesData = [
        { citizenIdx: 1, caseIdx: null, licenseNumber: "LIC-60001", licenseType: "food_service", status: "issued", officialIdx: 1, feeAmount: 350, appliedOffset: -40, issuedOffset: -25, expiresOffset: 340 },
        { citizenIdx: 2, caseIdx: 2, licenseNumber: "LIC-60002", licenseType: "building_permit", status: "under_review", officialIdx: 1, feeAmount: 800, appliedOffset: -5 },
        { citizenIdx: 3, caseIdx: null, licenseNumber: "LIC-60003", licenseType: "business", status: "applied", officialIdx: null, feeAmount: 200, appliedOffset: -1 },
        { citizenIdx: 0, caseIdx: null, licenseNumber: "LIC-60004", licenseType: "professional", status: "issued", officialIdx: 1, feeAmount: 500, appliedOffset: -90, issuedOffset: -70, expiresOffset: 295 },
      ]
      for (const l of licensesData) {
        const appliedAt = new Date(now + l.appliedOffset * DAY)
        await prisma.publicSectorLicense.create({
          data: {
            organizationId: orgId,
            citizenId: psCitizens[l.citizenIdx]?.id ?? null,
            caseId: l.caseIdx !== null ? psCases[l.caseIdx]?.id ?? null : null,
            licenseNumber: l.licenseNumber,
            licenseType: l.licenseType,
            status: l.status,
            issuingOfficialId: l.officialIdx !== null ? psOfficials[l.officialIdx].id : null,
            appliedAt,
            reviewStartedAt: ["under_review", "issued", "denied"].includes(l.status) ? new Date(appliedAt.getTime() + 2 * DAY) : null,
            issuedAt: l.status === "issued" ? new Date(now + l.issuedOffset * DAY) : null,
            expiresAt: l.status === "issued" ? new Date(now + l.expiresOffset * DAY) : null,
            feeAmount: l.feeAmount,
            feeCurrency: "USD",
          },
        })
      }

      // Grants
      const grantsData = [
        { citizenIdx: 4, grantNumber: "GR-70001", programSlug: "small-business-recovery", status: "disbursed", requestedAmount: 25000, approvedAmount: 20000, disbursedAmount: 20000, officialIdx: 2, narrative: "Recovery grant for local retail business.", submittedOffset: -60 },
        { citizenIdx: 0, grantNumber: "GR-70002", programSlug: "housing-assistance", status: "approved", requestedAmount: 12000, approvedAmount: 12000, disbursedAmount: 0, officialIdx: 2, narrative: "Emergency rental assistance.", submittedOffset: -20 },
        { citizenIdx: 3, grantNumber: "GR-70003", programSlug: "workforce-training", status: "submitted", requestedAmount: 8000, approvedAmount: null, disbursedAmount: 0, officialIdx: null, narrative: "Vocational training tuition support.", submittedOffset: -4 },
      ]
      for (const g of grantsData) {
        const submittedAt = new Date(now + g.submittedOffset * DAY)
        const reviewed = ["under_review", "approved", "disbursing", "disbursed", "denied"].includes(g.status)
        const approved = ["approved", "disbursing", "disbursed"].includes(g.status)
        await prisma.publicSectorGrant.create({
          data: {
            organizationId: orgId,
            citizenId: psCitizens[g.citizenIdx]?.id ?? null,
            grantNumber: g.grantNumber,
            programSlug: g.programSlug,
            status: g.status,
            requestedAmount: g.requestedAmount,
            approvedAmount: g.approvedAmount,
            disbursedAmount: g.disbursedAmount,
            currency: "USD",
            assignedOfficialId: g.officialIdx !== null ? psOfficials[g.officialIdx].id : null,
            narrative: g.narrative,
            submittedAt,
            reviewStartedAt: reviewed ? new Date(submittedAt.getTime() + 3 * DAY) : null,
            approvedAt: approved ? new Date(submittedAt.getTime() + 10 * DAY) : null,
            disbursingStartedAt: g.status === "disbursed" ? new Date(submittedAt.getTime() + 14 * DAY) : null,
            disbursedAt: g.status === "disbursed" ? new Date(submittedAt.getTime() + 16 * DAY) : null,
          },
        })
      }
      console.log(`Public Sector: ${psOfficials.length} officials, ${psCitizens.length} citizens, ${casesData.length} cases, ${licensesData.length} licenses, ${grantsData.length} grants`)
    } else {
      console.log("Public Sector: (existing, skipped)")
    }
  } catch (e) { console.log(`Public Sector: ERROR — ${e.message}`) }

  // ─── 92. Energy & Utilities (customers, meters, readings, outages, service calls) ───
  try {
    const existingEn = await prisma.utilityCustomer.findFirst({ where: { organizationId: orgId } })
    if (!existingEn) {
      const customersData = [
        { accountNumber: "UC-400001", accountHolderName: "Greenfield Residence", serviceAddressLine1: "88 Oak Avenue", serviceCity: "Austin", servicePostalCode: "78701", serviceCountry: "US", customerClass: "residential" },
        { accountNumber: "UC-400002", accountHolderName: "Lakeside Apartments LLC", serviceAddressLine1: "210 Riverside Dr", serviceCity: "Austin", servicePostalCode: "78704", serviceCountry: "US", customerClass: "small_commercial" },
        { accountNumber: "UC-400003", accountHolderName: "TechHub Manufacturing", serviceAddressLine1: "5000 Industrial Pkwy", serviceCity: "Austin", servicePostalCode: "78744", serviceCountry: "US", customerClass: "industrial" },
        { accountNumber: "UC-400004", accountHolderName: "Sunrise Farms", serviceAddressLine1: "1200 County Road 12", serviceCity: "Buda", servicePostalCode: "78610", serviceCountry: "US", customerClass: "agricultural" },
        { accountNumber: "UC-400005", accountHolderName: "City of Austin — Park Dept", serviceAddressLine1: "300 Civic Center Blvd", serviceCity: "Austin", servicePostalCode: "78701", serviceCountry: "US", customerClass: "municipal" },
      ]
      const enCustomers = []
      for (const c of customersData) {
        enCustomers.push(await prisma.utilityCustomer.create({
          data: { ...c, organizationId: orgId, status: "active", activatedAt: new Date(now - 365 * DAY), contactId: createdContacts[enCustomers.length]?.id ?? null },
        }))
      }

      const metersData = [
        { customerIdx: 0, meterNumber: "MTR-500001", commodityType: "electricity", manufacturer: "Itron", modelNumber: "OpenWay Riva", tariffPlanSlug: "residential-tou", lat: 30.2672, lon: -97.7431 },
        { customerIdx: 0, meterNumber: "MTR-500002", commodityType: "gas", manufacturer: "Sensus", modelNumber: "iConA", tariffPlanSlug: "residential-gas", lat: 30.2672, lon: -97.7431 },
        { customerIdx: 1, meterNumber: "MTR-500003", commodityType: "electricity", manufacturer: "Landis+Gyr", modelNumber: "E360", tariffPlanSlug: "small-commercial", lat: 30.2452, lon: -97.7688 },
        { customerIdx: 2, meterNumber: "MTR-500004", commodityType: "electricity", manufacturer: "Itron", modelNumber: "OpenWay Riva", tariffPlanSlug: "industrial-demand", lat: 30.1872, lon: -97.7231 },
        { customerIdx: 3, meterNumber: "MTR-500005", commodityType: "water", manufacturer: "Badger", modelNumber: "E-Series", tariffPlanSlug: "agricultural-water", lat: 30.0852, lon: -97.8403 },
        { customerIdx: 4, meterNumber: "MTR-500006", commodityType: "district_heating", manufacturer: "Kamstrup", modelNumber: "MULTICAL 603", tariffPlanSlug: "municipal-heat", lat: 30.2700, lon: -97.7400 },
      ]
      const enMeters = []
      for (const m of metersData) {
        const { customerIdx, lat, lon, ...rest } = m
        enMeters.push(await prisma.meteringPoint.create({
          data: { ...rest, organizationId: orgId, utilityCustomerId: enCustomers[customerIdx].id, latitude: lat, longitude: lon, status: "active", installedAt: new Date(now - 300 * DAY) },
        }))
      }

      // Readings — 3 per meter (trend), AMI + manual sources, validated.
      const unitMap = { electricity: "kWh", gas: "m3", water: "m3", district_heating: "GJ", sewer: "m3" }
      let readingCount = 0
      for (let mi = 0; mi < enMeters.length; mi++) {
        const meter = enMeters[mi]
        const commodity = metersData[mi].commodityType
        const unit = unitMap[commodity] || "kWh"
        const base = 1000 + mi * 500
        for (let r = 0; r < 3; r++) {
          const daysAgo = (3 - r) * 30
          await prisma.meterReading.create({
            data: {
              organizationId: orgId,
              meteringPointId: meter.id,
              source: r === 0 ? "manual" : "ami",
              readingAt: new Date(now - daysAgo * DAY),
              cumulativeValue: base + r * 320 + Math.round(Math.random() * 40),
              intervalValue: r === 0 ? null : 320 + Math.round(Math.random() * 40),
              unit,
              quality: "validated",
            },
          })
          readingCount++
        }
      }

      // Outages
      const outagesData = [
        { outageNumber: "OUT-2026-0001", cause: "equipment_failure", severity: "major", status: "resolved", affectedMeterCount: 1240, publicSummary: "Transformer failure on Oak Ave feeder.", internalNotes: "Replaced T-4412 transformer; restored in 3h20m.", startOffset: -8, durHours: 3.3 },
        { outageNumber: "OUT-2026-0002", cause: "weather", severity: "critical", status: "active", affectedMeterCount: 5800, publicSummary: "Severe storm damage to distribution lines.", internalNotes: "Crews dispatched to 4 sectors.", startOffset: 0, durHours: null },
        { outageNumber: "OUT-2026-0003", cause: "planned_maintenance", severity: "minor", status: "pending", affectedMeterCount: 320, publicSummary: "Scheduled substation maintenance.", internalNotes: "Notify affected customers 48h prior.", schedOffset: 5, durHours: 2 },
      ]
      const enOutages = []
      for (const o of outagesData) {
        const isPlanned = o.status === "pending"
        const actualStartAt = ["active", "resolved"].includes(o.status) ? new Date(now + o.startOffset * DAY) : null
        const actualEndAt = o.status === "resolved" ? new Date((actualStartAt?.getTime() ?? now) + (o.durHours || 2) * 60 * 60 * 1000) : null
        const scheduledStartAt = isPlanned ? new Date(now + o.schedOffset * DAY) : null
        const scheduledEndAt = isPlanned ? new Date((scheduledStartAt?.getTime() ?? now) + (o.durHours || 2) * 60 * 60 * 1000) : null
        enOutages.push(await prisma.outage.create({
          data: {
            organizationId: orgId,
            outageNumber: o.outageNumber,
            cause: o.cause,
            severity: o.severity,
            status: o.status,
            scheduledStartAt,
            scheduledEndAt,
            actualStartAt,
            actualEndAt,
            affectedMeterCount: o.affectedMeterCount,
            publicSummary: o.publicSummary,
            internalNotes: o.internalNotes,
          },
        }))
      }

      // Service calls
      const callsData = [
        { callNumber: "SC-2026-0001", customerIdx: 0, meterIdx: 0, outageIdx: null, callType: "meter_inspection", priority: "routine", status: "resolved", subject: "Meter reading appears high", description: "Customer disputes last electricity reading.", openedOffset: -6 },
        { callNumber: "SC-2026-0002", customerIdx: 1, meterIdx: 2, outageIdx: null, callType: "new_connection", priority: "elevated", status: "in_progress", subject: "New commercial service connection", description: "Connect new unit in Lakeside building.", openedOffset: -3 },
        { callNumber: "SC-2026-0003", customerIdx: 2, meterIdx: 3, outageIdx: 0, callType: "outage_report", priority: "urgent", status: "resolved", subject: "Power loss at manufacturing site", description: "Full outage reported during transformer failure.", openedOffset: -8 },
        { callNumber: "SC-2026-0004", customerIdx: 3, meterIdx: 4, outageIdx: null, callType: "billing_dispute", priority: "routine", status: "received", subject: "Water bill query", description: "Question about seasonal irrigation surcharge.", openedOffset: -1 },
      ]
      for (const c of callsData) {
        const createdAt = new Date(now + c.openedOffset * DAY)
        const dispatched = ["dispatched", "in_progress", "resolved"].includes(c.status)
        const started = ["in_progress", "resolved"].includes(c.status)
        await prisma.serviceCall.create({
          data: {
            organizationId: orgId,
            callNumber: c.callNumber,
            utilityCustomerId: enCustomers[c.customerIdx]?.id ?? null,
            meteringPointId: enMeters[c.meterIdx]?.id ?? null,
            outageId: c.outageIdx !== null ? enOutages[c.outageIdx]?.id ?? null : null,
            callType: c.callType,
            priority: c.priority,
            status: c.status,
            subject: c.subject,
            description: c.description,
            assignedToUserId: dispatched ? user.id : null,
            dispatchedAt: dispatched ? new Date(createdAt.getTime() + 2 * 60 * 60 * 1000) : null,
            startedAt: started ? new Date(createdAt.getTime() + 4 * 60 * 60 * 1000) : null,
            resolvedAt: c.status === "resolved" ? new Date(createdAt.getTime() + 8 * 60 * 60 * 1000) : null,
            resolutionNotes: c.status === "resolved" ? "Issue inspected and resolved on site." : null,
            createdAt,
          },
        })
      }
      console.log(`Energy & Utilities: ${enCustomers.length} customers, ${enMeters.length} meters, ${readingCount} readings, ${outagesData.length} outages, ${callsData.length} service calls`)
    } else {
      console.log("Energy & Utilities: (existing, skipped)")
    }
  } catch (e) { console.log(`Energy & Utilities: ERROR — ${e.message}`) }

  // ─── 93. Media Cloud (subscribers, content, ad campaigns, placements, events) ───
  try {
    const existingMd = await prisma.mediaSubscriber.findFirst({ where: { organizationId: orgId } })
    if (!existingMd) {
      const subscribersData = [
        { subscriberNumber: "SUB-800001", displayName: "Alex Rivera", email: "alex.rivera@example.com", tierSlug: "premium", billingRegion: "US", status: "active", revenueCents: 11988 },
        { subscriberNumber: "SUB-800002", displayName: "Jamie Cole", email: "jamie.cole@example.com", tierSlug: "premium-plus", billingRegion: "GB", status: "active", revenueCents: 23976 },
        { subscriberNumber: "SUB-800003", displayName: "Taylor Brooks", email: "taylor.brooks@example.com", tierSlug: "free", billingRegion: "US", status: "trial", revenueCents: 0 },
        { subscriberNumber: "SUB-800004", displayName: "Morgan Diaz", email: "morgan.diaz@example.com", tierSlug: "premium", billingRegion: "FR", status: "active", revenueCents: 9990 },
        { subscriberNumber: "SUB-800005", displayName: "Casey Lin", email: "casey.lin@example.com", tierSlug: "family", billingRegion: "US", status: "churned", revenueCents: 35964 },
        { subscriberNumber: "SUB-800006", displayName: "Jordan Pat", email: "jordan.pat@example.com", tierSlug: "free", billingRegion: "DE", status: "trial", revenueCents: 0 },
      ]
      const mdSubs = []
      for (const s of subscribersData) {
        const { revenueCents, ...rest } = s
        const trialStartedAt = new Date(now - 200 * DAY)
        mdSubs.push(await prisma.mediaSubscriber.create({
          data: {
            ...rest,
            organizationId: orgId,
            trialStartedAt,
            activatedAt: ["active", "paused", "churned"].includes(s.status) ? new Date(now - 185 * DAY) : null,
            churnedAt: s.status === "churned" ? new Date(now - 15 * DAY) : null,
            lifetimeRevenueCents: BigInt(revenueCents),
            contactId: createdContacts[mdSubs.length]?.id ?? null,
          },
        }))
      }

      const contentData = [
        { contentSlug: "future-of-ai-2026", contentKind: "article", title: "The Future of AI in 2026", byline: "Editorial Team", status: "published", monetization: "metered", wordCount: 1850, genreSlug: "technology", languageCode: "en", pubOffset: -20 },
        { contentSlug: "market-weekly-ep42", contentKind: "podcast", title: "Market Weekly — Episode 42", byline: "Finance Desk", status: "published", monetization: "ad_supported", durationSeconds: 2640, genreSlug: "business", languageCode: "en", pubOffset: -7 },
        { contentSlug: "deep-dive-climate", contentKind: "video", title: "Deep Dive: Climate Tech", byline: "Science Unit", status: "published", monetization: "premium_only", durationSeconds: 1920, genreSlug: "science", languageCode: "en", pubOffset: -3 },
        { contentSlug: "breaking-elections", contentKind: "article", title: "Breaking: Election Results Analysis", byline: "Politics Desk", status: "published", monetization: "paywalled", wordCount: 2400, genreSlug: "politics", languageCode: "en", pubOffset: -1 },
        { contentSlug: "live-keynote-2026", contentKind: "live_stream", title: "Annual Keynote — Live", byline: "Events Team", status: "scheduled", monetization: "free", durationSeconds: 5400, genreSlug: "technology", languageCode: "en", schedOffset: 6 },
        { contentSlug: "draft-investigative", contentKind: "article", title: "Investigative Series (Draft)", byline: "Investigations", status: "draft", monetization: "metered", wordCount: 3200, genreSlug: "investigative", languageCode: "en" },
      ]
      const mdContent = []
      for (const c of contentData) {
        const { pubOffset, schedOffset, ...rest } = c
        mdContent.push(await prisma.mediaContentInventory.create({
          data: {
            ...rest,
            organizationId: orgId,
            licensedRegions: ["US", "GB", "FR", "DE"],
            scheduledAt: c.status === "scheduled" ? new Date(now + (schedOffset || 6) * DAY) : null,
            publishedAt: c.status === "published" ? new Date(now + (pubOffset || -5) * DAY) : null,
          },
        }))
      }

      const campaignsData = [
        { campaignNumber: "ADC-900001", name: "Q2 Brand Awareness — TechCo", status: "running", campaignGoal: "brand_awareness", totalBudget: 50000, dailyBudgetCap: 1500, spentAmount: 18400, advertiserIdx: 0, flightStartOffset: -12, flightEndOffset: 18 },
        { campaignNumber: "ADC-900002", name: "Spring Retargeting — ShopNow", status: "completed", campaignGoal: "retargeting", totalBudget: 30000, dailyBudgetCap: 1000, spentAmount: 29850, advertiserIdx: 1, flightStartOffset: -45, flightEndOffset: -10 },
        { campaignNumber: "ADC-900003", name: "Product Launch Teaser", status: "draft", campaignGoal: "reach", totalBudget: 20000, dailyBudgetCap: null, spentAmount: 0, advertiserIdx: 2, flightStartOffset: null, flightEndOffset: null },
      ]
      const mdCampaigns = []
      for (const c of campaignsData) {
        const { advertiserIdx, flightStartOffset, flightEndOffset, ...rest } = c
        const live = ["running", "paused", "completed"].includes(c.status)
        mdCampaigns.push(await prisma.mediaAdCampaign.create({
          data: {
            ...rest,
            organizationId: orgId,
            advertiserCompanyId: createdCompanies[advertiserIdx]?.id ?? null,
            currency: "USD",
            flightStartAt: flightStartOffset !== null ? new Date(now + flightStartOffset * DAY) : null,
            flightEndAt: flightEndOffset !== null ? new Date(now + flightEndOffset * DAY) : null,
            targetingCriteria: { geos: ["US", "GB"], interests: ["technology", "business"], ageRange: "25-54" },
            creativeAssetRefs: [`creative-${c.campaignNumber}-a`, `creative-${c.campaignNumber}-b`],
            startedAt: live ? new Date(now + (flightStartOffset ?? -12) * DAY) : null,
            completedAt: c.status === "completed" ? new Date(now + (flightEndOffset ?? -10) * DAY) : null,
          },
        }))
      }

      // Placements
      const placementsData = [
        { campaignIdx: 0, contentIdx: 1, slotKind: "pre_roll", status: "live", pricingModel: "cpm", bidAmount: 18.5, impressions: 240000, clicks: 3600, conversions: 180, spent: 4440, startOffset: -10 },
        { campaignIdx: 0, contentIdx: 2, slotKind: "mid_roll", status: "live", pricingModel: "cpm", bidAmount: 22.0, impressions: 158000, clicks: 2100, conversions: 95, spent: 3476, startOffset: -8 },
        { campaignIdx: 1, contentIdx: 0, slotKind: "banner", status: "completed", pricingModel: "cpc", bidAmount: 1.2, impressions: 980000, clicks: 14200, conversions: 540, spent: 17040, startOffset: -44 },
        { campaignIdx: 1, contentIdx: 3, slotKind: "native_inline", status: "completed", pricingModel: "cpa", bidAmount: 24.0, impressions: 420000, clicks: 5800, conversions: 310, spent: 7440, startOffset: -40 },
      ]
      const mdPlacements = []
      for (const p of placementsData) {
        const { campaignIdx, contentIdx, impressions, clicks, conversions, spent, startOffset, ...rest } = p
        const startedAt = ["live", "paused", "completed"].includes(p.status) ? new Date(now + startOffset * DAY) : null
        mdPlacements.push(await prisma.mediaAdPlacement.create({
          data: {
            ...rest,
            organizationId: orgId,
            campaignId: mdCampaigns[campaignIdx].id,
            contentId: mdContent[contentIdx]?.id ?? null,
            impressionCount: BigInt(impressions),
            clickCount: BigInt(clicks),
            conversionCount: BigInt(conversions),
            placementSpentAmount: spent,
            startedAt,
            completedAt: p.status === "completed" ? new Date(startedAt.getTime() + 30 * DAY) : null,
          },
        }))
      }

      // Consumption events
      const eventKinds = ["view_start", "view_progress", "view_complete", "click", "conversion", "bookmark"]
      const devices = ["web", "mobile_web", "ios_app", "android_app", "smart_tv"]
      let evCount = 0
      for (let i = 0; i < 12; i++) {
        const kind = eventKinds[i % eventKinds.length]
        const content = mdContent[i % 4] // published items only
        await prisma.mediaConsumptionEvent.create({
          data: {
            organizationId: orgId,
            subscriberId: mdSubs[i % mdSubs.length]?.id ?? null,
            contentId: content.id,
            placementId: (kind === "click" || kind === "conversion") ? mdPlacements[i % mdPlacements.length]?.id ?? null : null,
            eventKind: kind,
            occurredAt: new Date(now - (i + 1) * 2 * DAY),
            progressPct: kind === "view_progress" ? 45 + (i % 5) * 10 : (kind === "view_complete" ? 100 : null),
            engagedSeconds: kind.startsWith("view") ? 60 + i * 15 : null,
            deviceKind: devices[i % devices.length],
            regionCode: ["US", "GB", "FR", "DE"][i % 4],
          },
        })
        evCount++
      }
      console.log(`Media Cloud: ${mdSubs.length} subscribers, ${contentData.length} content items, ${campaignsData.length} ad campaigns, ${placementsData.length} placements, ${evCount} events`)
    } else {
      console.log("Media Cloud: (existing, skipped)")
    }
  } catch (e) { console.log(`Media Cloud: ERROR — ${e.message}`) }

  // ─── 94. Loyalty Program (tiers, earn rules, accounts, transactions, promo codes) ───
  try {
    const existingLoy = await prisma.loyaltyTier.findFirst({ where: { organizationId: orgId } })
    if (!existingLoy) {
      const tiersData = [
        { code: "bronze", name: "Bronze", description: "Entry tier — every member starts here.", minLifetimePoints: 0, multiplier: 1.0, benefits: { perks: ["birthday_bonus"] } },
        { code: "silver", name: "Silver", description: "1,000+ lifetime points.", minLifetimePoints: 1000, multiplier: 1.25, benefits: { perks: ["birthday_bonus", "free_shipping"] } },
        { code: "gold", name: "Gold", description: "5,000+ lifetime points.", minLifetimePoints: 5000, multiplier: 1.5, benefits: { perks: ["birthday_bonus", "free_shipping", "priority_support"] } },
      ]
      for (const t of tiersData) await prisma.loyaltyTier.create({ data: { ...t, organizationId: orgId, createdBy: user.id } })

      const earnRulesData = [
        { name: "Purchase points", trigger: "purchase", pointsRate: 1, pointsFlat: null, minOrderAmount: 0, priority: 10, applyTierMultiplier: true },
        { name: "Signup bonus", trigger: "signup", pointsRate: null, pointsFlat: 200, minOrderAmount: null, priority: 5, applyTierMultiplier: false },
        { name: "Referral reward", trigger: "referral", pointsRate: null, pointsFlat: 500, minOrderAmount: null, priority: 5, applyTierMultiplier: false },
        { name: "Birthday gift", trigger: "birthday", pointsRate: null, pointsFlat: 250, minOrderAmount: null, priority: 1, applyTierMultiplier: false },
      ]
      for (const r of earnRulesData) await prisma.loyaltyEarnRule.create({ data: { ...r, organizationId: orgId, createdBy: user.id } })

      // Accounts — points ≤ lifetimePoints (CHECK); tier + tierUpgradedAt set together (CHECK).
      const accountSpecs = [
        { contactIdx: 0, lifetime: 6200, points: 4100, tier: "gold" },
        { contactIdx: 1, lifetime: 2400, points: 1850, tier: "silver" },
        { contactIdx: 2, lifetime: 800, points: 800, tier: "bronze" },
        { contactIdx: 3, lifetime: 1500, points: 300, tier: "silver" },
        { contactIdx: 4, lifetime: 150, points: 150, tier: "bronze" },
      ]
      let txCount = 0
      for (const a of accountSpecs) {
        const contact = createdContacts[a.contactIdx]
        if (!contact) continue
        const acct = await prisma.loyaltyAccount.create({
          data: { organizationId: orgId, contactId: contact.id, points: a.points, lifetimePoints: a.lifetime, tier: a.tier, tierUpgradedAt: new Date(now - 30 * DAY) },
        })
        // earn rows: lifetimeDelta = delta (CHECK: earn ⇒ 0 < lifetimeDelta ≤ delta)
        const earns = [Math.round(a.lifetime * 0.6), a.lifetime - Math.round(a.lifetime * 0.6)].filter((n) => n > 0)
        for (let i = 0; i < earns.length; i++) {
          await prisma.loyaltyTransaction.create({
            data: { organizationId: orgId, loyaltyAccountId: acct.id, type: "earn", delta: earns[i], lifetimeDelta: earns[i], reason: "Purchase reward", referenceId: `INV-LOY-${a.contactIdx}-${i}`, createdBy: user.id, createdAt: new Date(now - (60 - i * 20) * DAY) },
          })
          txCount++
        }
        // redeem row: negative delta, lifetimeDelta MUST be 0 (CHECK)
        const redeemed = a.lifetime - a.points
        if (redeemed > 0) {
          await prisma.loyaltyTransaction.create({
            data: { organizationId: orgId, loyaltyAccountId: acct.id, type: "redeem", delta: -redeemed, lifetimeDelta: 0, reason: "Reward redemption", createdBy: user.id, createdAt: new Date(now - 5 * DAY) },
          })
          txCount++
        }
      }

      // Promo codes — currency coherence (CHECK): percentage ⇒ currency NULL; fixed ⇒ currency set.
      const promoData = [
        { code: "SUMMER25", description: "25% off summer promo", discountType: "percentage", discountValue: 25, currency: null, minOrderAmount: 50, usageLimit: 1000, perCustomerLimit: 1, validFrom: new Date(now - 30 * DAY), validUntil: new Date(now + 30 * DAY) },
        { code: "WELCOME10", description: "$10 off your first order", discountType: "fixed", discountValue: 10, currency: "USD", minOrderAmount: 25, usageLimit: null, perCustomerLimit: 1, validFrom: new Date(now - 60 * DAY), validUntil: null },
        { code: "VIP15", description: "15% VIP discount", discountType: "percentage", discountValue: 15, currency: null, minOrderAmount: null, usageLimit: 200, perCustomerLimit: 3, validFrom: new Date(now - 10 * DAY), validUntil: new Date(now + 90 * DAY) },
      ]
      let redCount = 0
      for (const pd of promoData) {
        const promo = await prisma.promoCode.create({ data: { ...pd, organizationId: orgId, isActive: true, createdBy: user.id } })
        if (pd.code !== "VIP15") {
          for (let i = 0; i < 2; i++) {
            await prisma.promoCodeRedemption.create({
              data: { organizationId: orgId, promoCodeId: promo.id, contactId: createdContacts[i]?.id ?? null, referenceId: `INV-PROMO-${pd.code}-${i}`, referenceType: "invoice", discountApplied: pd.discountType === "percentage" ? 12.5 : pd.discountValue, currency: pd.currency ?? "USD", redeemedAt: new Date(now - (i + 1) * 7 * DAY) },
            })
            redCount++
          }
        }
      }
      console.log(`Loyalty: ${tiersData.length} tiers, ${earnRulesData.length} earn rules, ${accountSpecs.length} accounts, ${txCount} transactions, ${promoData.length} promo codes (${redCount} redemptions)`)
    } else {
      console.log("Loyalty: (existing, skipped)")
    }
  } catch (e) { console.log(`Loyalty: ERROR — ${e.message}`) }

  // ─── 95. Subscriptions (plans, customer subscriptions, events) ───
  try {
    const existingSub = await prisma.subscription.findFirst({ where: { organizationId: orgId } })
    if (!existingSub) {
      const plansData = [
        { name: "Starter", description: "Up to 3 users.", unitAmount: 29, billingInterval: "month", billingIntervalCount: 1, trialDays: 14 },
        { name: "Professional", description: "Up to 25 users.", unitAmount: 99, billingInterval: "month", billingIntervalCount: 1, trialDays: 14 },
        { name: "Enterprise (Annual)", description: "Unlimited users, billed yearly.", unitAmount: 4800, billingInterval: "year", billingIntervalCount: 1, trialDays: 0 },
      ]
      const plans = []
      for (const pl of plansData) plans.push(await prisma.subscriptionPlan.create({ data: { ...pl, organizationId: orgId, currency: "USD", isActive: true, createdBy: user.id } }))

      // Each status carries its coherent timestamps (CHECK): cancelled⟺cancelledAt;
      // paused⇒pausedAt set & resumedAt NULL; cancelAtPeriodEnd never with cancelled.
      const subSpecs = [
        { planIdx: 1, companyIdx: 0, status: "active", startOffset: -10, len: 30 },
        { planIdx: 0, companyIdx: 1, status: "trial", startOffset: -3, len: 14, trial: true },
        { planIdx: 2, companyIdx: 2, status: "active", startOffset: -120, len: 365, cancelAtPeriodEnd: true },
        { planIdx: 1, companyIdx: 3, status: "paused", startOffset: -20, len: 30 },
        { planIdx: 0, companyIdx: 4, status: "cancelled", startOffset: -45, len: 30 },
        { planIdx: 1, companyIdx: 5, status: "past_due", startOffset: -35, len: 30 },
      ]
      let evCount = 0
      for (const s of subSpecs) {
        const plan = plans[s.planIdx]
        const company = createdCompanies[s.companyIdx]
        if (!plan || !company) continue
        const start = new Date(now + s.startOffset * DAY)
        const end = new Date(start.getTime() + s.len * DAY)
        const isPaused = s.status === "paused"
        const isCancelled = s.status === "cancelled"
        const sub = await prisma.subscription.create({
          data: {
            organizationId: orgId, planId: plan.id, companyId: company.id,
            status: s.status,
            trialEndsAt: s.trial ? end : null,
            currentPeriodStart: start, currentPeriodEnd: end,
            nextBillingAt: isPaused || isCancelled ? null : end,
            cancelledAt: isCancelled ? new Date(now - 5 * DAY) : null,
            cancelAtPeriodEnd: s.cancelAtPeriodEnd ?? false,
            pausedAt: isPaused ? new Date(now - 8 * DAY) : null,
            currency: "USD", unitAmount: plan.unitAmount, billingInterval: plan.billingInterval, billingIntervalCount: plan.billingIntervalCount,
            createdBy: user.id, createdAt: start,
          },
        })
        await prisma.subscriptionEvent.create({ data: { organizationId: orgId, subscriptionId: sub.id, eventType: "created", newStatus: s.trial ? "trial" : "active", occurredAt: start } })
        evCount++
        if (isCancelled) { await prisma.subscriptionEvent.create({ data: { organizationId: orgId, subscriptionId: sub.id, eventType: "cancelled", previousStatus: "active", newStatus: "cancelled", occurredAt: new Date(now - 5 * DAY) } }); evCount++ }
        if (isPaused) { await prisma.subscriptionEvent.create({ data: { organizationId: orgId, subscriptionId: sub.id, eventType: "paused", previousStatus: "active", newStatus: "paused", occurredAt: new Date(now - 8 * DAY) } }); evCount++ }
        if (s.cancelAtPeriodEnd) { await prisma.subscriptionEvent.create({ data: { organizationId: orgId, subscriptionId: sub.id, eventType: "cancel_scheduled", occurredAt: new Date(now - 2 * DAY) } }); evCount++ }
      }
      console.log(`Subscriptions: ${plansData.length} plans, ${subSpecs.length} subscriptions, ${evCount} events`)
    } else {
      console.log("Subscriptions: (existing, skipped)")
    }
  } catch (e) { console.log(`Subscriptions: ERROR — ${e.message}`) }

  // ─── 96. Quotes / CPQ (quotes + line items) ───
  try {
    const existingQuote = await prisma.quote.findFirst({ where: { organizationId: orgId } })
    if (!existingQuote) {
      const prods = await prisma.product.findMany({ where: { organizationId: orgId }, take: 6 })
      const someDeals = await prisma.deal.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" }, take: 6 })
      // discountAmount XOR discountPct (never both — slice-2 route invariant): set one, leave the other default.
      const quoteSpecs = [
        { num: "Q-2026-0001", status: "accepted", dealIdx: 0, companyIdx: 0, sentOffset: -20, items: [{ pi: 0, qty: 10, unit: 2400 }, { pi: 1, qty: 1, unit: 12000 }], discountPct: 5 },
        { num: "Q-2026-0002", status: "sent", dealIdx: 1, companyIdx: 1, sentOffset: -4, items: [{ pi: 2, qty: 5, unit: 8500 }], discountAmount: 2000 },
        { num: "Q-2026-0003", status: "viewed", dealIdx: 2, companyIdx: 2, sentOffset: -2, items: [{ pi: 0, qty: 25, unit: 2400 }, { pi: 3, qty: 1, unit: 18000 }] },
        { num: "Q-2026-0004", status: "draft", dealIdx: 3, companyIdx: 3, items: [{ pi: 1, qty: 2, unit: 12000 }] },
        { num: "Q-2026-0005", status: "rejected", dealIdx: 4, companyIdx: 4, sentOffset: -30, items: [{ pi: 2, qty: 3, unit: 8500 }], rejectedReason: "Chose a competitor on price." },
      ]
      let liCount = 0
      for (const q of quoteSpecs) {
        const lineItems = q.items.map((it, idx) => ({ prod: prods[it.pi], qty: it.qty, unit: it.unit, lineTotal: it.qty * it.unit, idx }))
        const subtotal = lineItems.reduce((s, li) => s + li.lineTotal, 0)
        let discountAmount = 0, discountPct = null, totalAmount = subtotal
        if (q.discountPct) { discountPct = q.discountPct; totalAmount = Math.round(subtotal * (1 - q.discountPct / 100) * 100) / 100 }
        else if (q.discountAmount) { discountAmount = q.discountAmount; totalAmount = subtotal - q.discountAmount }
        const sentAt = q.sentOffset != null ? new Date(now + q.sentOffset * DAY) : null
        const quote = await prisma.quote.create({
          data: {
            organizationId: orgId, quoteNumber: q.num, version: 1,
            dealId: someDeals[q.dealIdx]?.id ?? null,
            status: q.status,
            validUntil: new Date(now + 30 * DAY), currency: "USD",
            subtotal, discountAmount, discountPct, totalAmount,
            customerName: createdCompanies[q.companyIdx]?.name ?? null,
            notes: "Demo quote generated by Quick Start.",
            sentAt,
            viewedAt: ["viewed", "accepted"].includes(q.status) ? new Date((sentAt?.getTime() ?? now) + 1 * DAY) : null,
            acceptedAt: q.status === "accepted" ? new Date((sentAt?.getTime() ?? now) + 3 * DAY) : null,
            rejectedAt: q.status === "rejected" ? new Date((sentAt?.getTime() ?? now) + 5 * DAY) : null,
            rejectedReason: q.rejectedReason ?? null,
            trackingToken: `qt-${slug}-${q.num}`,
            createdBy: user.id,
          },
        })
        for (const li of lineItems) {
          await prisma.quoteLineItem.create({
            data: { quoteId: quote.id, productId: li.prod?.id ?? null, productName: li.prod?.name ?? "Custom service", sku: li.prod?.sku ?? null, productType: li.prod?.productType ?? "other", quantity: li.qty, unitPrice: li.unit, lineDiscountAmount: 0, lineTotal: li.lineTotal, sortOrder: li.idx },
          })
          liCount++
        }
      }
      console.log(`Quotes/CPQ: ${quoteSpecs.length} quotes, ${liCount} line items`)
    } else {
      console.log("Quotes/CPQ: (existing, skipped)")
    }
  } catch (e) { console.log(`Quotes/CPQ: ERROR — ${e.message}`) }

  // ─── 97. Sales Sequences / Cadences (sequences, steps, enrollments) ───
  try {
    const existingSeq = await prisma.salesSequence.findFirst({ where: { organizationId: orgId } })
    if (!existingSeq) {
      const someLeads = await prisma.lead.findMany({ where: { organizationId: orgId }, take: 6 })
      const seqData = [
        { name: "New Lead Nurture (7-day)", description: "Welcome + value touches for fresh inbound leads.", steps: [
          { stepOrder: 1, type: "email", delayDays: 0, subject: "Welcome to LeadDrive 👋", body: "Thanks for your interest! Here's how teams like yours get started." },
          { stepOrder: 2, type: "email", delayDays: 2, subject: "A 2-minute product tour", body: "See the 3 features customers love most." },
          { stepOrder: 3, type: "call", delayDays: 4, subject: "Discovery call", body: "Qualify the lead and book a demo." },
          { stepOrder: 4, type: "task", delayDays: 7, subject: "Send tailored case study", body: "Pick the case study matching their industry." },
        ] },
        { name: "Demo No-Show Re-engage", description: "Win back prospects who missed a scheduled demo.", steps: [
          { stepOrder: 1, type: "email", delayDays: 0, subject: "Sorry we missed you", body: "Let's find a better time for your demo." },
          { stepOrder: 2, type: "call", delayDays: 2, subject: "Re-book demo", body: "Quick call to reschedule." },
        ] },
      ]
      let stepCount = 0, enrollCount = 0
      let firstSeqId = null
      for (const s of seqData) {
        const seq = await prisma.salesSequence.create({ data: { organizationId: orgId, name: s.name, description: s.description, isActive: true, createdBy: user.id } })
        if (!firstSeqId) firstSeqId = seq.id
        for (const st of s.steps) { await prisma.sequenceStep.create({ data: { ...st, sequenceId: seq.id, organizationId: orgId } }); stepCount++ }
      }
      const enrollees = [
        ...someLeads.slice(0, 3).map((l) => ({ entityType: "lead", entityId: l.id, status: "active", currentStep: 1 })),
        ...createdContacts.slice(0, 2).map((c) => ({ entityType: "contact", entityId: c.id, status: "completed", currentStep: 4 })),
      ]
      for (const e of enrollees) {
        await prisma.sequenceEnrollment.create({
          data: { sequenceId: firstSeqId, organizationId: orgId, entityType: e.entityType, entityId: e.entityId, status: e.status, currentStep: e.currentStep, nextStepAt: e.status === "active" ? new Date(now + 2 * DAY) : null, completedAt: e.status === "completed" ? new Date(now - 1 * DAY) : null, enrolledBy: user.id },
        })
        enrollCount++
      }
      console.log(`Sequences: ${seqData.length} sequences, ${stepCount} steps, ${enrollCount} enrollments`)
    } else { console.log("Sequences: (existing, skipped)") }
  } catch (e) { console.log(`Sequences: ERROR — ${e.message}`) }

  // ─── 98. Chatbot Rules (auto-reply rules for the inbox) ───
  try {
    const existingCbr = await prisma.chatbotRule.findFirst({ where: { organizationId: orgId } })
    if (!existingCbr) {
      const rules = [
        { name: "Greeting auto-reply", status: "active", channelTypes: [], triggerType: "contains", triggerValue: "hi,hello,hey,salam", responseText: "Hi! 👋 Thanks for reaching out. An agent will be with you shortly — meanwhile, how can I help?", priority: 10 },
        { name: "Pricing inquiry", status: "active", channelTypes: ["telegram", "whatsapp"], triggerType: "contains", triggerValue: "price,pricing,cost,how much", responseText: "Our plans are tailored per team. I'll connect you with sales for a quote!", priority: 20 },
        { name: "Business hours", status: "active", channelTypes: [], triggerType: "always", triggerValue: null, responseText: "We're online Mon–Fri, 9:00–18:00. We'll reply as soon as we're back!", priority: 1 },
        { name: "Refund policy (draft)", status: "draft", channelTypes: ["email"], triggerType: "contains", triggerValue: "refund,money back", responseText: "Refund policy: full refund within 14 days. (Draft — pending legal review.)", priority: 5 },
      ]
      for (const r of rules) await prisma.chatbotRule.create({ data: { ...r, organizationId: orgId, createdBy: user.id } })
      console.log(`Chatbot Rules: ${rules.length}`)
    } else { console.log("Chatbot Rules: (existing, skipped)") }
  } catch (e) { console.log(`Chatbot Rules: ERROR — ${e.message}`) }

  // ─── 99. Entitlements (SLA entitlements, milestone defs, ticket milestones, audit) ───
  try {
    const existingEnt = await prisma.entitlement.findFirst({ where: { organizationId: orgId } })
    if (!existingEnt) {
      const sla = await prisma.slaPolicy.findFirst({ where: { organizationId: orgId } })
      const tickets = await prisma.ticket.findMany({ where: { organizationId: orgId }, take: 4 })
      if (sla) {
        // At most one ACTIVE entitlement per company (partial unique) → distinct companies.
        const entSpecs = [
          { companyIdx: 0, supportLevel: "enterprise", status: "active" },
          { companyIdx: 1, supportLevel: "premium", status: "active" },
          { companyIdx: 2, supportLevel: "standard", status: "draft" },
        ]
        let defCount = 0, msCount = 0, aeCount = 0
        for (const es of entSpecs) {
          const company = createdCompanies[es.companyIdx]
          if (!company) continue
          const ent = await prisma.entitlement.create({
            data: { organizationId: orgId, companyId: company.id, slaPolicyId: sla.id, supportLevel: es.supportLevel, status: es.status, validFrom: new Date(now - 90 * DAY), validTo: new Date(now + 275 * DAY), createdBy: user.id },
          })
          await prisma.entitlementAuditEvent.create({ data: { organizationId: orgId, entitlementId: ent.id, eventType: "entitlement_created", actorUserId: user.id, occurredAt: new Date(now - 90 * DAY) } })
          aeCount++
          if (es.status === "active") { await prisma.entitlementAuditEvent.create({ data: { organizationId: orgId, entitlementId: ent.id, eventType: "entitlement_activated", actorUserId: user.id, occurredAt: new Date(now - 89 * DAY) } }); aeCount++ }
          const defs = [
            { type: "first_response", name: "First Response", severityTier: null, dueWithinSeconds: 3600 },
            { type: "resolution", name: "Resolution", severityTier: null, dueWithinSeconds: 86400 },
          ]
          const createdDefs = []
          for (const d of defs) { createdDefs.push(await prisma.entitlementMilestoneDefinition.create({ data: { ...d, organizationId: orgId, entitlementId: ent.id } })); defCount++ }
          if (es.status === "active" && tickets.length) {
            const t = tickets[es.companyIdx % tickets.length]
            const def = createdDefs[0]
            const status = es.companyIdx === 0 ? "met" : "in_progress"
            await prisma.entitlementTicketMilestone.create({
              data: { organizationId: orgId, ticketId: t.id, definitionId: def.id, type: def.type, status, dueAt: new Date(now + 1 * DAY), completedAt: status === "met" ? new Date(now - 2 * DAY) : null },
            })
            msCount++
          }
        }
        console.log(`Entitlements: ${entSpecs.length} entitlements, ${defCount} milestone defs, ${msCount} ticket milestones, ${aeCount} audit events`)
      } else { console.log("Entitlements: (skipped — no SLA policy)") }
    } else { console.log("Entitlements: (existing, skipped)") }
  } catch (e) { console.log(`Entitlements: ERROR — ${e.message}`) }

  // ─── 100. Attribution Models (models + calculation runs) ───
  try {
    const existingAttr = await prisma.attributionModel.findFirst({ where: { organizationId: orgId } })
    if (!existingAttr) {
      // isDefault: at most one per org (partial unique) → only Last Touch is default.
      const modelsData = [
        { name: "Last Touch", modelType: "last_touch", status: "active", isDefault: true, config: {} },
        { name: "Linear", modelType: "linear", status: "active", isDefault: false, config: {} },
        { name: "U-Shaped (40/20/40)", modelType: "u_shaped", status: "draft", isDefault: false, config: { firstWeight: 0.4, middleWeight: 0.2, lastWeight: 0.4 } },
      ]
      let runCount = 0
      for (const m of modelsData) {
        const model = await prisma.attributionModel.create({ data: { ...m, organizationId: orgId, createdBy: user.id } })
        if (m.status === "active") {
          const startedAt = new Date(now - 1 * DAY)
          await prisma.attributionCalculationRun.create({
            data: { organizationId: orgId, modelId: model.id, status: "succeeded", triggerSource: "cron", dealsTotal: 12, dealsProcessed: 12, influencesWritten: 28, startedAt, endedAt: new Date(startedAt.getTime() + 45 * 1000) },
          })
          runCount++
        }
      }
      console.log(`Attribution: ${modelsData.length} models, ${runCount} calculation runs`)
    } else { console.log("Attribution: (existing, skipped)") }
  } catch (e) { console.log(`Attribution: ERROR — ${e.message}`) }

  // ─── 101. Contract Templates + Milestones ───
  try {
    const existingCt = await prisma.contractTemplate.findFirst({ where: { organizationId: orgId } })
    if (!existingCt) {
      const templates = [
        { slug: "service-agreement-standard", name: "Standard Service Agreement", description: "Default MSA for new customers.", defaultContractType: "service_agreement", defaultDurationMonths: 12,
          clauses: [{ id: "c1", title: "Scope of Services", body: "Provider shall deliver {{service_name}} per the agreed SoW." }, { id: "c2", title: "Term", body: "This agreement runs for {{duration_months}} months from {{start_date}}." }, { id: "c3", title: "Fees", body: "Customer shall pay {{annual_fee}} {{currency}} annually." }],
          variables: [{ name: "service_name", type: "string", required: true }, { name: "duration_months", type: "number", required: true, default: 12 }, { name: "annual_fee", type: "number", required: true }] },
        { slug: "nda-mutual", name: "Mutual NDA", description: "Two-way confidentiality agreement.", defaultContractType: "nda", defaultDurationMonths: 24,
          clauses: [{ id: "c1", title: "Confidential Information", body: "Each party may disclose confidential information to the other." }, { id: "c2", title: "Term", body: "Obligations survive for {{duration_months}} months." }],
          variables: [{ name: "duration_months", type: "number", required: true, default: 24 }] },
      ]
      for (const t of templates) await prisma.contractTemplate.create({ data: { ...t, organizationId: orgId, isActive: true, createdBy: user.id } })
      const contracts = await prisma.contract.findMany({ where: { organizationId: orgId }, take: 4 })
      const msSpecs = [
        { label: "Kickoff & onboarding", status: "completed", dueOffset: -30 },
        { label: "Phase 1 delivery", status: "in_progress", dueOffset: 15 },
        { label: "Final acceptance", status: "pending", dueOffset: 60 },
      ]
      let msCount = 0
      for (let i = 0; i < contracts.length; i++) {
        const spec = msSpecs[i % msSpecs.length]
        await prisma.contractMilestone.create({
          data: { organizationId: orgId, contractId: contracts[i].id, label: spec.label, description: `${spec.label} milestone.`, dueAt: new Date(now + spec.dueOffset * DAY), status: spec.status, completedAt: spec.status === "completed" ? new Date(now - 28 * DAY) : null, ownerUserId: user.id, createdBy: user.id },
        })
        msCount++
      }
      console.log(`Contract Templates: ${templates.length} templates, ${msCount} milestones`)
    } else { console.log("Contract Templates: (existing, skipped)") }
  } catch (e) { console.log(`Contract Templates: ERROR — ${e.message}`) }

  // ─── 102. Account Engagement / Pardot (marketing accounts, intent signals, score snapshots) ───
  try {
    const existingMa = await prisma.marketingAccount.findFirst({ where: { organizationId: orgId } })
    if (!existingMa) {
      const stageOrder = ["engaged", "mql", "sql", "opportunity", "customer"]
      // Cumulative stage timestamps satisfy the marketing_accounts_*_coherence CHECKs
      // (e.g. stage='customer' ⇒ all became*At from engaged→customer set).
      const stageTs = (stage) => {
        const idx = stageOrder.indexOf(stage)
        const ts = {}
        if (idx >= 0) ts.becameEngagedAt = new Date(now - 50 * DAY)
        if (idx >= 1) ts.becameMqlAt = new Date(now - 40 * DAY)
        if (idx >= 2) ts.becameSqlAt = new Date(now - 30 * DAY)
        if (idx >= 3) ts.becameOpportunityAt = new Date(now - 20 * DAY)
        if (idx >= 4) ts.becameCustomerAt = new Date(now - 10 * DAY)
        return ts
      }
      const accSpecs = [
        { companyIdx: 0, accountName: null, stage: "customer", icpTier: "tier_1", grade: "A", score: 92, employeeBand: "enterprise", revenue: 50000000 },
        { companyIdx: 1, accountName: null, stage: "opportunity", icpTier: "tier_1", grade: "B", score: 78, employeeBand: "mid_market", revenue: 12000000 },
        { companyIdx: 2, accountName: null, stage: "sql", icpTier: "tier_2", grade: "B", score: 64, employeeBand: "mid_market", revenue: 8000000 },
        { companyIdx: 3, accountName: null, stage: "mql", icpTier: "tier_2", grade: "C", score: 48, employeeBand: "small", revenue: 2000000 },
        { companyIdx: 4, accountName: null, stage: "engaged", icpTier: "tier_3", grade: "C", score: 35, employeeBand: "small", revenue: 1000000 },
        { companyIdx: null, accountName: "Acme Strategic (target)", stage: "target", icpTier: "tier_1", grade: "unassigned", score: 12, employeeBand: "strategic", revenue: 200000000 },
        { companyIdx: 6, accountName: null, stage: "churned", icpTier: "tier_3", grade: "D", score: 20, employeeBand: "small", revenue: 1500000, churn: true },
      ]
      const signalKinds = ["page_view_high_intent", "content_download", "form_submission", "email_engagement", "event_attendance"]
      let sigCount = 0, snapCount = 0
      for (const a of accSpecs) {
        const company = a.companyIdx != null ? createdCompanies[a.companyIdx] : null
        const acct = await prisma.marketingAccount.create({
          data: { organizationId: orgId, companyId: company?.id ?? null, accountName: a.accountName ?? company?.name ?? "Marketing Account", lifecycleStage: a.stage, icpTier: a.icpTier, grade: a.grade, engagementScore: a.score, employeeBand: a.employeeBand, annualRevenueUsd: a.revenue != null ? BigInt(a.revenue) : null, ownerUserId: user.id, lastSignalAt: new Date(now - 3 * DAY), ...stageTs(a.stage), churnedAt: a.churn ? new Date(now - 10 * DAY) : null, churnReason: a.churn ? "Budget cut — paused vendor spend." : null },
        })
        const nSig = Math.max(2, Math.round(a.score / 20))
        for (let i = 0; i < nSig; i++) {
          await prisma.accountIntentSignal.create({
            data: { organizationId: orgId, marketingAccountId: acct.id, signalKind: signalKinds[i % signalKinds.length], weight: Math.min(100, 10 + i * 15), contactId: company ? createdContacts[a.companyIdx]?.id ?? null : null, occurredAt: new Date(now - (i + 1) * 3 * DAY) },
          })
          sigCount++
        }
        await prisma.accountScoreSnapshot.create({
          data: { organizationId: orgId, marketingAccountId: acct.id, snapshotAt: new Date(now - 7 * DAY), engagementScore: Math.max(0, a.score - 5), grade: a.grade, icpTier: a.icpTier, lifecycleStage: a.stage, signalCounts: { page_view_high_intent: nSig }, rationale: "Weekly score recompute." },
        })
        snapCount++
      }
      console.log(`Account Engagement: ${accSpecs.length} accounts, ${sigCount} intent signals, ${snapCount} score snapshots`)
    } else { console.log("Account Engagement: (existing, skipped)") }
  } catch (e) { console.log(`Account Engagement: ERROR — ${e.message}`) }

  // ─── Summary ───
  console.log("\n" + "═".repeat(50))
  console.log("Demo data seeded successfully!")
  console.log("═".repeat(50))
  console.log(`\nLogin:`)
  console.log(`  URL:      https://${slug}.leaddrivecrm.org/login`)
  console.log(`  Email:    ${user.email}`)
  console.log(`\nTeam accounts:`)
  for (const tm of teamMembers) {
    console.log(`  ${tm.email} (${tm.role})`)
  }
  console.log(`\nData summary:`)
  console.log(`  Companies:      ${companies.length}`)
  console.log(`  Contacts:       ${contacts.length}`)
  console.log(`  Deals:          ${deals.length} (total value: $${deals.reduce((s, d) => s + d.valueAmount, 0).toLocaleString()})`)
  console.log(`  Leads:          ${leads.length}`)
  console.log(`  Tasks:          ${tasks.length}`)
  console.log(`  Tickets:        ${tickets.length}`)
  console.log(`  Campaigns:      ${campaigns.length}`)
  console.log(`  Activities:     ${activities.length}`)
  console.log(`  + Products, Contracts, Offers, Invoices, Bills`)
  console.log(`  + Bank Accounts, Funds, KB Articles, Email Templates`)
  console.log(`  + Segments, Journeys, Events, Projects, Reports`)
  console.log(`  + Notifications, Sales Forecasts, Currencies, SLA Policies`)
  console.log(`  + Ticket Queues, Workflows, AI Configs, Call Logs`)
  console.log(`  + Budget Plan, Pricing Parameters, Overhead Costs`)
  console.log(`  + Ticket Comments, Macros, Escalation Rules`)
  console.log(`  + Lead Assignment Rules, Sales Quotas, Custom Fields`)
  console.log(`  + Field Permissions, Deal Contact Roles, Competitors, Team Members`)
  console.log(`  + Landing Pages, Form Submissions, Contact Events, Email Logs`)
  console.log(`  + Campaign Variants, Invoice/Bill Payments, Fund Transactions`)
  console.log(`  + Payment Orders, Recurring Invoices, Cash Flow Entries`)
  console.log(`  + Dashboard Layout, Budget Cost Types, Sections, Actuals`)
  console.log(`  + Expense Forecasts, Cost Employees, Client Services`)
  console.log(`  + Cost Model Snapshots`)
  console.log(`  + Pricing Module v2 (Groups, Profiles, Categories, Services, Additional Sales)`)
  console.log(`  + Inbox (Channels, Conversations, Messages)`)
  console.log(`  + Project Members, Fund Rules`)
  console.log(`  + MTM (Agents, Customers, Routes, Visits, Tasks, Photos, Orders, Alerts, Settings, Notifications)`)
  console.log(`  + Audit Logs, Custom Field Values, Currency Rate History`)
  console.log(`  + Stage Validation Rules, Cost Model Logs, Budget Change Logs`)
  console.log(`  + Budget Forecast Entries, Budget Direction Templates`)
  console.log(`  + Budget Department Owners, Budget Approval Comments`)
  console.log(`  + Rolling Forecast Months, Journey Enrollments, Sharing Rules`)
  console.log(`  + Payment Registry Entries, Cash Flow Alerts`)
  console.log(`  + AI Alerts, AI Interaction Logs, AI Guardrails`)
  console.log(`  + MTM Audit Logs, Accounting Integrations`)
  console.log(`  + Webhooks, Custom Domains, Contract Files`)
  console.log(`  + Accounting Imports, Plan Requests`)
  console.log(`  + API Keys, AI Chat Sessions & Messages`)
  console.log(`  + Social Monitoring (Accounts + Mentions with sentiments)`)
  console.log(`  + Surveys (NPS/CSAT/CES with responses) + Unsubscribes`)
  console.log(`  + Complaints Register (Tickets + ComplaintMeta)`)
  console.log(`  + Health Cloud (Providers, Patients, Encounters, Care Plans, Records)`)
  console.log(`  + Insurance Cloud (Team, Policyholders, Policies, Beneficiaries, Claims)`)
  console.log(`  + Public Sector (Officials, Citizens, Cases, Licenses, Grants)`)
  console.log(`  + Energy & Utilities (Customers, Meters, Readings, Outages, Service Calls)`)
  console.log(`  + Media Cloud (Subscribers, Content, Ad Campaigns, Placements, Events)`)
  console.log(`  + Loyalty (Tiers, Earn Rules, Accounts, Transactions, Promo Codes + Redemptions)`)
  console.log(`  + Subscriptions (Plans, Customer Subscriptions, Events)`)
  console.log(`  + Quotes / CPQ (Quotes + Line Items)`)
  console.log(`  + Sales Sequences (Sequences, Steps, Enrollments)`)
  console.log(`  + Chatbot Rules (auto-reply)`)
  console.log(`  + Entitlements (SLA entitlements, Milestone Defs, Ticket Milestones, Audit)`)
  console.log(`  + Attribution (Models + Calculation Runs)`)
  console.log(`  + Contract Templates + Milestones`)
  console.log(`  + Account Engagement (Marketing Accounts, Intent Signals, Score Snapshots)`)
  console.log(`\n  Total: 102 sections, all major business modules covered (incl. 5 Phase-7 Industry Clouds)`)
  console.log(`  (Runtime-only models excluded: Account, AgentHandoff, AiPendingAction, MtmAgentLocation, PageView, PushSubscription)`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())
