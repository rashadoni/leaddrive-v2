import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { requireIdentityAdministrator } from "@/lib/identity/administrator-request"
import { lookupIdentityTimePerson } from "@/lib/identity/time-enrollment"
import { IdentityRegistryError } from "@/lib/identity/contract"
const input = z.object({ phone: z.string().min(1).max(40) }).strict()
const headers = { "cache-control": "private, no-store" }
export async function POST(req: NextRequest) {
  const administrator = await requireIdentityAdministrator(req)
  if (administrator instanceof NextResponse) return administrator
  const body = await readJsonRequestWithinLimit(req, 1024), parsed = body.ok ? input.safeParse(body.value) : null
  if (!parsed?.success) return NextResponse.json({ error: "IDENTITY_PHONE_INVALID" }, { status: 400, headers })
  try {
    const data = await runWithTenant(administrator.organizationId, () => lookupIdentityTimePerson(prisma, administrator, parsed.data.phone))
    return NextResponse.json({ success: true, data }, { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof IdentityRegistryError ? error.code : "IDENTITY_LOOKUP_FAILED" }, { status: error instanceof IdentityRegistryError ? error.code === "IDENTITY_ADMIN_REQUIRED" ? 403 : 409 : 500, headers })
  }
}
