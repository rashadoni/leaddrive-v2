import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { getCapabilityInventory } from "@/lib/social/capability-inventory-source"
import { renderCoverageContractMarkdown } from "@/lib/social/capability-inventory"

/**
 * GET /api/v1/social/coverage-contract
 *
 * Отдаёт машиночитаемый capability inventory tenant-а (по умолчанию JSON) или
 * клиентский coverage contract в Markdown (`?format=markdown`). И то, и другое
 * считается из одних и тех же данных (`getCapabilityInventory`) — UI и договорный
 * документ не расходятся. Секреты не возвращаются.
 */
export const GET = withRlsAuth("social", "read", async (request: NextRequest, auth) => {
  const inventory = await getCapabilityInventory(auth.orgId)
  const format = new URL(request.url).searchParams.get("format")

  if (format === "markdown") {
    const markdown = renderCoverageContractMarkdown(inventory.rows, {
      organizationName: inventory.organizationName,
      generatedAt: new Date(inventory.generatedAt),
      version: inventory.version,
    })
    return new NextResponse(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="coverage-contract-${inventory.generatedAt.slice(0, 10)}.md"`,
        "Cache-Control": "no-store",
      },
    })
  }

  return NextResponse.json({ success: true, data: inventory })
})
