import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (req, { orgId, session }) => {
  // Search answers out of two modules at once, so its path belongs to neither
  // and no gate refuses it. A person from whom Sales (or CRM) was hidden must
  // not find its records here instead.
  const hidden = new Set(session?.hiddenModules ?? [])
  const crm = !hidden.has("crm")
  const sales = !hidden.has("sales")

  const q = req.nextUrl.searchParams.get("q")?.trim() || ""
  if (q.length < 2) return NextResponse.json({ success: true, data: [] })

  const contains = q
  const mode = "insensitive" as const

  try {
    const [companies, contacts, deals, leads, tasks] = await Promise.all([
      !crm ? [] : prisma.company.findMany({
        where: { organizationId: orgId, name: { contains, mode } },
        select: { id: true, name: true, industry: true },
        take: PAGE_SIZE.SEARCH,
      }),
      !crm ? [] : prisma.contact.findMany({
        where: { organizationId: orgId, fullName: { contains, mode } },
        select: { id: true, fullName: true, company: { select: { name: true } } },
        take: PAGE_SIZE.SEARCH,
      }),
      !sales ? [] : prisma.deal.findMany({
        where: { organizationId: orgId, name: { contains, mode } },
        select: { id: true, name: true, valueAmount: true, currency: true },
        take: PAGE_SIZE.SEARCH,
      }),
      !sales ? [] : prisma.lead.findMany({
        where: { organizationId: orgId, OR: [{ contactName: { contains, mode } }, { companyName: { contains, mode } }] },
        select: { id: true, contactName: true, companyName: true },
        take: PAGE_SIZE.SEARCH,
      }),
      !crm ? [] : prisma.task.findMany({
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
