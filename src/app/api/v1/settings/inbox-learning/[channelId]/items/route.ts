import { NextResponse } from "next/server"
import { isAdmin } from "@/lib/constants"
import { logAudit } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { createItem } from "@/lib/inbox/learning/service"

type Ctx = { params: Promise<{ channelId: string }> }

/** «Добавить знание»: a person's own row, used by the AI at once. */
export const POST = withRlsSessionAuth<Ctx>(async (req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { channelId } = await params
  const body = await readJsonRequestWithinLimit(req, 16 * 1024)
  if (!body.ok) return NextResponse.json({ error: "Invalid request" }, { status: body.reason === "too_large" ? 413 : 400 })
  const input = (body.value && typeof body.value === "object" ? body.value : {}) as Record<string, unknown>
  const result = await createItem({ organizationId: auth.orgId, channelConfigId: channelId, userId: auth.userId ?? null, type: input.type, title: input.title, body: input.body })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  await logAudit(auth.orgId, "inbox_learning_item_created", "inboxLearnedItem", result.item.id, result.item.title, {
    userId: auth.userId, newValue: { channelConfigId: channelId, type: result.item.type },
  }).catch(() => {})
  return NextResponse.json({ data: { item: result.item } }, { status: 201 })
})
