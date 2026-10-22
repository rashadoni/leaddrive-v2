import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const statuses = new Set(["pending", "sending", "accepted", "delivered", "read", "failed", "unknown", "skipped"])
export const GET = withRlsAuth("campaigns", "read", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const query = new URL(req.url).searchParams
  const page = Math.max(1, Math.min(1000, Number(query.get("page")) || 1))
  if (!Number.isInteger(page)) return NextResponse.json({ error: "Invalid page" }, { status: 400 })
  const status = query.get("status")
  if (status && !statuses.has(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  const campaign = await prisma.campaign.findFirst({ where: { id, organizationId: orgId, type: "whatsapp" }, select: { id: true } })
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const where = { organizationId: orgId, campaignId: id, ...(status ? { status } : {}) }
  const [deliveries, total] = await Promise.all([
    prisma.whatsAppCampaignDelivery.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * 50, take: 50,
      select: { id: true, recipientPhone: true, status: true, errorCode: true },
    }),
    prisma.whatsAppCampaignDelivery.count({ where }),
  ])
  return NextResponse.json({ success: true, data: { deliveries, total, page, pageSize: 50 } })
})
