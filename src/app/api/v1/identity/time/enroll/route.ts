import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { requireIdentityAdministrator } from "@/lib/identity/administrator-request"
import { enrollExistingIdentityInTime } from "@/lib/identity/time-enrollment"
import { IdentityRegistryError } from "@/lib/identity/contract"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { IdentityTimeEnrollmentInput } from "@/lib/identity/time-enrollment-contract"
const headers = { "cache-control": "private, no-store" }
export async function POST(req: NextRequest) {
  const administrator = await requireIdentityAdministrator(req)
  if (administrator instanceof NextResponse) return administrator
  const body = await readJsonRequestWithinLimit(req, 4096)
  if (!body.ok) return NextResponse.json({ error: "IDENTITY_TIME_ENROLLMENT_INVALID" }, { status: body.reason === "too_large" ? 413 : 400, headers })
  const parsed = IdentityTimeEnrollmentInput.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: "IDENTITY_TIME_ENROLLMENT_INVALID" }, { status: 400, headers })
  try {
    const data = await runWithTenant(administrator.organizationId, () => enrollExistingIdentityInTime(prisma, administrator, parsed.data))
    return NextResponse.json({ success: true, data }, { status: 201, headers })
  } catch (error) {
    const known = error instanceof IdentityRegistryError || error instanceof AttendanceRequestError
    return NextResponse.json({ error: known ? error.code : "IDENTITY_TIME_ENROLLMENT_FAILED" }, { status: error instanceof IdentityRegistryError && error.code === "IDENTITY_ADMIN_REQUIRED" ? 403 : known ? 409 : 500, headers })
  }
}
