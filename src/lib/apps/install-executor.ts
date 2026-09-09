import { randomBytes } from "crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hasModule, moduleRecordFromOrgFields, type ModuleId } from "@/lib/modules"
import { buildInstallPlan } from "./install-planner"
import { parseManifest } from "./manifest-parser"
import type {
  AppManifest,
  InstallAction,
  InstallPlan,
  ManifestCustomField,
  ManifestEventSubscription,
  ManifestWebhookSubscription,
} from "./types"

type AppInstallDb = PrismaClient | Prisma.TransactionClient

type ExistingActiveMode = "error" | "return"
const MARKETPLACE_PROVISIONING_KEY = "__marketplaceProvisioning"

export interface TenantAppInstallOrgContext {
  plan: string
  addons?: string[]
  modules?: Record<string, boolean>
}

export interface InstallTenantAppInput {
  db?: AppInstallDb
  appSlug?: string
  appId?: string
  organizationId: string
  installedBy: string
  userConfig?: Record<string, unknown>
  orgContext?: TenantAppInstallOrgContext
  existingActiveMode?: ExistingActiveMode
}

export interface ProvisionedResource {
  kind: "custom_field" | "platform_event_definition" | "webhook_subscription" | "setting"
  ref: string
  status: "created" | "reused" | "updated" | "metadata_only"
  id?: string
  details?: Record<string, unknown>
}

export interface InstallTenantAppResult {
  installation: {
    id: string
    appId: string
    installedVersion: string
    config: Prisma.JsonValue
    status: string
    installedAt: Date
    updatedAt?: Date
  }
  plan: InstallPlan
  provisionedResources: ProvisionedResource[]
  warnings: string[]
  executed: true
}

export interface AppSetupStatus {
  setupComplete: boolean
  missingNamedCredentials: string[]
  missingSettings: string[]
  warnings: string[]
}

export class AppInstallError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message)
    this.name = "AppInstallError"
    this.code = code
    this.status = status
    this.details = details
  }
}

export async function installTenantApp(input: InstallTenantAppInput): Promise<InstallTenantAppResult> {
  if (!input.appSlug && !input.appId) {
    throw new AppInstallError("missing_app_selector", "appSlug or appId is required", 400)
  }

  const db = input.db ?? prisma
  const app = await db.app.findFirst({
    where: input.appId
      ? { id: input.appId, isPublic: true }
      : { slug: input.appSlug, isPublic: true },
    select: {
      id: true,
      slug: true,
      version: true,
      manifest: true,
    },
  })
  if (!app) {
    throw new AppInstallError("app_not_found", "App not found", 404)
  }

  const manifestResult = parseManifest(app.manifest)
  if (!manifestResult.ok) {
    throw new AppInstallError(
      "invalid_manifest",
      "Catalog manifest is invalid",
      500,
      manifestResult.errors,
    )
  }
  const manifest = manifestResult.manifest

  await assertModuleRequirements(db, {
    organizationId: input.organizationId,
    manifest,
    orgContext: input.orgContext,
  })

  const planResult = buildInstallPlan({
    appId: app.id,
    appSlug: app.slug,
    installedVersion: app.version,
    manifest,
    userConfig: input.userConfig ?? {},
  })
  if (!planResult.ok) {
    throw new AppInstallError(
      "invalid_install_plan",
      "Install plan failed validation",
      400,
      planResult.errors,
    )
  }

  const setupStatus = await resolveAppSetupStatus(db, {
    organizationId: input.organizationId,
    manifest,
    config: planResult.plan.config,
  })

  const execute = (tx: Prisma.TransactionClient) => executeInstall(tx, {
    organizationId: input.organizationId,
    installedBy: input.installedBy,
    plan: planResult.plan,
    setupStatus,
    existingActiveMode: input.existingActiveMode ?? "error",
  })

  if (input.db) {
    return execute(input.db as Prisma.TransactionClient)
  }
  return prisma.$transaction(execute)
}

async function assertModuleRequirements(
  db: AppInstallDb,
  input: {
    organizationId: string
    manifest: AppManifest
    orgContext?: TenantAppInstallOrgContext
  },
) {
  const modulesRequired = input.manifest.requirements?.modules ?? []
  if (modulesRequired.length > 0) {
    let orgContext = input.orgContext
    if (!orgContext) {
      const org = await db.organization.findUnique({
        where: { id: input.organizationId },
        select: { plan: true, addons: true, features: true, modules: true },
      })
      if (!org) {
        throw new AppInstallError("organization_not_found", "Organization not found", 500)
      }
      orgContext = {
        plan: org.plan,
        addons: org.addons,
        modules: moduleRecordFromOrgFields({ features: org.features, modules: org.modules }),
      }
    }

    const missingModules = modulesRequired.filter((moduleId: string) => (
      !hasModule(orgContext!, moduleId as ModuleId)
    ))
    if (missingModules.length > 0) {
      throw new AppInstallError(
        "missing_modules",
        "App requires modules not enabled in this tenant",
        409,
        missingModules,
      )
    }
  }
}

export async function resolveAppSetupStatus(
  db: AppInstallDb,
  input: {
    organizationId: string
    manifest: AppManifest
    config: Record<string, unknown>
  },
): Promise<AppSetupStatus> {
  const credentialNames = requiredCredentialNames(input.manifest)
  let missingNamedCredentials: string[] = []
  if (credentialNames.length > 0) {
    const found = await db.namedCredential.findMany({
      where: {
        organizationId: input.organizationId,
        name: { in: credentialNames },
        isActive: true,
      },
      select: { name: true },
    })
    const foundNames = new Set(found.map((credential) => credential.name))
    missingNamedCredentials = credentialNames.filter((name) => !foundNames.has(name))
  }

  const missingSettings = (input.manifest.capabilities.settingsKeys ?? [])
    .filter((setting) => setting.required)
    .filter((setting) => isBlankConfigValue(input.config[setting.key]))
    .map((setting) => setting.key)

  const warnings = [
    ...missingNamedCredentials.map((name) => (
      `Named credential "${name}" is missing; connector delivery stays in setup_required until it is created.`
    )),
    ...missingSettings.map((key) => (
      `Required app setting "${key}" is missing; connector delivery stays in setup_required until it is configured.`
    )),
  ]

  return {
    setupComplete: missingNamedCredentials.length === 0 && missingSettings.length === 0,
    missingNamedCredentials,
    missingSettings,
    warnings,
  }
}

async function executeInstall(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    installedBy: string
    plan: InstallPlan
    setupStatus: AppSetupStatus
    existingActiveMode: ExistingActiveMode
  },
): Promise<InstallTenantAppResult> {
  const existing = await tx.appInstallation.findUnique({
    where: {
      organizationId_appId: {
        organizationId: input.organizationId,
        appId: input.plan.appId,
      },
    },
    select: {
      id: true,
      uninstalledAt: true,
      config: true,
      appId: true,
      installedVersion: true,
      status: true,
      installedAt: true,
      updatedAt: true,
    },
  })

  if (existing && existing.uninstalledAt === null && input.existingActiveMode === "return") {
    return {
      installation: {
        id: existing.id,
        appId: existing.appId,
        installedVersion: existing.installedVersion,
        config: existing.config,
        status: existing.status,
        installedAt: existing.installedAt,
        updatedAt: existing.updatedAt,
      },
      plan: input.plan,
      provisionedResources: [],
      warnings: [],
      executed: true,
    }
  }

  if (existing && existing.uninstalledAt === null) {
    throw new AppInstallError("already_installed", "App is already installed in this tenant", 409)
  }

  const resources: ProvisionedResource[] = []
  const warnings: string[] = []

  for (const action of input.plan.actions) {
    const result = await executeAction(tx, {
      organizationId: input.organizationId,
      installedBy: input.installedBy,
      appSlug: input.plan.appSlug,
      action,
    })
    resources.push(...result.resources)
    warnings.push(...result.warnings)
  }
  warnings.push(...input.setupStatus.warnings)

  const config = buildInstallationConfig(input.plan, resources, warnings, input.installedBy, input.setupStatus)

  let installation
  try {
    installation = existing
      ? await tx.appInstallation.update({
          where: { id: existing.id },
          data: {
            installedVersion: input.plan.installedVersion,
            config: config as Prisma.InputJsonValue,
            status: "active",
            uninstalledAt: null,
            installedBy: input.installedBy,
            installedAt: new Date(),
          },
          select: installationSelect,
        })
      : await tx.appInstallation.create({
          data: {
            organizationId: input.organizationId,
            appId: input.plan.appId,
            installedVersion: input.plan.installedVersion,
            config: config as Prisma.InputJsonValue,
            status: "active",
            installedBy: input.installedBy,
          },
          select: installationSelect,
        })
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new AppInstallError("already_installed", "App is already installed in this tenant", 409)
    }
    throw error
  }

  return {
    installation,
    plan: input.plan,
    provisionedResources: resources,
    warnings,
    executed: true,
  }
}

const installationSelect = {
  id: true,
  appId: true,
  installedVersion: true,
  config: true,
  status: true,
  installedAt: true,
  updatedAt: true,
} satisfies Prisma.AppInstallationSelect

async function executeAction(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    installedBy: string
    appSlug: string
    action: InstallAction
  },
): Promise<{ resources: ProvisionedResource[]; warnings: string[] }> {
  switch (input.action.kind) {
    case "create_custom_field":
      return ensureCustomField(tx, input.organizationId, input.action.spec)
    case "register_event_subscription":
      return ensurePlatformEventDefinition(tx, {
        organizationId: input.organizationId,
        installedBy: input.installedBy,
        appSlug: input.appSlug,
        spec: input.action.spec,
      })
    case "register_webhook_subscription":
      return registerWebhookMetadata(input.action.spec)
    case "set_setting":
      return {
        resources: [{
          kind: "setting",
          ref: input.action.key,
          status: "updated",
        }],
        warnings: [],
      }
  }
}

async function ensureCustomField(
  tx: Prisma.TransactionClient,
  organizationId: string,
  spec: ManifestCustomField,
): Promise<{ resources: ProvisionedResource[]; warnings: string[] }> {
  const existing = await tx.customField.findUnique({
    where: {
      organizationId_entityType_fieldName: {
        organizationId,
        entityType: spec.entityType,
        fieldName: spec.fieldName,
      },
    },
    select: {
      id: true,
      fieldType: true,
      isRequired: true,
      options: true,
    },
  })

  if (existing) {
    const warnings = customFieldCompatibilityWarnings(spec, existing)
    await tx.customField.update({
      where: { id: existing.id },
      data: { isActive: true },
      select: { id: true },
    })
    return {
      resources: [{
        kind: "custom_field",
        ref: `${spec.entityType}.${spec.fieldName}`,
        status: "reused",
        id: existing.id,
        details: {
          entityType: spec.entityType,
          fieldName: spec.fieldName,
        },
      }],
      warnings,
    }
  }

  let created: { id: string }
  try {
    created = await tx.customField.create({
      data: {
        organizationId,
        entityType: spec.entityType,
        fieldName: spec.fieldName,
        fieldLabel: spec.fieldLabel,
        fieldType: spec.fieldType,
        options: spec.options ?? [],
        isRequired: spec.required,
        isActive: true,
      },
      select: { id: true },
    })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const raced = await tx.customField.findUnique({
      where: {
        organizationId_entityType_fieldName: {
          organizationId,
          entityType: spec.entityType,
          fieldName: spec.fieldName,
        },
      },
      select: {
        id: true,
        fieldType: true,
        isRequired: true,
        options: true,
      },
    })
    if (!raced) throw error
    await tx.customField.update({
      where: { id: raced.id },
      data: { isActive: true },
      select: { id: true },
    })
    return {
      resources: [{
        kind: "custom_field",
        ref: `${spec.entityType}.${spec.fieldName}`,
        status: "reused",
        id: raced.id,
        details: {
          entityType: spec.entityType,
          fieldName: spec.fieldName,
        },
      }],
      warnings: customFieldCompatibilityWarnings(spec, raced),
    }
  }

  return {
    resources: [{
      kind: "custom_field",
      ref: `${spec.entityType}.${spec.fieldName}`,
      status: "created",
      id: created.id,
      details: {
        entityType: spec.entityType,
        fieldName: spec.fieldName,
      },
    }],
    warnings: [],
  }
}

function customFieldCompatibilityWarnings(
  spec: ManifestCustomField,
  existing: { fieldType: string; isRequired: boolean; options: string[] },
): string[] {
  const warnings: string[] = []
  if (existing.fieldType !== spec.fieldType) {
    warnings.push(
      `Custom field ${spec.entityType}.${spec.fieldName} already exists with type ${existing.fieldType}; kept existing type instead of changing to ${spec.fieldType}.`,
    )
  }
  if (existing.isRequired !== spec.required) {
    warnings.push(
      `Custom field ${spec.entityType}.${spec.fieldName} already has required=${existing.isRequired}; kept existing validation setting.`,
    )
  }
  if (spec.options && JSON.stringify(existing.options) !== JSON.stringify(spec.options)) {
    warnings.push(
      `Custom field ${spec.entityType}.${spec.fieldName} already has select options; kept existing options.`,
    )
  }
  return warnings
}

async function ensurePlatformEventDefinition(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string
    installedBy: string
    appSlug: string
    spec: ManifestEventSubscription
  },
): Promise<{ resources: ProvisionedResource[]; warnings: string[] }> {
  const existing = await tx.platformEventDefinition.findUnique({
    where: {
      organizationId_name: {
        organizationId: input.organizationId,
        name: input.spec.eventName,
      },
    },
    select: { id: true, isActive: true },
  })

  if (existing) {
    if (!existing.isActive) {
      await tx.platformEventDefinition.update({
        where: { id: existing.id },
        data: { isActive: true },
        select: { id: true },
      })
    }
    return {
      resources: [{
        kind: "platform_event_definition",
        ref: input.spec.ref,
        status: "reused",
        id: existing.id,
        details: {
          eventName: input.spec.eventName,
          codeModuleSlug: input.spec.codeModuleSlug ?? null,
        },
      }],
      warnings: [],
    }
  }

  let created: { id: string }
  try {
    created = await tx.platformEventDefinition.create({
      data: {
        organizationId: input.organizationId,
        name: input.spec.eventName,
        description: `Provisioned by marketplace app ${input.appSlug}`,
        fields: [],
        isActive: true,
        createdBy: input.installedBy,
      },
      select: { id: true },
    })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const raced = await tx.platformEventDefinition.findUnique({
      where: {
        organizationId_name: {
          organizationId: input.organizationId,
          name: input.spec.eventName,
        },
      },
      select: { id: true, isActive: true },
    })
    if (!raced) throw error
    if (!raced.isActive) {
      await tx.platformEventDefinition.update({
        where: { id: raced.id },
        data: { isActive: true },
        select: { id: true },
      })
    }
    return {
      resources: [{
        kind: "platform_event_definition",
        ref: input.spec.ref,
        status: "reused",
        id: raced.id,
        details: {
          eventName: input.spec.eventName,
          codeModuleSlug: input.spec.codeModuleSlug ?? null,
        },
      }],
      warnings: [],
    }
  }

  return {
    resources: [{
      kind: "platform_event_definition",
      ref: input.spec.ref,
      status: "created",
      id: created.id,
      details: {
        eventName: input.spec.eventName,
        codeModuleSlug: input.spec.codeModuleSlug ?? null,
      },
    }],
    warnings: [],
  }
}

function registerWebhookMetadata(
  spec: ManifestWebhookSubscription,
): { resources: ProvisionedResource[]; warnings: string[] } {
  return {
    resources: [{
      kind: "webhook_subscription",
      ref: spec.ref,
      status: "metadata_only",
      details: {
        eventNames: spec.eventNames,
        targetUrl: spec.targetUrl,
        credentialRef: spec.credentialRef ?? null,
      },
    }],
    warnings: [],
  }
}

function buildInstallationConfig(
  plan: InstallPlan,
  resources: ProvisionedResource[],
  warnings: string[],
  installedBy: string,
  setupStatus: AppSetupStatus,
): Record<string, unknown> {
  return {
    ...plan.config,
    [MARKETPLACE_PROVISIONING_KEY]: {
      schemaVersion: 1,
      appSlug: plan.appSlug,
      executedAt: new Date().toISOString(),
      executedBy: installedBy,
      requestId: randomBytes(8).toString("hex"),
      setupComplete: setupStatus.setupComplete,
      missingNamedCredentials: setupStatus.missingNamedCredentials,
      missingSettings: setupStatus.missingSettings,
      resources,
      warnings,
    },
  }
}

export function splitInstallationConfig(config: unknown): {
  userConfig: Record<string, unknown>
  provisioning: Record<string, unknown>
} {
  const record = asRecord(config) ?? {}
  const userConfig: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith("__")) userConfig[key] = value
  }
  return {
    userConfig,
    provisioning: asRecord(record[MARKETPLACE_PROVISIONING_KEY]) ?? {},
  }
}

export function mergeInstallationConfig(
  currentConfig: unknown,
  nextUserConfig: Record<string, unknown>,
  setupStatus: AppSetupStatus,
  configuredBy: string,
): Record<string, unknown> {
  const { provisioning } = splitInstallationConfig(currentConfig)
  return {
    ...nextUserConfig,
    [MARKETPLACE_PROVISIONING_KEY]: {
      ...provisioning,
      setupComplete: setupStatus.setupComplete,
      missingNamedCredentials: setupStatus.missingNamedCredentials,
      missingSettings: setupStatus.missingSettings,
      warnings: setupStatus.warnings,
      configuredAt: new Date().toISOString(),
      configuredBy,
    },
  }
}

function requiredCredentialNames(manifest: AppManifest): string[] {
  const names = new Set<string>()
  for (const name of manifest.requirements?.namedCredentialNames ?? []) {
    names.add(name)
  }
  for (const webhook of manifest.capabilities.webhookSubscriptions ?? []) {
    if (webhook.credentialRef) names.add(webhook.credentialRef)
  }
  return [...names].sort()
}

function isBlankConfigValue(value: unknown): boolean {
  return value === undefined || value === null || value === ""
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
