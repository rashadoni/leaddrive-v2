import { NextResponse } from "next/server"
import { z } from "zod"
import { isAdmin } from "@/lib/constants"
import { logAudit } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { changeItem, type ItemChange } from "@/lib/inbox/learning/service"

type Ctx = { params: Promise<{ channelId: string; itemId: string }> }

const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), title: z.string().max(400).optional(), body: z.string().max(4000).optional(), type: z.string().max(40).optional() }).strict(),
  z.object({ action: z.literal("approve") }).strict(),
  z.object({ action: z.literal("choose"), index: z.number().int().min(0).max(50) }).strict(),
  z.object({ action: z.literal("restore") }).strict(),
])

/** Edit, «Подтвердить» a price, pick the right one of two, or «Вернуть» a removed row. */
export const PATCH = withRlsSessionAuth<Ctx>(async (req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { channelId, itemId } = await params
  const body = await readJsonRequestWithinLimit(req, 16 * 1024)
  if (!body.ok) return NextResponse.json({ error: "Invalid request" }, { status: body.reason === "too_large" ? 413 : 400 })
  const parsed = changeSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  return apply(auth, channelId, itemId, parsed.data as ItemChange)
})

/** «Удалить»: the AI stops using it, and learning will not bring it back. */
export const DELETE = withRlsSessionAuth<Ctx>(async (_req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { channelId, itemId } = await params
  return apply(auth, channelId, itemId, { action: "remove" })
})

async function apply(auth: { orgId: string; userId?: string | null }, channelId: string, itemId: string, change: ItemChange) {
  const result = await changeItem({ organizationId: auth.orgId, channelConfigId: channelId, itemId, userId: auth.userId ?? null, change })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  await logAudit(auth.orgId, `inbox_learning_item_${change.action}`, "inboxLearnedItem", itemId, result.item.title, {
    userId: auth.userId ?? undefined, newValue: { status: result.item.status, type: result.item.type },
  }).catch(() => {})
  return NextResponse.json({ data: { item: result.item } })
}
