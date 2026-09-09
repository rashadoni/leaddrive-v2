#!/usr/bin/env node
import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

const KNOWN_CAPABILITIES = [
  { id: "crm-core", moduleId: "crm" },
  { id: "sales-core", moduleId: "sales" },
  { id: "settings-core", moduleId: "settings" },
  { id: "route-field", moduleId: "mtm" },
  { id: "da-vinci-ai", moduleId: "ai" },
  { id: "ai-security-monitoring", ownerModule: "ai", featureKey: "ai_security_monitoring" },
  { id: "slack-deal-notifier", ownerModule: "sales", appSlug: "slack-deal-notifier" },
  { id: "erp-order-sync", ownerModule: "mtm", appSlug: "erp-order-sync" },
  { id: "lead-scoring-template", ownerModule: "sales", appSlug: "lead-scoring-rules" },
]

const LEGACY_MODULE_MAP = {
  core: "crm",
  companies: "crm",
  contacts: "crm",
  tasks: "crm",
  projects: "crm",
  deals: "sales",
  leads: "sales",
  quotes: "sales",
  offers: "sales",
  workflows: "settings",
  "custom-fields": "settings",
  currencies: "settings",
  audit: "settings",
  users: "settings",
  settings: "settings",
  inventory: "mtm",
  reports: "analytics",
}

function arg(name) {
  const prefix = `--${name}=`
  const found = process.argv.find((item) => item.startsWith(prefix))
  return found ? found.slice(prefix.length) : undefined
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function featureRecord(features) {
  const values = Array.isArray(features) ? features : []
  const record = {}
  for (const value of values) {
    if (typeof value === "string") record[value] = true
  }
  return record
}

function moduleRecord(org) {
  return {
    ...featureRecord(org.features),
    ...Object.fromEntries(
      Object.entries(asRecord(org.modules)).filter(([, value]) => typeof value === "boolean"),
    ),
  }
}

function settingsRecord(settings) {
  const root = asRecord(settings)
  return asRecord(root.marketplaceCapabilities ?? root.capabilities)
}

function truthyMap(value) {
  if (Array.isArray(value)) return Object.fromEntries(value.filter((item) => typeof item === "string").map((item) => [item, true]))
  return Object.fromEntries(Object.entries(asRecord(value)).filter(([, enabled]) => enabled === true))
}

function hasModule(modules, addons, moduleId) {
  return modules[moduleId] === true || addons.includes(moduleId)
}

function resolveCapability(capability, org, modules, installationsBySlug, hidden, requested) {
  const installed = capability.appSlug ? installationsBySlug[capability.appSlug] : null
  const moduleEnabled = capability.moduleId ? hasModule(modules, org.addons, capability.moduleId) : false
  const ownerEnabled = capability.ownerModule ? hasModule(modules, org.addons, capability.ownerModule) : true
  const featureEnabled = capability.featureKey ? modules[capability.featureKey] === true : false

  if (installed?.status === "active") return hidden[capability.id] ? "hidden" : "installed"
  if (installed?.status === "disabled") return "disabled"
  if (moduleEnabled || featureEnabled) return hidden[capability.id] ? "hidden" : "enabled"
  if (requested[capability.id]) return "requested"
  if (!ownerEnabled) return "requires_owner_module"
  return "available_demo_or_request"
}

function inferLegacyGroups(features) {
  const groups = new Set()
  for (const key of Array.isArray(features) ? features : []) {
    if (LEGACY_MODULE_MAP[key]) groups.add(LEGACY_MODULE_MAP[key])
  }
  return [...groups].sort()
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node scripts/audit-tenant-capabilities.mjs --slug=<tenant-slug> [--json]")
    console.log("       node scripts/audit-tenant-capabilities.mjs --find=<slug-or-name> [--json]")
    return
  }

  const find = arg("find")
  const slug = arg("slug")
  const id = arg("id")
  const json = process.argv.includes("--json")
  if (find) {
    const tenants = await prisma.organization.findMany({
      where: {
        OR: [
          { slug: { contains: find, mode: "insensitive" } },
          { name: { contains: find, mode: "insensitive" } },
        ],
      },
      select: { id: true, slug: true, name: true, plan: true, isActive: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    })
    if (json) {
      console.log(JSON.stringify({ matches: tenants }, null, 2))
    } else {
      console.log(`Matches for "${find}":`)
      for (const tenant of tenants.length ? tenants : [{ slug: "none", name: "No tenants found", plan: "", isActive: false }]) {
        console.log(`- ${tenant.slug} ${tenant.name ? `(${tenant.name})` : ""} ${tenant.plan ? `plan=${tenant.plan}` : ""}`)
      }
    }
    return
  }

  if (!slug && !id) {
    throw new Error("Usage: node scripts/audit-tenant-capabilities.mjs --slug=<tenant-slug> [--json]")
  }

  const org = await prisma.organization.findFirst({
    where: id ? { id } : { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      addons: true,
      features: true,
      modules: true,
      settings: true,
      isActive: true,
    },
  })
  if (!org) throw new Error(`Tenant not found: ${id ?? slug}`)

  const appSlugs = KNOWN_CAPABILITIES.map((capability) => capability.appSlug).filter(Boolean)
  const apps = await prisma.app.findMany({
    where: { slug: { in: appSlugs } },
    select: { id: true, slug: true, name: true },
  })
  const appSlugById = new Map(apps.map((app) => [app.id, app.slug]))
  const installations = await prisma.appInstallation.findMany({
    where: { organizationId: org.id, appId: { in: apps.map((app) => app.id) }, uninstalledAt: null },
    select: { appId: true, status: true, installedVersion: true, updatedAt: true },
  })
  const installationsBySlug = Object.fromEntries(
    installations.map((installation) => [appSlugById.get(installation.appId), installation]).filter(([slug]) => Boolean(slug)),
  )

  const modules = moduleRecord(org)
  const marketplaceSettings = settingsRecord(org.settings)
  const hidden = truthyMap(marketplaceSettings.hidden)
  const requested = truthyMap(marketplaceSettings.requested)
  const legacyGroups = inferLegacyGroups(org.features)
  const warnings = []

  if (Object.keys(asRecord(org.modules)).length === 0 && Array.isArray(org.features) && org.features.length > 0) {
    warnings.push("modules_json_empty_but_features_present")
  }
  for (const group of legacyGroups) {
    if (modules[group] !== true) warnings.push(`legacy_feature_implies_${group}_but_module_missing`)
  }
  for (const capability of KNOWN_CAPABILITIES) {
    if (capability.appSlug && requested[capability.id] && installationsBySlug[capability.appSlug]?.status === "active") {
      warnings.push(`${capability.id}_requested_but_already_installed`)
    }
  }

  const capabilities = KNOWN_CAPABILITIES.map((capability) => ({
    id: capability.id,
    status: resolveCapability(capability, org, modules, installationsBySlug, hidden, requested),
    moduleId: capability.moduleId ?? null,
    ownerModule: capability.ownerModule ?? null,
    featureKey: capability.featureKey ?? null,
    appSlug: capability.appSlug ?? null,
  }))

  const report = {
    tenant: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      plan: org.plan,
      addons: org.addons,
      isActive: org.isActive,
    },
    raw: {
      features: org.features,
      modules: org.modules,
      marketplaceCapabilities: marketplaceSettings,
    },
    resolved: {
      modules,
      legacyGroups,
      appInstallations: installationsBySlug,
      capabilities,
    },
    warnings,
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Tenant: ${report.tenant.name} (${report.tenant.slug})`)
    console.log(`Plan: ${report.tenant.plan}; addons: ${report.tenant.addons.join(", ") || "none"}; active: ${report.tenant.isActive}`)
    console.log(`Modules: ${Object.entries(modules).filter(([, enabled]) => enabled === true).map(([key]) => key).sort().join(", ") || "none"}`)
    console.log(`Legacy inferred groups: ${legacyGroups.join(", ") || "none"}`)
    console.log("\nCapabilities:")
    for (const capability of capabilities) {
      console.log(`- ${capability.id}: ${capability.status}`)
    }
    console.log("\nWarnings:")
    for (const warning of warnings.length ? warnings : ["none"]) {
      console.log(`- ${warning}`)
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
