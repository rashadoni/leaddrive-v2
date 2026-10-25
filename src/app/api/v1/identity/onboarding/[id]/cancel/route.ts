import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { requireIdentityAdministrator } from "@/lib/identity/administrator-request"
import { IdentityRegistryError } from "@/lib/identity/contract"
import { cancelIdentityOnboardingIntent } from "@/lib/identity/onboarding"
const input = z.object({ requestId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/) }).strict()
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" }
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const administrator = await requireIdentityAdministrator(req)
  if (administrator instanceof NextResponse) return administrator
  const body = await readJsonRequestWithinLimit(req, 1024), parsed = body.ok ? input.safeParse(body.value) : null
  if (!parsed?.success) return NextResponse.json({ error: "IDENTITY_ONBOARDING_INPUT_INVALID" }, { status: body.ok || body.reason !== "too_large" ? 400 : 413, headers })
  try {
    const { id } = await context.params
    const data = await runWithTenant(administrator.organizationId, () => cancelIdentityOnboardingIntent(prisma, administrator, id, parsed.data.requestId))
    return NextResponse.json({ success: true, data }, { headers })
  } catch (error) {
    const known = error instanceof IdentityRegistryError
    return NextResponse.json({ error: known ? error.code : "IDENTITY_ONBOARDING_FAILED" }, { status: known ? error.code === "IDENTITY_ADMIN_REQUIRED" ? 403 : 409 : 500, headers })
  }
}
