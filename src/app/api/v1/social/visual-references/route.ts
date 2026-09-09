import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { createVisualReference, listVisualReferences } from "@/lib/social/media-observations"
import { visualReferenceSchema } from "@/lib/social/media-schema"

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  return NextResponse.json({ success: true, data: await listVisualReferences(auth.orgId) })
})

export const POST = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  const parsed = visualReferenceSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid visual reference" }, { status: 400 })
  try {
    const reference = await createVisualReference(auth.orgId, auth.userId, parsed.data)
    logAudit(auth.orgId, "create", "social_visual_reference", reference.id, reference.label)
    return NextResponse.json({ success: true, data: reference }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create visual reference" }, { status: 400 })
  }
})
