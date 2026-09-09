// Seed demo data into the AFI Group (Agro Food Investment) tenant.
//
// Usage:
//   CONFIRM_PROD=1 SEED_PASSWORD='<policy-compliant-secret>' \
//     node scripts/seeds/afigroup.mjs --slug=afigroup
//
// Before running: provision the tenant via POST /api/v1/admin/tenants with
// seedDemoData:false (otherwise the generic pharma seed will run instead).
//
// The script is idempotent — every insert is guarded by findFirst. Safe to
// re-run after partial failures.

import { makeScriptPrisma } from "../_rls.mjs"
import bcrypt from "bcryptjs"
import { passwordPolicyError } from "../password-policy.mjs"

let prisma

if (process.env.CONFIRM_PROD !== "1") {
  throw new Error("Set CONFIRM_PROD=1 to run this production seed")
}

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split("=").slice(1).join("=") : null
}

async function main() {
  const slug = getArg("slug") || "afigroup"
  const password = process.env.SEED_PASSWORD ?? getArg("password")
  if (!password) throw new Error("Set SEED_PASSWORD or pass --password=<policy-compliant-secret>")
  const passwordError = passwordPolicyError(password)
  if (passwordError) throw new Error(`Seed password rejected: ${passwordError}`)
  const companyName = getArg("name") || "Agro Food Investment"
  const adminEmail = getArg("email") || `demo@${slug}.leaddrivecrm.org`

  prisma = await makeScriptPrisma()

  let org = await prisma.organization.findUnique({ where: { slug } })
  if (!org) {
    // Self-provision — mirrors provisionTenant() from src/lib/tenant-provisioning.ts
    // so the script is usable standalone without hitting the admin API.
    console.log(`Tenant "${slug}" not found — provisioning now...`)
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: companyName,
          slug,
          plan: "enterprise",
          maxUsers: 50,
          maxContacts: 50000,
          features: JSON.stringify([]),
          addons: [],
          branding: JSON.stringify({ companyName, primaryColor: "#10b981" }),
          isActive: true,
          serverType: "shared",
          provisionedAt: new Date(),
          provisionedBy: "seed-script",
        },
      })
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: adminEmail,
          name: "Rashad Rahimov (Demo)",
          passwordHash,
          role: "admin",
          isActive: true,
        },
      })
      const pipe = await tx.pipeline.create({
        data: { organizationId: organization.id, name: "Sales Pipeline", isDefault: true, sortOrder: 0 },
      })
      const stageSeeds = [
        { name: "LEAD",        displayName: "Lead",        color: "#6366f1", probability: 10,  sortOrder: 1 },
        { name: "QUALIFIED",   displayName: "Qualified",   color: "#3b82f6", probability: 25,  sortOrder: 2 },
        { name: "PROPOSAL",    displayName: "Proposal",    color: "#f59e0b", probability: 50,  sortOrder: 3 },
        { name: "NEGOTIATION", displayName: "Negotiation", color: "#f97316", probability: 75,  sortOrder: 4 },
        { name: "WON",         displayName: "Won",         color: "#22c55e", probability: 100, sortOrder: 5, isWon: true },
        { name: "LOST",        displayName: "Lost",        color: "#ef4444", probability: 0,   sortOrder: 6, isLost: true },
      ]
      for (const s of stageSeeds) {
        await tx.pipelineStage.create({ data: { ...s, organizationId: organization.id, pipelineId: pipe.id } })
      }
      const slas = [
        { name: "Critical", priority: "critical", firstResponseHours: 1,  resolutionHours: 4 },
        { name: "High",     priority: "high",     firstResponseHours: 4,  resolutionHours: 8 },
        { name: "Medium",   priority: "medium",   firstResponseHours: 8,  resolutionHours: 24 },
        { name: "Low",      priority: "low",      firstResponseHours: 24, resolutionHours: 72 },
      ]
      for (const s of slas) {
        await tx.slaPolicy.create({ data: { organizationId: organization.id, ...s } })
      }
      return { organization, user }
    })
    org = result.organization
    console.log(`Provisioned: ${org.name} (${slug}) — admin ${adminEmail}`)
  }

  const orgId = org.id
  console.log(`\nTenant: ${org.name} (${slug})  —  id=${orgId}`)
  console.log(`Plan: ${org.plan}`)
  console.log("─".repeat(60))

  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  // ─── Admin user ───
  let admin = await prisma.user.findFirst({ where: { organizationId: orgId, role: "admin" } })
  if (!admin) {
    const hash = await bcrypt.hash(password, 12)
    admin = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: adminEmail,
        name: "Rashad Rahimov (Demo)",
        passwordHash: hash,
        role: "admin",
        isActive: true,
      },
    })
    console.log(`Admin user created: ${admin.email}`)
  } else {
    const hash = await bcrypt.hash(password, 12)
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        email: adminEmail,
        passwordHash: hash,
        passwordChangedAt: new Date(),
        name: "Rashad Rahimov (Demo)",
      },
    })
    admin = await prisma.user.findUnique({ where: { id: admin.id } })
    console.log(`Admin user: ${admin.email} (password reset)`)
  }

  // ─── Team members (4) ───
  const teamMembers = [
    { name: "Tural Məmmədov", email: `tural.mammadov@${slug}.leaddrivecrm.org`, role: "manager" },
    { name: "Aynur Həsənli",  email: `aynur.hasanli@${slug}.leaddrivecrm.org`,  role: "member" },
    { name: "Elçin Abbasov",  email: `elchin.abbasov@${slug}.leaddrivecrm.org`, role: "member" },
    { name: "Nərmin Quliyeva",email: `narmin.guliyeva@${slug}.leaddrivecrm.org`,role: "member" },
  ]
  const teamUsers = []
  for (const tm of teamMembers) {
    let u = await prisma.user.findFirst({ where: { organizationId: orgId, email: tm.email } })
    if (!u) {
      const hash = await bcrypt.hash(password, 12)
      u = await prisma.user.create({
        data: { ...tm, organizationId: orgId, passwordHash: hash, isActive: true },
      })
    }
    teamUsers.push(u)
  }
  const [uTural, uAynur, uElchin, uNarmin] = teamUsers
  console.log(`Team members: ${teamUsers.length}`)

  // ─── Features (enable everything incl. AI) ───
  const allFeatures = [
    "deals", "leads", "tasks", "contracts", "campaigns", "journeys", "events",
    "omnichannel", "tickets", "voip", "knowledge-base", "portal", "invoices",
    "budgeting", "profitability", "currencies", "reports", "ai", "projects",
    "workflows", "custom-fields", "complaints_register",
    "ai_daily_briefing", "ai_anomaly_detection", "ai_lead_scoring",
    "ai_auto_followup_shadow", "ai_auto_acknowledge_shadow", "ai_auto_payment_reminder_shadow",
  ]
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      features: allFeatures,
      branding: {
        ...(typeof org.branding === "object" && org.branding !== null ? org.branding : {}),
        companyName: "Agro Food Investment",
        primaryColor: "#10b981",
      },
      settings: {
        ...(typeof org.settings === "object" && org.settings !== null ? org.settings : {}),
        aiDailyBudgetUsd: 10,
        language: "en",
      },
    },
  })
  console.log(`Features: ${allFeatures.length} enabled`)

  // ─── Pipeline + stages ───
  let pipeline = await prisma.pipeline.findFirst({ where: { organizationId: orgId, isDefault: true } })
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: { organizationId: orgId, name: "Holding Sales Pipeline", isDefault: true, sortOrder: 0 },
    })
  }
  let stages = await prisma.pipelineStage.findMany({
    where: { organizationId: orgId, pipelineId: pipeline.id },
    orderBy: { sortOrder: "asc" },
  })
  if (stages.length === 0) {
    const orphanStages = await prisma.pipelineStage.findMany({
      where: { organizationId: orgId, pipelineId: null },
    })
    if (orphanStages.length > 0) {
      for (const s of orphanStages) {
        await prisma.pipelineStage.update({ where: { id: s.id }, data: { pipelineId: pipeline.id } })
      }
    } else {
      const stageData = [
        { name: "LEAD",        displayName: "New Lead",    color: "#6366f1", probability: 10,  sortOrder: 0 },
        { name: "QUALIFIED",   displayName: "Qualified",   color: "#3b82f6", probability: 25,  sortOrder: 1 },
        { name: "PROPOSAL",    displayName: "Proposal",    color: "#f59e0b", probability: 50,  sortOrder: 2 },
        { name: "NEGOTIATION", displayName: "Negotiation", color: "#8b5cf6", probability: 75,  sortOrder: 3 },
        { name: "WON",         displayName: "Won",         color: "#10b981", probability: 100, sortOrder: 4, isWon: true },
        { name: "LOST",        displayName: "Lost",        color: "#ef4444", probability: 0,   sortOrder: 5, isLost: true },
      ]
      for (const s of stageData) {
        await prisma.pipelineStage.create({ data: { ...s, organizationId: orgId, pipelineId: pipeline.id } })
      }
    }
    stages = await prisma.pipelineStage.findMany({
      where: { organizationId: orgId, pipelineId: pipeline.id },
      orderBy: { sortOrder: "asc" },
    })
  }
  console.log(`Pipeline: ${pipeline.name} with ${stages.length} stages`)

  // ─── Currencies ───
  const currencies = [
    { code: "AZN", name: "Azerbaijani Manat", symbol: "₼", exchangeRate: 1.0,  isBase: true  },
    { code: "USD", name: "US Dollar",         symbol: "$", exchangeRate: 0.59, isBase: false },
    { code: "EUR", name: "Euro",              symbol: "€", exchangeRate: 0.54, isBase: false },
    { code: "RUB", name: "Russian Ruble",     symbol: "₽", exchangeRate: 54.0, isBase: false },
    { code: "TRY", name: "Turkish Lira",      symbol: "₺", exchangeRate: 22.5, isBase: false },
  ]
  for (const c of currencies) {
    const existing = await prisma.currency.findFirst({ where: { organizationId: orgId, code: c.code } })
    if (!existing) {
      await prisma.currency.create({ data: { ...c, organizationId: orgId, isActive: true } })
    }
  }
  console.log(`Currencies: ${currencies.length}`)

  // ─── Companies — 11 AFI subsidiaries (internal) ───
  const subsidiaryData = [
    { name: "AGRARCO OOO",                    vertical: "trading",         city: "Baku",      voen: "1700012345" },
    { name: "AQROVEST OOO",                   vertical: "investment",      city: "Baku",      voen: "1700023456" },
    { name: "ASTARACHAY OOO",                 vertical: "tea",             city: "Astara",    voen: "1700034567" },
    { name: "AZBADAM OOO",                    vertical: "almond-export",   city: "Shamkir",   voen: "1700045678" },
    { name: "AZROSE OOO",                     vertical: "rose-oil",        city: "Absheron",  voen: "1700056789" },
    { name: "GALA OLIVES OOO",                vertical: "olive-oil",       city: "Absheron",  voen: "1700067890" },
    { name: "GRAND AGRO INVITRO OOO",         vertical: "invitro-lab",     city: "Baku",      voen: "1700078901" },
    { name: "GRAND AGRO OOO",                 vertical: "flagship",        city: "Baku",      voen: "1700089012" },
    { name: "LECHEQ FARM AND DISTILLERY OOO", vertical: "distillery",      city: "Gabala",    voen: "1700090123" },
    { name: "SHAMKIR AGROPARK OOO",           vertical: "agropark",        city: "Shamkir",   voen: "1700101234" },
    { name: "Zəfər Bağları OOO",              vertical: "fruit-orchards",  city: "Guba",      voen: "1700112345" },
  ]
  const subsidiaries = []
  for (const s of subsidiaryData) {
    const existing = await prisma.company.findFirst({ where: { organizationId: orgId, name: s.name } })
    if (existing) { subsidiaries.push(existing); continue }
    const created = await prisma.company.create({
      data: {
        organizationId: orgId,
        name: s.name,
        industry: "Agriculture / Food Production",
        city: s.city,
        country: "Azerbaijan",
        voen: s.voen,
        costCode: "AFI-SUBSIDIARY",
        category: "internal",
        status: "active",
        description: `AFI subsidiary — vertical: ${s.vertical}. Part of Agro Food Investment holding (11 companies).`,
      },
    })
    subsidiaries.push(created)
  }
  console.log(`AFI subsidiaries (internal): ${subsidiaries.length}`)

  // ─── Companies — 18 external customers ───
  const externalData = [
    // Azerbaijan retail
    { name: "Bravo Supermarket",     industry: "Retail",        city: "Baku",      country: "Azerbaijan", category: "client",   website: "bravomarket.az",  phone: "+994 12 555 0101" },
    { name: "Bazarstore",            industry: "Retail",        city: "Baku",      country: "Azerbaijan", category: "client",   website: "bazarstore.az",   phone: "+994 12 555 0102" },
    { name: "Araz Market",           industry: "Retail",        city: "Ganja",     country: "Azerbaijan", category: "client",   website: "araz.az",         phone: "+994 22 555 0103" },
    { name: "Neptun Supermarket",    industry: "Retail",        city: "Baku",      country: "Azerbaijan", category: "prospect", website: "neptun.az",       phone: "+994 12 555 0104" },
    // Russia retail
    { name: "Metro Cash & Carry RU", industry: "Wholesale",     city: "Moscow",    country: "Russia",     category: "client",   website: "metro-cc.ru",     phone: "+7 495 500 9500" },
    { name: "Wildberries",           industry: "E-commerce",    city: "Moscow",    country: "Russia",     category: "client",   website: "wildberries.ru",  phone: "+7 495 500 0000" },
    { name: "Лента",                 industry: "Retail",        city: "St. Petersburg", country: "Russia", category: "prospect", website: "lenta.com",       phone: "+7 800 700 5000" },
    // EU
    { name: "Lidl Stiftung",         industry: "Retail",        city: "Neckarsulm",country: "Germany",    category: "prospect", website: "lidl.de",         phone: "+49 7132 30 0" },
    { name: "Ritter Sport",          industry: "Food Manufacturing", city: "Waldenbuch", country: "Germany", category: "prospect", website: "ritter-sport.com", phone: "+49 7157 97 0" },
    { name: "Carrefour France",      industry: "Retail",        city: "Paris",     country: "France",     category: "prospect", website: "carrefour.fr",    phone: "+33 1 55 63 3939" },
    // Turkey
    { name: "Migros Ticaret",        industry: "Retail",        city: "Istanbul",  country: "Turkey",     category: "client",   website: "migros.com.tr",   phone: "+90 212 319 1919" },
    { name: "Anadolu Tarım",         industry: "Distribution",  city: "Ankara",    country: "Turkey",     category: "client",   website: "anadolutarim.com",phone: "+90 312 555 2020" },
    // UAE / Asia
    { name: "Carrefour UAE",         industry: "Retail",        city: "Dubai",     country: "UAE",        category: "prospect", website: "carrefouruae.com",phone: "+971 4 800 7800" },
    { name: "JD.com",                industry: "E-commerce",    city: "Beijing",   country: "China",      category: "prospect", website: "jd.com",          phone: "+86 10 8911 8888" },
    // HoReCa AZ
    { name: "Chinar Restaurant Group",industry: "HoReCa",       city: "Baku",      country: "Azerbaijan", category: "client",   website: "chinar.az",       phone: "+994 12 404 0404" },
    { name: "Four Seasons Baku",     industry: "HoReCa",        city: "Baku",      country: "Azerbaijan", category: "client",   website: "fourseasons.com/baku", phone: "+994 12 404 2424" },
    { name: "JW Marriott Baku",      industry: "HoReCa",        city: "Baku",      country: "Azerbaijan", category: "client",   website: "marriott.com",    phone: "+994 12 490 0005" },
    // Distributors
    { name: "Azerbaijan Wine Company",industry: "Beverages",    city: "Shamakhi",  country: "Azerbaijan", category: "partner",  website: "azwine.az",       phone: "+994 20 555 0707" },
  ]
  const externals = []
  for (const e of externalData) {
    const existing = await prisma.company.findFirst({ where: { organizationId: orgId, name: e.name } })
    if (existing) { externals.push(existing); continue }
    const created = await prisma.company.create({
      data: {
        organizationId: orgId,
        name: e.name,
        industry: e.industry,
        city: e.city,
        country: e.country,
        category: e.category,
        status: "active",
        website: e.website,
        phone: e.phone,
      },
    })
    externals.push(created)
  }
  console.log(`External customers: ${externals.length}`)

  // Helper to index externals by name substring
  const extByName = (q) => externals.find((e) => e.name.toLowerCase().includes(q.toLowerCase()))

  // ─── Contacts (28) ───
  const contactData = [
    // Bravo — 2
    { email: "orxan.quliyev@bravomarket.az",   fullName: "Orxan Quliyev",   position: "Head of Procurement", company: "Bravo",    engagementScore: 82 },
    { email: "leyla.ismayilova@bravomarket.az",fullName: "Leyla İsmayılova",position: "Quality Manager",     company: "Bravo",    engagementScore: 68 },
    // Bazarstore — 2
    { email: "elvin.huseynov@bazarstore.az",   fullName: "Elvin Hüseynov",  position: "Commercial Director", company: "Bazarstore", engagementScore: 75 },
    { email: "aysel.ahmadova@bazarstore.az",   fullName: "Aysel Əhmədova",  position: "Category Manager",    company: "Bazarstore", engagementScore: 60 },
    // Araz — 1
    { email: "tural.mehdiyev@araz.az",         fullName: "Tural Mehdiyev",  position: "Procurement Lead",    company: "Araz",     engagementScore: 55 },
    // Neptun — 1
    { email: "samir.aliyev@neptun.az",         fullName: "Samir Əliyev",    position: "Buyer",               company: "Neptun",   engagementScore: 45 },
    // Metro RU — 2
    { email: "igor.volkov@metro-cc.ru",        fullName: "Igor Volkov",     position: "Senior Procurement Manager", company: "Metro",    engagementScore: 88 },
    { email: "elena.novikova@metro-cc.ru",     fullName: "Elena Novikova",  position: "Quality Control Lead",       company: "Metro",    engagementScore: 72 },
    // Wildberries — 1
    { email: "dmitry.kozlov@wildberries.ru",   fullName: "Dmitry Kozlov",   position: "Category Buyer",      company: "Wildberries", engagementScore: 65 },
    // Лента — 1
    { email: "anna.morozova@lenta.com",        fullName: "Anna Morozova",   position: "Import Manager",      company: "Лента",    engagementScore: 50 },
    // Lidl — 2
    { email: "markus.schneider@lidl.de",       fullName: "Markus Schneider",position: "Category Manager EU", company: "Lidl",     engagementScore: 78 },
    { email: "julia.weber@lidl.de",            fullName: "Julia Weber",     position: "Quality Compliance",  company: "Lidl",     engagementScore: 62 },
    // Ritter Sport — 2
    { email: "peter.hoffmann@ritter-sport.com",fullName: "Peter Hoffmann",  position: "Raw Materials Buyer", company: "Ritter",   engagementScore: 92 },
    { email: "stefan.koch@ritter-sport.com",   fullName: "Stefan Koch",     position: "R&D Manager",         company: "Ritter",   engagementScore: 70 },
    // Carrefour FR — 1
    { email: "pierre.dubois@carrefour.fr",     fullName: "Pierre Dubois",   position: "International Buyer", company: "Carrefour France", engagementScore: 58 },
    // Migros TR — 1
    { email: "ahmet.yilmaz@migros.com.tr",     fullName: "Ahmet Yılmaz",    position: "Procurement Director",company: "Migros",   engagementScore: 80 },
    // Anadolu Tarım — 1
    { email: "mehmet.demir@anadolutarim.com",  fullName: "Mehmet Demir",    position: "CEO",                 company: "Anadolu",  engagementScore: 74 },
    // Carrefour UAE — 1
    { email: "rashid.almansoori@carrefouruae.com", fullName: "Rashid Al Mansoori", position: "Fresh Buyer", company: "Carrefour UAE", engagementScore: 48 },
    // JD — 1
    { email: "li.wei@jd.com",                  fullName: "Li Wei",          position: "Imports Specialist",  company: "JD.com",   engagementScore: 42 },
    // Chinar — 2
    { email: "kamran.rustamov@chinar.az",      fullName: "Kamran Rüstəmov", position: "Head Chef / Sommelier", company: "Chinar",   engagementScore: 85 },
    { email: "nigar.valiyeva@chinar.az",       fullName: "Nigar Vəliyeva",  position: "F&B Manager",         company: "Chinar",   engagementScore: 68 },
    // Four Seasons — 1
    { email: "jean.martin@fourseasons.com",    fullName: "Jean Martin",     position: "Executive Chef",      company: "Four Seasons", engagementScore: 76 },
    // JW Marriott — 1
    { email: "oliver.brown@marriott.com",      fullName: "Oliver Brown",    position: "F&B Director",        company: "Marriott", engagementScore: 66 },
    // AzWine — 2
    { email: "vuqar.karimov@azwine.az",        fullName: "Vuqar Kərimov",   position: "COO",                 company: "Wine",     engagementScore: 89 },
    { email: "gunay.rasulova@azwine.az",       fullName: "Günay Rəsulova",  position: "Agronomy Lead",       company: "Wine",     engagementScore: 72 },
    // More
    { email: "yusif.babayev@metro-cc.ru",      fullName: "Yusif Babayev",   position: "Import Specialist",   company: "Metro",    engagementScore: 54 },
    { email: "sophie.lefevre@carrefour.fr",    fullName: "Sophie Lefèvre",  position: "Quality Assurance",   company: "Carrefour France", engagementScore: 52 },
    { email: "arif.mammadov@bazarstore.az",    fullName: "Arif Məmmədov",   position: "Buyer (Fresh)",       company: "Bazarstore", engagementScore: 58 },
  ]
  const contacts = []
  for (const c of contactData) {
    const existing = await prisma.contact.findFirst({ where: { organizationId: orgId, email: c.email } })
    if (existing) { contacts.push(existing); continue }
    const co = extByName(c.company)
    if (!co) { console.warn(`  contact skipped — company not found: ${c.company}`); continue }
    const created = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId: co.id,
        fullName: c.fullName,
        email: c.email,
        position: c.position,
        engagementScore: c.engagementScore,
        isActive: true,
        tags: [],
        source: "referral",
      },
    })
    contacts.push(created)
  }
  console.log(`Contacts: ${contacts.length}`)

  const contactByEmail = (e) => contacts.find((c) => c.email === e)

  // ─── Products (10) ───
  const productData = [
    { name: "AZBADAM Almond Gift Pack 500g",                 category: "product", price: 12,  currency: "AZN", description: "Premium packaged almonds, retail-ready 500g gift box",                 tags: ["azbadam","retail"] },
    { name: "AZBADAM Raw Almond Bulk (per kg)",              category: "product", price: 18,  currency: "USD", description: "Unshelled raw almonds, export-grade, MOQ 5 MT",                          tags: ["azbadam","export","wholesale"] },
    { name: "GALA Olive Oil Extra Virgin 500ml",             category: "product", price: 8,   currency: "AZN", description: "Extra virgin olive oil, cold-pressed, glass bottle 500ml",               tags: ["gala-olives","retail"] },
    { name: "GALA Table Olives (per kg)",                    category: "product", price: 6,   currency: "AZN", description: "Green table olives, brine-cured",                                        tags: ["gala-olives","retail"] },
    { name: "ASTARACHAY Black Tea Premium 100g",             category: "product", price: 4,   currency: "AZN", description: "Premium black tea from Astara region",                                   tags: ["astarachay","retail"] },
    { name: "ASTARACHAY Green Tea 100g",                     category: "product", price: 5,   currency: "AZN", description: "Single-origin green tea, hand-rolled",                                    tags: ["astarachay","retail"] },
    { name: "AZROSE Rose Essential Oil 5ml",                 category: "product", price: 180, currency: "AZN", description: "Pure Damask rose essential oil, cosmetic grade",                         tags: ["azrose","export","cosmetic"] },
    { name: "GRAND AGRO INVITRO Apricot Sapling (per unit)", category: "product", price: 3,   currency: "USD", description: "Virus-free tissue-culture apricot saplings, wholesale",                  tags: ["grand-agro-invitro","wholesale"] },
    { name: "LECHEQ XO Brandy 5yr (0.7L)",                   category: "product", price: 45,  currency: "AZN", description: "Aged brandy, 5-year barrel, traditional Azerbaijani distillery",         tags: ["lecheq","retail","horeca"] },
    { name: "Zəfər Bağları Fresh Stone Fruits (per kg)",     category: "product", price: 2,   currency: "AZN", description: "Mixed seasonal stone fruits — apricot, peach, plum, cherry",             tags: ["zefer-bagi","fresh"] },
  ]
  for (const p of productData) {
    const existing = await prisma.product.findFirst({ where: { organizationId: orgId, name: p.name } })
    if (!existing) {
      await prisma.product.create({ data: { ...p, organizationId: orgId, isActive: true } })
    }
  }
  console.log(`Products: ${productData.length}`)

  // ─── Deals (18) ───
  // Helper: pick stage by name
  const stageBy = (name) => stages.find((s) => s.name === name)

  const subBy = (substr) => subsidiaries.find((s) => s.name.toLowerCase().includes(substr.toLowerCase()))

  const dealSpecs = [
    // LEAD (2)
    { name: "ASTARACHAY → Trendyol TR — Tea listing",              stage: "LEAD", ext: "Migros",       contact: "ahmet.yilmaz@migros.com.tr",    sub: "ASTARACHAY", value: 42000,  currency: "USD", assignee: uAynur, ageDays: 2  },
    { name: "AZROSE → Chanel supplier trial — Rose essential oil", stage: "LEAD", ext: "Carrefour France", contact: "pierre.dubois@carrefour.fr", sub: "AZROSE",     value: 68000,  currency: "EUR", assignee: uAynur, ageDays: 4  },

    // QUALIFIED (4)
    { name: "AZBADAM → Migros TR Q2 (15 MT almonds)",     stage: "QUALIFIED", ext: "Migros",           contact: "ahmet.yilmaz@migros.com.tr",      sub: "AZBADAM",     value: 195000, currency: "USD", assignee: uAynur,  ageDays: 8  },
    { name: "GALA → Carrefour FR — Olive oil tender",     stage: "QUALIFIED", ext: "Carrefour France", contact: "pierre.dubois@carrefour.fr",      sub: "GALA",        value: 120000, currency: "EUR", assignee: uAynur,  ageDays: 6  },
    { name: "LECHEQ → JW Marriott Baku — Annual supply",  stage: "QUALIFIED", ext: "Marriott",         contact: "oliver.brown@marriott.com",       sub: "LECHEQ",      value: 38000,  currency: "AZN", assignee: uElchin, ageDays: 5  },
    { name: "Zəfər → Bravo — Weekly fresh delivery",      stage: "QUALIFIED", ext: "Bravo",            contact: "orxan.quliyev@bravomarket.az",    sub: "Zəfər",       value: 24000,  currency: "AZN", assignee: uElchin, ageDays: 3  },

    // PROPOSAL (5)
    { name: "AZBADAM → Metro RU Q2 (40 MT almond shipment)",       stage: "PROPOSAL", ext: "Metro",        contact: "igor.volkov@metro-cc.ru",          sub: "AZBADAM",          value: 480000, currency: "USD", assignee: uTural,  ageDays: 14 },
    { name: "GALA → Lidl DE — Private-label olive oil listing",    stage: "PROPOSAL", ext: "Lidl",         contact: "markus.schneider@lidl.de",         sub: "GALA",             value: 310000, currency: "EUR", assignee: uAynur,  ageDays: 11 },
    { name: "GRAND AGRO INVITRO → AzWine — 5000 grape saplings",   stage: "PROPOSAL", ext: "Wine",         contact: "vuqar.karimov@azwine.az",          sub: "GRAND AGRO INVITRO", value: 135000, currency: "AZN", assignee: uTural,  ageDays: 9  },
    { name: "ASTARACHAY → Wildberries — Tea wholesale 20 MT",      stage: "PROPOSAL", ext: "Wildberries",  contact: "dmitry.kozlov@wildberries.ru",     sub: "ASTARACHAY",       value: 220000, currency: "RUB", assignee: uAynur,  ageDays: 16 },
    { name: "AZBADAM → Ritter Sport — Almond trial 2 MT",          stage: "PROPOSAL", ext: "Ritter",       contact: "peter.hoffmann@ritter-sport.com",  sub: "AZBADAM",          value: 52000,  currency: "EUR", assignee: uAynur,  ageDays: 7  },

    // NEGOTIATION (3)
    { name: "GALA → Metro RU — Premium tier (volume discount)",    stage: "NEGOTIATION", ext: "Metro",       contact: "elena.novikova@metro-cc.ru",     sub: "GALA",       value: 280000, currency: "EUR", assignee: uTural,  ageDays: 5  },
    { name: "LECHEQ → Four Seasons Baku — Exclusive brandy",       stage: "NEGOTIATION", ext: "Four Seasons",contact: "jean.martin@fourseasons.com",    sub: "LECHEQ",     value: 48000,  currency: "AZN", assignee: uElchin, ageDays: 4  },
    { name: "AZROSE → Chanel EU supplier — 2kg rose essential",    stage: "NEGOTIATION", ext: "Carrefour France", contact: "sophie.lefevre@carrefour.fr", sub: "AZROSE",     value: 95000,  currency: "EUR", assignee: uAynur,  ageDays: 3  },

    // WON (3)
    { name: "AZBADAM → Metro RU Q1 — Closed (5 MT almond)",        stage: "WON", ext: "Metro",         contact: "igor.volkov@metro-cc.ru",             sub: "AZBADAM",    value: 68000,  currency: "USD", assignee: uTural,  ageDays: 22 },
    { name: "ASTARACHAY → Chinar — 6-month tea contract",          stage: "WON", ext: "Chinar",        contact: "kamran.rustamov@chinar.az",           sub: "ASTARACHAY", value: 18000,  currency: "AZN", assignee: uElchin, ageDays: 35 },
    { name: "Zəfər Bağları → Bravo — Weekly fresh (12 mo)",        stage: "WON", ext: "Bravo",         contact: "leyla.ismayilova@bravomarket.az",     sub: "Zəfər",      value: 72000,  currency: "AZN", assignee: uElchin, ageDays: 40 },

    // LOST (1)
    { name: "GRAND AGRO INVITRO → Anadolu — Lost on price",        stage: "LOST", ext: "Anadolu",       contact: "mehmet.demir@anadolutarim.com",      sub: "GRAND AGRO INVITRO", value: 88000, currency: "USD", assignee: uTural, ageDays: 60 },
  ]

  const createdDeals = []
  for (const d of dealSpecs) {
    const existing = await prisma.deal.findFirst({ where: { organizationId: orgId, name: d.name } })
    if (existing) { createdDeals.push(existing); continue }
    const extCo = extByName(d.ext)
    const ct = contactByEmail(d.contact)
    const sub = subBy(d.sub)
    const stageObj = stageBy(d.stage)
    if (!extCo || !stageObj) { console.warn(`  deal skipped (no company/stage): ${d.name}`); continue }
    const probabilityMap = { LEAD: 10, QUALIFIED: 25, PROPOSAL: 50, NEGOTIATION: 75, WON: 100, LOST: 0 }
    const stageChangedAt = new Date(now - d.ageDays * DAY)
    const expectedClose = ["WON","LOST"].includes(d.stage) ? null : new Date(now + (10 + Math.random() * 60) * DAY)
    const created = await prisma.deal.create({
      data: {
        organizationId: orgId,
        pipelineId: pipeline.id,
        name: d.name,
        companyId: extCo.id,
        contactId: ct?.id,
        stage: d.stage,
        valueAmount: d.value,
        probability: probabilityMap[d.stage] || 0,
        currency: d.currency,
        assignedTo: d.assignee?.id || admin.id,
        salesChannel: sub?.name || null,
        tags: sub ? [sub.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")] : [],
        expectedClose,
        stageChangedAt,
        metadata: sub ? { subsidiaryId: sub.id, subsidiaryName: sub.name } : null,
      },
    })
    createdDeals.push(created)
  }
  console.log(`Deals: ${createdDeals.length}  (distribution: ${stageCounts(createdDeals).map(x => x.join("=")).join(", ")})`)

  // ─── Leads (9) ───
  const leadSpecs = [
    { contactName: "Burak Aydın",      companyName: "Ankara Import Co.",    email: "burak@ankaraimport.com.tr",   phone: "+90 312 555 4444", source: "website",   status: "new",       priority: "high",   score: 82, estimatedValue: 145000, notes: "Interested in almond bulk import, 10MT/quarter" },
    { contactName: "Sergey Ivanov",    companyName: "SPb Food Import",       email: "s.ivanov@spbfood.ru",         phone: "+7 812 555 1111",  source: "website",   status: "new",       priority: "medium", score: 68, estimatedValue: 85000,  notes: "Wants to add Astara tea to their B2B catalog" },
    { contactName: "Maria Chen",       companyName: "HK Natural Foods",      email: "m.chen@hknatfoods.hk",        phone: "+852 5555 2222",   source: "website",   status: "contacted", priority: "medium", score: 72, estimatedValue: 120000, notes: "Inquiry about rose essential oil" },
    { contactName: "Ali Haciyev",      companyName: "Baku Gourmet Shops",    email: "ali@bakugourmet.az",          phone: "+994 50 555 3333", source: "whatsapp",  status: "contacted", priority: "high",   score: 88, estimatedValue: 32000,  notes: "Wants premium olive oil + brandy combo for gift sets" },
    { contactName: "Rauf Veliyev",     companyName: "Nakhchivan Distribution",email: "rauf@nxdistrib.az",           phone: "+994 50 555 4444", source: "whatsapp",  status: "qualified", priority: "medium", score: 75, estimatedValue: 55000,  notes: "Regional distributor for fresh fruits" },
    { contactName: "Aziz Karimov",     companyName: "Dubai Foods Trading",    email: "a.karimov@dubaifoods.ae",     phone: "+971 50 555 5555", source: "event",     status: "new",       priority: "high",   score: 90, estimatedValue: 210000, notes: "Met at Gulfood 2026. Interested in export contracts" },
    { contactName: "Tatyana Orlova",   companyName: "Moscow Premium Retail",  email: "t.orlova@mospremium.ru",      phone: "+7 495 555 6666",  source: "referral",  status: "contacted", priority: "medium", score: 65, estimatedValue: 95000,  notes: "Referred by Metro. Interested in premium brandy" },
    { contactName: "Hans Mueller",     companyName: "Hamburg Organic Imports",email: "h.mueller@hh-organic.de",    phone: "+49 40 555 7777",  source: "social",    status: "new",       priority: "low",    score: 48, estimatedValue: 62000,  notes: "LinkedIn outreach, organic certification interest" },
    { contactName: "Kenji Tanaka",     companyName: "Tokyo Fine Foods",       email: "k.tanaka@tokyofine.jp",       phone: "+81 3 5555 8888",  source: "email",     status: "new",       priority: "medium", score: 58, estimatedValue: 48000,  notes: "Email inquiry, interested in green tea import" },
  ]
  const createdLeads = []
  for (const l of leadSpecs) {
    const existing = await prisma.lead.findFirst({ where: { organizationId: orgId, email: l.email } })
    if (existing) { createdLeads.push(existing); continue }
    const created = await prisma.lead.create({
      data: { ...l, organizationId: orgId, assignedTo: admin.id },
    })
    createdLeads.push(created)
  }
  console.log(`Leads: ${createdLeads.length}`)

  // ─── Tasks (18) ───
  const taskSpecs = [
    { title: "Send COA for AZBADAM almond lot #2026-04",         status: "in_progress", priority: "high",   dueDate: 3,   linkedDealIdx: 6,  description: "Certificate of Analysis required by Metro procurement before Q2 shipment" },
    { title: "Call Metro Moscow buyer Igor Volkov",              status: "pending",     priority: "high",   dueDate: 1,   linkedDealIdx: 6,  description: "Discuss tier pricing and volume commitment for Q2" },
    { title: "Prepare almond samples for Ritter Sport",          status: "pending",     priority: "medium", dueDate: 5,   linkedDealIdx: 10, description: "Package 3 grade samples, include provenance documentation" },
    { title: "Review Lidl PL proposal",                          status: "in_progress", priority: "high",   dueDate: 4,   linkedDealIdx: 7,  description: "Legal + pricing review for private-label listing proposal" },
    { title: "Invitro saplings delivery plan — AzWine",          status: "pending",     priority: "medium", dueDate: 7,   linkedDealIdx: 8,  description: "Schedule staged delivery for 5000 grape saplings, coordinate with nursery" },
    { title: "Draft Wildberries tea wholesale agreement",        status: "in_progress", priority: "medium", dueDate: 6,   linkedDealIdx: 9,  description: "Include SKU list, minimum order, delivery SLA" },
    { title: "Chinar — monthly tea replenishment",               status: "completed",   priority: "low",    dueDate: -5,  linkedDealIdx: 16, description: "April batch delivered, confirmed by Kamran Rüstəmov" },
    { title: "Follow-up with Chanel suppliers",                  status: "pending",     priority: "high",   dueDate: 2,   linkedDealIdx: 1,  description: "Confirm rose essential oil sample spec, arrange call" },
    { title: "Pilot program proposal — Carrefour France",        status: "in_progress", priority: "medium", dueDate: 8,   linkedDealIdx: 3,  description: "Olive oil tender submission: pricing, logistics, certifications" },
    { title: "Fresh fruits seasonal catalog — Bravo",            status: "completed",   priority: "medium", dueDate: -3,  linkedDealIdx: 5,  description: "Q2 availability calendar sent to Bravo category manager" },
    { title: "JW Marriott exclusive brandy — tasting event",     status: "pending",     priority: "low",    dueDate: 14,  linkedDealIdx: 4,  description: "Organize on-site tasting for F&B director and sommelier" },
    { title: "Export compliance check — Ritter shipment",        status: "in_progress", priority: "high",   dueDate: 5,   linkedDealIdx: 10, description: "German import regulations, labeling requirements" },
    { title: "Follow up Burak Aydın (lead)",                     status: "pending",     priority: "high",   dueDate: 2,   linkedLeadIdx: 0,  description: "Intro call scheduled — discovery on volume requirements" },
    { title: "Send product deck to Tokyo Fine Foods",            status: "pending",     priority: "medium", dueDate: 3,   linkedLeadIdx: 8,  description: "Translated product catalog (JP), tea varieties focus" },
    { title: "Gulfood follow-up — Aziz Karimov",                 status: "in_progress", priority: "high",   dueDate: 4,   linkedLeadIdx: 5,  description: "Proposal for export to UAE retail chain" },
    { title: "Quality audit — Zefer Bağları packhouse",          status: "pending",     priority: "medium", dueDate: 10,  linkedDealIdx: null, description: "HACCP compliance audit before peak fruit season" },
    { title: "Monthly sales pipeline review",                    status: "pending",     priority: "low",    dueDate: 2,   linkedDealIdx: null, description: "Compile pipeline metrics by subsidiary for CEO briefing" },
    { title: "Expired lead re-engagement campaign",              status: "pending",     priority: "low",    dueDate: 7,   linkedDealIdx: null, description: "Segment and email leads with no activity >30 days" },
  ]
  const createdTasks = []
  for (const t of taskSpecs) {
    const existing = await prisma.task.findFirst({ where: { organizationId: orgId, title: t.title } })
    if (existing) { createdTasks.push(existing); continue }
    let relatedType = null, relatedId = null
    if (typeof t.linkedDealIdx === "number" && createdDeals[t.linkedDealIdx]) {
      relatedType = "deal"; relatedId = createdDeals[t.linkedDealIdx].id
    } else if (typeof t.linkedLeadIdx === "number" && createdLeads[t.linkedLeadIdx]) {
      relatedType = "lead"; relatedId = createdLeads[t.linkedLeadIdx].id
    }
    const due = new Date(now + t.dueDate * DAY)
    const completedAt = t.status === "completed" ? new Date(now + (t.dueDate - 1) * DAY) : null
    const data = {
      organizationId: orgId,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: due,
      assignedTo: admin.id,
      createdBy: admin.id,
      completedAt,
    }
    if (relatedId) { data.relatedType = relatedType; data.relatedId = relatedId }
    const created = await prisma.task.create({ data })
    createdTasks.push(created)
  }
  console.log(`Tasks: ${createdTasks.length}`)

  // ─── Tickets (8) AFI-2026-001..008 ───
  const ticketSpecs = [
    { num: "AFI-2026-001", subject: "Broken glass in olive oil batch GO-2026-031",   description: "Metro Russia received 12 bottles with cracked glass. Batch GO-2026-031 from Absheron. Customer demands replacement shipment + investigation.", priority: "high",     status: "in_progress", source: "web_chat", contactEmail: "elena.novikova@metro-cc.ru",       category: "quality-complaint", createdDaysAgo: 2,  resolved: false },
    { num: "AFI-2026-002", subject: "Late delivery — Metro Moscow Q1 almonds",       description: "40MT almond shipment delayed by 6 days due to customs hold. Metro procurement wants penalty clause waiver discussion.", priority: "high",     status: "in_progress", source: "whatsapp", contactEmail: "igor.volkov@metro-cc.ru",         category: "logistics",          createdDaysAgo: 5,  resolved: false },
    { num: "AFI-2026-003", subject: "Off-taste detected in tea batch ASTR-2026-018", description: "Wildberries QA found musty notes in 3 of 50 samples. Requesting root-cause analysis and new shipment.",        priority: "high",     status: "in_progress", source: "email",    contactEmail: "dmitry.kozlov@wildberries.ru",    category: "quality-complaint", createdDaysAgo: 3,  resolved: false },
    { num: "AFI-2026-004", subject: "Mislabelled rose oil pack sent to Lidl",        description: "Lidl DE received 100 units with incorrect French language on label (should be German). Requesting immediate relabel or replacement.", priority: "medium",   status: "open",        source: "portal",    contactEmail: "julia.weber@lidl.de",             category: "quality-complaint", createdDaysAgo: 1,  resolved: false },
    { num: "AFI-2026-005", subject: "Missing export documents — Ritter Sport",      description: "Container stuck at Hamburg port. Phytosanitary certificate was not in shipping docs. Need urgent courier of original cert.", priority: "high",     status: "in_progress", source: "email",    contactEmail: "peter.hoffmann@ritter-sport.com", category: "logistics-docs",     createdDaysAgo: 4,  resolved: false },
    { num: "AFI-2026-006", subject: "Wrong invoice amount — Chinar",                 description: "Invoice INV-AFI-2026-018 shows AZN amount but contract was in USD. Please reissue.",                                      priority: "low",      status: "resolved",    source: "portal",    contactEmail: "nigar.valiyeva@chinar.az",        category: "billing",            createdDaysAgo: 8,  resolved: true },
    { num: "AFI-2026-007", subject: "Allergen declaration request — Carrefour",     description: "Carrefour France compliance team needs signed allergen declaration for next olive oil tender submission.",               priority: "medium",   status: "open",        source: "email",    contactEmail: "sophie.lefevre@carrefour.fr",     category: "compliance",         createdDaysAgo: 2,  resolved: false },
    { num: "AFI-2026-008", subject: "Packaging dented — brandy shipment to DFS",    description: "Duty Free received 6 boxes with visible dents. Consumer-grade damage — not sellable. Photos attached.",                  priority: "medium",   status: "in_progress", source: "whatsapp", contactEmail: "oliver.brown@marriott.com",       category: "quality-complaint", createdDaysAgo: 6,  resolved: false },
  ]
  const slaHoursMap = { critical: 1, high: 2, medium: 4, low: 8 }
  const createdTickets = []
  for (const t of ticketSpecs) {
    const existing = await prisma.ticket.findFirst({ where: { organizationId: orgId, ticketNumber: t.num } })
    if (existing) { createdTickets.push(existing); continue }
    const ct = contactByEmail(t.contactEmail)
    const createdAt = new Date(now - t.createdDaysAgo * DAY)
    const slaHours = slaHoursMap[t.priority] || 4
    const slaFirstResponseDueAt = new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000)
    const slaDueAt = new Date(createdAt.getTime() + slaHours * 4 * 60 * 60 * 1000)
    const resolvedAt = t.resolved ? new Date(createdAt.getTime() + slaHours * 3 * 60 * 60 * 1000) : null
    const created = await prisma.ticket.create({
      data: {
        organizationId: orgId,
        ticketNumber: t.num,
        subject: t.subject,
        description: t.description,
        priority: t.priority,
        status: t.status,
        category: t.category,
        source: t.source,
        contactId: ct?.id,
        companyId: ct?.companyId,
        assignedTo: admin.id,
        createdBy: admin.id,
        createdAt,
        slaFirstResponseDueAt: t.resolved ? null : slaFirstResponseDueAt,
        slaDueAt,
        slaPolicyName: `${t.priority[0].toUpperCase()}${t.priority.slice(1)} Priority SLA`,
        firstResponseAt: new Date(createdAt.getTime() + Math.min(slaHours * 0.5, 2) * 60 * 60 * 1000),
        resolvedAt,
        closedAt: null,
        tags: [],
        escalationLevel: 0,
      },
    })
    createdTickets.push(created)
  }
  console.log(`Tickets: ${createdTickets.length} (AFI-2026-001..008)`)

  // ─── ComplaintMeta (5) for quality-complaint tickets ───
  const complaintMetaSpecs = [
    { ticketNum: "AFI-2026-001", brand: "GALA OLIVES",  productionArea: "Absheron",    productCategory: "olive-oil",      riskLevel: "high",   externalRegistryNumber: 20260001 },
    { ticketNum: "AFI-2026-002", brand: "AZBADAM",      productionArea: "Shamkir",     productCategory: "almond",         riskLevel: "medium", externalRegistryNumber: 20260002 },
    { ticketNum: "AFI-2026-003", brand: "ASTARACHAY",   productionArea: "Astara",      productCategory: "tea",            riskLevel: "high",   externalRegistryNumber: 20260003 },
    { ticketNum: "AFI-2026-004", brand: "AZROSE",       productionArea: "Absheron",    productCategory: "essential-oil",  riskLevel: "medium", externalRegistryNumber: 20260004 },
    { ticketNum: "AFI-2026-008", brand: "LECHEQ",       productionArea: "Gabala",      productCategory: "brandy",         riskLevel: "medium", externalRegistryNumber: 20260008 },
  ]
  let cmCount = 0
  for (const cm of complaintMetaSpecs) {
    const ticket = createdTickets.find((t) => t.ticketNumber === cm.ticketNum)
    if (!ticket) continue
    const existing = await prisma.complaintMeta.findFirst({ where: { ticketId: ticket.id } })
    if (existing) continue
    await prisma.complaintMeta.create({
      data: {
        organizationId: orgId,
        ticketId: ticket.id,
        complaintType: "complaint",
        externalRegistryNumber: cm.externalRegistryNumber,
        brand: cm.brand,
        productionArea: cm.productionArea,
        productCategory: cm.productCategory,
        riskLevel: cm.riskLevel,
      },
    })
    cmCount++
  }
  console.log(`Complaint meta rows: ${cmCount}`)

  // ─── Inbox: ChannelConfig + SocialConversation + ChannelMessage (6 channels) ───
  const existingChannels = await prisma.channelConfig.count({ where: { organizationId: orgId } })
  if (existingChannels === 0) {
    const waChannel = await prisma.channelConfig.create({
      data: { organizationId: orgId, channelType: "whatsapp", configName: "AFI WhatsApp Business", phoneNumber: "+994 50 100 2030", settings: { businessName: "Agro Food Investment" }, isActive: true, createdBy: admin.id },
    })
    const tgChannel = await prisma.channelConfig.create({
      data: { organizationId: orgId, channelType: "telegram", configName: "AFI Telegram Bot", settings: { botName: "AFIGroupBot" }, isActive: true, createdBy: admin.id },
    })
    const igChannel = await prisma.channelConfig.create({
      data: { organizationId: orgId, channelType: "instagram", configName: "AFI Instagram", pageId: "afigroup_official", settings: {}, isActive: true, createdBy: admin.id },
    })
    const fbChannel = await prisma.channelConfig.create({
      data: { organizationId: orgId, channelType: "facebook", configName: "AFI Facebook Page", pageId: "AgroFoodInvestment", settings: {}, isActive: true, createdBy: admin.id },
    })
    const emailChannel = await prisma.channelConfig.create({
      data: { organizationId: orgId, channelType: "email", configName: "Export Desk", settings: { inboxEmail: "export@afigroup.leaddrivecrm.org", signature: "AFI Export Team" }, isActive: true, createdBy: admin.id },
    })
    const webChatChannel = await prisma.channelConfig.create({
      data: { organizationId: orgId, channelType: "web_chat", configName: "afigroup.az Web Chat", settings: { widget: "afi-web-chat" }, isActive: true, createdBy: admin.id },
    })

    // Conversations
    const peterC = contactByEmail("peter.hoffmann@ritter-sport.com")
    const elenaC = contactByEmail("elena.novikova@metro-cc.ru")
    const dmitryC = contactByEmail("dmitry.kozlov@wildberries.ru")
    const ahmetC = contactByEmail("ahmet.yilmaz@migros.com.tr")
    const jeanC  = contactByEmail("jean.martin@fourseasons.com")

    const convWA = await prisma.socialConversation.create({
      data: { organizationId: orgId, channelConfigId: waChannel.id, contactId: peterC?.id || null, platform: "whatsapp", externalId: "afi-wa-001", contactName: "Peter Hoffmann (Ritter Sport)", lastMessage: "Need to confirm shipment date for almond trial.", status: "open", lastMessageAt: new Date(now - 1 * 60 * 60 * 1000), unreadCount: 1, assignedTo: uAynur?.id || admin.id },
    })
    const convTG = await prisma.socialConversation.create({
      data: { organizationId: orgId, channelConfigId: tgChannel.id, contactId: ahmetC?.id || null, platform: "telegram", externalId: "afi-tg-001", contactName: "Ahmet Yılmaz (Migros)", lastMessage: "Можем увеличить объём чая на 20%?", status: "open", lastMessageAt: new Date(now - 3 * 60 * 60 * 1000), unreadCount: 2, assignedTo: uAynur?.id || admin.id },
    })
    const convIG = await prisma.socialConversation.create({
      data: { organizationId: orgId, channelConfigId: igChannel.id, contactId: jeanC?.id || null, platform: "instagram", externalId: "afi-ig-001", contactName: "Jean Martin (Four Seasons)", lastMessage: "Interested in bulk fresh fruits for new summer menu.", status: "open", lastMessageAt: new Date(now - 6 * 60 * 60 * 1000), unreadCount: 1, assignedTo: uElchin?.id || admin.id },
    })
    const convFB = await prisma.socialConversation.create({
      data: { organizationId: orgId, channelConfigId: fbChannel.id, contactId: null, platform: "facebook", externalId: "afi-fb-001", contactName: "Iranian Distributor (Tehran Imports)", lastMessage: "Rose essential oil pricing for 2kg order?", status: "open", lastMessageAt: new Date(now - 12 * 60 * 60 * 1000), unreadCount: 1, assignedTo: uAynur?.id || admin.id },
    })
    const convEM = await prisma.socialConversation.create({
      data: { organizationId: orgId, channelConfigId: emailChannel.id, contactId: elenaC?.id || null, platform: "email", externalId: "afi-em-001", contactName: "Elena Novikova (Metro)", lastMessage: "URGENT quality issue batch GO-2026-031 — replacement requested.", status: "open", lastMessageAt: new Date(now - 5 * 60 * 60 * 1000), unreadCount: 3, assignedTo: admin.id },
    })
    const convWC = await prisma.socialConversation.create({
      data: { organizationId: orgId, channelConfigId: webChatChannel.id, contactId: null, platform: "web_chat", externalId: "afi-wc-001", contactName: "Turkish Importer (anonymous)", lastMessage: "Looking for almond samples, 2MT trial order.", status: "open", lastMessageAt: new Date(now - 20 * 60 * 60 * 1000), unreadCount: 1 },
    })

    const msg = async (data) => prisma.channelMessage.create({ data: { ...data, organizationId: orgId } })

    // WhatsApp — Ritter
    await msg({ channelConfigId: waChannel.id, conversationId: convWA.id, direction: "inbound",  channelType: "whatsapp", contactId: peterC?.id, from: "+49 7157 97 100",     to: "+994 50 100 2030", body: "Hi team, following up on the almond trial shipment to Hamburg. Do you have an ETA?",                                   status: "read",      messageType: "text", createdAt: new Date(now - 26 * 60 * 60 * 1000) })
    await msg({ channelConfigId: waChannel.id, conversationId: convWA.id, direction: "outbound", channelType: "whatsapp", contactId: peterC?.id, from: "+994 50 100 2030",    to: "+49 7157 97 100",  body: "Hi Peter. Shipment cleared customs today. ETA Hamburg: Tuesday 15:00 local time. Sending BL by email.", status: "delivered", messageType: "text", createdAt: new Date(now - 24 * 60 * 60 * 1000) })
    await msg({ channelConfigId: waChannel.id, conversationId: convWA.id, direction: "inbound",  channelType: "whatsapp", contactId: peterC?.id, from: "+49 7157 97 100",     to: "+994 50 100 2030", body: "Perfect, thanks. Once samples arrive we'll do the QA in our lab and come back with tier feedback.",                       status: "read",      messageType: "text", createdAt: new Date(now - 20 * 60 * 60 * 1000) })
    await msg({ channelConfigId: waChannel.id, conversationId: convWA.id, direction: "inbound",  channelType: "whatsapp", contactId: peterC?.id, from: "+49 7157 97 100",     to: "+994 50 100 2030", body: "Need to confirm shipment date for the main 2MT trial.",                                                                     status: "delivered", messageType: "text", createdAt: new Date(now - 1 * 60 * 60 * 1000) })

    // Telegram — Migros
    await msg({ channelConfigId: tgChannel.id, conversationId: convTG.id, direction: "inbound",  channelType: "telegram", contactId: ahmetC?.id, from: "ahmet.yilmaz", to: "AFIGroupBot", body: "Merhaba! Q2 planning — можем увеличить объём чая на 20%?",             status: "read",      messageType: "text", createdAt: new Date(now - 5 * 60 * 60 * 1000) })
    await msg({ channelConfigId: tgChannel.id, conversationId: convTG.id, direction: "outbound", channelType: "telegram", contactId: ahmetC?.id, from: "AFIGroupBot",   to: "ahmet.yilmaz", body: "Привет Ахмет! Да, Astarachay может увеличить поставки. Пришлю подробности Q2 допа сегодня.", status: "delivered", messageType: "text", createdAt: new Date(now - 4 * 60 * 60 * 1000) })
    await msg({ channelConfigId: tgChannel.id, conversationId: convTG.id, direction: "inbound",  channelType: "telegram", contactId: ahmetC?.id, from: "ahmet.yilmaz", to: "AFIGroupBot", body: "Супер, ждём предложение. Также интересует премиум-зелёный.",          status: "delivered", messageType: "text", createdAt: new Date(now - 3 * 60 * 60 * 1000) })

    // Instagram — Jean Martin
    await msg({ channelConfigId: igChannel.id, conversationId: convIG.id, direction: "inbound",  channelType: "instagram", contactId: jeanC?.id, from: "chef_jeanmartin", to: "afigroup_official", body: "Hello! Chef Jean here from Four Seasons Baku. Summer menu — we want to source fresh stone fruits locally. Possible bulk deal?", status: "read",      messageType: "text", createdAt: new Date(now - 8 * 60 * 60 * 1000) })
    await msg({ channelConfigId: igChannel.id, conversationId: convIG.id, direction: "outbound", channelType: "instagram", contactId: jeanC?.id, from: "afigroup_official", to: "chef_jeanmartin", body: "Hi Chef! Absolutely — Zəfər Bağları has weekly harvest calendar. Let me connect you with Elçin.",                                  status: "delivered", messageType: "text", createdAt: new Date(now - 7 * 60 * 60 * 1000) })
    await msg({ channelConfigId: igChannel.id, conversationId: convIG.id, direction: "inbound",  channelType: "instagram", contactId: jeanC?.id, from: "chef_jeanmartin", to: "afigroup_official", body: "Interested in bulk fresh fruits for new summer menu.",                                                                                  status: "delivered", messageType: "text", createdAt: new Date(now - 6 * 60 * 60 * 1000) })

    // Facebook — Iranian distributor
    await msg({ channelConfigId: fbChannel.id, conversationId: convFB.id, direction: "inbound",  channelType: "facebook", contactId: null, from: "TehranImports", to: "AgroFoodInvestment", body: "Hello, we're a Tehran-based distributor. Interested in rose essential oil — pricing for 2kg order?", status: "unread", messageType: "text", createdAt: new Date(now - 12 * 60 * 60 * 1000) })

    // Email — Metro quality issue
    await msg({ channelConfigId: emailChannel.id, conversationId: convEM.id, direction: "inbound",  channelType: "email", contactId: elenaC?.id, from: "elena.novikova@metro-cc.ru", to: "export@afigroup.leaddrivecrm.org", subject: "URGENT: quality issue in olive oil batch GO-2026-031", body: "We received the Q1 shipment and 12 bottles have cracked glass. Attaching photos. Need replacement shipment urgently and a full investigation.", status: "read", createdAt: new Date(now - 8 * 60 * 60 * 1000) })
    await msg({ channelConfigId: emailChannel.id, conversationId: convEM.id, direction: "outbound", channelType: "email", contactId: elenaC?.id, from: "export@afigroup.leaddrivecrm.org", to: "elena.novikova@metro-cc.ru", subject: "Re: URGENT: quality issue in olive oil batch GO-2026-031", body: "Dear Elena, confirmed — investigation opened (ticket AFI-2026-001). Replacement shipment dispatched today. Root-cause report by Friday.", status: "delivered", createdAt: new Date(now - 6 * 60 * 60 * 1000) })
    await msg({ channelConfigId: emailChannel.id, conversationId: convEM.id, direction: "inbound",  channelType: "email", contactId: elenaC?.id, from: "elena.novikova@metro-cc.ru", to: "export@afigroup.leaddrivecrm.org", subject: "Re: URGENT: quality issue in olive oil batch GO-2026-031", body: "Thank you. Please also confirm corrective action for the packaging supplier.", status: "read", createdAt: new Date(now - 5 * 60 * 60 * 1000) })

    // Web chat — Turkish importer
    await msg({ channelConfigId: webChatChannel.id, conversationId: convWC.id, direction: "inbound", channelType: "web_chat", contactId: null, from: "visitor-anon-ruAE", to: "afigroup.az", body: "Hi, I'm an importer in Istanbul. Looking for almond samples for a 2MT trial order. Can you send pricing and lead times?", status: "unread", messageType: "text", createdAt: new Date(now - 20 * 60 * 60 * 1000) })

    console.log(`Inbox: 6 channels, 6 conversations, ~14 messages`)
  } else {
    console.log(`Inbox: ${existingChannels} channels already exist, skipped`)
  }

  // ─── Campaigns (3) ───
  const campaignsData = [
    { name: "Spring 2026 Distributor Newsletter",      type: "email", status: "sent",   subject: "AFI Group — New Season Catalog & Export Terms", totalRecipients: 420, totalSent: 410, totalOpened: 140, totalClicked: 46, budget: 1200, actualCost: 980 },
    { name: "Summer Rose Oil Promo → HoReCa",          type: "email", status: "draft",  subject: "Limited Harvest: Damask Rose Essential Oil 2026", totalRecipients: 0,   totalSent: 0,   totalOpened: 0,   totalClicked: 0,  budget: 800,  actualCost: 0 },
    { name: "Q1 NPS Survey — Retail Partners",         type: "email", status: "running",subject: "How are we doing? Quick 2-minute feedback",      totalRecipients: 180, totalSent: 175, totalOpened: 96,  totalClicked: 58, budget: 200,  actualCost: 120 },
  ]
  for (const c of campaignsData) {
    const existing = await prisma.campaign.findFirst({ where: { organizationId: orgId, name: c.name } })
    if (!existing) {
      await prisma.campaign.create({
        data: {
          ...c,
          organizationId: orgId,
          createdBy: admin.id,
          sentAt: c.status === "sent" ? new Date(now - 14 * DAY) : undefined,
        },
      })
    }
  }
  console.log(`Campaigns: ${campaignsData.length}`)

  // ─── Survey + SurveyResponses (12 NPS) ───
  const surveySlug = `nps-afi-${Date.now().toString(36)}`
  let survey = await prisma.survey.findFirst({ where: { organizationId: orgId, name: "Retail Partners NPS 2026 Q1" } })
  if (!survey) {
    survey = await prisma.survey.create({
      data: {
        organizationId: orgId,
        name: "Retail Partners NPS 2026 Q1",
        description: "Quarterly Net Promoter Score survey for AFI retail and HoReCa partners",
        type: "nps",
        status: "active",
        publicSlug: surveySlug,
        channels: ["email", "link"],
        questions: [
          { id: "q1", type: "nps",    label: "How likely are you to recommend AFI Group products to a colleague?" },
          { id: "q2", type: "text",   label: "What's the main reason for your score?" },
        ],
        triggers: { afterTicketResolve: false },
      },
    })
  }
  const responseRows = [
    { score: 10, category: "promoter",  comment: "Fast response to complaints — true partnership.", sentiment: "positive", email: "igor.volkov@metro-cc.ru",          daysAgo: 3 },
    { score: 9,  category: "promoter",  comment: "Very stable supply of olive oil this year.",       sentiment: "positive", email: "markus.schneider@lidl.de",         daysAgo: 5 },
    { score: 10, category: "promoter",  comment: "Almond quality is consistently premium.",          sentiment: "positive", email: "peter.hoffmann@ritter-sport.com",  daysAgo: 7 },
    { score: 9,  category: "promoter",  comment: "Great communication, quick to respond.",           sentiment: "positive", email: "orxan.quliyev@bravomarket.az",     daysAgo: 10 },
    { score: 8,  category: "promoter",  comment: "Happy overall, though delivery scheduling could be smoother.", sentiment: "positive", email: "ahmet.yilmaz@migros.com.tr", daysAgo: 12 },
    { score: 9,  category: "promoter",  comment: "Chinar has been impressed with tea consistency.",  sentiment: "positive", email: "kamran.rustamov@chinar.az",        daysAgo: 14 },
    { score: 8,  category: "promoter",  comment: "Good quality. Packaging could be upgraded.",       sentiment: "neutral",  email: "jean.martin@fourseasons.com",      daysAgo: 16 },
    { score: 7,  category: "passive",   comment: "Occasional delays in Q1, otherwise OK.",           sentiment: "neutral",  email: "elvin.huseynov@bazarstore.az",     daysAgo: 18 },
    { score: 7,  category: "passive",   comment: "Pricing negotiations take long.",                  sentiment: "neutral",  email: "oliver.brown@marriott.com",        daysAgo: 20 },
    { score: 7,  category: "passive",   comment: "Fine overall — minor label issues twice.",         sentiment: "neutral",  email: "julia.weber@lidl.de",              daysAgo: 22 },
    { score: 6,  category: "detractor", comment: "Quality issue not fully resolved yet.",            sentiment: "negative", email: "elena.novikova@metro-cc.ru",       daysAgo: 6 },
    { score: 5,  category: "detractor", comment: "Two late shipments in one quarter — concerning.",  sentiment: "negative", email: "dmitry.kozlov@wildberries.ru",     daysAgo: 9 },
  ]
  let respCount = 0
  for (const r of responseRows) {
    const ct = contactByEmail(r.email)
    const existing = await prisma.surveyResponse.findFirst({
      where: { organizationId: orgId, surveyId: survey.id, email: r.email },
    })
    if (existing) continue
    await prisma.surveyResponse.create({
      data: {
        organizationId: orgId,
        surveyId: survey.id,
        contactId: ct?.id || null,
        email: r.email,
        score: r.score,
        category: r.category,
        comment: r.comment,
        commentSentiment: r.sentiment,
        channel: "email",
        completedAt: new Date(now - r.daysAgo * DAY),
        answers: { q1: r.score, q2: r.comment },
      },
    })
    respCount++
  }
  await prisma.survey.update({
    where: { id: survey.id },
    data: { totalSent: 180, totalResponses: respCount },
  })
  console.log(`Survey + responses: ${respCount}`)

  // ─── AiShadowAction (4 pending) ───
  const dealMetroQ2 = createdDeals.find((d) => d.name.includes("Metro RU Q2"))
  const ticketOliveGlass = createdTickets.find((t) => t.ticketNumber === "AFI-2026-001")
  const leadTurkish = createdLeads.find((l) => l.email === "burak@ankaraimport.com.tr")
  const leadRitter = createdLeads.find((l) => l.email === "a.karimov@dubaifoods.ae")

  const shadowSpecs = [
    dealMetroQ2 ? {
      featureName: "ai_auto_followup",
      entityType: "deal",
      entityId: dealMetroQ2.id,
      actionType: "create_task",
      payload: {
        reason: "Deal stuck in PROPOSAL for 14 days with no activity",
        suggestedTask: {
          title: "Follow-up call with Metro procurement (Igor Volkov)",
          priority: "high",
          dueDays: 2,
        },
        confidence: 0.82,
      },
    } : null,
    ticketOliveGlass ? {
      featureName: "ai_auto_acknowledge",
      entityType: "ticket",
      entityId: ticketOliveGlass.id,
      actionType: "send_template",
      payload: {
        reason: "Similar complaint from Metro 2 weeks ago resolved with replacement shipment — suggest same",
        suggestedTemplate: "quality-complaint-replacement",
        confidence: 0.88,
      },
    } : null,
    leadTurkish ? {
      featureName: "ai_auto_followup",
      entityType: "lead",
      entityId: leadTurkish.id,
      actionType: "create_task",
      payload: {
        reason: "High-score lead (82) with no contact in 5 days",
        suggestedTask: {
          title: "Schedule intro call with Burak Aydın (Ankara Import)",
          priority: "high",
          dueDays: 1,
        },
        confidence: 0.78,
      },
    } : null,
    leadRitter ? {
      featureName: "ai_lead_scoring",
      entityType: "lead",
      entityId: leadRitter.id,
      actionType: "update_field",
      payload: {
        reason: "High-value buyer pattern — Gulfood event + UAE retail + $210K estimated",
        suggestedField: "score",
        currentValue: 90,
        suggestedValue: 95,
        confidence: 0.91,
      },
    } : null,
  ].filter(Boolean)

  let shadowCount = 0
  for (const s of shadowSpecs) {
    const existing = await prisma.aiShadowAction.findFirst({
      where: { organizationId: orgId, entityType: s.entityType, entityId: s.entityId, featureName: s.featureName },
    })
    if (existing) continue
    await prisma.aiShadowAction.create({
      data: { ...s, organizationId: orgId, approved: null },
    })
    shadowCount++
  }
  console.log(`AI shadow actions: ${shadowCount}`)

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2 enrichment — makes the sidebar look alive: activities, ticket
  // comments, task checklists/comments, deal roles, email templates, KB,
  // journeys, segments, saved reports, notifications.
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Activities (timeline on companies / contacts / deals) ───
  const activitySpecs = [
    // Sales activities
    { type: "call",    subject: "Discovery call — Metro procurement (Igor Volkov)",          description: "Discussed Q2 almond volume, pricing tier, logistics from Baku to Moscow. Metro needs COA and phytosanitary certs with each shipment.", contactEmail: "igor.volkov@metro-cc.ru",    daysAgo: 14 },
    { type: "email",   subject: "Sent proposal — Lidl PL listing (olive oil)",                description: "Emailed full proposal + product dossier. Markus will loop in buying committee next Tuesday.",                                                          contactEmail: "markus.schneider@lidl.de",   daysAgo: 11 },
    { type: "meeting", subject: "Sample tasting — Four Seasons Baku (LECHEQ brandy)",          description: "Chef Jean and sommelier tasted 3 expressions. XO 5yr was the favourite. Follow-up meeting on Monday to discuss exclusive pour rights.",            contactEmail: "jean.martin@fourseasons.com", daysAgo: 4  },
    { type: "note",    subject: "AZBADAM lot #2026-04 — quality review",                        description: "Internal note: lot passed all lab tests, moisture 5.8%, aflatoxin <0.5 ppb. Cleared for Metro + Ritter shipments.",                                 contactEmail: null,                            daysAgo: 9  },
    { type: "call",    subject: "Onboarding call — Anadolu Tarım",                             description: "Mehmet asked for expanded product catalog and export-price list. Lost on price later — follow-up in Q3.",                                            contactEmail: "mehmet.demir@anadolutarim.com", daysAgo: 60 },
    { type: "meeting", subject: "Quarterly business review — Chinar Restaurant Group",         description: "Kamran is very happy. Expanding from 3 to 5 restaurants, will need tea+brandy commitment for 12 more months.",                                        contactEmail: "kamran.rustamov@chinar.az",   daysAgo: 7  },
    { type: "email",   subject: "Follow-up — Ritter Sport trial shipment status",              description: "Sent BL + inspection report. Peter confirmed Tuesday ETA. QA report due by Friday next week.",                                                      contactEmail: "peter.hoffmann@ritter-sport.com", daysAgo: 2 },
    { type: "note",    subject: "Internal — AZROSE 2026 harvest forecast",                      description: "Agronomy team estimates 8% higher yield vs 2025 due to favorable spring. Reserve 2kg for Chanel trial.",                                              contactEmail: null,                            daysAgo: 12 },
    { type: "call",    subject: "Catch-up call — Bravo Supermarket (Orxan)",                   description: "Weekly fresh fruit slot confirmed. Discussed in-store promotion for almonds in Q2.",                                                                 contactEmail: "orxan.quliyev@bravomarket.az", daysAgo: 6  },
    { type: "email",   subject: "Carrefour France — tender docs update",                        description: "Sent allergen declaration + updated HACCP certificates as requested by compliance team.",                                                             contactEmail: "sophie.lefevre@carrefour.fr",  daysAgo: 3  },
    { type: "meeting", subject: "Strategy review — GRAND AGRO INVITRO expansion",               description: "Internal review with agronomy lead. Pipeline of saplings for 3 wine producers. Capacity increase needed by Q4.",                                      contactEmail: null,                            daysAgo: 10 },
    { type: "note",    subject: "Metro QA feedback — olive oil replacement lot",                description: "Elena confirmed receipt of replacement shipment. No further cracked units. Investigation report accepted.",                                            contactEmail: "elena.novikova@metro-cc.ru",    daysAgo: 1  },
    { type: "call",    subject: "Cold outreach — Wildberries wholesale team (Dmitry)",          description: "Introduced tea portfolio and export terms. Dmitry requested sample shipment + wholesale price list.",                                                contactEmail: "dmitry.kozlov@wildberries.ru",  daysAgo: 16 },
    { type: "email",   subject: "JW Marriott annual supply — renewal terms",                    description: "Oliver asking for 12-month fixed-price contract. Need internal approval on pricing lock.",                                                           contactEmail: "oliver.brown@marriott.com",     daysAgo: 5  },
    { type: "meeting", subject: "Site visit — Shamkir Agropark",                                description: "Reviewed packhouse, cold storage, and Q2 readiness. HACCP audit scheduled for next week.",                                                          contactEmail: null,                            daysAgo: 8  },
  ]
  let actCount = 0
  for (const a of activitySpecs) {
    const existing = await prisma.activity.findFirst({ where: { organizationId: orgId, subject: a.subject } })
    if (existing) continue
    const ct = a.contactEmail ? contactByEmail(a.contactEmail) : null
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        type: a.type,
        subject: a.subject,
        description: a.description,
        contactId: ct?.id || null,
        companyId: ct?.companyId || null,
        createdBy: admin.id,
        createdAt: new Date(now - a.daysAgo * DAY),
      },
    })
    actCount++
  }
  console.log(`Activities: ${actCount}`)

  // ─── TicketComments (makes tickets look worked on) ───
  const ticketCommentSpecs = [
    { num: "AFI-2026-001", comments: [
      { comment: "Photos received from Metro QA. Confirmed — 12 units with glass cracks. Escalating to production / packaging.", isInternal: false },
      { comment: "Opened supplier investigation with bottle vendor (Kavkaz Glass). Requesting root-cause by Friday.",              isInternal: true  },
      { comment: "Replacement shipment dispatched (express freight). ETA Moscow Tuesday.",                                         isInternal: false },
      { comment: "Internal note — switch to reinforced packaging for next 2 batches until root cause is fixed.",                   isInternal: true  },
    ]},
    { num: "AFI-2026-002", comments: [
      { comment: "Customs hold resolved, waiting for phytosanitary cert delivery to handler in Moscow.",                            isInternal: false },
      { comment: "ETA to Metro warehouse updated to Wednesday. Penalty waiver requested.",                                          isInternal: false },
      { comment: "Drafted credit-note for 0.5% late-delivery penalty as goodwill gesture.",                                         isInternal: true  },
    ]},
    { num: "AFI-2026-003", comments: [
      { comment: "Wildberries QA lab report attached. 3/50 samples flagged for musty notes. Storage humidity suspect.",            isInternal: false },
      { comment: "Pulled retention samples from warehouse — matching musty profile. Likely moisture event during transit.",         isInternal: true  },
      { comment: "Offering replacement + credit-note. Implementing tighter humidity control on next shipments.",                    isInternal: false },
    ]},
    { num: "AFI-2026-005", comments: [
      { comment: "Container confirmed at Hamburg port. Original phytosanitary cert being couriered overnight.",                    isInternal: false },
      { comment: "Export desk — going forward, include scanned cert + hard copy in every container as SOP.",                       isInternal: true  },
    ]},
    { num: "AFI-2026-006", comments: [
      { comment: "Invoice reissued with correct currency (USD). Chinar finance team confirmed receipt.",                           isInternal: false },
    ]},
    { num: "AFI-2026-008", comments: [
      { comment: "Duty Free received photos. 6 boxes dented — likely during Baku→airport handling.",                               isInternal: false },
      { comment: "Replacement 6 boxes dispatched, insurance claim filed with handling agent.",                                     isInternal: true  },
    ]},
  ]
  let tcCount = 0
  for (const tcs of ticketCommentSpecs) {
    const ticket = createdTickets.find((t) => t.ticketNumber === tcs.num)
    if (!ticket) continue
    const existingCount = await prisma.ticketComment.count({ where: { ticketId: ticket.id } })
    if (existingCount > 0) continue
    for (let i = 0; i < tcs.comments.length; i++) {
      const c = tcs.comments[i]
      await prisma.ticketComment.create({
        data: {
          ticketId: ticket.id,
          userId: admin.id,
          comment: c.comment,
          isInternal: c.isInternal,
          createdAt: new Date(ticket.createdAt.getTime() + (i + 1) * 60 * 60 * 1000),
        },
      })
      tcCount++
    }
  }
  console.log(`Ticket comments: ${tcCount}`)

  // ─── TaskChecklist + TaskComment (on 5 tasks) ───
  const checklistSpecs = [
    { taskIdx: 0, items: [
      { title: "Pull lab COA from Baku QA",   completed: true  },
      { title: "Translate COA to EN + RU",    completed: true  },
      { title: "Upload to Metro sharepoint",  completed: false },
      { title: "Email Igor confirmation",     completed: false },
    ]},
    { taskIdx: 3, items: [
      { title: "Review Lidl contract red-lines", completed: true  },
      { title: "Confirm PL trademark use",       completed: true  },
      { title: "Sign-off pricing with CEO",      completed: false },
      { title: "Send counter-proposal",          completed: false },
    ]},
    { taskIdx: 4, items: [
      { title: "Nursery capacity check (5000 units)", completed: true  },
      { title: "Staged delivery schedule — 3 tranches", completed: true },
      { title: "Phytosanitary docs prepared",           completed: false },
      { title: "Kick-off call with AzWine agronomist",  completed: false },
    ]},
    { taskIdx: 11, items: [
      { title: "German labelling rules — cross-check",     completed: true  },
      { title: "Allergen declaration signed",              completed: true  },
      { title: "Shipment manifest prepared",               completed: false },
    ]},
    { taskIdx: 14, items: [
      { title: "Gulfood card to CRM",                completed: true  },
      { title: "Send welcome pack + price list",     completed: true  },
      { title: "Schedule intro call (next week)",    completed: false },
    ]},
  ]
  let tclCount = 0
  for (const cls of checklistSpecs) {
    const task = createdTasks[cls.taskIdx]
    if (!task) continue
    const existing = await prisma.taskChecklist.count({ where: { taskId: task.id } })
    if (existing > 0) continue
    for (let i = 0; i < cls.items.length; i++) {
      await prisma.taskChecklist.create({
        data: {
          organizationId: orgId,
          taskId: task.id,
          title: cls.items[i].title,
          completed: cls.items[i].completed,
          sortOrder: i,
        },
      })
      tclCount++
    }
  }
  console.log(`Task checklist items: ${tclCount}`)

  const taskCommentSpecs = [
    { taskIdx: 0, comments: [
      { content: "Started pulling COA from Baku lab.",                                                           isSystem: false },
      { content: "Status changed to in_progress",                                                                isSystem: true  },
      { content: "COA uploaded to drive — EN version in progress.",                                              isSystem: false },
    ]},
    { taskIdx: 3, comments: [
      { content: "Legal flagged 2 clauses in Lidl red-line — discussing with CEO.",                              isSystem: false },
      { content: "Sign-off meeting scheduled for Friday.",                                                       isSystem: false },
    ]},
    { taskIdx: 6, comments: [
      { content: "Batch delivered on time. Kamran reported tea quality excellent.",                              isSystem: false },
      { content: "Status changed to completed",                                                                  isSystem: true  },
    ]},
  ]
  let tcmCount = 0
  for (const cc of taskCommentSpecs) {
    const task = createdTasks[cc.taskIdx]
    if (!task) continue
    const existing = await prisma.taskComment.count({ where: { taskId: task.id } })
    if (existing > 0) continue
    for (const c of cc.comments) {
      await prisma.taskComment.create({
        data: {
          organizationId: orgId,
          taskId: task.id,
          userId: admin.id,
          content: c.content,
          isSystem: c.isSystem,
          createdAt: new Date(now - Math.floor(Math.random() * 5) * DAY),
        },
      })
      tcmCount++
    }
  }
  console.log(`Task comments: ${tcmCount}`)

  // ─── DealContactRole (deal stakeholders) ───
  const roleSpecs = [
    { dealIdx: 6,  contactEmail: "igor.volkov@metro-cc.ru",        role: "Decision Maker",   influence: "High",   isPrimary: true  },
    { dealIdx: 6,  contactEmail: "elena.novikova@metro-cc.ru",     role: "Influencer",        influence: "Medium", isPrimary: false },
    { dealIdx: 6,  contactEmail: "yusif.babayev@metro-cc.ru",      role: "User / Champion",   influence: "Low",    isPrimary: false },
    { dealIdx: 7,  contactEmail: "markus.schneider@lidl.de",       role: "Decision Maker",   influence: "High",   isPrimary: true  },
    { dealIdx: 7,  contactEmail: "julia.weber@lidl.de",            role: "Quality Gatekeeper",influence: "High",   isPrimary: false },
    { dealIdx: 8,  contactEmail: "vuqar.karimov@azwine.az",        role: "Decision Maker",   influence: "High",   isPrimary: true  },
    { dealIdx: 8,  contactEmail: "gunay.rasulova@azwine.az",       role: "Technical Lead",   influence: "Medium", isPrimary: false },
    { dealIdx: 10, contactEmail: "peter.hoffmann@ritter-sport.com",role: "Decision Maker",   influence: "High",   isPrimary: true  },
    { dealIdx: 10, contactEmail: "stefan.koch@ritter-sport.com",   role: "Influencer",        influence: "Medium", isPrimary: false },
    { dealIdx: 15, contactEmail: "kamran.rustamov@chinar.az",      role: "Decision Maker",   influence: "High",   isPrimary: true  },
    { dealIdx: 15, contactEmail: "nigar.valiyeva@chinar.az",       role: "Ops Manager",       influence: "Medium", isPrimary: false },
  ]
  let roleCount = 0
  for (const r of roleSpecs) {
    const deal = createdDeals[r.dealIdx]
    const ct = contactByEmail(r.contactEmail)
    if (!deal || !ct) continue
    try {
      await prisma.dealContactRole.create({
        data: {
          dealId: deal.id,
          contactId: ct.id,
          role: r.role,
          influence: r.influence,
          isPrimary: r.isPrimary,
        },
      })
      roleCount++
    } catch (_) { /* unique dealId+contactId — skip if already exists */ }
  }
  console.log(`Deal contact roles: ${roleCount}`)

  // ─── Email Templates (8) ───
  const templateSpecs = [
    { name: "Welcome — Distributor Onboarding", subject: "Welcome to AFI Group — {{contactName}}, let's get started", category: "onboarding", htmlBody: "<h2>Welcome, {{contactName}}</h2><p>Thank you for joining as an AFI distributor. Attached you'll find our full price list, product catalog and export terms.</p><p>Your dedicated account manager is {{managerName}} — available 9am-6pm (GMT+4).</p>", variables: ["contactName","managerName"] },
    { name: "Quality COA — Attachment Email",   subject: "Certificate of Analysis — {{productName}} / batch {{lotNumber}}", category: "quality",     htmlBody: "<p>Dear {{contactName}},</p><p>Attached: Certificate of Analysis for lot <b>{{lotNumber}}</b> — {{productName}}.</p><p>All parameters within spec. Full lab report available on request.</p>", variables: ["contactName","productName","lotNumber"] },
    { name: "Follow-up — After Sample Tasting",  subject: "How did the {{productName}} samples go?", category: "sales",        htmlBody: "<p>Hi {{contactName}},</p><p>Hope the {{productName}} samples landed well. Happy to walk through pricing, volumes and delivery terms whenever you're ready.</p><p>Best,<br/>{{senderName}}</p>", variables: ["contactName","productName","senderName"] },
    { name: "Invoice Reminder",                  subject: "Reminder — Invoice {{invoiceNumber}} due {{dueDate}}",             category: "finance",      htmlBody: "<p>Dear {{contactName}},</p><p>Friendly reminder: invoice <b>{{invoiceNumber}}</b> for <b>{{amount}}</b> is due on <b>{{dueDate}}</b>.</p><p>AFI Finance</p>", variables: ["contactName","invoiceNumber","amount","dueDate"] },
    { name: "Quality Complaint — Acknowledgement", subject: "We've received your complaint — {{ticketNumber}}",                category: "support",      htmlBody: "<p>Dear {{contactName}},</p><p>We've received your complaint {{ticketNumber}} and opened an internal investigation. First response within 2 hours.</p><p>Thank you for flagging — your feedback helps us improve.</p>", variables: ["contactName","ticketNumber"] },
    { name: "Seasonal Harvest Update — Summer",  subject: "Summer harvest is live at AFI Group",                                category: "marketing",    htmlBody: "<h2>Summer 2026 — Harvest Update</h2><p>Fresh stone fruits from Zəfər Bağları and premium rose oil from AZROSE are now available for export.</p><p>Ask us for the seasonal price sheet.</p>", variables: [] },
    { name: "NPS Survey — Retail Partners",       subject: "Quick 2-minute feedback — AFI Group",                                category: "feedback",     htmlBody: "<p>Hi {{contactName}},</p><p>How likely are you to recommend AFI Group to a colleague?</p><p><a href=\"{{surveyLink}}\">Click here to answer →</a></p>", variables: ["contactName","surveyLink"] },
    { name: "Shipment Dispatched — Notification", subject: "Your shipment has left Baku — {{shipmentRef}}",                       category: "logistics",    htmlBody: "<p>Dear {{contactName}},</p><p>Shipment <b>{{shipmentRef}}</b> dispatched from Baku on {{dispatchDate}}. ETA {{etaDate}}.</p><p>Tracking: {{trackingUrl}}</p>", variables: ["contactName","shipmentRef","dispatchDate","etaDate","trackingUrl"] },
  ]
  let tplCount = 0
  for (const t of templateSpecs) {
    const existing = await prisma.emailTemplate.findFirst({ where: { organizationId: orgId, name: t.name } })
    if (existing) continue
    await prisma.emailTemplate.create({
      data: { ...t, organizationId: orgId, createdBy: admin.id, isActive: true, language: "en" },
    })
    tplCount++
  }
  console.log(`Email templates: ${tplCount}`)

  // ─── KB Categories + Articles ───
  const kbExisting = await prisma.kbCategory.count({ where: { organizationId: orgId } })
  if (kbExisting === 0) {
    const categories = [
      { name: "Product Specifications",  sortOrder: 0 },
      { name: "Export & Logistics",       sortOrder: 1 },
      { name: "Quality & Compliance",     sortOrder: 2 },
      { name: "Distributor Onboarding",   sortOrder: 3 },
    ]
    const createdCats = []
    for (const c of categories) {
      const cat = await prisma.kbCategory.create({ data: { ...c, organizationId: orgId } })
      createdCats.push(cat)
    }
    const articles = [
      { title: "AZBADAM Almond — Product Specification",         content: "# AZBADAM Almond Specification\n\n**Origin:** Shamkir region, Azerbaijan\n**Moisture:** ≤ 6%\n**Aflatoxin:** ≤ 2 ppb\n**Grades:** Premium / Standard / Industrial\n**Packaging:** 500g retail / 25kg bulk\n\n## Storage\n- Temperature: 10-18°C\n- Humidity: ≤ 65%\n- Storage life: 18 months\n\n## Certifications\nISO 22000, HACCP, Halal, Non-GMO.",                                 categoryId: createdCats[0].id, status: "published", viewCount: 142, helpfulCount: 24 },
      { title: "GALA Olive Oil — Product Specification",          content: "# GALA Olive Oil Specification\n\n**Variety:** Mediterranean cultivars grown in Absheron\n**Type:** Extra Virgin, cold-pressed\n**Acidity:** ≤ 0.8%\n**Peroxide value:** ≤ 20 meq O2/kg\n**Packaging:** 250ml / 500ml / 1L glass; 5L tin\n\n## Certifications\nIOC member, Halal, ISO 22000.",                                                                                  categoryId: createdCats[0].id, status: "published", viewCount: 95,  helpfulCount: 18 },
      { title: "ASTARACHAY Tea — Product Range",                  content: "# ASTARACHAY Tea Range\n\n**Region:** Astara (subtropical zone)\n**Grades:** Premium, Standard, Dust\n**Types:** Black, Green, Herbal\n**Packaging:** 100g / 200g retail; 5kg wholesale\n**Caffeine content:** 2.5-4% (black), 1-2% (green)",                                                                                                                                 categoryId: createdCats[0].id, status: "published", viewCount: 78,  helpfulCount: 14 },
      { title: "Export — Phytosanitary Certificates",             content: "# Phytosanitary Certificates\n\n## Process\n1. Inspection request — 5 days before ship date\n2. Lab samples — retained 6 months\n3. Cert issued by State Phytosanitary Service\n\n## Document checklist\n- Commercial invoice\n- Packing list\n- Certificate of Origin\n- Phytosanitary certificate\n- Health certificate (dairy / animal products)",                                  categoryId: createdCats[1].id, status: "published", viewCount: 56,  helpfulCount: 11 },
      { title: "Shipping Lanes — AZ to EU / RU / TR",             content: "# Shipping Lanes\n\n## Russia — Metro / Wildberries / Лента\n- Truck: Baku → Moscow, 5-7 days\n- Rail: Baku → Samara → MSK, 8-10 days (cheaper, cold-chain available)\n\n## Europe — Lidl / Ritter / Carrefour\n- Sea: Baku → Poti → Trieste, 14-18 days\n- Air (urgent): Baku → Frankfurt, next-day\n\n## Turkey — Migros / Anadolu\n- Truck: Baku → Istanbul, 3-4 days",                                                    categoryId: createdCats[1].id, status: "published", viewCount: 43,  helpfulCount: 9  },
      { title: "Quality Complaint — Handling SOP",                content: "# Quality Complaint SOP\n\n## Step 1 — Intake\n- Customer files complaint (portal / email / WhatsApp)\n- Ticket auto-created in CRM\n- SLA: first response 2h, resolution 24-48h\n\n## Step 2 — Triage\n- Assign risk level: high / medium / low\n- Route to Quality or Logistics\n\n## Step 3 — Resolution\n- Replacement shipment / credit note / refund\n- Close ticket, tag with root cause",                          categoryId: createdCats[2].id, status: "published", viewCount: 89,  helpfulCount: 20 },
      { title: "HACCP & ISO 22000 — Scope Overview",              content: "# HACCP / ISO 22000 Scope\n\nAll AFI production sites operate under ISO 22000 FSMS:\n- GRAND AGRO\n- AZBADAM (Shamkir processing)\n- GALA OLIVES (Absheron)\n- LECHEQ (Gabala distillery)\n\nCertificate renewal: annual audit by SGS Azerbaijan.",                                                                                                                            categoryId: createdCats[2].id, status: "published", viewCount: 62,  helpfulCount: 12 },
      { title: "New Distributor — Onboarding Checklist",          content: "# Distributor Onboarding\n\n1. Signed distribution agreement\n2. VAT / business registration docs\n3. Credit line approval from AFI Finance\n4. Initial order form submitted\n5. Shipping address + contact persons confirmed\n6. Portal access provisioned\n7. Welcome pack (price list + catalog + COA library) emailed\n8. Kick-off call scheduled within 7 days",                categoryId: createdCats[3].id, status: "published", viewCount: 104, helpfulCount: 21 },
    ]
    for (const a of articles) {
      await prisma.kbArticle.create({
        data: { ...a, organizationId: orgId, authorId: admin.id, tags: [] },
      })
    }
    console.log(`KB: ${categories.length} categories, ${articles.length} articles`)
  } else {
    console.log(`KB: ${kbExisting} categories already exist, skipped`)
  }

  // ─── Contact Segments ───
  const segSpecs = [
    { name: "Retail buyers — Russia",             description: "Contacts at Metro / Wildberries / Лента and other RU retail chains", conditions: { rules: [{ field: "company.country", operator: "eq", value: "Russia" }, { field: "company.category", operator: "eq", value: "client" }] }, contactCount: 5 },
    { name: "HoReCa — Azerbaijan",                 description: "HoReCa buyers in Azerbaijan (Chinar, Four Seasons, JW Marriott)",    conditions: { rules: [{ field: "company.industry", operator: "eq", value: "HoReCa" }, { field: "company.country", operator: "eq", value: "Azerbaijan" }] }, contactCount: 4 },
    { name: "EU distributors — high engagement",   description: "EU-based buyers with engagement score ≥ 70",                         conditions: { rules: [{ field: "company.country", operator: "in", value: ["Germany","France"] }, { field: "engagementScore", operator: "gte", value: 70 }] }, contactCount: 3 },
    { name: "Quality contacts (all)",              description: "All QA / Quality Manager / Compliance roles across buyers",          conditions: { rules: [{ field: "position", operator: "contains", value: "Quality" }] }, contactCount: 4 },
  ]
  let segCount = 0
  for (const s of segSpecs) {
    const existing = await prisma.contactSegment.findFirst({ where: { organizationId: orgId, name: s.name } })
    if (existing) continue
    await prisma.contactSegment.create({
      data: { ...s, organizationId: orgId, createdBy: admin.id, isDynamic: true },
    })
    segCount++
  }
  console.log(`Contact segments: ${segCount}`)

  // ─── Journeys (3 automations with steps) ───
  const journeyExisting = await prisma.journey.count({ where: { organizationId: orgId } })
  if (journeyExisting === 0) {
    const journeysData = [
      {
        name: "New Distributor Onboarding",
        description: "Welcome email + onboarding checklist + follow-up call scheduling for new distributors.",
        status: "active", triggerType: "contact_created",
        entryCount: 14, activeCount: 4, completedCount: 9, conversionCount: 7,
        steps: [
          { stepOrder: 0, stepType: "send_email",    config: { templateName: "Welcome — Distributor Onboarding" } },
          { stepOrder: 1, stepType: "wait",          config: { days: 2 } },
          { stepOrder: 2, stepType: "create_task",   config: { title: "Schedule kick-off call with new distributor", assignTo: "owner" } },
          { stepOrder: 3, stepType: "wait",          config: { days: 5 } },
          { stepOrder: 4, stepType: "condition",     config: { field: "hasOrders", operator: "eq", value: false } },
          { stepOrder: 5, stepType: "send_email",    config: { templateName: "Follow-up — After Sample Tasting" } },
        ],
      },
      {
        name: "Quality Complaint Auto-Response",
        description: "Auto-acknowledge incoming complaint tickets + internal task + survey after resolution.",
        status: "active", triggerType: "ticket_created",
        entryCount: 21, activeCount: 6, completedCount: 13, conversionCount: 11,
        steps: [
          { stepOrder: 0, stepType: "send_email",    config: { templateName: "Quality Complaint — Acknowledgement" } },
          { stepOrder: 1, stepType: "create_task",   config: { title: "Review quality complaint — open investigation", assignTo: "qualityTeam", priority: "high" } },
          { stepOrder: 2, stepType: "wait",          config: { days: 3 } },
          { stepOrder: 3, stepType: "condition",     config: { field: "ticketStatus", operator: "eq", value: "resolved" } },
          { stepOrder: 4, stepType: "send_email",    config: { templateName: "NPS Survey — Retail Partners" } },
        ],
      },
      {
        name: "Invoice Payment Chain",
        description: "Automated payment reminders for overdue invoices with escalation to account manager.",
        status: "active", triggerType: "invoice_overdue",
        entryCount: 9, activeCount: 3, completedCount: 5, conversionCount: 4,
        steps: [
          { stepOrder: 0, stepType: "send_email",    config: { templateName: "Invoice Reminder" } },
          { stepOrder: 1, stepType: "wait",          config: { days: 7 } },
          { stepOrder: 2, stepType: "condition",     config: { field: "invoicePaid", operator: "eq", value: false } },
          { stepOrder: 3, stepType: "send_email",    config: { templateName: "Invoice Reminder", subject: "Second reminder" } },
          { stepOrder: 4, stepType: "wait",          config: { days: 7 } },
          { stepOrder: 5, stepType: "create_task",   config: { title: "Call overdue client", assignTo: "accountManager", priority: "high" } },
        ],
      },
    ]
    for (const j of journeysData) {
      const { steps, ...jData } = j
      const journey = await prisma.journey.create({ data: { ...jData, organizationId: orgId, createdBy: admin.id } })
      for (const s of steps) {
        await prisma.journeyStep.create({ data: { ...s, journeyId: journey.id } })
      }
    }
    console.log(`Journeys: ${journeysData.length} (with ${journeysData.reduce((a,j) => a + j.steps.length, 0)} steps)`)
  } else {
    console.log(`Journeys: ${journeyExisting} already exist, skipped`)
  }

  // ─── Saved Reports ───
  const reportSpecs = [
    { name: "Pipeline by Subsidiary",         entityType: "deals",   columns: [{ field: "salesChannel", label: "Subsidiary" }, { field: "stage", label: "Stage" }, { field: "valueAmount", aggregate: "sum", label: "Sum" }], groupBy: "salesChannel", chartType: "bar" },
    { name: "Deals by Stage — This Quarter",  entityType: "deals",   columns: [{ field: "stage", label: "Stage" }, { field: "id", aggregate: "count", label: "Count" }], groupBy: "stage", chartType: "funnel" },
    { name: "Top 10 Retail Clients by Revenue",entityType: "companies", columns: [{ field: "name", label: "Company" }, { field: "deals.valueAmount", aggregate: "sum", label: "Won deals" }], sortBy: "deals.valueAmount", chartType: "bar" },
    { name: "Complaints by Brand — 90 days",   entityType: "tickets", columns: [{ field: "complaintMeta.brand", label: "Brand" }, { field: "id", aggregate: "count", label: "Complaints" }], groupBy: "complaintMeta.brand", chartType: "pie" },
    { name: "Open Tasks by Owner",             entityType: "tasks",   columns: [{ field: "assignedTo", label: "Owner" }, { field: "id", aggregate: "count", label: "Open" }], filters: [{ field: "status", op: "ne", value: "completed" }], groupBy: "assignedTo", chartType: "bar" },
  ]
  let rptCount = 0
  for (const r of reportSpecs) {
    const existing = await prisma.savedReport.findFirst({ where: { organizationId: orgId, name: r.name } })
    if (existing) continue
    await prisma.savedReport.create({
      data: { ...r, organizationId: orgId, createdBy: admin.id, isShared: true },
    })
    rptCount++
  }
  console.log(`Saved reports: ${rptCount}`)

  // ─── Notifications (for header bell) ───
  const notifSpecs = [
    { type: "new_lead",              title: "New lead from Gulfood event",           message: "Aziz Karimov (Dubai Foods Trading) — score 90",                  entityType: "lead",   isRead: false, daysAgo: 0 },
    { type: "deal_stage_change",     title: "Deal advanced to Negotiation",          message: "AZROSE → Chanel EU supplier — 2kg rose essential",               entityType: "deal",   isRead: false, daysAgo: 0 },
    { type: "ticket_sla_warning",    title: "Ticket AFI-2026-004 near SLA breach",   message: "Mislabelled rose oil pack sent to Lidl — 30 min to first response", entityType: "ticket", isRead: false, daysAgo: 0 },
    { type: "task_due",              title: "Task due today — Metro follow-up",      message: "Call Metro Moscow buyer Igor Volkov",                            entityType: "task",   isRead: false, daysAgo: 0 },
    { type: "complaint_new",         title: "New high-risk complaint — GALA",         message: "Broken glass in olive oil batch GO-2026-031",                    entityType: "ticket", isRead: true,  daysAgo: 2 },
    { type: "deal_won",              title: "Deal won — $68K",                        message: "AZBADAM → Metro RU Q1 almonds — closed",                         entityType: "deal",   isRead: true,  daysAgo: 3 },
    { type: "ai_suggestion",         title: "AI suggests follow-up task",             message: "Deal stuck in PROPOSAL 14 days — Metro RU Q2 almonds",           entityType: "deal",   isRead: false, daysAgo: 0 },
    { type: "invoice_overdue",       title: "Invoice overdue — Chinar",               message: "INV-AFI-2026-018 — 3 days past due",                             entityType: null,     isRead: false, daysAgo: 0 },
    { type: "nps_response",          title: "New NPS response — detractor",           message: "Dmitry Kozlov (Wildberries) scored 5/10",                         entityType: null,     isRead: true,  daysAgo: 1 },
    { type: "webhook_integration",   title: "Shipment docs uploaded — Ritter",       message: "Phytosanitary certificate delivered to Hamburg handler",         entityType: null,     isRead: true,  daysAgo: 2 },
  ]
  let notifCount = 0
  for (const n of notifSpecs) {
    const existing = await prisma.notification.findFirst({ where: { organizationId: orgId, userId: admin.id, title: n.title } })
    if (existing) continue
    await prisma.notification.create({
      data: {
        organizationId: orgId,
        userId: admin.id,
        type: n.type,
        title: n.title,
        message: n.message,
        entityType: n.entityType,
        isRead: n.isRead,
        createdAt: new Date(now - n.daysAgo * DAY),
      },
    })
    notifCount++
  }
  console.log(`Notifications: ${notifCount}`)

  // ─── Summary ───
  console.log("\n" + "═".repeat(60))
  console.log("AFI Group demo data seeded successfully!")
  console.log("═".repeat(60))
  console.log(`\nLogin:`)
  console.log(`  URL:      https://${slug}.leaddrivecrm.org/login`)
  console.log(`  Email:    ${admin.email}`)
  console.log(`\nTeam:`)
  for (const tm of teamMembers) console.log(`  ${tm.email}  (${tm.role})`)
  console.log(`\nCounts:`)
  console.log(`  Subsidiaries (internal): ${subsidiaries.length}`)
  console.log(`  External customers:      ${externals.length}`)
  console.log(`  Contacts:                ${contacts.length}`)
  console.log(`  Products:                ${productData.length}`)
  console.log(`  Deals:                   ${createdDeals.length}`)
  console.log(`  Leads:                   ${createdLeads.length}`)
  console.log(`  Tasks:                   ${createdTasks.length}`)
  console.log(`  Tickets:                 ${createdTickets.length}`)
  console.log(`  Complaint meta:          ${cmCount}`)
  console.log(`  Inbox channels / convs:  6 / 6`)
  console.log(`  Campaigns:               ${campaignsData.length}`)
  console.log(`  Survey responses:        ${respCount}`)
  console.log(`  AI shadow actions:       ${shadowCount}`)
}

// Helper: count deals per stage for log line
function stageCounts(deals) {
  const order = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]
  const counts = {}
  for (const d of deals) counts[d.stage] = (counts[d.stage] || 0) + 1
  return order.map((s) => [s, counts[s] || 0])
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma?.$disconnect())
