import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/lib/cron-auth"
import { refreshZeytunLineCatalog, refreshZeytunPharmacies } from "@/lib/voice-agent/pharmacy/zeytun-catalog-refresh"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Keeps Zeytun's phone-line catalog under a day old and its pharmacy
 * directory current (see the library's notes). */
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
  return NextResponse.json({ ...catalog, pharmacies },
    { status: catalog.outcome === "failed" || pharmacies.outcome === "failed" ? 502 : 200 })
}
