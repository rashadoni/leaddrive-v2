/**
 * POST /api/v1/apps/[id]/install
 *
 * Install a catalog app for the calling tenant. The install executor
 * validates the manifest, checks requirements, creates/reactivates
 * the AppInstallation row, and provisions safe side effects such as
 * custom fields and platform-event definitions.
 *
 * Part of L1/L2 App marketplace (Phase 5 slice 1).
 *
 * Body: `{ config: Record<string, unknown> }` — user-supplied
 * settings values keyed by `manifest.capabilities.settingsKeys`.
 *
 * Returns 201 with the installation row, install plan, provisioning
 * resources, warnings, and executed=true.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  AppInstallError,
  installTenantApp,
  mergeInstallationConfig,
  resolveAppSetupStatus,
  splitInstallationConfig,
} from "@/lib/apps/install-executor"
import { buildInstallPlan } from "@/lib/apps/install-planner"
import { parseManifest } from "@/lib/apps/manifest-parser"
import { TENANT_CAPABILITY_CATALOG } from "@/lib/tenant-capabilities"
import { withRlsAuth } from "@/lib/with-rls"

const bodySchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
})

async function readBody(req: NextRequest): Promise<unknown | NextResponse> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }
}

export const POST = withRlsAuth("settings", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const app = await prisma.app.findFirst({
    where: { id, isPublic: true },
    select: { id: true, slug: true },
  })
  if (!app) return NextResponse.json({ error: "App not found" }, { status: 404 })

  const managedCapability = TENANT_CAPABILITY_CATALOG.find((capability) => capability.appSlug === app.slug)
  if (managedCapability) {
    return NextResponse.json(
      {
        error: "This app is managed by tenant capability approval. Request access instead of installing it directly.",
        capabilityId: managedCapability.id,
        action: "request_access",
      },
      { status: 409 },
    )
  }

  try {
    const result = await installTenantApp({
      appId: app.id,
      organizationId: auth.orgId,
      installedBy: auth.userId,
      userConfig: parsed.data.config ?? {},
    })

    return NextResponse.json(
      {
        installation: result.installation,
        plan: result.plan,
        provisionedResources: result.provisionedResources,
        warnings: result.warnings,
        executed: true,
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof AppInstallError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
          missing: Array.isArray(error.details) ? error.details : undefined,
        },
        { status: error.status },
      )
    }
    throw error
  }
})

/**
 * PATCH /api/v1/apps/[id]/install
 *
 * Update an installation. Two modes:
 *   - `{ status: "active" | "disabled" }` toggles soft-disable.
 *   - `{ config: Record<string, unknown> }` replaces user-config.
 * Both can be sent in the same body.
 *
 * Returns 200 with the updated row. 404 when no active installation
 * exists for this (tenant, app).
 */
const patchSchema = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export const PATCH = withRlsAuth("settings", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  if (parsed.data.status === undefined && parsed.data.config === undefined) {
    return NextResponse.json({ error: "Body must include status or config" }, { status: 400 })
  }

  // Cross-tenant guard via composite (organizationId, appId) unique key.
  const existing = await prisma.appInstallation.findUnique({
    where: { organizationId_appId: { organizationId: auth.orgId, appId: id } },
    select: {
      id: true,
      uninstalledAt: true,
      config: true,
      installedVersion: true,
      app: {
        select: {
          id: true,
          slug: true,
          manifest: true,
        },
      },
    },
  })
  if (!existing || existing.uninstalledAt !== null) {
    return NextResponse.json({ error: "Installation not found" }, { status: 404 })
  }

  const updateData: { status?: "active" | "disabled"; config?: Prisma.InputJsonValue } = {}
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status
  if (parsed.data.config !== undefined) {
    const manifestResult = parseManifest(existing.app.manifest)
    if (!manifestResult.ok) {
      return NextResponse.json(
        { error: "Catalog manifest is invalid", details: manifestResult.errors },
        { status: 500 },
      )
    }

    const current = splitInstallationConfig(existing.config)
    const nextUserConfig = {
      ...current.userConfig,
      ...parsed.data.config,
    }
    const planResult = buildInstallPlan({
      appId: existing.app.id,
      appSlug: existing.app.slug,
      installedVersion: existing.installedVersion,
      manifest: manifestResult.manifest,
      userConfig: nextUserConfig,
    })
    if (!planResult.ok) {
      return NextResponse.json(
        { error: "Invalid app configuration", details: planResult.errors },
        { status: 400 },
      )
    }

    const setupStatus = await resolveAppSetupStatus(prisma, {
      organizationId: auth.orgId,
      manifest: manifestResult.manifest,
      config: planResult.plan.config,
    })
    updateData.config = mergeInstallationConfig(
      existing.config,
      planResult.plan.config,
      setupStatus,
      auth.userId,
    ) as Prisma.InputJsonValue
  }

  const updated = await prisma.appInstallation.update({
    where: { id: existing.id },
    data: updateData,
    select: {
      id: true,
      appId: true,
      installedVersion: true,
      config: true,
      status: true,
      installedAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json({ installation: updated })
})

/**
 * DELETE /api/v1/apps/[id]/install
 *
 * Soft-uninstall — stamps `uninstalledAt` rather than deleting the
 * row. Custom fields, event definitions, historical values, and the
 * provisioning audit trail are preserved. Re-install reactivates the
 * same (organizationId, appId) row and clears `uninstalledAt`, so the
 * unique constraint does not block users from adding the app again.
 *
 * 404 when no active installation exists.
 */
export const DELETE = withRlsAuth("settings", "write", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.appInstallation.findUnique({
    where: { organizationId_appId: { organizationId: auth.orgId, appId: id } },
    select: { id: true, config: true, uninstalledAt: true },
  })
  if (!existing || existing.uninstalledAt !== null) {
    return NextResponse.json({ error: "Installation not found" }, { status: 404 })
  }

  const updated = await prisma.appInstallation.update({
    where: { id: existing.id },
    data: {
      uninstalledAt: new Date(),
      status: "disabled",
      config: buildSoftUninstallConfig(existing.config, auth.userId) as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      appId: true,
      status: true,
      uninstalledAt: true,
    },
  })
  return NextResponse.json({ installation: updated })
})

function buildSoftUninstallConfig(config: unknown, userId: string): Record<string, unknown> {
  const current = splitInstallationConfig(config)
  return {
    ...current.userConfig,
    __marketplaceProvisioning: {
      ...current.provisioning,
      setupComplete: false,
      cleanupPolicy: "preserve_data",
      cleanupReason: "Custom fields, event definitions, and historical values are preserved on uninstall.",
      uninstalledAt: new Date().toISOString(),
      uninstalledBy: userId,
    },
  }
}
