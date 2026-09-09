import { NextResponse } from "next/server"

import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"
import { isManagerOrAbove } from "@/lib/constants"
import { listMissedInboundQueue } from "@/lib/calls/missed-inbound-queue"
import { checkPermission } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"

const REQUIRED_MODULES = ["voip", "crm", "sales"] as const
const NO_STORE_HEADERS = { "cache-control": "private, no-store" }

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "private, no-store")
  return response
}

export const GET = withRlsSessionAuth(async (_request, auth) => {
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json(
      { error: "Manager role required" },
      { status: 403, headers: NO_STORE_HEADERS },
    )
  }
  if (
    !checkPermission(auth.role, "tasks", "read")
    || !checkPermission(auth.role, "voip", "read")
    || !checkPermission(auth.role, "leads", "read")
  ) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    )
  }

  if (auth.role !== "superadmin") {
    for (const moduleId of REQUIRED_MODULES) {
      if (!(await orgHasModule(auth.orgId, moduleId))) {
        return noStore(moduleDisabledResponse(moduleId))
      }
    }
  }

  try {
    const data = await listMissedInboundQueue(prisma, auth)
    return NextResponse.json(
      { success: true, data },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    console.error(
      error instanceof Error && error.message === "missed_inbound_queue_scan_limit"
        ? "[missed-inbound-queue] bounded scan limit reached"
        : "[missed-inbound-queue] list failed",
    )
    return NextResponse.json(
      { error: "missed_inbound_queue_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
})
