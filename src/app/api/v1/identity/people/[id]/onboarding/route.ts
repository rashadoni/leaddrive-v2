import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { requireIdentityAdministrator } from "@/lib/identity/administrator-request"
import { IdentityRegistryError } from "@/lib/identity/contract"
import { IdentityOnboardingInput } from "@/lib/identity/onboarding-contract"
import { createIdentityOnboardingIntent } from "@/lib/identity/onboarding"
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" }
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const administrator = await requireIdentityAdministrator(req)
  if (administrator instanceof NextResponse) return administrator
  if (administrator.mode !== "CANONICAL") return NextResponse.json({ error: "IDENTITY_CANONICAL_ADMIN_CONTEXT_REQUIRED" }, { status: 409, headers })
  const body = await readJsonRequestWithinLimit(req, 4096)
  if (!body.ok) return NextResponse.json({ error: "IDENTITY_ONBOARDING_INPUT_INVALID" }, { status: body.reason === "too_large" ? 413 : 400, headers })
  const { id } = await context.params
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value) || Object.hasOwn(body.value, "userId")) {
    return NextResponse.json({ error: "IDENTITY_ONBOARDING_INPUT_INVALID" }, { status: 400, headers })
  }
  const parsed = IdentityOnboardingInput.safeParse({ ...body.value, userId: id })
  if (!parsed.success) return NextResponse.json({ error: "IDENTITY_ONBOARDING_INPUT_INVALID" }, { status: 400, headers })
  try {
    const data = await runWithTenant(administrator.organizationId, () => createIdentityOnboardingIntent(prisma, administrator, parsed.data))
    return NextResponse.json({ success: true, data }, { status: 201, headers })
  } catch (error) {
    const known = error instanceof IdentityRegistryError
    return NextResponse.json({ error: known ? error.code : "IDENTITY_ONBOARDING_FAILED" }, { status: known ? error.code === "IDENTITY_ADMIN_REQUIRED" ? 403 : 409 : 500, headers })
  }
}
