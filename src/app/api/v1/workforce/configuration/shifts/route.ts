import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  WorkforceShiftTemplateDraftCreateSchema,
  createWorkforceShiftTemplateDraft,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

const shiftTemplateSelect = {
  id: true,
  teamId: true,
  code: true,
  isDefault: true,
  version: true,
  status: true,
  name: true,
  timezone: true,
  definition: true,
  definitionHash: true,
  provenance: true,
  systemProfileVersion: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Administrative inventory. Draft and published templates are explicit. */
export const GET = withWorkforceSessionAdminAuth(async (_req: NextRequest, auth) => {
  try {
    const shifts = await prisma.workforceShiftTemplate.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ teamId: "asc" }, { code: "asc" }, { version: "desc" }],
      select: shiftTemplateSelect,
    })
    return NextResponse.json({ success: true, data: { shifts } })
  } catch (error) {
    console.error("[workforce/configuration/shifts GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce shift templates" }, { status: 500 })
  }
})

/** Creates a DRAFT non-default shift template only. */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceShiftTemplateDraftCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce shift draft" }, { status: 400 })
  }
  try {
    const shift = await createWorkforceShiftTemplateDraft({
      organizationId: auth.orgId,
      createdByUserId: auth.userId,
      draft: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { shift } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error("[workforce/configuration/shifts POST]", error)
    return NextResponse.json({ error: "Failed to create Workforce shift draft" }, { status: 500 })
  }
})
