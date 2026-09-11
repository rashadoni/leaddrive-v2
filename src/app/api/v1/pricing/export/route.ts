import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { generateTemplate1, generateTemplate2, generateBudgetPL } from "@/lib/pricing-export"
import type { PricingAdjustments } from "@/lib/pricing"
import { prisma } from "@/lib/prisma"
import fs from "fs"
import path from "path"
import { resolveRuntimePaths } from "@/lib/runtime-paths"

/*
 * Справочник юрлиц клиентов для выгрузки цен — это данные тенанта, а не код.
 * До 2026-09-11 он лежал в `public/data/company_legal_names.json`, то есть в
 * публичном репозитории: названия юрлиц реальных клиентов видел любой, кто
 * открывал GitHub. Теперь файл живёт в runtime-каталоге прода
 * (`$LEADDRIVE_RUNTIME_DIR/state/pricing/`), который переживает выкатки и в
 * артефакт не попадает.
 *
 * Названия компаний в базе для этого не годятся: там короткие имена
 * («Garabaghotel»), а в отчёте нужно юрлицо («YENİ GƏNCƏ HOTEL COMPANY MMC»).
 * Если файла нет — как и раньше, генератор подставит «КОД MMC».
 */
function legalNamesFile(): string {
  return path.join(resolveRuntimePaths().runtimeRoot, "state", "pricing", "company_legal_names.json")
}

function loadLegalNames(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(legalNamesFile(), "utf-8"))
  } catch (err) {
    // Отсутствие файла — штатный случай (любой тенант, кроме одного, и любая
    // локальная сборка), им логи не засоряем. Всё остальное — сломанный JSON
    // или права — стоит увидеть.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") console.error(err)
    return {}
  }
}

async function loadPricingDataFromDB(orgId: string) {
  const profiles = await prisma.pricingProfile.findMany({
    where: { organizationId: orgId },
    include: {
      group: true,
      categories: {
        where: { organizationId: orgId },
        include: {
          category: true,
          services: { where: { organizationId: orgId }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
    orderBy: [{ group: { sortOrder: "asc" } }, { companyCode: "asc" }],
  })

  const data: Record<string, any> = {}
  for (const profile of profiles) {
    const categories: Record<string, any> = {}
    for (const pc of profile.categories) {
      categories[pc.category.name] = {
        total: pc.total,
        services: pc.services.map((s: any) => ({
          name: s.name, qty: s.qty, price: s.price, total: s.total, unit: s.unit,
        })),
      }
    }
    data[profile.companyCode] = {
      group: profile.group.name,
      categories,
      monthly: profile.monthlyTotal,
      annual: profile.annualTotal,
      monthly_total: profile.monthlyTotal,
    }
  }
  return data
}

export const POST = withRls(async (req, { orgId }) => {
  try {
    const body = await req.json()
    const template = body.template || "1"
    const adjustments: PricingAdjustments | null = body.adjustments || null
    const effectiveDate: string | null = body.effective_date || null
    const data = await loadPricingDataFromDB(orgId)
    const legal = loadLegalNames()
    let buffer: Buffer; let filename: string
    if (template === "2") { buffer = await generateTemplate2(data, legal, adjustments, effectiveDate); filename = "SALES_Report.xlsx" }
    else if (template === "budget" || template === "3") { buffer = await generateBudgetPL(data, legal, adjustments, effectiveDate); filename = "Budget_PL.xlsx" }
    else { buffer = await generateTemplate1(data, legal, adjustments, effectiveDate); filename = "SALES_2026.xlsx" }
    return new NextResponse(buffer as unknown as BodyInit, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"` } })
  } catch (e) { console.error("Export failed:", e); return NextResponse.json({ error: "Export failed" }, { status: 500 }) }
})
