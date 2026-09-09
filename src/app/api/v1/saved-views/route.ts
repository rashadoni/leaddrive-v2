import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { SAVED_VIEW_ENTITY_TYPES, type SavedViewEntityType } from "@/lib/saved-views/entity-types"

// FIX 3: Map each entityType to the module that gates it.
// PATCH/DELETE load the view first, then authorize against view.entityType's module.
// GET/POST authorize against the REQUESTED entityType's module.
// Unknown entityTypes fall back to "tasks" to avoid breaking hypothetical future types.
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
 * CRUD for user-defined saved views — Roadmap #20.
 *
 * GET    ?entityType=tasks   — list views visible to the caller for that entity
 * POST                       — create a view for the caller
 * PATCH                      — handled by [id]/route.ts
 * DELETE                     — handled by [id]/route.ts
 *
 * Visibility rules:
 *   - A view with `isShared=true` is visible to every member of the org
 *     (the creator's userId stays as the owner — only they + admins can
 *     edit/delete it; enforced in [id]/route.ts).
 *   - A view with `isShared=false` is visible ONLY to the creator.
 *
 * `filters` is a free-form JSONB blob — the shape is owned by the list
 * page that consumes it. No server-side schema check beyond "object".
 */

const createSchema = z.object({
  entityType: z.enum(SAVED_VIEW_ENTITY_TYPES),
  name: z.string().min(1).max(80),
  filters: z.record(z.string(), z.unknown()).default({}),
  isDefault: z.boolean().default(false),
  isShared: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
})

export async function GET(req: NextRequest) {
  // FIX 3: resolve entityType FIRST so we can gate on the correct module.
  // We need to read the URL before calling requireAuth, since the module
  // depends on the requested entityType.
  const { searchParams } = new URL(req.url)
  const entityType = searchParams.get("entityType")
  if (!entityType || !(SAVED_VIEW_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return NextResponse.json({ error: `entityType must be one of: ${SAVED_VIEW_ENTITY_TYPES.join(", ")}` }, { status: 400 })
  }

  // Gate on the module that owns this entityType (not hardcoded "tasks").
  // Auth resolves under runWithRlsBypass (the dynamic-module requireAuth queries
  // must not run inside the tenant frame); the read below runs under runWithTenant.
  const auth = await runWithRlsBypass(() => requireAuth(req, moduleForEntityType(entityType), "read"))
  if (isAuthError(auth)) return auth
  const orgId = auth.orgId
  const userId = auth.userId

  return runWithTenant(orgId, async () => {
  try {
    const views = await prisma.savedView.findMany({
      where: {
        organizationId: orgId,
        entityType,
        // Either: the caller created it, OR it's shared in this org.
        OR: [
          { userId },
          { isShared: true },
        ],
      },
      orderBy: [
        { isDefault: "desc" },
        { sortOrder: "asc" },
        { createdAt: "asc" },
      ],
      include: {
        user: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ success: true, data: views })
  } catch (e) {
    console.error("[saved-views GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}

export async function POST(req: NextRequest) {
  // FIX 3: Parse body first to get entityType, then gate on its module.
  // We read the body once here; zod re-validates the complete object below.
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = createSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Gate on the module that owns this entityType (not hardcoded "tasks").
  // Auth resolves under runWithRlsBypass; the writes below run under runWithTenant.
  const auth = await runWithRlsBypass(() => requireAuth(req, moduleForEntityType(parsed.data.entityType), "read"))
  if (isAuthError(auth)) return auth
  const orgId = auth.orgId
  const userId = auth.userId

  const { entityType, name, filters, isDefault, isShared, sortOrder } = parsed.data

  // "__"-prefixed names are RESERVED internal views (e.g. __table_default__,
  // the org-wide column default applied to every member). Creating one is an
  // org-wide write, so it is admin-gated — mirroring [id]'s owner-or-admin
  // mutate rule (otherwise any reader could plant the org default; the chips
  // bar hides "__" views, so this doesn't touch normal user/shared views).
  if (name.startsWith("__") && auth.role !== "admin" && auth.role !== "superadmin") {
    return NextResponse.json({ error: "Reserved views can only be created by an admin" }, { status: 403 })
  }

  return runWithTenant(orgId, async () => {
  try {
    // Only one default per (org, user, entityType). Architect P1:
    // clear-then-create must be atomic — two concurrent POSTs with
    // isDefault=true could otherwise both pass the clear and both
    // commit a default. $transaction wraps the pair so the second one
    // sees the first's writes via serialization.
    const view = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (isDefault) {
        await tx.savedView.updateMany({
          where: { organizationId: orgId, userId, entityType, isDefault: true },
          data: { isDefault: false },
        })
      }
      return tx.savedView.create({
        data: {
          organizationId: orgId,
          userId,
          entityType,
          name,
          filters: filters as Prisma.InputJsonValue,
          isDefault,
          isShared,
          sortOrder,
        },
        include: { user: { select: { id: true, name: true } } },
      })
    })

    logAudit(orgId, "create", "saved_view", view.id, name)
    return NextResponse.json({ success: true, data: view }, { status: 201 })
  } catch (e) {
    console.error("[saved-views POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
