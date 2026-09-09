import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId }) => {

  const q = req.nextUrl.searchParams.get("q")?.trim() || ""
  if (q.length < 2) return NextResponse.json({ success: true, data: [] })

  const contains = q
  const mode = "insensitive" as const

  try {
    const [companies, contacts, deals, leads, tasks] = await Promise.all([
      prisma.company.findMany({
        where: { organizationId: orgId, name: { contains, mode } },
        select: { id: true, name: true, industry: true },
        take: PAGE_SIZE.SEARCH,
      }),
      prisma.contact.findMany({
        where: { organizationId: orgId, fullName: { contains, mode } },
        select: { id: true, fullName: true, company: { select: { name: true } } },
        take: PAGE_SIZE.SEARCH,
      }),
      prisma.deal.findMany({
        where: { organizationId: orgId, name: { contains, mode } },
        select: { id: true, name: true, valueAmount: true, currency: true },
        take: PAGE_SIZE.SEARCH,
      }),
      prisma.lead.findMany({
        where: { organizationId: orgId, OR: [{ contactName: { contains, mode } }, { companyName: { contains, mode } }] },
        select: { id: true, contactName: true, companyName: true },
        take: PAGE_SIZE.SEARCH,
      }),
      prisma.task.findMany({
        where: { organizationId: orgId, title: { contains, mode } },
        select: { id: true, title: true, priority: true },
        take: PAGE_SIZE.SEARCH,
      }),
    ])

    const results = [
      ...companies.map((c: any) => ({ id: c.id, type: "company" as const, name: c.name, subtitle: c.industry || "", href: `/companies/${c.id}` })),
      ...contacts.map((c: any) => ({ id: c.id, type: "contact" as const, name: c.fullName, subtitle: c.company?.name || "", href: `/contacts/${c.id}` })),
      ...deals.map((d: any) => ({ id: d.id, type: "deal" as const, name: d.name, subtitle: `${decimalToNumber(d.valueAmount)} ${d.currency || "₼"}`, href: `/deals/${d.id}` })),
      ...leads.map((l: any) => ({ id: l.id, type: "lead" as const, name: l.contactName, subtitle: l.companyName || "", href: `/leads/${l.id}` })),
      ...tasks.map((t: any) => ({ id: t.id, type: "task" as const, name: t.title, subtitle: t.priority, href: `/tasks/${t.id}` })),
    ]

    return NextResponse.json({ success: true, data: results })
  } catch (err) {
    console.error("Search error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
