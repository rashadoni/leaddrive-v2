/**
 * CLM Slice 7b — Contracts Repository XLSX Export.
 *
 * GET /api/v1/contracts/export
 *
 * Auth: requireAuth(contracts, "read") + org-scoped.
 * Accepts the SAME filters as GET /api/v1/contracts (the repository list):
 *   search, status, type, tagIds (comma-separated), hasDeviations,
 *   valueMin, valueMax, startFrom, startTo, endFrom, endTo
 *
 * Row cap: 10 000 rows to avoid memory blowup.
 *
 * Money: valueAmount is retrieved from DB as Prisma.Decimal and converted
 * via decimalToNumber() to a JS number for XLSX rendering — NOT summed into
 * a running float total. The cell renders the plain number so spreadsheet
 * software can format it.
 *
 * Columns per row:
 *   Contract Number, Title, Company, Type, Status,
 *   Value, Currency, Start Date, End Date, Tags
 */
import { NextResponse } from "next/server"
import ExcelJS from "exceljs"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRlsAuth } from "@/lib/with-rls"
import { isContractStatus } from "@/lib/contract-lifecycle/state-machine"

const EXPORT_ROW_CAP = 10_000

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  return isNaN(d.getTime()) ? undefined : d
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return ""
  return d.toISOString().slice(0, 10)
}

export const GET = withRlsAuth("contracts", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)

  const search = searchParams.get("search") || ""
  const status = searchParams.get("status") || undefined
  const type = searchParams.get("type") || undefined

  if (status && !isContractStatus(status)) {
    return NextResponse.json(
      { error: `Invalid contract status: "${status}"`, code: "INVALID_CONTRACT_STATUS" },
      { status: 400 },
    )
  }

  const tagIdsRaw = searchParams.get("tagIds")
  const tagIds = tagIdsRaw ? tagIdsRaw.split(",").filter(Boolean) : []

  const hasDeviationsRaw = searchParams.get("hasDeviations")
  const hasDeviations = hasDeviationsRaw === "true"

  const valueMinRaw = searchParams.get("valueMin")
  const valueMaxRaw = searchParams.get("valueMax")
  const valueMin =
    valueMinRaw && !isNaN(Number(valueMinRaw)) ? Number(valueMinRaw) : undefined
  const valueMax =
    valueMaxRaw && !isNaN(Number(valueMaxRaw)) ? Number(valueMaxRaw) : undefined

  const startFrom = parseDate(searchParams.get("startFrom"))
  const startTo = parseDate(searchParams.get("startTo"))
  const endFrom = parseDate(searchParams.get("endFrom"))
  const endTo = parseDate(searchParams.get("endTo"))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    organizationId: orgId,
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { contractNumber: { contains: search, mode: "insensitive" } },
            { notes: { contains: search, mode: "insensitive" } },
            { renderedBody: { contains: search, mode: "insensitive" } },
            { company: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(tagIds.length > 0
      ? { tags: { some: { id: { in: tagIds }, organizationId: orgId } } }
      : {}),
    ...(hasDeviations
      ? { deviationFlags: { some: { status: "flagged", organizationId: orgId } } }
      : {}),
    ...(valueMin !== undefined || valueMax !== undefined
      ? {
          valueAmount: {
            ...(valueMin !== undefined ? { gte: valueMin } : {}),
            ...(valueMax !== undefined ? { lte: valueMax } : {}),
          },
        }
      : {}),
    ...(startFrom !== undefined || startTo !== undefined
      ? {
          startDate: {
            ...(startFrom ? { gte: startFrom } : {}),
            ...(startTo ? { lte: startTo } : {}),
          },
        }
      : {}),
    ...(endFrom !== undefined || endTo !== undefined
      ? {
          endDate: {
            ...(endFrom ? { gte: endFrom } : {}),
            ...(endTo ? { lte: endTo } : {}),
          },
        }
      : {}),
  }

  try {
    const contracts = await prisma.contract.findMany({
      where,
      take: EXPORT_ROW_CAP,
      orderBy: { createdAt: "desc" },
      include: {
        company: { select: { name: true } },
        tags: {
          where: { organizationId: orgId },
          select: { name: true },
        },
      },
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = "LeadDrive CLM"
    wb.created = new Date()

    const ws = wb.addWorksheet("Contracts")
    ws.columns = [
      { header: "Contract Number", key: "contractNumber", width: 20 },
      { header: "Title", key: "title", width: 36 },
      { header: "Company", key: "company", width: 28 },
      { header: "Type", key: "type", width: 20 },
      { header: "Status", key: "status", width: 18 },
      { header: "Value", key: "value", width: 16 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Start Date", key: "startDate", width: 14 },
      { header: "End Date", key: "endDate", width: 14 },
      { header: "Tags", key: "tags", width: 28 },
    ]
    ws.getRow(1).font = { bold: true }

    for (const c of contracts) {
      // valueAmount: Decimal | null — convert via decimalToNumber at boundary
      const value = c.valueAmount != null ? decimalToNumber(c.valueAmount) : ""
      ws.addRow({
        contractNumber: c.contractNumber,
        title: c.title,
        company: c.company?.name ?? "",
        type: c.type ?? "",
        status: c.status,
        value,
        currency: c.currency ?? "",
        startDate: fmtDate(c.startDate),
        endDate: fmtDate(c.endDate),
        tags: c.tags.map((t: { name: string }) => t.name).join(", "),
      })
    }

    // Note row if row cap was hit
    if (contracts.length === EXPORT_ROW_CAP) {
      const noteRow = ws.addRow({
        contractNumber: `[Export capped at ${EXPORT_ROW_CAP} rows — refine filters]`,
        title: "", company: "", type: "", status: "",
        value: "", currency: "", startDate: "", endDate: "", tags: "",
      })
      noteRow.font = { italic: true, color: { argb: "FF888888" } }
    }

    const buffer = await wb.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="contracts-export.xlsx"`,
      },
    })
  } catch (err) {
    console.error("[contracts/export] GET error:", err)
    return NextResponse.json(
      { error: "Failed to generate contracts export" },
      { status: 500 },
    )
  }
})
