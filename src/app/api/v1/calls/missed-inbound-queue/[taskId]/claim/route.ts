import { NextResponse } from "next/server"

import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"
import {
  claimMissedInboundQueueTask,
  MissedInboundQueueError,
} from "@/lib/calls/missed-inbound-queue"
import { isManagerOrAbove } from "@/lib/constants"
import { checkPermission } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { withRlsSessionAuth } from "@/lib/with-rls"

type RouteContext = { params: Promise<{ taskId: string }> }

const REQUIRED_MODULES = ["voip", "crm", "sales"] as const
const NO_STORE_HEADERS = { "cache-control": "private, no-store" }

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "private, no-store")
  return response
}

export const POST = withRlsSessionAuth(async (request, auth, context: RouteContext) => {
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json(
      { error: "Manager role required" },
      { status: 403, headers: NO_STORE_HEADERS },
    )
  }

  const mutationRejection = guardInteractiveJsonMutation(request)
  if (mutationRejection) return noStore(mutationRejection)

  if (
    !checkPermission(auth.role, "tasks", "write")
    || !checkPermission(auth.role, "voip", "write")
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

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0) {
    return NextResponse.json(
      { error: "invalid_missed_inbound_claim_payload" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const { taskId } = await context.params
  try {
    const data = await claimMissedInboundQueueTask(prisma, auth, taskId)
    return NextResponse.json(
      { success: true, data },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    if (error instanceof MissedInboundQueueError) {
      if (error.code === "already_claimed") {
        return NextResponse.json(
          { error: "missed_inbound_already_claimed" },
          { status: 409, headers: NO_STORE_HEADERS },
        )
      }
      return NextResponse.json(
        { error: "missed_inbound_not_found" },
        { status: 404, headers: NO_STORE_HEADERS },
      )
    }

    console.error("[missed-inbound-queue] claim failed")
    return NextResponse.json(
      { error: "missed_inbound_claim_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
})
