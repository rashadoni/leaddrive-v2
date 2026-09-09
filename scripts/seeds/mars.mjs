// Seed Mars Overseas demo tenant (Pepsi-bottler MTM pilot — M0-6 / M1-6 prep).
//
// Provisions a "mars" tenant on the LeadDrive instance with realistic
// Pepsi-bottler Route & Field data: 5 agents, 25 customers across
//
// Idempotent — every insert guarded by findFirst/findUnique. Safe to
// re-run after partial failures.
//
// Usage:
//   CONFIRM_PROD=1 SEED_PASSWORD='<policy-compliant-secret>' \
//     node scripts/seeds/mars.mjs --slug=mars
//   CONFIRM_PROD=1 SEED_PASSWORD='<policy-compliant-secret>' \
//     node scripts/seeds/mars.mjs --slug=mars --reset-passwords
//
// Before running:
//   - Either run against the tenant after provisioning via the admin API,
//     or let this script self-provision the org (it will if missing).
//   - DATABASE_URL must point at the target DB.

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
function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? getArg("password")
if (!SEED_PASSWORD) throw new Error("Set SEED_PASSWORD or pass --password=<policy-compliant-secret>")
const passwordError = passwordPolicyError(SEED_PASSWORD)
if (passwordError) throw new Error(`Seed password rejected: ${passwordError}`)
const RESET_PASSWORDS = hasFlag("reset-passwords")

prisma = await makeScriptPrisma()

// Feature flags — Mars is MTM-heavy; enable Route & Field plus core CRM.
const MARS_FEATURES = [
  "mtm",
  "core",
  "deals",
  "leads",
  "tasks",
  "reports",
  "knowledge-base",
  "custom-fields",
  "currencies",
]

// Mars-flavored branding — Pepsi blue + Mars Overseas wordmark.
const MARS_BRANDING = {
  primaryColor: "#004B93", // Pepsi navy blue
  accentColor: "#E32934", // Pepsi red
  companyName: "Mars Overseas Baku",
  loginHeader: "Mars Overseas — Pepsi Pilot Trade Marketing",
}

const today = new Date()
function daysAgo(n) {
  const d = new Date(today)
  d.setDate(d.getDate() - n)
  return d
}
function daysAhead(n) {
  const d = new Date(today)
  d.setDate(d.getDate() + n)
  return d
}
function dateAt(base, hours, minutes = 0) {
  const d = new Date(base)
  d.setHours(hours, minutes, 0, 0)
  return d
}

// ─── Static demo data ───────────────────────────────────────────────────────

const AGENTS = [
  // First entry doubles as the demo manager + web admin link.
  { name: "Farid Aliyev",     email: "farid@mars.leaddrivecrm.org",   phone: "+994-50-555-1001", role: "MANAGER",    isManager: true },
  { name: "Elnur Mammadov",   email: "elnur@mars.leaddrivecrm.org",   phone: "+994-50-555-1002", role: "SUPERVISOR", isManager: false },
  { name: "Tural Quliyev",    email: "tural@mars.leaddrivecrm.org",   phone: "+994-50-555-1003", role: "AGENT",      isManager: false },
  { name: "Nigar Hüseynova",  email: "nigar@mars.leaddrivecrm.org",   phone: "+994-50-555-1004", role: "AGENT",      isManager: false },
  { name: "Rashad Babayev",   email: "rashad@mars.leaddrivecrm.org",  phone: "+994-50-555-1005", role: "AGENT",      isManager: false },
]

const CUSTOMERS = [
  // Baku — supermarkets
  { code: "BRV-NSM",   name: "Bravo Nəsimi",                category: "A", address: "Nizami Küçəsi 76, Bakı, Nəsimi",      lat: 40.3712, lon: 49.8421, district: "Baku" },
  { code: "BRV-YSM",   name: "Bravo Yasamal",               category: "A", address: "Hasan bey Zardabi 88, Bakı, Yasamal", lat: 40.3925, lon: 49.8225, district: "Baku" },
  { code: "BIZ-XTI",   name: "Bizim Tarla Xətai",            category: "A", address: "Babək prospekti 17, Bakı, Xətai",     lat: 40.3835, lon: 49.9133, district: "Baku" },
  { code: "ARZ-SBL",   name: "Araz Səbail",                  category: "A", address: "Nizami Küçəsi 12, Bakı, Səbail",      lat: 40.3633, lon: 49.8344, district: "Baku" },
  { code: "NPT-BNG",   name: "Neptun Binəqədi",              category: "B", address: "Binəqədi Şossesi 4, Bakı, Binəqədi",  lat: 40.4521, lon: 49.8217, district: "Baku" },
  { code: "PIR-XTI",   name: "Pyramid Express Xətai",        category: "B", address: "Babək prospekti 22, Bakı, Xətai",     lat: 40.3812, lon: 49.9215, district: "Baku" },
  // Baku — corner shops
  { code: "MGZ-AHM",   name: 'Mağaza "Əhməd"',               category: "C", address: "Hüseyn Cavid 14, Bakı, Yasamal",      lat: 40.3878, lon: 49.8456, district: "Baku" },
  { code: "MGZ-NIK",   name: 'Mağaza "Nikbin"',              category: "C", address: "Sahil bağı yanı, Bakı, Səbail",       lat: 40.3681, lon: 49.8347, district: "Baku" },
  { code: "MGZ-25",    name: "Магазин № 25",                  category: "D", address: "28 May küçəsi 31, Bakı",              lat: 40.3795, lon: 49.8412, district: "Baku" },
  // Baku — HoReCa
  { code: "REST-KFC1", name: "KFC Park Bulvar",              category: "A", address: "Park Bulvar AVM, Bakı, Səbail",        lat: 40.3582, lon: 49.8458, district: "Baku" },
  { code: "REST-MCD1", name: "McDonald's 28 May",            category: "A", address: "28 May metrosu yanı, Bakı",            lat: 40.3789, lon: 49.8479, district: "Baku" },
  { code: "REST-RST1", name: "Ramada Cafe",                  category: "B", address: "Üzeyir Hacıbəyli 1, Bakı, Səbail",     lat: 40.3691, lon: 49.8367, district: "Baku" },
  // Ganja
  { code: "BRV-GNJ1",  name: "Bravo Gəncə Mərkəz",            category: "A", address: "Atatürk prospekti 33, Gəncə",          lat: 40.6828, lon: 46.3606, district: "Ganja" },
  { code: "ARZ-GNJ1",  name: "Araz Gəncə",                    category: "B", address: "Heydər Əliyev prospekti 8, Gəncə",     lat: 40.6794, lon: 46.3589, district: "Ganja" },
  { code: "MGZ-GNJ1",  name: 'Mağaza "Gəncəbazar"',           category: "C", address: "Şah İsmayıl Xətai küçəsi 24, Gəncə",   lat: 40.6804, lon: 46.3578, district: "Ganja" },
  { code: "MGZ-GNJ2",  name: "Магазин «Низами»",              category: "D", address: "Nizami küçəsi 14, Gəncə",              lat: 40.6831, lon: 46.3622, district: "Ganja" },
  // Sumqayit
  { code: "BIZ-SMQ1",  name: "Bizim Tarla Sumqayıt",          category: "A", address: "Sülh küçəsi 17, Sumqayıt",             lat: 40.5851, lon: 49.6473, district: "Sumqayit" },
  { code: "NPT-SMQ1",  name: "Neptun Sumqayıt",               category: "B", address: "28 May küçəsi 11, Sumqayıt",           lat: 40.5832, lon: 49.6491, district: "Sumqayit" },
  { code: "MGZ-SMQ1",  name: 'Mağaza "Xəzər"',                category: "C", address: "Cəfər Cabbarlı küçəsi 9, Sumqayıt",    lat: 40.5867, lon: 49.6502, district: "Sumqayit" },
  { code: "MGZ-SMQ2",  name: 'Mağaza "Sahil"',                category: "C", address: "Sahil küçəsi 22, Sumqayıt",            lat: 40.5912, lon: 49.6534, district: "Sumqayit" },
  // Baku misc
  { code: "GAS-SOC1",  name: "SOCAR АЗС-12",                  category: "B", address: "Heydar Aliyev pr. 67, Bakı",           lat: 40.4012, lon: 49.8682, district: "Baku" },
  { code: "GAS-SOC2",  name: "SOCAR АЗС-44",                  category: "B", address: "Binəqədi şossesi 88, Bakı",            lat: 40.4612, lon: 49.8175, district: "Baku" },
  { code: "CINEMA-1",  name: "CinemaPlus 28 Mall",            category: "B", address: "28 Mall, Bakı",                        lat: 40.3782, lon: 49.8489, district: "Baku" },
  { code: "AVM-GZ",    name: "Gənclik AVM food court",         category: "A", address: "Fətəli Xan Xoyski pr., Bakı",           lat: 40.3978, lon: 49.8506, district: "Baku" },
  { code: "REST-CHX",  name: "Çörək Xanası Köhnə Bazar",      category: "C", address: "İçəri Şəhər, Bakı",                    lat: 40.3661, lon: 49.8367, district: "Baku" },
]

// ─── Main seed ──────────────────────────────────────────────────────────────

async function main() {
  // Default slug is `mars` to match the subdomain we register in nginx
  // (`mars.leaddrivecrm.org`). The cookie-domain binding +
  // organizationSlug check in middleware will silently reject login if
  // slug ≠ subdomain (see memory/feedback_client_cookie_domain.md).
  const slug = getArg("slug") || "mars"
  const adminEmail = getArg("email") || "demo@mars.leaddrivecrm.org"
  const companyName = getArg("name") || MARS_BRANDING.companyName

  console.log("\n🚀 Mars Overseas demo seed — Pepsi-bottler MTM pilot\n")
  console.log(`   Tenant slug: ${slug}`)
  console.log(`   Admin email: ${adminEmail}\n`)

  // 1. Provision the organization if it doesn't exist
  let org = await prisma.organization.findUnique({ where: { slug } })
  if (!org) {
    console.log(`Tenant "${slug}" not found — self-provisioning...`)
    const adminHash = await bcrypt.hash(SEED_PASSWORD, 12)
    org = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: companyName,
          slug,
          plan: "enterprise",
          maxUsers: 50,
          maxContacts: 10000,
          isActive: true,
          // Match project convention: features + branding stored as
          // JSON-stringified strings on the Json? column (see
          // src/lib/tenant-provisioning.ts:88). Mixed shapes across rows
          // break frontend readers, so stay consistent.
          features: JSON.stringify(MARS_FEATURES),
          branding: JSON.stringify(MARS_BRANDING),
        },
      })
      await tx.user.create({
        data: {
          organizationId: organization.id,
          email: adminEmail,
          name: "Mars Demo Admin",
          role: "admin",
          isActive: true,
          passwordHash: adminHash,
        },
      })
      return organization
    })
    console.log(`✅ Org "${slug}" provisioned (${org.id})`)
  } else {
    // Refresh features / branding in case the org was provisioned with
    // a generic pharma profile via the admin API.
    const rawFeatures = org.features
    const currentFeatures = Array.isArray(rawFeatures)
      ? rawFeatures
      : typeof rawFeatures === "string"
        ? JSON.parse(rawFeatures || "[]")
        : []
    const missing = MARS_FEATURES.filter((f) => !currentFeatures.includes(f))
    if (missing.length || !org.branding) {
      // Merge existing branding (may be either a stringified or parsed
      // object depending on which provisioning path created the tenant)
      // with Mars defaults, then stringify for consistency with the
      // create-path convention.
      const existingBranding =
        typeof org.branding === "string"
          ? (() => {
              try { return JSON.parse(org.branding) } catch { return {} }
            })()
          : (org.branding && typeof org.branding === "object" ? org.branding : {})
      await prisma.organization.update({
        where: { id: org.id },
        data: {
          features: JSON.stringify([...new Set([...currentFeatures, ...MARS_FEATURES])]),
          branding: JSON.stringify({ ...existingBranding, ...MARS_BRANDING }),
        },
      })
      console.log(`  ✓ patched features (+${missing.length}) + branding on existing tenant`)
    }
    console.log(`✅ Tenant "${slug}" already exists (${org.id}); refreshed`)
  }
  const orgId = org.id

  // Ensure an admin user exists (re-seed against an org provisioned earlier).
  let admin = await prisma.user.findFirst({
    where: { organizationId: orgId, email: adminEmail },
  })
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: adminEmail,
        name: "Mars Demo Admin",
        role: "admin",
        isActive: true,
        passwordHash: await bcrypt.hash(SEED_PASSWORD, 12),
      },
    })
    console.log(`  ✓ created admin user ${adminEmail}`)
  } else if (RESET_PASSWORDS) {
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        passwordHash: await bcrypt.hash(SEED_PASSWORD, 12),
        passwordChangedAt: new Date(),
      },
    })
    console.log(`  ✓ reset admin password`)
  }

  // ═══════════════════════════════════════════════════
  // AGENTS
  // ═══════════════════════════════════════════════════
  console.log("\n📋 Agents…")
  const demoPasswordHash = await bcrypt.hash(SEED_PASSWORD, 12)
  const agents = {}
  let manager = null
  for (const a of AGENTS) {
    // Web evidence and manager review use the CRM session, while the native
    // app authenticates against MtmAgent.passwordHash. Keep both principals
    // for every non-manager roster entry and bind them through userId. The
    // manager entry intentionally stays linked to the tenant admin created
    // above, so demo@... remains the web manager principal.
    let linkedUserId = a.isManager ? admin.id : null
    if (!a.isManager) {
      const existingWebUser = await prisma.user.findUnique({
        where: { organizationId_email: { organizationId: orgId, email: a.email } },
        select: { id: true },
      })
      const webRole = a.role === "SUPERVISOR" ? "manager" : "sales"
      const webUser = existingWebUser
        ? await prisma.user.update({
            where: { id: existingWebUser.id },
            data: {
              name: a.name,
              role: webRole,
              isActive: true,
              ...(RESET_PASSWORDS
                ? { passwordHash: demoPasswordHash, passwordChangedAt: new Date() }
                : {}),
            },
          })
        : await prisma.user.create({
            data: {
              organizationId: orgId,
              email: a.email,
              name: a.name,
              role: webRole,
              isActive: true,
              passwordHash: demoPasswordHash,
            },
          })
      linkedUserId = webUser.id
    }
    const existing = await prisma.mtmAgent.findUnique({
      where: { organizationId_email: { organizationId: orgId, email: a.email } },
      select: { passwordHash: true },
    })
    const agent = await prisma.mtmAgent.upsert({
      where: { organizationId_email: { organizationId: orgId, email: a.email } },
      update: {
        name: a.name,
        phone: a.phone,
        role: a.role,
        status: "ACTIVE",
        managerId: a.isManager ? null : (manager?.id ?? null),
        userId: linkedUserId,
        // Only fill passwordHash on first create — re-seed should not
        // overwrite a hash someone rotated locally, unless --reset-passwords.
        ...(existing?.passwordHash && !RESET_PASSWORDS ? {} : { passwordHash: demoPasswordHash }),
      },
      create: {
        organizationId: orgId,
        name: a.name,
        email: a.email,
        phone: a.phone,
        role: a.role,
        status: "ACTIVE",
        isOnline: a.isManager,
        managerId: a.isManager ? null : (manager?.id ?? null),
        userId: linkedUserId,
        passwordHash: demoPasswordHash,
      },
    })
    agents[a.email] = agent
    if (a.isManager) manager = agent
    console.log(`  ✅ ${agent.name} (${agent.role})`)
  }

  // ═══════════════════════════════════════════════════
  // CUSTOMERS
  // ═══════════════════════════════════════════════════
  console.log("\n🏪 Customers…")
  const customers = {}
  for (const c of CUSTOMERS) {
    const cust = await prisma.mtmCustomer.upsert({
      where: { organizationId_code: { organizationId: orgId, code: c.code } },
      update: {
        name: c.name,
        category: c.category,
        address: c.address,
        latitude: c.lat,
        longitude: c.lon,
        status: "ACTIVE",
      },
      create: {
        organizationId: orgId,
        code: c.code,
        name: c.name,
        category: c.category,
        address: c.address,
        latitude: c.lat,
        longitude: c.lon,
        status: "ACTIVE",
        phone: `+994-50-555-${(1000 + Object.keys(customers).length).toString().padStart(4, "0")}`,
      },
    })
    customers[c.code] = { row: cust, meta: c }
  }
  console.log(`  ✅ ${CUSTOMERS.length} customers`)

  // ═══════════════════════════════════════════════════
  // ROUTES + ROUTE POINTS + VISITS
  // ═══════════════════════════════════════════════════
  console.log("\n🗺  Routes + visits…")
  const fieldAgents = AGENTS.filter((a) => a.role === "AGENT" || a.role === "SUPERVISOR").map((a) => agents[a.email])

  // 5 routes: 3 today (active/planned), 2 yesterday (completed)
  const routePlans = [
    { agent: fieldAgents[0], date: today,        district: "Baku",     status: "IN_PROGRESS" },
    { agent: fieldAgents[1], date: today,        district: "Baku",     status: "PLANNED" },
    { agent: fieldAgents[2], date: today,        district: "Ganja",    status: "PLANNED" },
    { agent: fieldAgents[0], date: daysAgo(1),   district: "Baku",     status: "COMPLETED" },
    { agent: fieldAgents[3], date: daysAgo(1),   district: "Sumqayit", status: "COMPLETED" },
  ]
  let routesMade = 0
  let pointsMade = 0
  let visitsMade = 0
  for (let r = 0; r < routePlans.length; r++) {
    const plan = routePlans[r]
    if (!plan.agent) continue
    const districtCustomers = CUSTOMERS.filter((c) => c.district === plan.district)
    const selected = districtCustomers.slice(0, 5 + (r % 3))
    const routeKey = `${plan.agent.id}-${plan.date.toISOString().slice(0, 10)}`
    const existingRoute = await prisma.mtmRoute.findFirst({
      where: { organizationId: orgId, agentId: plan.agent.id, date: { gte: dateAt(plan.date, 0), lt: dateAt(plan.date, 23, 59) } },
    })
    let route = existingRoute
    if (!route) {
      route = await prisma.mtmRoute.create({
        data: {
          organizationId: orgId,
          agentId: plan.agent.id,
          date: dateAt(plan.date, 9),
          status: plan.status,
          notes: `Route ${routeKey} — ${plan.district} territory`,
        },
      })
      routesMade++
    }
    // Points
    for (let i = 0; i < selected.length; i++) {
      const cust = customers[selected[i].code]
      const existingPoint = await prisma.mtmRoutePoint.findFirst({
        where: { routeId: route.id, customerId: cust.row.id },
      })
      if (!existingPoint) {
        // MtmPointStatus enum: PENDING / VISITED / SKIPPED — no PLANNED.
        const pointStatus =
          plan.status === "COMPLETED" ? "VISITED" :
          plan.status === "IN_PROGRESS" && i < 2 ? "VISITED" :
          "PENDING"
        await prisma.mtmRoutePoint.create({
          // Note: orderIndex (not "position") is the sort key.
          data: {
            organizationId: orgId,
            routeId: route.id,
            customerId: cust.row.id,
            orderIndex: i + 1,
            plannedTime: dateAt(plan.date, 9 + i),
            visitedAt: pointStatus === "VISITED" ? dateAt(plan.date, 9 + i, 30) : null,
            status: pointStatus,
          },
        })
        pointsMade++
        // Create a visit for each VISITED point.
        // MtmVisitStatus enum: CHECKED_IN / CHECKED_OUT / CANCELLED.
        // Field names are checkInAt/checkOutAt/checkInLat/checkInLng;
        // no routePointId or checkInAccuracy on the schema.
        if (pointStatus === "VISITED") {
          const checkInAt = dateAt(plan.date, 9 + i, 30)
          const isCompleted = plan.status === "COMPLETED" || i < 1
          await prisma.mtmVisit.create({
            data: {
              organizationId: orgId,
              agentId: plan.agent.id,
              customerId: cust.row.id,
              status: isCompleted ? "CHECKED_OUT" : "CHECKED_IN",
              checkInAt,
              checkOutAt: isCompleted ? new Date(checkInAt.getTime() + 22 * 60 * 1000) : null,
              // Reproducible jitter (~50m at Baku latitude) seeded from
              // customer code so re-seeds produce stable GPS history.
              // The bit-fiddle keeps lat/lng independent.
              checkInLat: cust.meta.lat + (((cust.row.id.charCodeAt(0) % 11) - 5) / 10000),
              checkInLng: cust.meta.lon + (((cust.row.id.charCodeAt(1) % 11) - 5) / 10000),
              duration: isCompleted ? 22 : null,
              notes: isCompleted ? "Визит завершён, заказ принят, выкладка проверена." : null,
            },
          })
          visitsMade++
        }
      }
    }
  }
  console.log(`  ✅ ${routesMade} routes, ${pointsMade} points, ${visitsMade} visits`)

  // ═══════════════════════════════════════════════════
  // TASKS
  // ═══════════════════════════════════════════════════
  console.log("\n📝 Tasks…")
  // MtmTaskStatus enum: PENDING / IN_PROGRESS / COMPLETED / CANCELLED / OVERDUE.
  // MtmTaskPriority enum: LOW / MEDIUM / HIGH / URGENT (no NORMAL).
  const tasks = [
    { title: "Проверить выкладку Pepsi-2L в Bravo Nəsimi",    customerKey: "BRV-NSM",   priority: "HIGH",   status: "PENDING",     daysAhead: 0 },
    { title: "Согласовать промо Mirinda с Bizim Tarla",         customerKey: "BIZ-XTI",   priority: "MEDIUM", status: "IN_PROGRESS", daysAhead: 1 },
    { title: "Заменить ценник 7Up в Araz Səbail",               customerKey: "ARZ-SBL",   priority: "LOW",    status: "COMPLETED",   daysAgo: 2  },
    { title: "Проинспектировать холодильник в KFC Park Bulvar", customerKey: "REST-KFC1", priority: "URGENT", status: "PENDING",     daysAhead: 0 },
    { title: "Получить подпись на акт от Bravo Gəncə",          customerKey: "BRV-GNJ1",  priority: "MEDIUM", status: "PENDING",     daysAhead: 2 },
  ]
  let taskCount = 0
  for (const t of tasks) {
    const cust = customers[t.customerKey]
    if (!cust) continue
    const existing = await prisma.mtmTask.findFirst({
      where: { organizationId: orgId, title: t.title },
    })
    if (existing) continue
    await prisma.mtmTask.create({
      data: {
        organizationId: orgId,
        agentId: fieldAgents[taskCount % fieldAgents.length]?.id,
        customerId: cust.row.id,
        title: t.title,
        description: null,
        priority: t.priority,
        status: t.status,
        dueDate: t.daysAhead !== undefined ? daysAhead(t.daysAhead) : daysAgo(t.daysAgo),
        completedAt: t.status === "COMPLETED" ? daysAgo(t.daysAgo ?? 1) : null,
      },
    })
    taskCount++
  }
  console.log(`  ✅ ${taskCount} tasks`)

  // ═══════════════════════════════════════════════════
  // ALERTS
  // ═══════════════════════════════════════════════════
  console.log("\n🚨 Alerts…")
  // MtmAlertType enum (current schema): GPS_ANOMALY / LATE_START /
  // MISSED_VISIT / LONG_BREAK / GPS_SPOOFING / OUT_OF_ZONE / LOW_BATTERY /
  // OVERTIME. Equipment-related and stockout alerts are NOT in this enum
  // yet — they're modeled via the audit log + console alerts on
  // BullMQ/cron job runs. For the demo we use the enum values that exist
  // and surface equipment status via the dedicated /mtm/equipment view.
  //
  // Each alert requires agentId (mandatory FK). Pick the agent whose
  // shift the alert flags.
  const tural = agents["tural@mars.leaddrivecrm.org"]
  const nigar = agents["nigar@mars.leaddrivecrm.org"]
  const rashadAgent = agents["rashad@mars.leaddrivecrm.org"]
  const elnur = agents["elnur@mars.leaddrivecrm.org"]
  const alerts = [
    { agent: tural,        type: "GPS_SPOOFING", category: "CRITICAL", title: "Подозрение на спуфинг GPS",     description: "Tural Quliyev · Bravo Yasamal — координаты check-in не совпадают с EXIF фото визита (расхождение 280м)." },
    { agent: nigar,        type: "MISSED_VISIT", category: "WARNING",  title: "Пропущенный визит по плану",     description: "Nigar Hüseynova · Neptun Sumqayıt — точка #3 маршрута не посещена до 14:00 по плану." },
    { agent: rashadAgent,  type: "LATE_START",   category: "WARNING",  title: "Поздний старт смены",            description: "Rashad Babayev — первый check-in в 11:15, плановый старт смены 9:00." },
    { agent: elnur,        type: "LONG_BREAK",   category: "INFO",     title: "Длинный перерыв",                description: "Elnur Mammadov — отсутствует GPS-трэк с 13:15 до 14:48 (1ч 33мин)." },
    { agent: tural,        type: "OUT_OF_ZONE",  category: "WARNING",  title: "Агент вне рабочей зоны",         description: "Tural Quliyev — последний GPS пинг 7км от ближайшей назначенной точки." },
  ]
  let alertCount = 0
  for (const a of alerts) {
    if (!a.agent) continue
    const existing = await prisma.mtmAlert.findFirst({
      where: { organizationId: orgId, title: a.title },
    })
    if (existing) continue
    await prisma.mtmAlert.create({
      data: {
        organizationId: orgId,
        agentId: a.agent.id,
        type: a.type,
        category: a.category,
        title: a.title,
        description: a.description,
        isResolved: false,
      },
    })
    alertCount++
  }
  console.log(`  ✅ ${alertCount} alerts`)

  // ═══════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════
  console.log("\n" + "═".repeat(60))
  console.log("✨ Mars Overseas demo tenant seeded successfully")
  console.log("═".repeat(60))
  console.log(`\nTenant:  ${companyName} (slug: ${slug})`)
  console.log(`Admin:   ${adminEmail}`)
  console.log("Mobile:  seeded agent emails listed above")
  console.log(`\nNext steps:`)
  console.log(`  1. Add 'mars' entry to clients/registry.json`)
  console.log(`  2. Provision mars.leaddrivecrm.org subdomain on nginx`)
  console.log(`  3. Open https://mars.leaddrivecrm.org and walk the playbook`)
  console.log(`     (docs/mars-playbook.md)`)
  console.log()
}

main()
  .catch((e) => {
    console.error("\n❌ Mars seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma?.$disconnect()
  })
