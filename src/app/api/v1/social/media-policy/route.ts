import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { getOrCreateMediaPolicy, updateMediaPolicy } from "@/lib/social/media-observations"
import { mediaPolicySchema } from "@/lib/social/media-schema"

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  return NextResponse.json({ success: true, data: await getOrCreateMediaPolicy(auth.orgId) })
})

export const PATCH = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  const parsed = mediaPolicySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid media policy" }, { status: 400 })
  const policy = await updateMediaPolicy(auth.orgId, auth.userId, parsed.data)
  logAudit(auth.orgId, "update", "social_media_policy", policy.id, `version:${policy.policyVersion}`)
  return NextResponse.json({ success: true, data: policy })
})
