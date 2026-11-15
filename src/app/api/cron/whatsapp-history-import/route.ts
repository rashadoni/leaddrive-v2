import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { processAllPendingHistory } from "@/lib/whatsapp-history-import/import"

/**
 * The backstop of the WhatsApp coexistence import (lib/whatsapp-history-import): imports every
 * captured chunk still waiting — one whose after-response run was cut short by a deploy or a crash.
 * Not on a schedule: the webhook imports each chunk right after answering Meta, and the next chunk
 * of the same number picks up anything left before it. Run by hand when a channel shows chunks
 * waiting: `cron-trigger.sh /api/cron/whatsapp-history-import`. Each chunk is taken with one
 * conditional UPDATE, so a run racing the webhook imports nothing twice.
 */
export async function POST(req: NextRequest) {
  const authError = requireCronAuth(req)
  if (authError) return authError
  try {
    const result = await processAllPendingHistory({ budgetMs: 100_000 })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[whatsapp-history-import cron]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
