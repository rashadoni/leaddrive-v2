import { NextRequest, NextResponse } from "next/server"
import { withWorkforceSessionPolicyConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"
import { WorkforcePolicyRestoreDraftSchema, WorkforcePolicyRestoreSourceIdSchema,
  WorkforcePolicyRestoreError, restoreWorkforcePolicyAsDraft } from "@/lib/workforce/policy-restore-draft"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

type Context = { params: Promise<{ id: string }> }
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }
const authorized = withWorkforceSessionPolicyConfigurationAuth<Context>(async (req: NextRequest, auth, { params }) => {
  const { id } = await params
  const draft = WorkforcePolicyRestoreDraftSchema.safeParse(await req.json().catch(() => null))
  if (!WorkforcePolicyRestoreSourceIdSchema.safeParse(id).success || !draft.success || Array.from(req.nextUrl.searchParams).length) {
    return NextResponse.json({ error: "Choose a recorded policy, name and future start date.", code: "WORKFORCE_POLICY_RESTORE_INPUT_INVALID" }, { status: 400, headers })
  }
  try {
    const result = await restoreWorkforcePolicyAsDraft({ organizationId: auth.orgId, sourcePolicyId: id,
      draft: draft.data, audit: workforceConfigurationRequestAuditContext(req, auth.userId) })
    return NextResponse.json({ success: true, data: { restore: result } }, { status: result.replayed ? 200 : 201, headers })
  } catch (error) {
    if (error instanceof WorkforcePolicyRestoreError) {
      const status = error.code === "WORKFORCE_POLICY_RESTORE_SOURCE_UNAVAILABLE" ? 404
        : error.code === "WORKFORCE_POLICY_RESTORE_INPUT_INVALID" ? 400 : 409
      return NextResponse.json({ error: "This recorded policy cannot be restored with this request.", code: error.code }, { status, headers })
    }
    logWorkforceSensitiveOperationFailure({ operation: "configuration-policy-restore-draft" })
    return NextResponse.json({ error: "Unable to confirm policy draft creation. Retry the same request.", code: "WORKFORCE_POLICY_RESTORE_UNAVAILABLE" }, { status: 503, headers })
  }
})

/** Apply private headers also to authorization denials before the handler runs. */
export async function POST(req: NextRequest, context: Context): Promise<Response> {
  const response = await authorized(req, context)
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
  return response
}
