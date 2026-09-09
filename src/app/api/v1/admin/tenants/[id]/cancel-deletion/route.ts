import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { cancelTenantDeletion } from "@/lib/tenant-provisioning"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { getDeletionCancelledEmail } from "@/lib/emails/tenant-deletion"
import { runWithRlsBypass } from "@/lib/rls-context"

// POST /api/v1/admin/tenants/[id]/cancel-deletion — Cancel scheduled deletion
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  return runWithRlsBypass(async () => {
    const existing = await prisma.organization.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    }

    if (!existing.deletionScheduledAt) {
      return NextResponse.json({ error: "No deletion is scheduled for this tenant" }, { status: 400 })
    }

    await cancelTenantDeletion(id)

    // Notify admin users (best-effort)
    try {
      const adminUsers = await prisma.user.findMany({
        where: { organizationId: id, role: "admin" },
        select: { email: true },
      })
      const emailData = getDeletionCancelledEmail({ companyName: existing.name })
      for (const u of adminUsers) {
        await sendEmail({ to: u.email, subject: emailData.subject, html: emailData.html }).catch(() => {})
      }
    } catch {}

    return NextResponse.json({
      success: true,
      message: `Deletion cancelled for "${existing.name}". Tenant reactivated.`,
    })
  })
}
