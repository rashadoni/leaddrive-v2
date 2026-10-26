import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { E_QAIME_DIRECTIONS } from "@/lib/finance/e-qaime"

const knownSchema = z.object({
  ownVoen: z.string().trim().regex(/^\d{10}$/),
  keys: z.array(z.object({
    portalId: z.string().trim().min(1).max(100),
    priorSystem: z.boolean().default(false),
    direction: z.enum(E_QAIME_DIRECTIONS),
  })).min(1).max(500),
})

/**
 * POST — which of the invoices the extension just listed on the portal are
 * already here, with their status and whether their PDF is stored. The
 * extension then opens only the new and the changed ones: every invoice opened
 * on the portal is a request made in the accountant's name.
 *
 * Writes nothing, but answers only those who may import: it exists for them.
 */
export const POST = withRlsAuth("finance", "write", async (req, { orgId }) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = knownSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }
  const { ownVoen, keys } = parsed.data

  type KnownRow = { id: string; portalId: string; priorSystem: boolean; direction: string; status: string; pdfFile: string | null }
  const rows: KnownRow[] = await prisma.eQaimeInvoice.findMany({
    where: { organizationId: orgId, ownVoen, portalId: { in: [...new Set(keys.map((key) => key.portalId))] } },
    select: { id: true, portalId: true, priorSystem: true, direction: true, status: true, pdfFile: true },
  })
  const wanted = new Set(keys.map((key) => `${key.direction}:${key.priorSystem}:${key.portalId}`))
  return NextResponse.json({
    data: rows
      .filter((row) => wanted.has(`${row.direction}:${row.priorSystem}:${row.portalId}`))
      .map((row) => ({
        id: row.id,
        portalId: row.portalId,
        priorSystem: row.priorSystem,
        direction: row.direction,
        status: row.status,
        hasPdf: Boolean(row.pdfFile),
      })),
  })
})
