import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { generateQuotePdf } from "@/lib/cpq/quote-pdf"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * S6 CPQ slice-3 piece-2 — Quote PDF download.
 *
 * `GET /api/v1/quotes/[id]/pdf` — returns a branded PDF of the quote
 * suitable for emailing to a customer. Cross-tenant guard via the
 * standard `findFirst({where:{id, organizationId}})` pattern; rejection
 * reason is NOT decrypted or included even when present (audit-only
 * field, bound-AAD encrypted, never goes to a buyer).
 *
 * Query params:
 *   ?download=1 → forces `Content-Disposition: attachment` so the
 *                browser saves the file; default is `inline` so
 *                clicking the link opens the PDF in a new tab.
 */
export const GET = withRlsAuth("offers", "read", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  // Scope `offers` (NOT the unmapped `quotes`): roles carry `offers` read/write
  // (manager/sales), and `offers` → `sales` in LEGACY_MODULE_MAP, matching the
  // quotes list/detail routes' `orgHasModule("sales")` + ROUTE_MODULE_MAP
  // /api/v1/quotes → offers. `quotes` is not in MODULES, so it would deny those
  // roles at checkPermission before the module bridge runs.
  const orgId = auth.orgId
  const { id } = await params

  try {
    const [quote, organization] = await Promise.all([
      prisma.quote.findFirst({
        where: { id, organizationId: orgId },
        include: {
          lineItems: { orderBy: { sortOrder: "asc" } },
          deal: {
            select: {
              name: true,
              company: { select: { name: true } },
            },
          },
        },
      }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true, logo: true, branding: true },
      }),
    ])

    if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!organization) return NextResponse.json({ error: "Org not found" }, { status: 500 })

    const pdf = generateQuotePdf({ quote, organization })

    const { searchParams } = new URL(req.url)
    const disposition = searchParams.get("download") === "1" ? "attachment" : "inline"
    // Sanitize quoteNumber for Content-Disposition: defangs both header
    // injection (CRLF) and quote-character smuggling. Schema allows
    // arbitrary printable chars up to 50 chars per slice-1 — the header
    // value must be a token-safe slug.
    const safeNumber = quote.quoteNumber.replace(/[^\w.\-]/g, "_").slice(0, 50)
    const filename = `${safeNumber}${quote.version > 1 ? `-v${quote.version}` : ""}.pdf`

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        // Quotes are sensitive sales data — do not let a CDN cache them.
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Quote PDF render failed:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
