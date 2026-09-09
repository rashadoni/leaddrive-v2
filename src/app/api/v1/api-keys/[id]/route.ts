import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/constants"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const MAX_API_KEY_PATCH_BODY_SIZE = 8 * 1024
const patchApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0)

async function requireApiKeyAdministrator(auth: { orgId: string; role: string }) {
  if (!isAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (auth.role !== "superadmin" && !(await orgHasModule(auth.orgId, "crm"))) {
    return moduleDisabledResponse("crm")
  }
  return null
}

// DELETE /api/v1/api-keys/:id — revoke key
export const DELETE = withRlsSessionAuth(async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const denial = await requireApiKeyAdministrator(auth)
  if (denial) return denial

  const { id } = await params

  const key = await prisma.apiKey.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true },
  })
  if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.apiKey.update({
      where: { id },
      data: { isActive: false },
    })
    await tx.webhook.updateMany({
      where: {
        organizationId: auth.orgId,
        createdByApiKeyId: id,
      },
      data: { isActive: false },
    })
  })

  return NextResponse.json({ success: true })
})

// PATCH /api/v1/api-keys/:id — update key (rename, toggle active)
export const PATCH = withRlsSessionAuth(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const denial = await requireApiKeyAdministrator(auth)
  if (denial) return denial

  const { id } = await params
  const requestBody = await readJsonRequestWithinLimit(req, MAX_API_KEY_PATCH_BODY_SIZE)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid request" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = patchApiKeySchema.safeParse(requestBody.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const body = parsed.data

  const key = await prisma.apiKey.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true },
  })
  if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 })

  const data: { name?: string; isActive?: boolean } = {}
  if (body.name !== undefined) data.name = body.name
  if (body.isActive !== undefined) data.isActive = body.isActive

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.apiKey.update({
      where: { id },
      data,
      select: { id: true, name: true, isActive: true },
    })
    if (body.isActive === false) {
      await tx.webhook.updateMany({
        where: {
          organizationId: auth.orgId,
          createdByApiKeyId: id,
        },
        data: { isActive: false },
      })
    }
    return result
  })

  return NextResponse.json({
    success: true,
    data: {
      id: updated.id,
      name: updated.name,
      isActive: updated.isActive,
    },
  })
})
