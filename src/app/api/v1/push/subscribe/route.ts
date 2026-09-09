import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { runWithRlsBypass } from "@/lib/rls-context"
import { checkPermission } from "@/lib/permissions"
import { moduleDisabledResponse, orgHasModule } from "@/lib/api-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

const schema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => {
    try {
      return new URL(value).protocol === "https:"
    } catch {
      return false
    }
  }, { message: "Push endpoint must use HTTPS" }),
  keys: z.object({
    p256dh: z.string().min(1).max(1024),
    auth: z.string().min(1).max(1024),
  }).strict(),
}).strict()

async function authorizePushSubscription(auth: { orgId: string; role: string }): Promise<Response | null> {
  if (!checkPermission(auth.role as any, "inbox", "read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (auth.role !== "superadmin" && !(await orgHasModule(auth.orgId, "omnichannel"))) {
    return moduleDisabledResponse("omnichannel")
  }
  return null
}

export const POST = withRlsSessionAuth(async (req, auth) => {
  const denial = await authorizePushSubscription(auth)
  if (denial) return denial

  const body = await readJsonRequestWithinLimit(req, 16 * 1024)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Request body too large" : "Invalid request body" },
      { status: body.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const userAgent = req.headers.get("user-agent") || null

  // `endpoint` is globally unique and identifies one physical browser. An upsert
  // keyed on it is unsafe under RLS: if the same browser was previously
  // registered under a DIFFERENT org/user (agent switched accounts), the
  // ON-CONFLICT-UPDATE branch must touch a row the tenant policy hides. A
  // legitimate browser re-registration proves possession of the complete push
  // subscription (endpoint + both encryption keys), so only that exact record
  // may be transferred. Knowing an endpoint URL alone is not enough to delete
  // another user's subscription.
  await runWithRlsBypass(() =>
    prisma.pushSubscription.deleteMany({
      where: {
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
    })
  )

  let record: { id: string }
  try {
    record = await prisma.pushSubscription.create({
      data: {
        organizationId: auth.orgId,
        userId: auth.userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent,
      },
    })
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Push endpoint is already registered" }, { status: 409 })
    }
    throw error
  }

  return NextResponse.json({ success: true, data: { id: record.id } })
})

export const DELETE = withRlsSessionAuth(async (req, auth) => {
  const denial = await authorizePushSubscription(auth)
  if (denial) return denial

  const { searchParams } = new URL(req.url)
  const endpoint = searchParams.get("endpoint")
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 })

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: auth.userId, organizationId: auth.orgId },
  })
  return NextResponse.json({ success: true })
})
