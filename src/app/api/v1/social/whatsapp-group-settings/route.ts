import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const schema = z.object({
  groupId: z.string().trim().max(200).optional(),
  groupName: z.string().trim().max(200).optional(),
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readGroup(settings: unknown) {
  const root = asRecord(settings)
  const nested = asRecord(root.socialLeadGroup)
  const id = nested.id ?? root.socialLeadGroupId ?? root.whatsappSocialLeadGroupId
  const name = nested.name ?? root.socialLeadGroupName ?? root.whatsappSocialLeadGroupName
  return {
    groupId: typeof id === "string" ? id : "",
    groupName: typeof name === "string" ? name : "",
  }
}

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  const cfg = await prisma.channelConfig.findFirst({
    where: { organizationId: auth.orgId, channelType: "whatsapp", isActive: true },
    select: { id: true, settings: true },
    orderBy: { createdAt: "desc" },
  })

  if (!cfg) {
    return NextResponse.json({
      success: true,
      data: { channelConnected: false, groupId: "", groupName: "" },
    })
  }

  return NextResponse.json({
    success: true,
    data: { channelConnected: true, ...readGroup(cfg.settings) },
  })
})

export const PUT = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const cfg = await prisma.channelConfig.findFirst({
    where: { organizationId: auth.orgId, channelType: "whatsapp", isActive: true },
    select: { id: true, settings: true },
    orderBy: { createdAt: "desc" },
  })
  if (!cfg) {
    return NextResponse.json({ error: "WhatsApp channel is not configured" }, { status: 404 })
  }

  const next = { ...asRecord(cfg.settings) }
  const groupId = parsed.data.groupId?.trim() || ""
  const groupName = parsed.data.groupName?.trim() || ""

  if (groupId) {
    next.socialLeadGroup = { id: groupId, name: groupName || groupId }
  } else {
    delete next.socialLeadGroup
  }
  delete next.socialLeadGroupId
  delete next.socialLeadGroupName
  delete next.whatsappSocialLeadGroupId
  delete next.whatsappSocialLeadGroupName

  await prisma.channelConfig.update({
    where: { id: cfg.id },
    data: { settings: next },
  })

  return NextResponse.json({
    success: true,
    data: { channelConnected: true, ...readGroup(next) },
  })
})
