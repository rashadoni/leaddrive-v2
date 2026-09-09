#!/usr/bin/env node
/**
 * Fail-fast readiness check for real Advisor Center responsive QA.
 *
 * This script does not mutate data. It verifies the prerequisites needed before
 * running scripts/capture-advisor-screenshots.mjs against an authenticated
 * tenant with current Advisor demo data.
 */
import fs from "node:fs"
import { makeScriptPrisma } from "./_rls.mjs"
import { passwordPolicyError } from "./password-policy.mjs"

const DEFAULT_DB_URL = "postgresql://leaddrive:leaddrive@localhost:5432/leaddrive"
const DEFAULT_DEMO_EMAIL = "advisor.manager@advisor-demo.local"
const REQUIRED_TABLES = [
  "ai_shadow_actions",
  "proactive_alerts",
  "mtm_agents",
  "mtm_routes",
  "mtm_visits",
  "mtm_photos",
  "payment_orders",
  "invoices",
  "bills",
  "quotes",
  "offers",
  "contracts",
  "tickets",
  "campaigns",
  "advisor_playbooks",
  "advisor_signal_snapshots",
]
const DEMO_PREFIX = "ADV-DEMO"
const DEMO_MARKER = "@advisor-demo.local"
const CUID_LIKE = /\bc[a-z0-9]{20,}\b/i

function arg(name) {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ""
}

function boolEnv(name) {
  return ["1", "true", "yes"].includes(String(process.env[name] || "").toLowerCase())
}

const slug = arg("slug") || process.env.ADVISOR_TENANT_SLUG || ""
const baseUrl = process.env.BASE_URL || "http://localhost:3000"
const storageState = process.env.ADVISOR_STORAGE_STATE || process.env.STORAGE_STATE || ""
const email = process.env.ADMIN_EMAIL || process.env.ADVISOR_EMAIL || ""
const password = process.env.ADMIN_PASSWORD || process.env.ADVISOR_PASSWORD || ""
const databaseUrl = process.env.DATABASE_URL || DEFAULT_DB_URL
const jsonOutput = process.argv.includes("--json")

const results = []

function record(status, name, detail, fix) {
  results.push({ status, name, detail, ...(fix ? { fix } : {}) })
}

function isLocalBaseUrl(value) {
  try {
    const url = new URL(value)
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  } catch {
    return false
  }
}

function shouldCheckDb() {
  if (boolEnv("ADVISOR_QA_SKIP_DB")) return false
  if (boolEnv("ADVISOR_QA_CHECK_DB")) return true
  return isLocalBaseUrl(baseUrl)
}

async function checkAuthInputs() {
  if (storageState) {
    if (fs.existsSync(storageState)) {
      record("ok", "auth", `storage state found: ${storageState}`)
    } else {
      record("fail", "auth", `storage state does not exist: ${storageState}`, "Point ADVISOR_STORAGE_STATE at a Playwright storageState JSON file.")
    }
    return
  }

  if (email && password) {
    const passwordError = passwordPolicyError(password)
    if (passwordError) {
      record("fail", "auth", `provided password does not meet the shared policy: ${passwordError}`, "Use the same secret-managed password supplied as ADVISOR_DEMO_PASSWORD when the QA user was seeded.")
      return
    }
    record("ok", "auth", `credentials provided for ${email}`)
    return
  }

  record(
    "fail",
    "auth",
    "no ADVISOR_STORAGE_STATE and no ADMIN_EMAIL/ADMIN_PASSWORD or ADVISOR_EMAIL/ADVISOR_PASSWORD",
    `Use a captured storageState, or seed a pilot tenant and provide ADVISOR_EMAIL=${DEFAULT_DEMO_EMAIL} plus the secret-managed ADVISOR_PASSWORD.`,
  )
}

async function checkDatabase() {
  if (!shouldCheckDb()) {
    record("warn", "database", `skipped DB checks for non-local BASE_URL=${baseUrl}`, "Set ADVISOR_QA_CHECK_DB=1 to force local DB preflight.")
    return
  }

  const previousDatabaseUrl = process.env.DATABASE_URL
  let prisma
  try {
    process.env.DATABASE_URL = databaseUrl
    prisma = await makeScriptPrisma()
    await prisma.$connect()
    record("ok", "database", `connected to ${databaseUrl.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:***@")}`)

    const missingTables = []
    for (const table of REQUIRED_TABLES) {
      const rows = await prisma.$queryRaw`SELECT to_regclass(${`public.${table}`})::text AS name`
      if (!rows?.[0]?.name) missingTables.push(table)
    }
    if (missingTables.length > 0) {
      record(
        "fail",
        "schema",
        `missing Advisor QA tables: ${missingTables.join(", ")}`,
        "For local QA, load env and run npx prisma migrate dev before seeding Advisor demo data.",
      )
    } else {
      record("ok", "schema", "all Advisor QA tables exist")
    }

    if (!slug) {
      record("warn", "tenant", "ADVISOR_TENANT_SLUG/--slug was not provided", "Run with --slug=<tenant-slug> to verify the exact pilot tenant.")
      return
    }

    const tenants = await prisma.$queryRaw`
      SELECT id, name, slug, modules, features, addons
      FROM organizations
      WHERE slug = ${slug}
      LIMIT 1
    `
    const tenant = tenants?.[0]
    if (!tenant) {
      record("fail", "tenant", `tenant not found: ${slug}`, `Create or choose a tenant, then run node scripts/seeds/advisor-demo.mjs --slug=${slug}.`)
      return
    }
    record("ok", "tenant", `found ${tenant.name || tenant.slug} (${tenant.slug})`)

    const modules = tenant.modules && typeof tenant.modules === "object" ? tenant.modules : {}
    const expectedModules = ["crm", "sales", "contracts", "marketing", "support", "finance", "analytics", "mtm"]
    const disabledModules = expectedModules.filter((key) => modules[key] !== true)
    if (disabledModules.length > 0) {
      record(
        "warn",
        "modules",
        `tenant modules not fully Advisor-ready: ${disabledModules.join(", ")}`,
        `Run node scripts/seeds/advisor-demo.mjs --slug=${slug} to enable Advisor demo modules.`,
      )
    } else {
      record("ok", "modules", "Advisor demo modules are enabled")
    }

    const candidateEmail = email || DEFAULT_DEMO_EMAIL
    const users = await prisma.$queryRaw`
      SELECT email, role, "isActive", "totpEnabled", "smsAuthEnabled", "require2fa"
      FROM users
      WHERE "organizationId" = ${tenant.id} AND email = ${candidateEmail}
      LIMIT 1
    `
    const user = users?.[0]
    if (!user) {
      record(
        "fail",
        "qa-user",
        `QA user not found in tenant ${slug}: ${candidateEmail}`,
        `Run node scripts/seeds/advisor-demo.mjs --slug=${slug}, then use ADVISOR_EMAIL=${DEFAULT_DEMO_EMAIL}.`,
      )
    } else if (!user.isActive) {
      record("fail", "qa-user", `QA user is inactive: ${candidateEmail}`, "Activate the user or provide a different ADVISOR_EMAIL.")
    } else if (user.totpEnabled || user.smsAuthEnabled || user.require2fa) {
      record("warn", "qa-user", `QA user may require 2FA: ${candidateEmail}`, "Prefer ADVISOR_STORAGE_STATE for tenants with 2FA.")
    } else {
      record("ok", "qa-user", `QA user ready: ${candidateEmail} (${user.role})`)
    }

    await checkAdvisorFullStory(prisma, tenant.id)
  } catch (error) {
    record("fail", "database", error instanceof Error ? error.message : String(error), "Check DATABASE_URL or set ADVISOR_QA_SKIP_DB=1 for remote screenshot capture.")
  } finally {
    await prisma?.$disconnect().catch(() => undefined)
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  }
}

async function checkAdvisorFullStory(prisma, organizationId) {
  const [
    crmContacts,
    deals,
    leads,
    offers,
    quotes,
    contracts,
    campaigns,
    tasks,
    invoices,
    bills,
    paymentOrders,
    tickets,
    routes,
    visits,
    photos,
    pendingActions,
    executedActions,
    rejectedActions,
    playbooks,
    snapshots,
    advisorActions,
  ] = await Promise.all([
    prisma.contact.count({ where: { organizationId, email: { endsWith: DEMO_MARKER } } }),
    prisma.deal.count({ where: { organizationId, name: { startsWith: DEMO_PREFIX } } }),
    prisma.lead.count({ where: { organizationId, email: { endsWith: DEMO_MARKER } } }),
    prisma.offer.count({ where: { organizationId, offerNumber: { startsWith: DEMO_PREFIX } } }),
    prisma.quote.count({ where: { organizationId, quoteNumber: { startsWith: DEMO_PREFIX } } }),
    prisma.contract.count({ where: { organizationId, contractNumber: { startsWith: DEMO_PREFIX } } }),
    prisma.campaign.count({ where: { organizationId, name: { startsWith: DEMO_PREFIX } } }),
    prisma.task.count({ where: { organizationId, title: { startsWith: DEMO_PREFIX } } }),
    prisma.invoice.count({ where: { organizationId, invoiceNumber: { startsWith: DEMO_PREFIX } } }),
    prisma.bill.count({ where: { organizationId, billNumber: { startsWith: DEMO_PREFIX } } }),
    prisma.paymentOrder.count({ where: { organizationId, orderNumber: { startsWith: DEMO_PREFIX } } }),
    prisma.ticket.count({ where: { organizationId, ticketNumber: { startsWith: DEMO_PREFIX } } }),
    prisma.mtmRoute.count({ where: { organizationId, name: { startsWith: DEMO_PREFIX } } }),
    prisma.mtmVisit.count({ where: { organizationId, notes: { contains: DEMO_PREFIX } } }),
    prisma.mtmPhoto.count({ where: { organizationId, url: { contains: "advisor-demo.local" } } }),
    prisma.aiShadowAction.count({ where: { organizationId, featureName: "advisor_signal", sourceSignalId: { startsWith: `${DEMO_PREFIX}:` }, approved: null } }),
    prisma.aiShadowAction.count({ where: { organizationId, featureName: "advisor_signal", sourceSignalId: { startsWith: `${DEMO_PREFIX}:` }, approved: true, executionStatus: "executed" } }),
    prisma.aiShadowAction.count({ where: { organizationId, featureName: "advisor_signal", sourceSignalId: { startsWith: `${DEMO_PREFIX}:` }, approved: false } }),
    prisma.advisorPlaybook.count({ where: { organizationId, patternKey: { startsWith: "sales:deal:create_task:create_follow-up_task" }, status: "disabled" } }),
    prisma.advisorSignalSnapshot.count({
      where: {
        organizationId,
        signalIds: { hasSome: [`${DEMO_PREFIX}:sales:previous`, `${DEMO_PREFIX}:finance:previous`] },
      },
    }),
    prisma.aiShadowAction.findMany({
      where: { organizationId, featureName: "advisor_signal", sourceSignalId: { startsWith: `${DEMO_PREFIX}:` } },
      select: { id: true, payload: true },
      take: 100,
    }),
  ])

  const domainChecks = [
    ["crm", crmContacts >= 1, `${crmContacts} demo contacts`],
    ["sales", deals >= 1 && leads >= 2 && offers >= 1 && quotes >= 1, `${deals} deals, ${leads} leads, ${offers} offers, ${quotes} quotes`],
    ["contracts", contracts >= 2, `${contracts} contracts`],
    ["marketing", campaigns >= 1, `${campaigns} campaigns`],
    ["tasks-kpi", tasks >= 4, `${tasks} tasks`],
    ["finance", invoices >= 1 && bills >= 1 && paymentOrders >= 1, `${invoices} invoices, ${bills} bills, ${paymentOrders} payment orders`],
    ["support", tickets >= 4, `${tickets} tickets`],
    ["routes-mtm", routes >= 1 && visits >= 1 && photos >= 2, `${routes} routes, ${visits} visits, ${photos} photos`],
  ]
  const missingDomains = domainChecks.filter(([, ok]) => !ok)
  if (missingDomains.length > 0) {
    record(
      "fail",
      "demo-story",
      `incomplete Advisor demo domains: ${missingDomains.map(([name, , detail]) => `${name} (${detail})`).join("; ")}`,
      `Run node scripts/seeds/advisor-demo.mjs --slug=${slug} after migrations.`,
    )
  } else {
    record("ok", "demo-story", domainChecks.map(([name, , detail]) => `${name}: ${detail}`).join(" | "))
  }

  const loopChecks = [
    ["approval-queue", pendingActions >= 1, `${pendingActions} pending Advisor actions`],
    ["executed-history", executedActions >= 2, `${executedActions} executed Advisor actions`],
    ["rejected-history", rejectedActions >= 1, `${rejectedActions} rejected Advisor actions`],
    ["playbook", playbooks >= 1, `${playbooks} disabled playbooks`],
    ["briefing-snapshot", snapshots >= 1, `${snapshots} persisted snapshots`],
  ]
  const missingLoop = loopChecks.filter(([, ok]) => !ok)
  if (missingLoop.length > 0) {
    record(
      "fail",
      "advisor-loop",
      `incomplete Advisor 100% loop: ${missingLoop.map(([name, , detail]) => `${name} (${detail})`).join("; ")}`,
      `Run node scripts/seeds/advisor-demo.mjs --slug=${slug} to seed queue/history/playbook/snapshot data.`,
    )
  } else {
    record("ok", "advisor-loop", loopChecks.map(([name, , detail]) => `${name}: ${detail}`).join(" | "))
  }

  const badOwnerLabels = advisorActions
    .map((action) => {
      const payload = action.payload && typeof action.payload === "object" && !Array.isArray(action.payload) ? action.payload : {}
      const advisor = payload.advisor && typeof payload.advisor === "object" && !Array.isArray(payload.advisor) ? payload.advisor : {}
      return { id: action.id, ownerLabel: advisor.ownerLabel }
    })
    .filter((item) => typeof item.ownerLabel === "string" && CUID_LIKE.test(item.ownerLabel))
  if (badOwnerLabels.length > 0) {
    record("fail", "owner-labels", `technical owner labels found in Advisor actions: ${badOwnerLabels.map((item) => item.id).join(", ")}`, "Rerun the seed or fix owner label resolution.")
  } else {
    record("ok", "owner-labels", "Advisor demo action owner labels are human-readable")
  }
}

function printResults() {
  const failed = results.filter((item) => item.status === "fail")
  if (jsonOutput) {
    console.log(JSON.stringify({ ok: failed.length === 0, baseUrl, slug: slug || null, results }, null, 2))
    return
  }

  console.log(`Advisor QA readiness for ${baseUrl}`)
  if (slug) console.log(`Tenant: ${slug}`)
  for (const item of results) {
    const mark = item.status === "ok" ? "OK" : item.status === "warn" ? "WARN" : "FAIL"
    console.log(`${mark} ${item.name}: ${item.detail}`)
    if (item.fix) console.log(`  fix: ${item.fix}`)
  }
}

await checkAuthInputs()
await checkDatabase()
printResults()

if (results.some((item) => item.status === "fail")) {
  process.exit(1)
}
