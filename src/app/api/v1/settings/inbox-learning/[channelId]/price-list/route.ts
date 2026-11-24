import { NextResponse } from "next/server"
import { z } from "zod"
import { isAdmin } from "@/lib/constants"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { LEARNING_CHANNEL_TYPES } from "@/lib/inbox/learning/service"
import { PRICE_LIST_MAX_CHARS, packageBody, parsePriceList } from "@/lib/inbox/learning/price-list"

type Ctx = { params: Promise<{ channelId: string }> }

const schema = z.object({ text: z.string().max(PRICE_LIST_MAX_CHARS) }).strict()

/**
 * «Вставить прайс»: the pasted price list, laid out as packages for a person to check
 * (lib/inbox/learning/price-list). Saves nothing — the screen saves the cards through «Добавить
 * знание». One paid call per press, under the organization's AI budget.
 */
export const POST = withRlsSessionAuth<Ctx>(async (req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { channelId } = await params
  const body = await readJsonRequestWithinLimit(req, 32 * 1024)
  if (!body.ok) return NextResponse.json({ error: "too_long" }, { status: body.reason === "too_large" ? 413 : 400 })
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: "too_long" }, { status: 400 })
  const channel = await prisma.channelConfig.findFirst({
    where: { id: channelId, organizationId: auth.orgId, channelType: { in: [...LEARNING_CHANNEL_TYPES] } },
    select: { id: true },
  })
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  const result = await parsePriceList({ organizationId: auth.orgId, text: parsed.data.text })
  if (!result.ok) {
    const status = result.error === "empty" || result.error === "too_long" || result.error === "nothing_found" ? 400 : result.error === "budget" ? 429 : 502
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ data: { packages: result.packages.map((p) => ({ ...p, body: packageBody(p) })) } })
})
