import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { checkPermission } from "@/lib/permissions"

/**
 * GET — for the Chrome extension's panel on the tax portal: which LeadDrive
 * organization and person the invoices would go to, and whether that person
 * may bring them in. The extension shows this before anything is sent.
 */
export const GET = withRlsAuth("finance", "read", async (_req, { orgId, name, role }) => {
  const organization = await prisma.organization.findFirst({ where: { id: orgId }, select: { name: true } })
  return NextResponse.json({
    data: {
      organization: organization?.name ?? "",
      user: name,
      canImport: checkPermission(role, "finance", "write"),
    },
  })
})
