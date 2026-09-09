// Provision the "brandprotection" tenant (brandprotection.leaddrivecrm.org)
// and clone the ENTIRE social-monitoring configuration from an existing
// tenant so nothing has to be re-configured by hand.
//
// Usage:
//   CONFIRM_PROD=1 SEED_PASSWORD='<policy-compliant-secret>' \
//     node scripts/seeds/brandprotection.mjs --from=leaddrive \
//     --slug=brandprotection --name="Brand Protection" \
//     --email=admin@brandprotection.leaddrivecrm.org \
//     --brand-protection-only=1
//
// What gets cloned from the --from tenant:
//   - Organization social feature flags (ai_auto_social_reply[/shadow],
//     ai_auto_social_triage_shadow, social_brand_protection_only)
//   - ChannelConfig "Monitoring providers" (search-index/Apify settings;
//     the encrypted token is RE-ENCRYPTED for the new org's key purpose)
//   - ChannelConfig "Monitoring scenarios" (scenario ids preserved, so
//     scenarioLinks inside monitoring sources stay valid)
//   - AiAgentConfig agentType="social" (the reply agent persona)
//   - Meta app-config ChannelConfigs (facebook/instagram rows carrying the
//     full appId+appSecret+verifyToken triple — incl. the Instagram-Login
//     app row; plain fields, no re-encryption needed)
//   - SocialAccount rows incl. OAuth tokens (their encryption purpose is
//     bound to the platform page id, not the org — safe to copy)
//   - SocialReplyChannelSetting rows (senderAccountId remapped)
//   - MonitoringSource rows (settings.socialAccountId remapped; per-source
//     search-index / provider tokens re-encrypted for the new org/source)
//   - ReplyPolicy rows
//
// Deliberately NOT cloned:
//   - Mention/evidence/report history (settings only)
//   - The WhatsApp ChannelConfig (same WABA in two tenants would double-
//     process webhooks; reconnect WhatsApp in the new tenant if needed)
//   - Chatwoot ChannelConfigs (settings.webhookSecret resolves the org on
//     inbound webhooks — a shared secret would make routing ambiguous; the
//     new tenant needs its own Chatwoot inbox + secret for TikTok DMs)
//   - Users other than the new admin
//
// Idempotent: every insert is guarded by a findFirst on the natural key.
// Safe to re-run after partial failures; re-runs do NOT overwrite rows the
// new tenant already has.
//
// NOTE: requires NEXTAUTH_SECRET of the target deployment (same secret the
// app uses) — token re-encryption derives keys from it.

import crypto from "crypto"
import bcrypt from "bcryptjs"
import { makeScriptPrisma } from "../_rls.mjs"
import { passwordPolicyError } from "../password-policy.mjs"

let prisma

if (process.env.CONFIRM_PROD !== "1") {
  throw new Error("Set CONFIRM_PROD=1 to run this production seed")
}

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.split("=").slice(1).join("=") : null
}

// ── secure-token.ts mirror (scripts can't import TS from src/lib) ───────────
function getMasterSecret() {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (secret) return secret
  throw new Error("NEXTAUTH_SECRET is required to re-encrypt tokens")
}

function deriveKey(purpose) {
  const base = crypto.createHash("sha256").update(getMasterSecret()).digest()
  const info = Buffer.from(`leaddrive:${purpose}`, "utf8")
  return crypto.createHmac("sha256", base).update(info).digest().slice(0, 32)
}

function base64urlEncode(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlDecode(s) {
  const pad = s.length % 4
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad ? 4 - pad : 0)
  return Buffer.from(normalized, "base64")
}

function encryptToken(plaintext, purpose) {
  if (!plaintext) return ""
  const key = deriveKey(purpose)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return "v1:" + base64urlEncode(Buffer.concat([iv, ct, cipher.getAuthTag()]))
}

function decryptToken(stored, purpose) {
  if (!stored) return ""
  if (!stored.startsWith("v1:")) return stored // legacy plaintext
  const raw = base64urlDecode(stored.slice(3))
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(raw.length - 16)
  const ct = raw.subarray(12, raw.length - 16)
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(purpose), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}

/** Try purposes in order; return plaintext or null (never throws). */
function tryDecrypt(stored, purposes) {
  for (const purpose of purposes) {
    try {
      return decryptToken(stored, purpose)
    } catch {
      // next purpose
    }
  }
  return null
}

function reencrypt(stored, oldPurposes, newPurpose, label, warnings) {
  if (!stored) return stored
  const plaintext = tryDecrypt(stored, oldPurposes)
  if (plaintext === null) {
    warnings.push(`${label}: could not decrypt with known purposes — token NOT copied, reconnect it manually`)
    return null
  }
  return encryptToken(plaintext, newPurpose)
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

const SOCIAL_FEATURE_FLAGS = [
  "ai_auto_social_reply",
  "ai_auto_social_reply_shadow",
  "ai_auto_social_triage_shadow",
  "social_brand_protection_only",
]

// ── Tenant scaffolding defaults (mirrors provisionTenant() / src/lib/constants.ts) ──
// The Tenant Builder path seeds these; a self-provisioned tenant must get the
// same set or Task.type / Task.eventType validation, ticket SLAs and currency
// pickers run on fallbacks. Backfilled idempotently for EXISTING orgs too.
const DEFAULT_TASK_TYPES = [
  { name: "task", displayName: "Task", color: "#EA580C", sortOrder: 0 },
  { name: "bug", displayName: "Bug", color: "#DE350B", sortOrder: 1 },
  { name: "feature", displayName: "Feature", color: "#00B8D9", sortOrder: 2 },
  { name: "story", displayName: "Story", color: "#00875A", sortOrder: 3 },
  { name: "epic", displayName: "Epic", color: "#6554C0", sortOrder: 4 },
]

const DEFAULT_EVENT_TYPES = [
  { name: "914_line", displayName: "914 LINE", color: "#EAB308", sortOrder: 0 },
  { name: "mobil_operators_line", displayName: "MOBIL OPERATORS LINE", color: "#A855F7", sortOrder: 1 },
  { name: "social_media", displayName: "SOCIAL MEDIA", color: "#EC4899", sortOrder: 2 },
  { name: "vip_group_whatsapp", displayName: "VIP GROUP WHATSAPP", color: "#06B6D4", sortOrder: 3 },
]

const DEFAULT_SLA_POLICIES = [
  { name: "Critical", priority: "critical", firstResponseHours: 1, resolutionHours: 4 },
  { name: "High", priority: "high", firstResponseHours: 4, resolutionHours: 8 },
  { name: "Medium", priority: "medium", firstResponseHours: 8, resolutionHours: 24 },
  { name: "Low", priority: "low", firstResponseHours: 24, resolutionHours: 72 },
]

const INITIAL_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", exchangeRate: 1, isBase: true },
  { code: "EUR", name: "Euro", symbol: "€", exchangeRate: 0.92 },
  { code: "GBP", name: "British Pound", symbol: "£", exchangeRate: 0.79 },
]

/** Seed a scaffolding table only when the org has NO rows in it yet. */
async function backfillScaffolding(orgId) {
  const plans = [
    { label: "task types", model: prisma.taskType, rows: DEFAULT_TASK_TYPES },
    { label: "event types", model: prisma.eventType, rows: DEFAULT_EVENT_TYPES },
    { label: "SLA policies", model: prisma.slaPolicy, rows: DEFAULT_SLA_POLICIES },
    { label: "currencies", model: prisma.currency, rows: INITIAL_CURRENCIES },
  ]
  for (const plan of plans) {
    const existing = await plan.model.count({ where: { organizationId: orgId } })
    if (existing > 0) {
      console.log(`  ↷ ${plan.label} already present (${existing}) — skipped`)
      continue
    }
    for (const row of plan.rows) {
      await plan.model.create({ data: { organizationId: orgId, ...row } })
    }
    console.log(`  ✔ Default ${plan.label} seeded (${plan.rows.length})`)
  }
}

async function main() {
  const fromSlug = getArg("from")
  if (!fromSlug) {
    console.error("Missing --from=<sourceSlug> (the tenant whose social-monitoring settings will be cloned)")
    process.exit(1)
  }
  const slug = getArg("slug") || "brandprotection"
  const companyName = getArg("name") || "Brand Protection"
  const adminEmail = getArg("email") || `admin@${slug}.leaddrivecrm.org`
  const password = process.env.SEED_PASSWORD ?? getArg("password")
  if (!password) throw new Error("Set SEED_PASSWORD or pass --password=<policy-compliant-secret>")
  const passwordError = passwordPolicyError(password)
  if (passwordError) throw new Error(`Seed password rejected: ${passwordError}`)
  const brandProtectionOnlyArg = getArg("brand-protection-only") // "1" | "0" | null (inherit)

  prisma = await makeScriptPrisma()

  const source = await prisma.organization.findUnique({ where: { slug: fromSlug } })
  if (!source) {
    console.error(`Source tenant "${fromSlug}" not found`)
    process.exit(1)
  }

  const warnings = []

  // ── 1. Provision the tenant (mirrors provisionTenant() minimal path) ──────
  let org = await prisma.organization.findUnique({ where: { slug } })
  if (!org) {
    console.log(`Tenant "${slug}" not found — provisioning now...`)
    const passwordHash = await bcrypt.hash(password, 12)
    org = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: companyName,
          slug,
          plan: "enterprise",
          maxUsers: 25,
          maxContacts: 50000,
          features: [],
          addons: [],
          branding: JSON.stringify({ companyName, primaryColor: "#f59e0b" }),
          isActive: true,
          serverType: "shared",
          provisionedAt: new Date(),
          provisionedBy: "seed-script:brandprotection",
        },
      })
      await tx.user.create({
        data: {
          organizationId: organization.id,
          email: adminEmail,
          name: "Brand Protection Admin",
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
      for (const stage of stageSeeds) {
        await tx.pipelineStage.create({ data: { organizationId: organization.id, pipelineId: pipe.id, ...stage } })
      }
      return organization
    })
    console.log(`  ✔ Organization ${org.id} (${slug}.leaddrivecrm.org), admin ${adminEmail}`)
  } else {
    console.log(`Tenant "${slug}" already exists (${org.id}) — cloning missing settings only`)
    // Keep the admin password in sync with the supplied seed credential on re-runs when asked.
    // Without this the seed only set the password at creation, so the pass
    // file and the DB hash could drift apart. Gated on RESET_ADMIN_PASSWORD so
    // a normal settings re-clone never silently rewrites the password.
    if (process.env.RESET_ADMIN_PASSWORD === "1") {
      const passwordHash = await bcrypt.hash(password, 12)
      const res = await prisma.user.updateMany({
        where: { organizationId: org.id, email: adminEmail },
        data: { passwordHash, passwordChangedAt: new Date(), isActive: true },
      })
      console.log(`  ✔ Admin password reset for ${adminEmail} (rows: ${res.count})`)
      if (res.count === 0) {
        // The admin row is missing (e.g. email typo on first run) — create it.
        await prisma.user.create({
          data: {
            organizationId: org.id,
            email: adminEmail,
            name: "Brand Protection Admin",
            passwordHash,
            role: "admin",
            isActive: true,
          },
        })
        console.log(`  ✔ Admin user ${adminEmail} created (was missing)`)
      }
    }
  }

  // Full Tenant-Builder parity: task/event types, SLA policies, currencies.
  await backfillScaffolding(org.id)

  // ── 2. Feature flags ───────────────────────────────────────────────────────
  // features is a Json column that historically holds either a real array or
  // a JSON-stringified array (provisionTenant writes the latter) — accept both.
  const parseFeatures = (value) => {
    if (Array.isArray(value)) return value.filter((f) => typeof f === "string")
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string") : []
      } catch {
        return []
      }
    }
    return []
  }
  const sourceFeatures = parseFeatures(source.features)
  const targetFeatures = new Set(parseFeatures(org.features))
  for (const flag of SOCIAL_FEATURE_FLAGS) {
    if (sourceFeatures.includes(flag)) targetFeatures.add(flag)
  }
  if (brandProtectionOnlyArg === "1") targetFeatures.add("social_brand_protection_only")
  if (brandProtectionOnlyArg === "0") targetFeatures.delete("social_brand_protection_only")
  await prisma.organization.update({
    where: { id: org.id },
    data: { features: Array.from(targetFeatures) },
  })
  console.log(`  ✔ Features: [${Array.from(targetFeatures).join(", ")}]`)

  // ── 3. ChannelConfig: Monitoring providers (+ token re-encryption) ────────
  const providersName = "Monitoring providers"
  const sourceProviders = await prisma.channelConfig.findFirst({
    where: { organizationId: source.id, channelType: "social_monitoring", configName: providersName },
  })
  if (sourceProviders) {
    const existing = await prisma.channelConfig.findFirst({
      where: { organizationId: org.id, channelType: "social_monitoring", configName: providersName },
    })
    if (!existing) {
      const apiKey = sourceProviders.apiKey
        ? reencrypt(
            sourceProviders.apiKey,
            [`social-search-index:${source.id}`],
            `social-search-index:${org.id}`,
            "Monitoring providers apiKey",
            warnings,
          )
        : null
      await prisma.channelConfig.create({
        data: {
          organizationId: org.id,
          channelType: "social_monitoring",
          configName: providersName,
          apiKey,
          settings: sourceProviders.settings ?? {},
          isActive: true,
        },
      })
      console.log("  ✔ Monitoring providers settings cloned")
    } else {
      console.log("  ↷ Monitoring providers already present — skipped")
    }
  }

  // ── 4. ChannelConfig: Monitoring scenarios (ids preserved) ────────────────
  const scenariosName = "Monitoring scenarios"
  const sourceScenarios = await prisma.channelConfig.findFirst({
    where: { organizationId: source.id, channelType: "social_monitoring", configName: scenariosName },
  })
  if (sourceScenarios) {
    const existing = await prisma.channelConfig.findFirst({
      where: { organizationId: org.id, channelType: "social_monitoring", configName: scenariosName },
    })
    if (!existing) {
      await prisma.channelConfig.create({
        data: {
          organizationId: org.id,
          channelType: "social_monitoring",
          configName: scenariosName,
          settings: sourceScenarios.settings ?? {},
          isActive: true,
        },
      })
      console.log("  ✔ Monitoring scenarios cloned")
    } else {
      console.log("  ↷ Monitoring scenarios already present — skipped")
    }
  }

  // ── 5. Social AI agent persona ─────────────────────────────────────────────
  const sourceAgent = await prisma.aiAgentConfig.findFirst({
    where: { organizationId: source.id, agentType: "social" },
  })
  if (sourceAgent) {
    const existing = await prisma.aiAgentConfig.findFirst({
      where: { organizationId: org.id, agentType: "social" },
    })
    if (!existing) {
      const { id, organizationId, createdAt, updatedAt, ...agentData } = sourceAgent
      await prisma.aiAgentConfig.create({
        // handoffTargets holds agent-config IDs of the SOURCE org — stale in
        // the clone, so reset it; the social agent doesn't use handoffs.
        data: { ...agentData, organizationId: org.id, handoffTargets: [] },
      })
      console.log("  ✔ Social AI agent persona cloned")
    } else {
      console.log("  ↷ Social AI agent already present — skipped")
    }
  }

  // ── 5b. Meta app-config ChannelConfigs (Model B: tenant's own FB / IG-Login
  //        app credentials) ─────────────────────────────────────────────────
  // These rows power the tenant-side OAuth connect buttons: getTenantMetaApp /
  // getTenantInstagramLoginApp (src/lib/social/tenant-meta-app.ts) resolve the
  // most recent facebook/instagram ChannelConfig carrying the FULL app triple
  // (appId + appSecret + verifyToken). The triple is stored PLAIN (same as the
  // WhatsApp per-tenant pattern) → no re-encryption needed, and requiring the
  // triple excludes OAuth-created page rows (they carry pageId/token but no
  // verifyToken). Cloning gives the new tenant the SAME Meta apps the source
  // tenant registered — critically the Instagram-Login (settings.igLogin=true)
  // app, since the env fallback INSTAGRAM_APP_ID is not configured on prod.
  //
  // Deliberately NOT cloned here (matching the WhatsApp exclusion): chatwoot
  // configs — their settings.webhookSecret resolves the org on inbound
  // webhooks (findFirst), so two tenants sharing one secret would make routing
  // ambiguous. A second tenant needs its own Chatwoot inbox + secret.
  const sourceAppConfigs = await prisma.channelConfig.findMany({
    where: {
      organizationId: source.id,
      channelType: { in: ["facebook", "instagram"] },
      appId: { not: null },
      appSecret: { not: null },
      verifyToken: { not: null },
    },
  })
  for (const cfg of sourceAppConfigs) {
    const existing = await prisma.channelConfig.findFirst({
      where: { organizationId: org.id, channelType: cfg.channelType, configName: cfg.configName },
    })
    if (existing) {
      console.log(`  ↷ ChannelConfig ${cfg.channelType}/"${cfg.configName}" already present — skipped`)
      continue
    }
    await prisma.channelConfig.create({
      data: {
        organizationId: org.id,
        channelType: cfg.channelType,
        configName: cfg.configName,
        appId: cfg.appId,
        appSecret: cfg.appSecret,
        verifyToken: cfg.verifyToken,
        settings: cfg.settings ?? undefined,
        displayName: cfg.displayName,
        isActive: cfg.isActive,
        // NOT copied: pageId/accessToken/botToken/apiKey/phone* — page- or
        // channel-instance-bound values; the new tenant mints its own via OAuth.
        createdBy: null,
      },
    })
    console.log(`  ✔ ChannelConfig ${cfg.channelType}/"${cfg.configName}" (Meta app creds) cloned`)
  }
  if (sourceAppConfigs.length === 0) {
    console.log("  ↷ No Meta app-config ChannelConfigs (appId+appSecret+verifyToken) in source — nothing to clone")
  }

  // ── 6. SocialAccounts (OAuth token purpose is page-bound → copy as-is) ────
  const sourceAccounts = await prisma.socialAccount.findMany({ where: { organizationId: source.id } })
  const accountIdMap = new Map()
  for (const account of sourceAccounts) {
    let target = await prisma.socialAccount.findFirst({
      where: { organizationId: org.id, platform: account.platform, handle: account.handle },
    })
    if (!target) {
      const { id, organizationId, createdAt, updatedAt, lastPolledAt, ...accountData } = account
      target = await prisma.socialAccount.create({
        data: { ...accountData, organizationId: org.id, lastPolledAt: null },
      })
      console.log(`  ✔ SocialAccount ${account.platform}/${account.handle} cloned`)
    }
    accountIdMap.set(account.id, target.id)
  }

  // ── 7. Reply channel settings (senderAccountId remapped) ──────────────────
  const sourceReplyChannels = await prisma.socialReplyChannelSetting.findMany({ where: { organizationId: source.id } })
  for (const setting of sourceReplyChannels) {
    const existing = await prisma.socialReplyChannelSetting.findFirst({
      where: { organizationId: org.id, platform: setting.platform },
    })
    if (existing) continue
    const { id, organizationId, createdAt, updatedAt, senderAccountId, updatedBy, ...settingData } = setting
    await prisma.socialReplyChannelSetting.create({
      data: {
        ...settingData,
        organizationId: org.id,
        senderAccountId: senderAccountId ? accountIdMap.get(senderAccountId) ?? null : null,
        updatedBy: null,
      },
    })
    console.log(`  ✔ Reply channel setting ${setting.platform} cloned`)
  }

  // ── 8. Monitoring sources (token re-encryption + account remap) ───────────
  const sourceSources = await prisma.monitoringSource.findMany({ where: { organizationId: source.id } })
  let clonedSources = 0
  for (const src of sourceSources) {
    const dupWhere = src.url
      ? { organizationId: org.id, platform: src.platform, sourceType: src.sourceType, collectionMode: src.collectionMode, url: src.url }
      : src.query
        ? { organizationId: org.id, platform: src.platform, sourceType: src.sourceType, collectionMode: src.collectionMode, query: src.query }
        : { organizationId: org.id, platform: src.platform, sourceType: src.sourceType, collectionMode: src.collectionMode, handle: src.handle }
    const existing = await prisma.monitoringSource.findFirst({ where: dupWhere })
    if (existing) continue

    const settings = JSON.parse(JSON.stringify(asRecord(src.settings)))
    const label = `MonitoringSource ${src.platform}/${src.sourceType} ${src.url || src.query || src.handle || src.id}`

    // Remap the linked reply/collection identity to the cloned account.
    if (typeof settings.socialAccountId === "string" && settings.socialAccountId) {
      settings.socialAccountId = accountIdMap.get(settings.socialAccountId) ?? null
      if (!settings.socialAccountId) delete settings.socialAccountId
    }

    // Search-index token: purpose is org- (or source-)bound → re-encrypt.
    const searchIndex = asRecord(settings.searchIndex)
    if (typeof searchIndex.encryptedToken === "string" && searchIndex.encryptedToken) {
      const oldPurposes = [
        ...(typeof searchIndex.tokenPurpose === "string" && searchIndex.tokenPurpose ? [searchIndex.tokenPurpose] : []),
        `social-search-index:${source.id}`,
        `social-search-index:${src.id}`,
      ]
      const next = reencrypt(searchIndex.encryptedToken, oldPurposes, `social-search-index:${org.id}`, `${label} searchIndex token`, warnings)
      if (next) {
        searchIndex.encryptedToken = next
        searchIndex.tokenPurpose = `social-search-index:${org.id}`
      } else {
        delete searchIndex.encryptedToken
        delete searchIndex.tokenPurpose
      }
      settings.searchIndex = searchIndex
    }

    const { id, organizationId, createdAt, updatedAt, lastCheckedAt, lastSuccessfulAt, lastError, createdBy, ...srcData } = src
    const created = await prisma.monitoringSource.create({
      data: {
        ...srcData,
        organizationId: org.id,
        settings,
        lastCheckedAt: null,
        lastSuccessfulAt: null,
        lastError: null,
        // createdBy is a user id of the SOURCE org — meaningless here.
        createdBy: null,
      },
    })
    clonedSources++

    // Provider token purpose embeds the SOURCE id → needs the new id, so
    // re-encrypt after create and update the row.
    const provider = asRecord(settings.provider)
    if (typeof provider.encryptedToken === "string" && provider.encryptedToken) {
      const next = reencrypt(
        provider.encryptedToken,
        [`social-provider:${src.id}`, "social-provider"],
        `social-provider:${created.id}`,
        `${label} provider token`,
        warnings,
      )
      if (next) provider.encryptedToken = next
      else delete provider.encryptedToken
      settings.provider = provider
      await prisma.monitoringSource.update({ where: { id: created.id }, data: { settings } })
    }
  }
  console.log(`  ✔ Monitoring sources cloned: ${clonedSources} (of ${sourceSources.length} in source)`)

  // ── 9. Reply policies ──────────────────────────────────────────────────────
  const sourcePolicies = await prisma.replyPolicy.findMany({ where: { organizationId: source.id } })
  let clonedPolicies = 0
  for (const policy of sourcePolicies) {
    const existing = await prisma.replyPolicy.findFirst({
      where: {
        organizationId: org.id,
        platform: policy.platform,
        collectionMode: policy.collectionMode,
        sourceType: policy.sourceType,
      },
    })
    if (existing) continue
    const { id, organizationId, createdAt, updatedAt, updatedBy, ...policyData } = policy
    await prisma.replyPolicy.create({ data: { ...policyData, organizationId: org.id, updatedBy: null } })
    clonedPolicies++
  }
  console.log(`  ✔ Reply policies cloned: ${clonedPolicies} (of ${sourcePolicies.length} in source)`)

  console.log("\nDone.")
  if (warnings.length > 0) {
    console.log("\n⚠ Warnings:")
    for (const warning of warnings) console.log(`  - ${warning}`)
  }
  console.log(`
Next steps (see docs/brandprotection-tenant.md):
  1. DNS: A-record ${slug}.leaddrivecrm.org → shared server
  2. nginx: clients/nginx/template.conf → sites-available/${slug}.leaddrivecrm.org + certbot
  3. Login at https://${slug}.leaddrivecrm.org (${adminEmail}) and verify
     Social Monitoring → Sources / Scenarios / Settings are populated.
  4. WhatsApp channel (mention → group delivery) was NOT cloned by design —
     connect it in the new tenant if that flow is needed.`)
}

try {
  await main()
} finally {
  await prisma?.$disconnect()
}
