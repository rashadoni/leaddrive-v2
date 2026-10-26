import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/lib/cron-auth"
import { loadZeytunPharmacyCompanies } from "@/lib/pharmacy-orders/pharmacy-companies-load"
import { warmZeytunLine } from "@/lib/voice-agent/pharmacy/zeytun-line-host"
import { refreshZeytunLineCatalog, refreshZeytunPharmacies } from "@/lib/voice-agent/pharmacy/zeytun-catalog-refresh"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Keeps Zeytun's phone-line catalog under a day old, its pharmacy
 * directory current, and the directory loaded into its companies (see the
 * libraries' notes). */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const failed = (error: unknown) => {
    void error
    // A malformed connection file: say so without echoing any of it.
    return { outcome: "failed" as const, error: "invalid_configuration" }
  }
  const catalog = await refreshZeytunLineCatalog().catch(failed)
  const pharmacies = await refreshZeytunPharmacies().catch(failed)
  const companies = await loadZeytunPharmacyCompanies().catch((error: unknown) => {
    // The kind of failure only: a database error can quote a pharmacy's row.
    console.error("[zeytun-pharmacy-companies] load failed:", error instanceof Error ? error.name : typeof error,
      (error as { code?: unknown })?.code ?? "")
    return { outcome: "failed" as const, error: "load_failed" }
  })
  // A catalog the tick just downloaded is parsed here, not inside a call.
  const line = await warmZeytunLine().catch(() => ({ outcome: "failed" as const }))
  return NextResponse.json({ ...catalog, pharmacies, companies, line },
    { status: [catalog, pharmacies, companies].some(step => step.outcome === "failed") ? 502 : 200 })
}
