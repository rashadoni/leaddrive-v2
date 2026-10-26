import { NextResponse, type NextRequest } from "next/server"

import { buildXlsxWorkbook, contentDispositionAttachment } from "@/lib/export/tabular"
import { getPhoneOrder, PhoneOrderError, phoneOrderSheet, phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { withRlsAuth } from "@/lib/with-rls"

type Context = { params: Promise<{ id: string }> }

/** The order's lines as .xlsx for entering into 1C. */
export const GET = withRlsAuth("deals", "read", async (_req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  try {
    const order = await getPhoneOrder(auth.orgId, (await params).id)
    const buffer = await buildXlsxWorkbook([phoneOrderSheet(order)]).xlsx.writeBuffer()
    return new NextResponse(buffer, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionAttachment(`${order.label}.xlsx`),
    } })
  } catch (error) {
    if (error instanceof PhoneOrderError) return NextResponse.json({ error: error.code }, { status: error.status })
    throw error
  }
})
