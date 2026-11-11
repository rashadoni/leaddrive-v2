import { NextRequest, NextResponse } from "next/server"
import type { PrismaClient } from "@prisma/client"

import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { refreshZeytunSalesHistory } from "@/lib/voice-agent/pharmacy/zeytun-sales-history"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * What 1C sold each pharmacy (zeytun-sales-history.ts), for the line's ear and
 * search. Every 15 minutes, two minutes of one-at-a-time requests to 1C at most;
 * nothing without the private Get_Sales connection file. Counts only in the answer.
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
