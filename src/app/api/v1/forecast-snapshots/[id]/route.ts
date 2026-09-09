/**
 * A12 Forecast Snapshots — single-snapshot mutations.
 *
 * DELETE /api/v1/forecast-snapshots/[id] — remove one snapshot (org-scoped).
 * Snapshots were create-only until now; this lets operators prune test /
 * mistaken captures. Org-scoped existence check prevents cross-tenant delete.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Missing snapshot id" }, { status: 400 })
  }

  try {
    // Org-scoped existence → 404 (and prevents deleting another tenant's row).
    const existing = await prisma.forecastSnapshot.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 })
    }
    await prisma.forecastSnapshot.delete({ where: { id } })
    return NextResponse.json({ ok: true, id: existing.id })
  } catch (err) {
    console.error("[forecast-snapshots/:id] DELETE error:", err)
    return NextResponse.json(
      { error: "Failed to delete snapshot" },
      { status: 500 },
    )
  }
})
