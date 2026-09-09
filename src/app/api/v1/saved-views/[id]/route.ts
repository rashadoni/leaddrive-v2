import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import type { SavedViewEntityType } from "@/lib/saved-views/entity-types"

// FIX 3: Mirror the module map from the collection route — authorize PATCH/DELETE
// against the module that owns the view's entityType, not hardcoded "tasks".
const ENTITY_TYPE_MODULE_MAP: Record<SavedViewEntityType, string> = {
  tasks: "tasks",
  contacts: "contacts",
  deals: "deals",
  leads: "leads",
  companies: "companies",
  projects: "projects",
  contracts: "contracts",
}

function moduleForEntityType(entityType: string): string {
  return ENTITY_TYPE_MODULE_MAP[entityType as SavedViewEntityType] ?? "tasks"
}

/**
 * PATCH / DELETE on a single saved view.
 *
 * Permission rules:
 *   - The owner (view.userId === caller) may always edit/delete.
 *   - Admins may edit/delete any view in their org (so a leaving employee's
 *     shared views can be cleaned up).
 *   - Anyone else: 403.
 *
 * Roadmap #20.
 */

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  isShared: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

async function ownerOrAdmin(viewId: string, orgId: string, userId: string, role: string) {
  const view = await prisma.savedView.findFirst({
    where: { id: viewId, organizationId: orgId },
  })
  if (!view) return { view: null, allowed: false }
  const allowed = view.userId === userId || role === "admin" || role === "superadmin"
  return { view, allowed }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // FIX 3: Load the view first (org-scoped) to get its entityType, then gate on
  // that entityType's module instead of a hardcoded "tasks". ownerOrAdmin also
  // validates ownership/admin — 404 for cross-tenant, 403 for non-owner non-admin.
  // We need orgId before the module gate, so start with a minimal requireAuth
  // (no module/action — just gets an authenticated orgId + role). Resolved under
  // runWithRlsBypass; the view-load + phase-2 module gate + write run under
  // runWithTenant so they are RLS-scoped (phase-2's queries are same-org → fine).
  const preAuth = await runWithRlsBypass(() => requireAuth(req))
  if (isAuthError(preAuth)) return preAuth
  const orgId = preAuth.orgId
  const userId = preAuth.userId
  const role = preAuth.role
  const { id } = await params

  return runWithTenant(orgId, async () => {
  const { view, allowed } = await ownerOrAdmin(id, orgId, userId, role)
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!allowed) return NextResponse.json({ error: "Forbidden — only the view owner or an admin may edit it" }, { status: 403 })

  // Now gate on the module that owns this view's entityType
  const moduleAuth = await requireAuth(req, moduleForEntityType(view.entityType), "read")
  if (isAuthError(moduleAuth)) return moduleAuth

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // Atomic clear-then-update — same race-safety as POST. Architect P1:
    // two concurrent PATCHes setting isDefault=true on different views
    // for the same user could otherwise both commit defaults.
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (parsed.data.isDefault === true) {
        await tx.savedView.updateMany({
          where: {
            organizationId: orgId,
            userId: view.userId,
            entityType: view.entityType,
            isDefault: true,
            NOT: { id: view.id },
          },
          data: { isDefault: false },
        })
      }
      // `filters` is JSONB — cast through InputJsonValue. The zod schema
      // already shapes it as Record<string, unknown>, so the cast is
      // safe at runtime, just an annotation gap. Extracting the rest
      // first lets us add the typed filters key separately.
      const { filters, ...rest } = parsed.data
      const data: Prisma.SavedViewUpdateInput = {
        ...rest,
        ...(filters !== undefined ? { filters: filters as Prisma.InputJsonValue } : {}),
      }
      return tx.savedView.update({
        where: { id },
        data,
        include: { user: { select: { id: true, name: true } } },
      })
    })
    logAudit(orgId, "update", "saved_view", id, updated.name)
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error("[saved-views PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // FIX 3: Same pattern as PATCH — load view first, then gate on its entityType's module.
  // Phase-1 auth under runWithRlsBypass; load + module-gate + delete under runWithTenant.
  const preAuth = await runWithRlsBypass(() => requireAuth(req))
  if (isAuthError(preAuth)) return preAuth
  const orgId = preAuth.orgId
  const userId = preAuth.userId
  const role = preAuth.role
  const { id } = await params

  return runWithTenant(orgId, async () => {
  const { view, allowed } = await ownerOrAdmin(id, orgId, userId, role)
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!allowed) return NextResponse.json({ error: "Forbidden — only the view owner or an admin may delete it" }, { status: 403 })

  // Gate on the module that owns this view's entityType
  const moduleAuth = await requireAuth(req, moduleForEntityType(view.entityType), "read")
  if (isAuthError(moduleAuth)) return moduleAuth

  try {
    await prisma.savedView.delete({ where: { id } })
    logAudit(orgId, "delete", "saved_view", id, view.name)
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[saved-views DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
