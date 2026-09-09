import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { DEFAULT_ROLES, getAssignableRoleIds, type RoleConfig } from "@/lib/org-roles"

// Re-exported for backward compatibility with any importer of this route module.
export type { RoleConfig }

const MODULES = [
  "companies", "contacts", "deals", "leads", "tasks", "tickets",
  "contracts", "offers", "campaigns", "reports", "ai", "settings",
]

// Cosmetic per-module matrix shown in the roles UI. Keyed to the enforce-able
// catalog (DEFAULT_ROLES). NOTE: actual API enforcement uses ROLE_PERMISSIONS in
// lib/permissions.ts, not this map — see memory/deferred_findings.md.
const DEFAULT_PERMISSIONS: Record<string, Record<string, string>> = {
  admin:   { companies: "full", contacts: "full", deals: "full", leads: "full", tasks: "full", tickets: "full", contracts: "full", offers: "full", campaigns: "full", reports: "full", ai: "full", settings: "full" },
  manager: { companies: "full", contacts: "full", deals: "full", leads: "full", tasks: "full", tickets: "full", contracts: "full", offers: "full", campaigns: "full", reports: "full", ai: "full", settings: "none" },
  sales:   { companies: "full", contacts: "full", deals: "full", leads: "full", tasks: "edit", tickets: "view", contracts: "full", offers: "full", campaigns: "view", reports: "view", ai: "view", settings: "none" },
  support: { companies: "view", contacts: "edit", deals: "view", leads: "none", tasks: "full", tickets: "full", contracts: "none", offers: "none", campaigns: "none", reports: "view", ai: "view", settings: "none" },
  ticketing: { companies: "view", contacts: "edit", deals: "none", leads: "none", tasks: "edit", tickets: "edit", contracts: "none", offers: "none", campaigns: "none", reports: "view", ai: "view", settings: "none" },
  viewer:  { companies: "view", contacts: "view", deals: "view", leads: "view", tasks: "view", tickets: "view", contracts: "view", offers: "none", campaigns: "none", reports: "view", ai: "none", settings: "none" },
}

type RoleSettings = {
  roles?: RoleConfig[]
  permissions?: Record<string, Record<string, string>>
  [key: string]: unknown
}

function readRoleSettings(settings: unknown): RoleSettings {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? settings as RoleSettings : {}
}

// GET — list all roles
export const GET = withRls(async (_req, { orgId }) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })

  const settings = readRoleSettings(org?.settings)
  const roles: RoleConfig[] = settings.roles || DEFAULT_ROLES
  const savedPerms = settings.permissions || {}

  // Annotate each role with whether it can actually be ASSIGNED to a user — i.e.
  // whether the permission engine enforces it. The user-edit dropdown uses this
  // to hide deny-all roles (extended/custom) that would lock a user out.
  const assignable = getAssignableRoleIds()
  const annotatedRoles = roles.map((r) => ({ ...r, assignable: assignable.has(r.id) }))

  // Merge: ensure every role has permissions (fill missing from defaults)
  const permissions: Record<string, Record<string, string>> = {}
  for (const role of roles) {
    permissions[role.id] = savedPerms[role.id] || DEFAULT_PERMISSIONS[role.id] || {}
    // Fill missing modules
    for (const mod of MODULES) {
      if (!permissions[role.id][mod]) {
        permissions[role.id][mod] = DEFAULT_PERMISSIONS[role.id]?.[mod] || (mod === "settings" ? "none" : "view")
      }
    }
  }

  return NextResponse.json({ success: true, data: { roles: annotatedRoles, permissions } })
})

// POST — create a new role (admin only)
export const POST = withRlsAuth("settings", "write", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId

  try {
    const body = await req.json()
    const { name, color } = body

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return NextResponse.json({ error: "Role name must be at least 2 characters" }, { status: 400 })
    }

    const id = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
    if (!id) {
      return NextResponse.json({ error: "Invalid role name" }, { status: 400 })
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    })

    const settings = readRoleSettings(org?.settings)
    const roles: RoleConfig[] = settings.roles || [...DEFAULT_ROLES]
    const permissions = settings.permissions || { ...DEFAULT_PERMISSIONS }

    if (roles.find((r: RoleConfig) => r.id === id)) {
      return NextResponse.json({ error: "Role with this name already exists" }, { status: 400 })
    }

    const newRole: RoleConfig = {
      id,
      name: name.trim(),
      color: color || "slate",
      isSystem: false,
    }

    roles.push(newRole)

    // Default permissions for new role — view only
    const defaultPerms: Record<string, string> = {}
    for (const mod of MODULES) {
      defaultPerms[mod] = mod === "settings" ? "none" : "view"
    }
    permissions[id] = defaultPerms

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        settings: { ...settings, roles, permissions },
      },
    })

    return NextResponse.json({ success: true, data: newRole })
  } catch (e: unknown) {
    console.error("Roles POST error:", e)
    return NextResponse.json({ error: "Failed to create role" }, { status: 500 })
  }
})

// PUT — update roles and permissions together (admin only)
export const PUT = withRlsAuth("settings", "write", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId

  try {
    const body = await req.json()
    const { roles, permissions } = body

    if (!roles || !permissions) {
      return NextResponse.json({ error: "roles and permissions required" }, { status: 400 })
    }

    // Ensure admin always has full settings
    if (permissions.admin) {
      permissions.admin.settings = "full"
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    })

    const currentSettings = readRoleSettings(org?.settings)

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        settings: { ...currentSettings, roles, permissions },
      },
    })

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    console.error("Roles PUT error:", e)
    return NextResponse.json({ error: "Failed to update roles" }, { status: 500 })
  }
})

// DELETE — delete a custom role (admin only)
export const DELETE = withRlsAuth("settings", "delete", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId

  try {
    const { searchParams } = new URL(req.url)
    const roleId = searchParams.get("id")

    if (!roleId) {
      return NextResponse.json({ error: "Role ID required" }, { status: 400 })
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    })

    const settings = readRoleSettings(org?.settings)
    const roles: RoleConfig[] = settings.roles || [...DEFAULT_ROLES]
    const permissions = settings.permissions || { ...DEFAULT_PERMISSIONS }

    const role = roles.find((r: RoleConfig) => r.id === roleId)
    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 })
    }
    if (role.isSystem) {
      return NextResponse.json({ error: "Cannot delete system role" }, { status: 400 })
    }

    // Check if any users have this role
    const usersWithRole = await prisma.user.count({
      where: { organizationId: orgId, role: roleId },
    })
    if (usersWithRole > 0) {
      return NextResponse.json({ error: `Cannot delete role: ${usersWithRole} users still have this role` }, { status: 400 })
    }

    const updatedRoles = roles.filter((r: RoleConfig) => r.id !== roleId)
    delete permissions[roleId]

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        settings: { ...settings, roles: updatedRoles, permissions },
      },
    })

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    console.error("Roles DELETE error:", e)
    return NextResponse.json({ error: "Failed to delete role" }, { status: 500 })
  }
})
