import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { importApifyProviderRun, verifyApifyWebhookSecret } from "@/lib/social/apify-async-adapter"

export async function POST(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId")?.trim()
  // Keep credentials out of callback URLs: query strings are commonly copied
  // into access logs, traces and referrer telemetry. New Apify webhooks send
  // this value through `headersTemplate`.
  const secret = request.headers.get("x-leaddrive-apify-secret")?.trim()
  if (!runId || !secret) return NextResponse.json({ error: "invalid_webhook" }, { status: 401 })

  const result = await runWithRlsBypass(async () => {
    const run = await prisma.socialProviderRun.findUnique({
      where: { id: runId },
      select: { id: true, organizationId: true, idempotencyKey: true, webhookSecretHash: true, providerKey: true },
    })
    if (!run || run.providerKey !== "APIFY" || !verifyApifyWebhookSecret(run, secret)) return null
    // Apify retries webhooks and may deliver duplicates. Import is idempotent;
    // acknowledge only after the run was authenticated.
    return importApifyProviderRun(run.id)
  })
  if (!result) return NextResponse.json({ error: "invalid_webhook" }, { status: 401 })
  return NextResponse.json({ success: true, data: result })
}
