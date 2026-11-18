import { NextRequest, NextResponse } from "next/server"
import type { PrismaClient } from "@prisma/client"

import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { refreshZeytunSalesHistory } from "@/lib/voice-agent/pharmacy/zeytun-sales-history"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * What 1C sold each pharmacy (zeytun-sales-history.ts), for the line's ear and
 * search. Every 15 minutes; reads only 22:00-07:00 Baku, one request every two
 * seconds, at most 12 minutes a tick, and stands down until the next night when
 * 1C is slow or refuses. Nothing without the private Get_Sales connection file.
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const result = await refreshZeytunSalesHistory({ db: prisma as unknown as PrismaClient }).catch((error: unknown) => {
    console.error("[zeytun-sales-history] failed:", error instanceof Error ? error.name : typeof error)
    return { outcome: "failed" as const }
  })
  return NextResponse.json(result, { status: result.outcome === "failed" ? 502 : 200 })
}
