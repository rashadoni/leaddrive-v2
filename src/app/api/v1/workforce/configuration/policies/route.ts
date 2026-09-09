import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  WorkforcePolicyDraftCreateSchema,
  createWorkforcePolicyDraft,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

const policySelect = {
  id: true,
  teamId: true,
  version: true,
  status: true,
  name: true,
  effectiveFrom: true,
  effectiveTo: true,
  definition: true,
  definitionHash: true,
  provenance: true,
  systemProfileVersion: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Administrative inventory. It is intentionally separate from employee HRM reads. */
export const GET = withWorkforceSessionAdminAuth(async (_req: NextRequest, auth) => {
  try {
    const policies = await prisma.workforcePolicy.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ teamId: "asc" }, { version: "desc" }],
      select: policySelect,
    })
    return NextResponse.json({ success: true, data: { policies } })
  } catch (error) {
    console.error("[workforce/configuration/policies GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce policies" }, { status: 500 })
  }
})

/** Creates only a DRAFT policy; publication is a separate future-only action. */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforcePolicyDraftCreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce policy draft" }, { status: 400 })
  }
  try {
    const policy = await createWorkforcePolicyDraft({
      organizationId: auth.orgId,
      createdByUserId: auth.userId,
      draft: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { policy } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error("[workforce/configuration/policies POST]", error)
    return NextResponse.json({ error: "Failed to create Workforce policy draft" }, { status: 500 })
  }
})
