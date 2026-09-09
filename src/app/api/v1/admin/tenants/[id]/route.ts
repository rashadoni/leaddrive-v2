import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import {
  assertTenantWorkforceRetentionClear,
  deactivateTenant,
  activateTenant,
  scheduleTenantDeletion,
  hardDeleteTenant,
  WorkforceRetentionBlockedError,
} from "@/lib/tenant-provisioning"
import { exportTenantData } from "@/lib/tenant-export"
import { sendEmail } from "@/lib/email"
import { getDeletionScheduledEmail, getDeletionCompletedEmail } from "@/lib/emails/tenant-deletion"
import { logAudit } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { reconcileModulesWithFeatures, withRequiredModules } from "@/lib/modules"

// GET /api/v1/admin/tenants/[id] — Tenant details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  return runWithRlsBypass(async () => {
    const tenant = await prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: {
            users: true,
            contacts: true,
            deals: true,
            companies: true,
            leads: true,
          },
        },
      },
    })

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        isActive: tenant.isActive,
        serverType: tenant.serverType,
        serverIp: tenant.serverIp,
        maxUsers: tenant.maxUsers,
        maxContacts: tenant.maxContacts,
        features: tenant.features,
        branding: tenant.branding,
        addons: tenant.addons,
        settings: tenant.settings,
        provisionedAt: tenant.provisionedAt,
        provisionedBy: tenant.provisionedBy,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
        users: tenant.users,
        _count: tenant._count,
      },
    })
  })
}

// PUT /api/v1/admin/tenants/[id] — Update tenant
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json()

  return runWithRlsBypass(async () => {
    const existing = await prisma.organization.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    // Slug change: validate uniqueness if changed
    if (body.slug !== undefined && body.slug !== existing.slug) {
      const { validateSlug } = await import("@/lib/tenant-provisioning")
      const slugCheck = await validateSlug(body.slug)
      if (!slugCheck.valid) {
        return NextResponse.json({ error: slugCheck.error }, { status: 400 })
      }
    }

    const updateData: any = {}
    if (body.slug !== undefined) updateData.slug = body.slug
    if (body.name !== undefined) updateData.name = body.name
    if (body.plan !== undefined) updateData.plan = body.plan
    if (body.maxUsers !== undefined) updateData.maxUsers = body.maxUsers
    if (body.maxContacts !== undefined) updateData.maxContacts = body.maxContacts
    if (body.features !== undefined) {
      // A Support tenant always needs the shared customer base. Persist the
      // normalized list too (not only the derived `modules` map), otherwise a
      // later edit could make the dependency look like an unexplained grant.
      const features = withRequiredModules(body.features)
      updateData.features = JSON.stringify(features)
      // `features` is authoritative for module visibility, but `hasModule` also
      // merges the `modules` JSON column (written by Advisor Suite / capability
      // grants). Keep that column in sync so a superadmin toggling a group-module
      // OFF here actually hides it — otherwise the stale column keeps granting it.
      // Non-group keys (capability-entitlement module ids) are preserved.
      updateData.modules = reconcileModulesWithFeatures(features, existing.modules)
    }
    if (body.branding !== undefined) {
      updateData.branding = typeof body.branding === "string" ? body.branding : JSON.stringify(body.branding)
      const brandingObj = typeof body.branding === "string" ? JSON.parse(body.branding) : body.branding
      updateData.logo = brandingObj?.logo || null
    }
    if (body.addons !== undefined) updateData.addons = body.addons
    if (body.isActive !== undefined) updateData.isActive = body.isActive
    if (body.serverType !== undefined) updateData.serverType = body.serverType
    if (body.serverIp !== undefined) updateData.serverIp = body.serverIp

    // Settings are merged (not overwritten) to preserve unrelated keys
    if (body.settings !== undefined && typeof body.settings === "object") {
      const existingSettings = (existing.settings as Record<string, any>) || {}
      updateData.settings = { ...existingSettings, ...body.settings }
    }

    const updated = await prisma.organization.update({
      where: { id },
      data: updateData,
    })

    logAudit(auth.orgId, "update", "tenant", id, existing.name, {
      oldValue: { plan: existing.plan, isActive: existing.isActive },
      newValue: updateData,
    })

    return NextResponse.json({
      data: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        plan: updated.plan,
        isActive: updated.isActive,
        maxUsers: updated.maxUsers,
        maxContacts: updated.maxContacts,
      },
    })
  })
}

// DELETE /api/v1/admin/tenants/[id] — Schedule deletion or force delete
// Without ?force → schedule deletion (30 day grace period)
// With ?force=true&confirm=<slug> → immediate hard delete with export
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  return runWithRlsBypass(async () => {
    const url = new URL(req.url)
    const force = url.searchParams.get("force") === "true"
    const confirmSlug = url.searchParams.get("confirm")

    const existing = await prisma.organization.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    if (force) {
      // Force delete — requires slug confirmation
      if (confirmSlug !== existing.slug) {
        return NextResponse.json(
          { error: "Slug confirmation does not match. Pass ?confirm=<slug> to confirm deletion." },
          { status: 400 }
        )
      }

      try {
        await assertTenantWorkforceRetentionClear(id)
      } catch (error) {
        if (error instanceof WorkforceRetentionBlockedError) {
          return NextResponse.json({
            error: error.message,
            code: error.code,
          }, { status: 409 })
        }
        throw error
      }

      // Export data before deletion (best-effort)
      let exportFilename: string | null = null
      try {
        const exportResult = await exportTenantData(id)
        exportFilename = exportResult.filename
        console.log(`[TENANT] Exported data for "${existing.name}" before deletion: ${exportFilename}`)
      } catch (exportErr) {
        console.error(`[TENANT] Export failed before deletion of "${existing.name}":`, exportErr)
      }

      // Capture recipients before cascade deletion, but do not tell anyone the
      // tenant is gone until the database delete has actually committed.
      let completedDeletionRecipients: string[] = []
      try {
        const adminUsers = await prisma.user.findMany({
          where: { organizationId: id, role: "admin" },
          select: { email: true },
        })
        completedDeletionRecipients = adminUsers.map((user) => user.email)
      } catch {}

      // Hard delete (cascade)
      try {
        await hardDeleteTenant(id)
      } catch (deleteErr: any) {
        console.error(`[TENANT] Hard delete failed for "${existing.name}":`, deleteErr)
        if (deleteErr instanceof WorkforceRetentionBlockedError) {
          return NextResponse.json(
            { error: deleteErr.message, code: deleteErr.code },
            { status: 409 },
          )
        }
        return NextResponse.json(
          { error: `Deletion failed: ${deleteErr.message || "Unknown error"}` },
          { status: 500 }
        )
      }

      // Record and announce completion only after the database removal. A
      // concurrent Workforce write can still trip the database retention
      // guard after preflight; that must not generate a false completion.
      logAudit(auth.orgId, "force_delete", "tenant", id, existing.name, {
        oldValue: { slug: existing.slug, plan: existing.plan },
      })
      try {
        const emailData = getDeletionCompletedEmail({ companyName: existing.name })
        for (const email of completedDeletionRecipients) {
          await sendEmail({ to: email, subject: emailData.subject, html: emailData.html }).catch(() => {})
        }
      } catch {}

      return NextResponse.json({
        success: true,
        message: `Tenant "${existing.name}" permanently deleted`,
        exportFilename,
      })
    } else {
      // Schedule deletion (30 day grace period)
      const deletionDate = await scheduleTenantDeletion(id)

      // Notify admin users (best-effort)
      try {
        const adminUsers = await prisma.user.findMany({
          where: { organizationId: id, role: "admin" },
          select: { email: true },
        })
        const emailData = getDeletionScheduledEmail({
          companyName: existing.name,
          deletionDate: deletionDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
          adminUrl: `https://app.leaddrivecrm.org/admin/tenants/${id}`,
        })
        for (const u of adminUsers) {
          await sendEmail({ to: u.email, subject: emailData.subject, html: emailData.html }).catch(() => {})
        }
      } catch {}

      logAudit(auth.orgId, "schedule_delete", "tenant", id, existing.name, {
        newValue: { deletionScheduledAt: deletionDate.toISOString() },
      })

      return NextResponse.json({
        success: true,
        message: `Tenant "${existing.name}" scheduled for deletion`,
        deletionScheduledAt: deletionDate.toISOString(),
      })
    }
  })
}
