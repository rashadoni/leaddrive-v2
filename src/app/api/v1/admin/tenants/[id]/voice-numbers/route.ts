import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"

import { logAudit, prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { normalizeLineNumber } from "@/lib/voip/line-numbers"

type Context = { params: Promise<{ id: string }> }

const addSchema = z.strictObject({
  number: z.string().trim().min(5).max(32),
  label: z.string().trim().max(80).optional(),
  channelConfigId: z.string().min(1).max(64).nullable().optional(),
})

/** A client's phone numbers: the operator (superadmin) assigns them, because
 * whoever holds a number receives its calls. */
async function listNumbers(tenantId: string) {
  const [numbers, channels] = await Promise.all([
    prisma.voiceLineNumber.findMany({ where: { organizationId: tenantId }, orderBy: { createdAt: "asc" },
      select: { id: true, e164: true, label: true, channelConfigId: true, createdAt: true } }),
    prisma.channelConfig.findMany({ where: { organizationId: tenantId, channelType: "voip" }, orderBy: { createdAt: "asc" },
      select: { id: true, configName: true, isActive: true } }),
  ])
  return { numbers, channels }
}

export async function GET(req: NextRequest, { params }: Context) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  return runWithRlsBypass(async () => NextResponse.json({ data: await listNumbers(id) }))
}

export async function POST(req: NextRequest, { params }: Context) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const parsed = addSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 })
  const e164 = normalizeLineNumber(parsed.data.number)
  if (!e164) return NextResponse.json({ error: "invalid_number" }, { status: 400 })
  return runWithRlsBypass(async () => {
    const tenant = await prisma.organization.findUnique({ where: { id }, select: { id: true } })
    if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 })
    if (parsed.data.channelConfigId) {
      const channel = await prisma.channelConfig.findFirst({ where: { id: parsed.data.channelConfigId, organizationId: id, channelType: "voip" }, select: { id: true } })
      if (!channel) return NextResponse.json({ error: "invalid_channel" }, { status: 400 })
    }
    try {
      const row = await prisma.voiceLineNumber.create({ data: {
        organizationId: id, e164, label: parsed.data.label || null, channelConfigId: parsed.data.channelConfigId ?? null, createdById: auth.userId,
      }, select: { id: true } })
      await logAudit(id, "voice_line_number_assigned", "voice_line_number", row.id, e164, { userId: auth.userId })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const holder = await prisma.voiceLineNumber.findUnique({ where: { e164 }, select: { organization: { select: { name: true } } } })
        return NextResponse.json({ error: "number_taken", holder: holder?.organization.name ?? null }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json({ data: await listNumbers(id) }, { status: 201 })
  })
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const numberId = req.nextUrl.searchParams.get("numberId") ?? ""
  return runWithRlsBypass(async () => {
    const removed = await prisma.voiceLineNumber.deleteMany({ where: { id: numberId, organizationId: id } })
    if (removed.count !== 1) return NextResponse.json({ error: "not_found" }, { status: 404 })
    await logAudit(id, "voice_line_number_removed", "voice_line_number", numberId, undefined, { userId: auth.userId })
    return NextResponse.json({ data: await listNumbers(id) })
  })
}
