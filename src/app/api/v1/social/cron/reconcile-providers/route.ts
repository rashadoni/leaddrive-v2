import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import {
  importApifyProviderRun,
  processApifyDatasetDeletion,
  reconcileApifyProviderRuns,
} from "@/lib/social/apify-async-adapter"
import { reconcileBrightDataProviderRuns } from "@/lib/social/bright-data-reconcile"

export async function POST(request: NextRequest) {
  const authError = requireCronAuth(request)
  if (authError) return authError
  const body = await request.json().catch(() => null) as {
    organizationId?: unknown
    ids?: unknown
  } | null
  if (body?.ids !== undefined || body?.organizationId !== undefined) {
    const organizationId = typeof body.organizationId === "string"
      ? body.organizationId.trim()
      : ""
    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids
          .filter((id): id is string => typeof id === "string")
          .map(id => id.trim())
          .filter(Boolean)))
      : []
    if (
      !organizationId
      || organizationId.length > 160
      || ids.length === 0
      || ids.length > 50
      || ids.some(id => id.length > 160 || !/^[A-Za-z0-9_-]+$/.test(id))
    ) {
      return NextResponse.json({ error: "invalid_reconcile_scope" }, { status: 400 })
    }
    const data = await runWithRlsBypass(async () => {
      const runs = await prisma.socialProviderRun.findMany({
        where: {
          organizationId,
          id: { in: ids },
          status: { in: ["RUNNING", "SUCCEEDED", "IMPORTING"] },
        },
        select: { id: true, providerKey: true },
      })
      const apify = []
      for (const run of runs.filter((item: { id: string; providerKey: string }) => item.providerKey === "APIFY")) {
        apify.push({ id: run.id, ...(await importApifyProviderRun(run.id)) })
      }
      const brightDataIds = runs
        .filter((item: { id: string; providerKey: string }) => item.providerKey === "bright-data")
        .map((item: { id: string; providerKey: string }) => item.id)
      const brightData = brightDataIds.length > 0
        ? await reconcileBrightDataProviderRuns(
            brightDataIds.length,
            undefined,
            { organizationId, ids: brightDataIds },
          )
        : []
      return { apify, brightData }
    })
    const success = !data.apify.some(run => ["FAILED", "BLOCKED"].includes(run.status))
      && !data.brightData.some(run => run.status === "ERROR")
    return NextResponse.json({ success, data }, { status: success ? 200 : 207 })
  }
  const data = await runWithRlsBypass(async () => {
    const [runs, deletion, brightData] = await Promise.all([
      reconcileApifyProviderRuns(),
      processApifyDatasetDeletion(),
      reconcileBrightDataProviderRuns(),
    ])
    return { runs, deletion, brightData }
  })
  const success = data.deletion.failed === 0 && !data.brightData.some(run => run.status === "ERROR")
  return NextResponse.json({ success, data }, { status: success ? 200 : 207 })
}
