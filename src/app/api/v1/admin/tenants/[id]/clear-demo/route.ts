import { NextRequest, NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { clearTenantContent } from "@/lib/tenant-provisioning"
import { exportTenantData } from "@/lib/tenant-export"
import { runWithRlsBypass } from "@/lib/rls-context"

// POST /api/v1/admin/tenants/[id]/clear-demo
// Body: { confirm: "<slug>" }
//
// Clears ALL business content for the tenant (the "Quick Start" demo-data
// reset) while preserving the org, its users (login), branding, settings and
// enabled modules. Superadmin-only + slug-confirmed (mirrors Force Delete). A
// best-effort JSON export is taken before clearing so the wipe is recoverable.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  return runWithRlsBypass(async () => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const confirmSlug = typeof body?.confirm === "string" ? body.confirm : null

    const existing = await prisma.organization.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    if (confirmSlug !== existing.slug) {
      return NextResponse.json(
        { error: "Slug confirmation does not match. Pass { confirm: \"<slug>\" } to confirm." },
        { status: 400 },
      )
    }

    // Best-effort export before clearing (safety net — same as force-delete).
    let exportFilename: string | null = null
    try {
      const exportResult = await exportTenantData(id)
      exportFilename = exportResult.filename
      console.log(`[TENANT] Exported "${existing.name}" before demo-data clear: ${exportFilename}`)
    } catch (exportErr) {
      console.error(`[TENANT] Export failed before demo-data clear of "${existing.name}":`, exportErr)
    }

    let result
    try {
      result = await clearTenantContent(id)
    } catch (clearErr: any) {
      console.error(`[TENANT] Demo-data clear failed for "${existing.name}":`, clearErr)
      return NextResponse.json(
        { error: `Clear failed: ${clearErr?.message || "Unknown error"}` },
        { status: 500 },
      )
    }

    logAudit(auth.orgId, "clear_demo_data", "tenant", id, existing.name, {
      newValue: { rowsDeleted: result.rowsDeleted, tablesCleared: result.tablesCleared },
    })

    return NextResponse.json({
      success: true,
      message: `Cleared business content for "${existing.name}" — ${result.rowsDeleted.toLocaleString()}+ records across ${result.tablesCleared} section(s) (linked rows cascade). Login, branding, modules, billing, integrations and audit preserved.`,
      rowsDeleted: result.rowsDeleted,
      tablesCleared: result.tablesCleared,
      exportFilename,
    })
  })
}
