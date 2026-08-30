import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getPlanDefaults } from "@/lib/plan-templates"
import { DEFAULT_PIPELINE_STAGES, DEFAULT_TASK_TYPES, DEFAULT_EVENT_TYPES, INITIAL_CURRENCIES } from "@/lib/constants"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { deleteDnsRecord, isCloudflareConfigured } from "@/lib/cloudflare-dns"
import { ADDON_MODULES, withRequiredModules } from "@/lib/modules"
import { WORKFORCE_DEFAULT_PROFILE_VERSION } from "@/lib/workforce/default-profile"
import type { Prisma, TenantProvisioningStep } from "@prisma/client"
import {
  createTenantProvisioningRun,
  runTenantProvisioningV2,
  type TenantBrandProfileInput,
  type TenantProviderInput,
} from "@/lib/tenant-provisioning-v2"
import { generateStrongTemporaryPassword } from "@/lib/password-policy"

const RESERVED_SLUGS = new Set([
  "app", "admin", "api", "www", "mail", "ftp", "static", "cdn", "assets",
  "status", "portal", "login", "register", "dashboard", "billing", "support",
])

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

/**
 * Whether the effective module set (features ∪ addon→module expansion) includes MTM.
 * Keyed off effective modules, NOT the plan name, so custom plans with an `mtm` addon
 * (or `mtm` feature) correctly trigger MTM-agent seeding.
 */
export function effectiveModulesEnableMtm(features: string[], addons: string[]): boolean {
  const mods = new Set<string>(features)
  for (const a of addons) for (const m of ADDON_MODULES[a] ?? []) mods.add(m)
  return mods.has("mtm")
}

export interface TenantInput {
  companyName: string
  slug: string
  plan: string
  adminName: string
  adminEmail: string
  branding?: { primaryColor?: string; logo?: string }
  features?: string[]
  provisionedBy: string // superadmin userId
  // Phase 2 — optional custom scaffolding; absent → DEFAULT_* constants
  pipelineStages?: Array<{ name: string; displayName: string; color: string; probability: number; sortOrder: number; isWon?: boolean; isLost?: boolean }>
  taskTypes?: Array<{ name: string; displayName: string; color: string; sortOrder: number }>
  eventTypes?: Array<{ name: string; displayName: string; color: string; sortOrder: number }>
  currencies?: Array<{ code: string; name: string; symbol: string; exchangeRate: number; isBase?: boolean }>
  /** Stable key for the additive post-create bootstrap. */
  idempotencyKey?: string
  /** Tenant-owned identity used for subject-bound AI and monitoring. */
  primaryBrand?: TenantBrandProfileInput
  /** Platforms to initialize in needs_access state. Undefined means all supported platforms. */
  channels?: string[]
  /** Commercial entitlement only. Provisioning never dispatches a paid provider run. */
  providers?: TenantProviderInput[]
}

/**
 * Resolve the scaffolding to seed at provisioning: caller-provided arrays if present,
 * else the DEFAULT_* constants. Pure — testable without a DB.
 */
export function resolveScaffolding(
  input: Pick<TenantInput, "pipelineStages" | "taskTypes" | "eventTypes" | "currencies">,
) {
  return {
    stages: input.pipelineStages ?? DEFAULT_PIPELINE_STAGES,
    taskTypes: input.taskTypes ?? DEFAULT_TASK_TYPES,
    eventTypes: input.eventTypes ?? DEFAULT_EVENT_TYPES,
    currencies: input.currencies ?? INITIAL_CURRENCIES,
  }
}

export function resolveTenantFeatures(input: {
  requestedFeatures: string[]
  channels?: string[]
}): string[] {
  const features = new Set(input.requestedFeatures)

  // An omitted channel list is the legacy API contract for "all supported
  // channels". An explicit empty list comes from the admin wizard and means
  // that Omni-Channel was intentionally removed.
  if (input.channels === undefined || input.channels.length > 0) {
    features.add("omnichannel")
  }
  if (input.channels === undefined) {
    features.add("social")
  }

  // Support depends on the shared customer base (companies and contacts).
  // Normalising here keeps a manually crafted provisioning request from
  // creating a misleading Support-only tenant.
  return withRequiredModules(Array.from(features))
}

export interface ProvisionResult {
  organization: { id: string; name: string; slug: string; plan: string }
  user: { id: string; email: string; name: string }
  tempPassword: string
  url: string
  provisioning: {
    id: string
    status: string
    summary: unknown
    steps: Array<{
      stepKey: string
      status: string
      attempts: number
      output: unknown
      error: string | null
    }>
  }
}

export async function validateSlug(slug: string): Promise<{ valid: boolean; error?: string }> {
  if (!slug) return { valid: false, error: "Slug is required" }
  if (!SLUG_REGEX.test(slug)) {
    return { valid: false, error: "Slug must be 3-30 chars, lowercase alphanumeric and hyphens only, cannot start/end with hyphen" }
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { valid: false, error: `Slug "${slug}" is reserved` }
  }
  const existing = await prisma.organization.findUnique({ where: { slug } })
  if (existing) {
    return { valid: false, error: `Slug "${slug}" is already taken` }
  }
  return { valid: true }
}

export function generateTempPassword(): string {
  return generateStrongTemporaryPassword(crypto.randomBytes)
}

async function resumeIncompleteTenant(input: TenantInput, organization: {
  id: string
  name: string
  slug: string
  plan: string
  provisionedBy: string | null
}): Promise<ProvisionResult> {
  const idempotencyKey = input.idempotencyKey
  const [admin, existingRun] = await Promise.all([
    prisma.user.findFirst({
      where: { organizationId: organization.id, email: input.adminEmail, role: "admin" },
    }),
    prisma.tenantProvisioningRun.findFirst({
      where: { organizationId: organization.id },
      select: { id: true },
    }),
  ])

  // Core identity is written before the additive provisioning run. Recover
  // only the exact unfinished wizard request: this avoids turning a normal
  // duplicate-slug request into a mutation of an unrelated tenant.
  if (
    !idempotencyKey ||
    organization.provisionedBy !== input.provisionedBy ||
    organization.name !== input.companyName ||
    organization.plan !== input.plan ||
    !admin ||
    admin.passwordChangedAt !== null ||
    existingRun
  ) {
    throw new Error(`Slug "${input.slug}" is already taken`)
  }

  const planDefaults = await getPlanDefaults(input.plan)
  const effectiveFeatures = resolveTenantFeatures({
    requestedFeatures: input.features || planDefaults.features,
    channels: input.channels,
  })
  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  const [updatedOrganization, updatedAdmin] = await Promise.all([
    prisma.organization.update({
      where: { id: organization.id },
      data: {
        maxUsers: planDefaults.maxUsers,
        maxContacts: planDefaults.maxContacts,
        features: effectiveFeatures,
        addons: planDefaults.addons,
        logo: input.branding?.logo || null,
        branding: JSON.stringify(input.branding || {}),
        isActive: true,
      },
    }),
    prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash, passwordChangedAt: new Date() },
    }),
  ])

  const provisioningRun = await createTenantProvisioningRun({
    organizationId: updatedOrganization.id,
    idempotencyKey,
    provisioning: {
      companyName: input.companyName,
      features: effectiveFeatures,
      addons: planDefaults.addons,
      primaryBrand: input.primaryBrand,
      channels: input.channels,
      providers: input.providers,
      createdBy: input.provisionedBy,
      workforceDefaultProfileVersion: effectiveFeatures.includes("workforce-hrm")
        ? WORKFORCE_DEFAULT_PROFILE_VERSION
        : undefined,
    },
  })
  const provisioning = await runTenantProvisioningV2({
    organizationId: updatedOrganization.id,
    runId: provisioningRun.id,
  })
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"
  const url = `https://${updatedOrganization.slug}.${baseDomain}`
  updateRegistry(updatedOrganization.slug, updatedOrganization.name, updatedOrganization.plan, baseDomain)

  return {
    organization: {
      id: updatedOrganization.id,
      name: updatedOrganization.name,
      slug: updatedOrganization.slug,
      plan: updatedOrganization.plan,
    },
    user: {
      id: updatedAdmin.id,
      email: updatedAdmin.email,
      name: updatedAdmin.name,
    },
    tempPassword,
    url,
    provisioning: {
      id: provisioning.id,
      status: provisioning.status,
      summary: provisioning.summary,
      steps: (provisioning.steps as TenantProvisioningStep[]).map((step) => ({
        stepKey: step.stepKey,
        status: step.status,
        attempts: step.attempts,
        output: step.output,
        error: step.error,
      })),
    },
  }
}

export async function provisionTenant(input: TenantInput): Promise<ProvisionResult> {
  const existingOrganization = await prisma.organization.findUnique({ where: { slug: input.slug } })
  if (existingOrganization) {
    return resumeIncompleteTenant(input, existingOrganization)
  }

  // Validate slug
  const slugCheck = await validateSlug(input.slug)
  if (!slugCheck.valid) {
    throw new Error(slugCheck.error)
  }

  // Check email uniqueness
  const existingUser = await prisma.user.findFirst({ where: { email: input.adminEmail } })
  if (existingUser) {
    throw new Error(`Email "${input.adminEmail}" is already registered`)
  }

  // Get plan defaults
  const planDefaults = await getPlanDefaults(input.plan)
  const effectiveFeatures = resolveTenantFeatures({
    requestedFeatures: input.features || planDefaults.features,
    channels: input.channels,
  })
  const tempPassword = generateTempPassword()
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  // Create everything in a transaction (Prisma P2002 = unique constraint = slug or email taken)
  let result
  try {
  result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Create Organization
    const organization = await tx.organization.create({
      data: {
        name: input.companyName,
        slug: input.slug,
        plan: input.plan,
        maxUsers: planDefaults.maxUsers,
        maxContacts: planDefaults.maxContacts,
        features: effectiveFeatures,
        // addons come from the plan tier (NOT the features array — that was a
        // copy-paste bug that polluted the addons column with feature strings).
        addons: planDefaults.addons,
        logo: input.branding?.logo || null,
        branding: JSON.stringify(input.branding || {}),
        isActive: true,
        serverType: "shared",
        provisionedAt: new Date(),
        provisionedBy: input.provisionedBy,
      },
    })

    // 2. Create admin User
    const user = await tx.user.create({
      data: {
        organizationId: organization.id,
        email: input.adminEmail,
        name: input.adminName,
        passwordHash,
        role: "admin",
      },
    })

    // 3. Create pipeline + stages (custom from wizard if provided, else DEFAULT_*)
    const scaffolding = resolveScaffolding(input)
    const defaultPipeline = await tx.pipeline.create({
      data: { organizationId: organization.id, name: "Sales Pipeline", isDefault: true, sortOrder: 0 },
    })
    for (const s of scaffolding.stages) {
      await tx.pipelineStage.create({ data: { organizationId: organization.id, pipelineId: defaultPipeline.id, ...s } })
    }

    // 3b. Create default task types (Bordio-style configurable "Task types").
    // Task.type is validated against these; new orgs start with the legacy 5.
    for (const tt of scaffolding.taskTypes) {
      await tx.taskType.create({ data: { organizationId: organization.id, ...tt } })
    }

    // 3c. Create default event types (channel/source axis: 914 LINE, SOCIAL MEDIA…).
    // Task.eventType is validated against these.
    for (const et of scaffolding.eventTypes) {
      await tx.eventType.create({ data: { organizationId: organization.id, ...et } })
    }

    // 4. Create default SLA policies
    const slas = [
      { name: "Critical", priority: "critical", firstResponseHours: 1, resolutionHours: 4 },
      { name: "High", priority: "high", firstResponseHours: 4, resolutionHours: 8 },
      { name: "Medium", priority: "medium", firstResponseHours: 8, resolutionHours: 24 },
      { name: "Low", priority: "low", firstResponseHours: 24, resolutionHours: 72 },
    ]
    for (const s of slas) {
      await tx.slaPolicy.create({ data: { organizationId: organization.id, ...s } })
    }

    // 5. Create default currencies
    for (const c of scaffolding.currencies) {
      await tx.currency.create({ data: { organizationId: organization.id, ...c } })
    }

    // 6. Create MTM agent if the effective module set includes MTM (features ∪ addon→module).
    // Keyed off effective modules, NOT the plan name, so custom plans with an mtm addon work.
    if (effectiveModulesEnableMtm(effectiveFeatures, planDefaults.addons)) {
      await tx.mtmAgent.create({
        data: {
          organizationId: organization.id,
          name: input.adminName,
          email: input.adminEmail,
          role: "MANAGER",
          userId: user.id,
          passwordHash, // same password as admin user
        },
      })
    }

    return { organization, user }
  })
  } catch (err: unknown) {
    const prismaError = err as { code?: string; meta?: { target?: string[] } }
    if (prismaError.code === "P2002") {
      const field = prismaError.meta?.target?.[0] || "slug"
      throw new Error(`A tenant with this ${field} already exists`)
    }
    throw err
  }

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"
  const url = `https://${input.slug}.${baseDomain}`

  // Core identity and login are now durable. Every following initializer is
  // additive and independently retryable; it does not send messages or start
  // paid provider jobs.
  const provisioningRun = await createTenantProvisioningRun({
    organizationId: result.organization.id,
    idempotencyKey: input.idempotencyKey || crypto.randomUUID(),
    provisioning: {
      companyName: input.companyName,
      features: effectiveFeatures,
      addons: planDefaults.addons,
      primaryBrand: input.primaryBrand,
      channels: input.channels,
      providers: input.providers,
      createdBy: input.provisionedBy,
      // Only a newly provisioned tenant with the explicit independent HRM
      // entitlement receives the system baseline. A legacy `mtm` grant stays
      // compatibility-only and must not be silently configured.
      workforceDefaultProfileVersion: effectiveFeatures.includes("workforce-hrm")
        ? WORKFORCE_DEFAULT_PROFILE_VERSION
        : undefined,
    },
  })
  const provisioning = await runTenantProvisioningV2({
    organizationId: result.organization.id,
    runId: provisioningRun.id,
  })

  // Update registry.json (best-effort)
  updateRegistry(input.slug, result.organization.name, input.plan, baseDomain)

  return {
    organization: {
      id: result.organization.id,
      name: result.organization.name,
      slug: result.organization.slug,
      plan: result.organization.plan,
    },
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
    },
    tempPassword,
    url,
    provisioning: {
      id: provisioning.id,
      status: provisioning.status,
      summary: provisioning.summary,
      steps: (provisioning.steps as TenantProvisioningStep[]).map((step) => ({
        stepKey: step.stepKey,
        status: step.status,
        attempts: step.attempts,
        output: step.output,
        error: step.error,
      })),
    },
  }
}

export async function deactivateTenant(orgId: string): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { isActive: false },
  })
}

export async function activateTenant(orgId: string): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: { isActive: true, deletionScheduledAt: null },
  })
}

const DELETION_GRACE_DAYS = 30

/**
 * Schedule tenant for deletion after grace period.
 * Sets isActive = false immediately (users can't log in).
 */
export async function scheduleTenantDeletion(orgId: string): Promise<Date> {
  const deletionDate = new Date()
  deletionDate.setDate(deletionDate.getDate() + DELETION_GRACE_DAYS)

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      isActive: false,
      deletionScheduledAt: deletionDate,
    },
  })

  return deletionDate
}

/**
 * Cancel a scheduled deletion and reactivate the tenant.
 */
export async function cancelTenantDeletion(orgId: string): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      isActive: true,
      deletionScheduledAt: null,
    },
  })
}

export class WorkforceRetentionBlockedError extends Error {
  readonly code = "WORKFORCE_RETENTION_BLOCKED"

  constructor() {
    super("Tenant has Workforce history or configuration that must be retained before permanent deletion")
    this.name = "WorkforceRetentionBlockedError"
  }
}

type WorkforceRetentionClient = Pick<Prisma.TransactionClient,
  | "mtmAgentWorkday"
  | "mtmAgentWorkdayEvent"
  | "mtmAgentLocation"
  | "mtmHrmRequest"
  | "mtmWorkCalendarDay"
  | "mtmAuditLog"
  | "workforcePolicy"
  | "workforceShiftTemplate"
  | "workforceShiftAssignment"
  | "workforceShiftDefaultAssignment"
  | "workforcePolicySnapshot"
  | "workforceShiftSnapshot"
  | "workforceWorkdayScheduleSnapshot"
  | "workforceAttendanceException"
  | "workforceTimeCorrection"
  | "workforceTimesheetApproval"
>

/**
 * A permanent tenant removal must not silently use FK cascades to bypass the
 * Workforce time/decision retention contract. This is a preflight only: it
 * never mutates tenant or Workforce data.
 */
export async function assertTenantWorkforceRetentionClear(
  orgId: string,
  client: WorkforceRetentionClient = prisma,
): Promise<void> {
  const counts = await Promise.all([
    client.mtmAgentWorkday.count({ where: { organizationId: orgId } }),
    client.mtmAgentWorkdayEvent.count({ where: { organizationId: orgId } }),
    client.mtmAgentLocation.count({ where: { organizationId: orgId } }),
    client.mtmHrmRequest.count({ where: { organizationId: orgId } }),
    client.mtmWorkCalendarDay.count({
      where: { organizationId: orgId, source: { in: ["HRM", "WORKFORCE_LEAVE", "WORKFORCE_ABSENCE"] } },
    }),
    client.mtmAuditLog.count({
      where: {
        organizationId: orgId,
        OR: [
          { metadataKind: { in: ["workday_transition", "hrm_request_decision", "workforce_time_correction"] } },
          { action: { in: [
            "WORKDAY_START",
            "WORKDAY_PAUSE",
            "WORKDAY_RESUME",
            "WORKDAY_FINISH",
            "HRM_REQUEST_DECISION",
            "WORKFORCE_TIME_CORRECTION_APPLIED",
          ] } },
        ],
      },
    }),
    client.workforcePolicy.count({ where: { organizationId: orgId } }),
    client.workforceShiftTemplate.count({ where: { organizationId: orgId } }),
    client.workforceShiftAssignment.count({ where: { organizationId: orgId } }),
    client.workforceShiftDefaultAssignment.count({ where: { organizationId: orgId } }),
    client.workforcePolicySnapshot.count({ where: { organizationId: orgId } }),
    client.workforceShiftSnapshot.count({ where: { organizationId: orgId } }),
    client.workforceWorkdayScheduleSnapshot.count({ where: { organizationId: orgId } }),
    client.workforceAttendanceException.count({ where: { organizationId: orgId } }),
    client.workforceTimeCorrection.count({ where: { organizationId: orgId } }),
    client.workforceTimesheetApproval.count({ where: { organizationId: orgId } }),
  ])
  if (counts.some((count) => count > 0)) throw new WorkforceRetentionBlockedError()
}

function isWorkforceRetentionTriggerError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /Workforce .*cannot be (?:deleted|DELETE)|published definition cannot be deleted/i.test(error.message)
}

/**
 * Permanently delete a tenant only after retention preflight clears. PostgreSQL
 * cascades still execute the deletion, but cannot become an undocumented
 * Workforce-history purge path.
 */

/** Upload subdirectories a tenant's own files can live in. Deliberately a fixed
 *  list rather than "everything under uploads": avatars and shared assets are
 *  not tenant content, and a purge must never be able to walk outside these. */
const TENANT_UPLOAD_DIRS = ["contracts", "contract-images", "tasks", "mtm-photos", "inbox"] as const

/**
 * File names owned by one tenant, gathered under the Organization row lock and
 * before the cascade removes the rows that name them. Enumeration fails closed:
 * deleting the DB identity without a complete byte manifest would make a retry
 * unable to discover the orphaned files.
 */
async function collectTenantFileNames(
  orgId: string,
  client: Pick<Prisma.TransactionClient, "contractFile" | "taskAttachment" | "mtmDocument">,
): Promise<string[]> {
  const [contractFiles, taskAttachments, mtmDocuments] = await Promise.all([
    client.contractFile.findMany({ where: { organizationId: orgId }, select: { fileName: true } }),
    client.taskAttachment.findMany({ where: { organizationId: orgId }, select: { fileName: true } }),
    client.mtmDocument.findMany({ where: { organizationId: orgId }, select: { fileName: true } }),
  ])
  return [...new Set(
    [...contractFiles, ...taskAttachments, ...mtmDocuments]
      .map((row) => row.fileName)
      .filter((name): name is string => Boolean(name)),
  )]
}

/**
 * Remove those files from disk.
 *
 * basename() is not decoration: a stored name is tenant-influenced input, and
 * without it a crafted "../../" name would make the purge delete outside the
 * uploads tree. A missing file is not an error — it may have been cleaned up
 * already, and the purge must finish either way.
 */
async function deleteTenantFiles(fileNames: string[]): Promise<void> {
  if (fileNames.length === 0) return
  const { unlink } = await import("node:fs/promises")
  const path = await import("node:path")
  const { runtimePublicUploadsRoot } = await import("@/lib/runtime-paths")
  const root = runtimePublicUploadsRoot()
  let removed = 0
  for (const raw of fileNames) {
    const safe = path.basename(raw)
    if (!safe || safe === "." || safe === "..") continue
    for (const dir of TENANT_UPLOAD_DIRS) {
      try {
        await unlink(path.join(root, dir, safe))
        removed++
      } catch {
        // absent here, or already gone — try the next directory
      }
    }
  }
  console.log(`[TENANT] Removed ${removed} file(s) of ${fileNames.length} recorded name(s)`)
}

export async function hardDeleteTenant(orgId: string): Promise<void> {
  let org: { id: string; slug: string; name: string }
  let fileNames: string[] = []

  try {
    const deletion = await prisma.$transaction(
      async (tx) => {
        // FK inserts take a KEY SHARE lock on their parent Organization. Hold an
        // UPDATE lock from the final retention count through the cascade so a
        // new request/location cannot appear in the gap and be silently lost.
        await tx.$executeRaw`SELECT 1 FROM "organizations" WHERE "id" = ${orgId} FOR UPDATE`
        const existing = await tx.organization.findUnique({
          where: { id: orgId },
          select: { id: true, slug: true, name: true },
        })
        if (!existing) throw new Error("Organization not found")

        await assertTenantWorkforceRetentionClear(orgId, tx)
        // The parent lock prevents new child FKs while this complete manifest
        // is collected; the names stay available for byte deletion after commit.
        const lockedFileNames = await collectTenantFileNames(orgId, tx)
        // Both immutable audit history and canonical event history require a
        // visible, transaction-local declaration that this is the nested FK
        // cascade of a deliberate tenant deletion. Their triggers still verify
        // trigger depth and that the parent Organization is being removed.
        await tx.$executeRawUnsafe(`SET LOCAL app.audit_log_purge = 'on'`)
        await tx.$executeRawUnsafe(`SET LOCAL app.event_history_purge = 'on'`)
        await tx.organization.delete({ where: { id: orgId } })
        return { existing, lockedFileNames }
      },
      { timeout: 120_000, maxWait: 10_000 },
    )
    fileNames = deletion.lockedFileNames
    org = deletion.existing
  } catch (error) {
    if (isWorkforceRetentionTriggerError(error)) throw new WorkforceRetentionBlockedError()
    throw error
  }

  // DNS cleanup is intentionally after the database delete so a retention
  // block never leaves an otherwise-live tenant without its hostname.
  if (isCloudflareConfigured()) {
    try {
      await deleteDnsRecord(org.slug)
    } catch (err) {
      console.error(`[TENANT] DNS delete failed for ${org.slug}:`, err)
    }
  }

  // Files on disk. The database cascade cannot reach these: contract documents,
  // task attachments and MTM photos live on the filesystem and the rows only
  // hold a name. Without this a deleted tenant's contracts stay readable on the
  // server, so "all data deleted" would be untrue however many foreign keys the
  // schema gains (ISMS-12 §4).
  //
  // Collected BEFORE the cascade, deleted AFTER it: once the rows are gone
  // there is nothing left to tell us which files were theirs, and deleting
  // first would strand the rows if the transaction rolled back.
  await deleteTenantFiles(fileNames)

  // Remove from registry
  removeFromRegistry(org.slug)

  console.log(`[TENANT] Hard deleted org "${org.name}" (${org.slug}), id: ${orgId}`)
}

/**
 * Tables a content purge must SURVIVE. The `organizations` row itself is
 * preserved implicitly (no `organizationId` column → never in the purge set;
 * its config columns features/branding/settings/addons/plan are untouched).
 *
 * Three buckets, all chosen on the "loss is IRREVERSIBLE / EXTERNAL /
 * COMPLIANCE" principle — wiping these would cause real harm even though they
 * are org-scoped, so they are NOT "demo content":
 *   • auth/login — break the tenant if removed (no admin, dead sessions).
 *   • integrations & secrets — silently break live external wiring (messaging
 *     channel tokens, API keys, webhooks, accounting/e-sign connectors,
 *     custom domains).
 *   • billing, finance & compliance — financial state (subscriptions,
 *     funds/ledger/projections) and immutable audit/event history.
 *
 * Re-creatable tenant CONFIG (pipelines, custom fields, templates, macros,
 * SLA, workflows, singleton AI/grade configs, mtm settings, preferences) is
 * intentionally NOT here — it is wiped and the Quick Start seeder recreates it
 * on re-run. The dialog text says so explicitly so the operator isn't misled.
 */
const CONTENT_PURGE_PRESERVE = new Set<string>([
  // auth / login
  "organizations", "users", "accounts", "sessions", "verification_tokens", "_prisma_migrations",
  // integrations & secrets (external breakage). NB: `accounting_imports` is
  // deliberately NOT here — it is import job-history (not a secret) AND its
  // planId→budget_plans FK is onDelete:Cascade, so preserving it would be
  // incoherent (cascade-killed when budget_plans is wiped anyway).
  "channel_configs", "api_keys", "webhooks", "accounting_integrations",
  "esign_provider_configs", "custom_domains",
  // billing & compliance
  "subscriptions", "subscription_plans", "subscription_events", "plan_requests", "audit_logs",
  // Finance ledger and its active event-derived projection. A demo-content
  // reset must never erase money history or make the event stream disagree
  // with the compatibility projection.
  "funds", "fund_rules", "fund_transactions", "fund_balance_projections",
  // Canonical event platform. These rows are the recovery source of truth,
  // idempotency evidence and external-effect evidence; only hardDeleteTenant's
  // explicit whole-tenant cascade may remove them.
  "event_command_receipts", "event_aggregate_heads", "domain_events", "event_outbox",
  "consumer_inbox", "projection_builds", "projection_checkpoints", "effect_outbox",
  "effect_attempts", "effect_reconciliations",
])

/**
 * Clear all BUSINESS CONTENT for a tenant (the "Quick Start" demo-data reset)
 * while keeping the tenant usable: the org row (with its config), its users
 * (login), and NextAuth auth tables are preserved.
 *
 * Mechanism: every content table carries an `organizationId` column, so we
 * `DELETE ... WHERE "organizationId" = $1` from each one. Child tables WITHOUT
 * an `organizationId` (e.g. invoice_items, quote_line_items) are removed
 * automatically by the same `onDelete: Cascade` FKs that `hardDeleteTenant`
 * relies on, when their org-scoped parent row is deleted.
 *
 * Ordering is solved by a fix-point loop instead of a hand-maintained
 * dependency list: each pass deletes from every still-non-empty table,
 * swallowing FK-restrict failures; a table that fails because a child still
 * references it is retried on the next pass once that child is gone. The loop
 * stops when nothing is left or a pass makes no progress (→ surfaced as an
 * error rather than a silent partial wipe). This auto-adapts to schema changes
 * — no per-model list to keep in sync.
 *
 * NOTE: this clears ALL content for the org, not just rows the seeder created
 * (demo and real records are indistinguishable once mixed). Intended for demo
 * tenants. Caller is superadmin-gated + slug-confirmed.
 */
async function clearTenantContentInner(
  orgId: string,
): Promise<{ tablesCleared: number; rowsDeleted: number; details: Record<string, number> }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!org) throw new Error("Organization not found")

  const cols = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT DISTINCT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organizationId'
  `
  let remaining = cols
    .map((r: { table_name: string }) => r.table_name)
    .filter((t: string) => /^[a-z_][a-z0-9_]*$/.test(t) && !CONTENT_PURGE_PRESERVE.has(t))

  const details: Record<string, number> = {}
  let progress = true
  while (remaining.length > 0 && progress) {
    progress = false
    const stillFailing: string[] = []
    for (const t of remaining) {
      try {
        // Table name comes from the DB catalog + passes the slug regex above,
        // so it is safe to interpolate; orgId is parameterised.
        const n = await prisma.$executeRawUnsafe(
          `DELETE FROM "${t}" WHERE "organizationId" = $1`,
          orgId,
        )
        details[t] = Number(n)
        progress = true
      } catch {
        stillFailing.push(t)
      }
    }
    remaining = stillFailing
  }

  if (remaining.length > 0) {
    throw new Error(
      `clearTenantContent: could not clear ${remaining.length} table(s) after fix-point (possible FK cycle): ${remaining.join(", ")}`,
    )
  }

  const rowsDeleted = Object.values(details).reduce((s, n) => s + n, 0)
  const tablesCleared = Object.keys(details).filter((t) => details[t] > 0).length
  console.log(
    `[TENANT] Cleared content for "${org.name}" (${org.slug}): ${rowsDeleted} rows across ${tablesCleared} tables`,
  )
  return { tablesCleared, rowsDeleted, details }
}

/**
 * Admin cross-tenant content purge ([P1] closure). Runs UNDER runWithRlsBypass so the per-op Prisma
 * extension (prisma.ts) batches `set_config('app.rls_bypass','on',true)` with EACH raw DELETE — required
 * once RLS is enabled on content tables, else the raw DELETEs row-filter to 0 rows → a SILENT no-op
 * clear (the fix-point loop would "converge" having deleted nothing). The bypass is per-OPERATION (each
 * DELETE is its own batch tx via the extension), so the inner FK-retry fix-point loop is preserved — a
 * failed DELETE aborts only its own batch tx, not a single big transaction. Harmless while RLS is on 0
 * tables; correct the moment it rolls out (this is the "add bypass BEFORE enabling RLS" prerequisite).
 */
export function clearTenantContent(
  orgId: string,
): Promise<{ tablesCleared: number; rowsDeleted: number; details: Record<string, number> }> {
  return runWithRlsBypass(() => clearTenantContentInner(orgId))
}

/**
 * Find and delete all tenants past their scheduled deletion date.
 * Called by cron job.
 */
export async function purgeScheduledTenants(
  organizationIds?: readonly string[],
): Promise<{ purged: string[]; errors: string[] }> {
  const overdue = await prisma.organization.findMany({
    where: {
      deletionScheduledAt: { lte: new Date() },
      ...(organizationIds ? { id: { in: [...organizationIds] } } : {}),
    },
    select: { id: true, name: true, slug: true },
  })

  const purged: string[] = []
  const errors: string[] = []

  for (const org of overdue) {
    try {
      await hardDeleteTenant(org.id)
      purged.push(`${org.name} (${org.slug})`)
    } catch (err: unknown) {
      console.error(`[TENANT] Purge failed for ${org.slug}:`, err)
      errors.push(`${org.slug}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { purged, errors }
}

// --- Registry.json management ---

const REGISTRY_PATH = path.join(process.cwd(), "clients", "registry.json")

function updateRegistry(slug: string, name: string, plan: string, baseDomain: string): void {
  try {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"))
    registry.clients[slug] = {
      name,
      server: process.env.SHARED_SERVER_IP || "13.140.132.245",
      sshUser: "root",
      sshKey: "~/.ssh/id_ed25519",
      domain: `${slug}.${baseDomain}`,
      appDir: "/opt/leaddrive-v2",
      port: 3001,
      pm2Name: "leaddrive-v2",
      plan,
      status: "active",
      type: "shared",
      provisionedAt: new Date().toISOString(),
    }
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n")
    console.log(`[TENANT] Registry updated for "${slug}"`)
  } catch (err) {
    console.error("[TENANT] Registry update failed:", err)
  }
}

function removeFromRegistry(slug: string): void {
  try {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"))
    if (registry.clients[slug]) {
      delete registry.clients[slug]
      fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n")
      console.log(`[TENANT] Registry removed "${slug}"`)
    }
  } catch (err) {
    console.error("[TENANT] Registry removal failed:", err)
  }
}
