import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"

export const DELETE = withRouteFieldRlsAuth("read",
  async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const view = await prisma.savedView.findFirst({
      where: {
        id,
        organizationId: auth.orgId,
        entityType: "mtm_contacts",
        userId: auth.userId,
      },
      select: { id: true, name: true },
    })
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
    await prisma.savedView.deleteMany({
      where: {
        id,
        organizationId: auth.orgId,
        entityType: "mtm_contacts",
        userId: auth.userId,
      },
    })
    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: auth.agentId,
      action: "CONTACT_VIEW_DELETE",
      entity: "saved_view",
      entityId: id,
      metadataKind: "contact_saved_view",
      oldData: { name: view.name },
      req,
    }).catch((error) => console.warn("[MTM/contacts/views DELETE] audit failed", error))
    return NextResponse.json({ success: true })
  },
)
