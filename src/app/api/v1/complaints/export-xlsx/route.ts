import { NextResponse } from "next/server"
import ExcelJS from "exceljs"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { EXPORT_HEADERS, complaintToExportRow } from "@/lib/complaints-mapper"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("tickets", "read", async (req, { orgId }) => {
  const searchParams = new URL(req.url).searchParams
  const status = searchParams.get("status") || ""
  const brand = searchParams.get("brand") || ""
  const riskLevel = searchParams.get("riskLevel") || ""
  const productCategory = searchParams.get("productCategory") || ""
  const q = searchParams.get("q") || ""
  const where: Prisma.TicketWhereInput = {
    organizationId: orgId,
    complaintMeta: brand || riskLevel || productCategory
      ? {
          ...(brand ? { brand } : {}),
          ...(riskLevel ? { riskLevel } : {}),
          ...(productCategory ? { productCategory } : {}),
        }
      : { isNot: null },
    ...(status ? { status } : {}),
    ...(q ? { OR: [
      { subject: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ] } : {}),
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      complaintMeta: true,
      comments: { orderBy: { createdAt: "asc" } },
      contact: { select: { fullName: true, phone: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("CRM hesabat")
  ws.addRow([...EXPORT_HEADERS])
  ws.getRow(1).font = { bold: true }

  for (const t of tickets) {
    const m = t.complaintMeta!
    const response = t.comments.find((c: { isInternal: boolean }) => !c.isInternal)?.comment || null
    const row = complaintToExportRow({
      externalRegistryNumber: m.externalRegistryNumber,
      customerName: t.contact?.fullName || null,
      requestDate: t.createdAt,
      source: t.source,
      complaintType: (m.complaintType as "complaint" | "suggestion") || "complaint",
      brand: m.brand,
      productionArea: m.productionArea,
      productCategory: m.productCategory,
      complaintObject: m.complaintObject,
      complaintObjectDetail: m.complaintObjectDetail,
      phone: t.contact?.phone || null,
      content: t.description || "",
      responsibleDepartment: m.responsibleDepartment,
      response,
      status: ((t.status as "open" | "in_progress" | "resolved" | "escalated") || "open"),
      riskLevel: (m.riskLevel as "low" | "medium" | "high" | null) ?? null,
      priority: ((t.priority as "low" | "medium" | "high" | "urgent") || "medium"),
    })
    ws.addRow(row)
  }

  ws.columns?.forEach((col) => {
    col.width = 22
  })

  const buffer = await wb.xlsx.writeBuffer()
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="CRM-hesabat-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
})
