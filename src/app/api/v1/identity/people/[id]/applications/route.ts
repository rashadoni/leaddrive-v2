import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { requireIdentityAdministrator } from "@/lib/identity/administrator-request"
import { enrollIdentityApplication } from "@/lib/identity/application-enrollment"
import { IdentityRegistryError } from "@/lib/identity/contract"

const input = z.object({ actorId: z.string().min(1).max(128), application: z.enum(["TIME", "ROUTE_FIELD"]),
  role: z.string().min(1).max(50), status: z.enum(["ACTIVE", "REVOKED"]), expectedAccountVersion: z.number().int().positive(),
  expectedGrantVersion: z.number().int().nonnegative(), expectedMembershipVersion: z.number().int().nonnegative(), requestId: z.string().min(1).max(128) }).strict()
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" }

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const administrator = await requireIdentityAdministrator(req)
  if (administrator instanceof NextResponse) return administrator
  const body = await readJsonRequestWithinLimit(req, 2048)
  const parsed = body.ok ? input.safeParse(body.value) : null
  if (!parsed?.success) return NextResponse.json({ error: "IDENTITY_ENROLLMENT_INPUT_INVALID" }, { status: body.ok || body.reason !== "too_large" ? 400 : 413, headers })
  try {
    const { id } = await context.params
    const result = await runWithTenant(administrator.organizationId,
      () => enrollIdentityApplication(prisma, administrator, { ...parsed.data, userId: id }))
    return NextResponse.json({ success: true, data: result }, { headers })
  } catch (error) {
    const known = error instanceof IdentityRegistryError
    return NextResponse.json({ error: known ? error.code : "IDENTITY_ENROLLMENT_FAILED" },
      { status: !known ? 500 : error.code === "IDENTITY_ADMIN_REQUIRED" ? 403 : 409, headers })
  }
}
