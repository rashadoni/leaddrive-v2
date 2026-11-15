import { NextResponse } from "next/server"
import { z } from "zod"
import { isAdmin } from "@/lib/constants"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { changeSample } from "@/lib/inbox/learning/service"

type Ctx = { params: Promise<{ channelId: string; sampleId: string }> }

const schema = z.object({ action: z.enum(["accept", "teach"]) }).strict()

/**
 * On «Где ИИ ответил бы иначе»: «Ответ ИИ тоже подходит» (accept) or «Запомнить ответ сотрудника»
 * (teach — the person's answer becomes knowledge; a price in it still waits for «Подтвердить»).
 */
export const PATCH = withRlsSessionAuth<Ctx>(async (req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { channelId, sampleId } = await params
  const body = await readJsonRequestWithinLimit(req, 4 * 1024)
  if (!body.ok) return NextResponse.json({ error: "Invalid request" }, { status: body.reason === "too_large" ? 413 : 400 })
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const result = await changeSample({ organizationId: auth.orgId, channelConfigId: channelId, sampleId, userId: auth.userId ?? null, change: parsed.data })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ data: { item: result.item ?? null } })
})
