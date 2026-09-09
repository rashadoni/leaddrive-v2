import { NextResponse } from "next/server"
import { MODULES, API_SCOPES } from "@/lib/permissions"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/constants"
import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"

// GET /api/v1/api-keys/scopes — list every scope an API key can hold.
// Derived from the central MODULES registry so new modules appear automatically.
export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!isAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (auth.role !== "superadmin" && !(await orgHasModule(auth.orgId, "crm"))) {
    return moduleDisabledResponse("crm")
  }

  return NextResponse.json({
    success: true,
    data: {
      modules: MODULES,
      scopes: API_SCOPES,
    },
  })
})
