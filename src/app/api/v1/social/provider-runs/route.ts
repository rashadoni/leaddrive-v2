import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { importApifyProviderRun } from "@/lib/social/apify-async-adapter"
import { reconcileBrightDataProviderRuns } from "@/lib/social/bright-data-reconcile"
import { withRlsAuth } from "@/lib/with-rls"

const MAX_PROVIDER_RUN_IDS = 50

function providerRunIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = Array.from(new Set(
    value.filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean),
  ))
  if (
    ids.length === 0
    || ids.length > MAX_PROVIDER_RUN_IDS
    || ids.some(id => id.length > 160 || !/^[A-Za-z0-9_-]+$/.test(id))
  ) {
    return null
  }
  return ids
}

export const GET = withRlsAuth("social", "read", async (request: NextRequest, auth) => {
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 50)
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200))
    : 50
  const status = request.nextUrl.searchParams.get("status")?.trim() || undefined
  const sourceId = request.nextUrl.searchParams.get("sourceId")?.trim() || undefined
  const idsValue = request.nextUrl.searchParams.get("ids")?.trim() || ""
  const ids = Array.from(new Set(
    idsValue.split(",").map(value => value.trim()).filter(Boolean),
  ))
  if (
    idsValue
    && (
      ids.length === 0
      || ids.length > 50
      || ids.some(id => id.length > 160 || !/^[A-Za-z0-9_-]+$/.test(id))
    )
  ) {
    return NextResponse.json({ error: "ids is invalid" }, { status: 400 })
  }
  const runs = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: auth.orgId,
      purgedAt: null,
      ...(status ? { status } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(ids.length > 0
        ? {
            OR: [
              { id: { in: ids } },
              // A manual discovery run can enqueue a separate paid comments
              // actor after its posts are imported. Return that direct child
              // under the same polling request so card progress does not stop
              // at posts while comments are still running.
              { parentRunId: { in: ids } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      sourceId: true,
      collectorRunId: true,
      routePlanId: true,
      parentRunId: true,
      providerKey: true,
      adapterKey: true,
      phase: true,
      actorId: true,
      actorBuild: true,
      schemaVersion: true,
      status: true,
      maxItems: true,
      reservedChargeUsd: true,
      actualChargeUsd: true,
      receivedCount: true,
      acceptedCount: true,
      reviewCount: true,
      rejectedCount: true,
      duplicateCount: true,
      lastError: true,
      startedAt: true,
      finishedAt: true,
      importedAt: true,
      purgeAt: true,
      purgedAt: true,
      createdAt: true,
      source: { select: { platform: true, sourceType: true, ownership: true } },
      routePlan: { select: { capability: true, contentScope: true, acquisitionMode: true, status: true } },
    },
  })
  // Провайдерские затраты — внутренняя операционка платформы: тенантным ролям
  // (включая org-admin клиента) суммы не отдаём, superadmin видит как раньше.
  const payload = auth.role === "superadmin"
    ? runs
    : runs.map((run: (typeof runs)[number]) => ({ ...run, reservedChargeUsd: null, actualChargeUsd: null }))
  return NextResponse.json({ success: true, data: payload })
})

/**
 * Reconcile only provider jobs that the current operator is already polling.
 *
 * This endpoint never dispatches an initial discovery job. It closes the gap
 * left when a provider webhook is delayed or the background scheduler is
 * intentionally disabled, so a manual monitoring run can import its own
 * finished provider result without starting a duplicate paid request.
 */
export const POST = withRlsAuth("social", "write", async (request: NextRequest, auth) => {
  const body = await request.json().catch(() => null) as { ids?: unknown } | null
  const ids = providerRunIds(body?.ids)
  if (!ids) {
    return NextResponse.json({ error: "ids is invalid" }, { status: 400 })
  }

  const runs = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: auth.orgId,
      purgedAt: null,
      OR: [
        { id: { in: ids } },
        { parentRunId: { in: ids } },
      ],
      status: { in: ["RUNNING", "SUCCEEDED", "IMPORTING"] },
    },
    select: { id: true, providerKey: true },
  })
  const apifyIds = runs
    .filter((run: { id: string; providerKey: string }) => run.providerKey === "APIFY")
    .map((run: { id: string; providerKey: string }) => run.id)
  const brightDataIds = runs
    .filter((run: { id: string; providerKey: string }) => run.providerKey === "bright-data")
    .map((run: { id: string; providerKey: string }) => run.id)

  const apify = []
  for (const id of apifyIds) {
    apify.push({ id, ...(await importApifyProviderRun(id)) })
  }
  const brightData = brightDataIds.length > 0
    ? await reconcileBrightDataProviderRuns(
        brightDataIds.length,
        undefined,
        { organizationId: auth.orgId, ids: brightDataIds },
      )
    : []

  return NextResponse.json({
    success: true,
    data: { apify, brightData },
  })
})
