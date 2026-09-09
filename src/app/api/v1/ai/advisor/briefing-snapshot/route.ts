import { NextResponse } from "next/server"
import { isManagerOrAbove } from "@/lib/constants"
import { withRlsAuth } from "@/lib/with-rls"
import { getPreviousAdvisorSignalSnapshot } from "@/lib/ai/advisor/snapshots"
import type { AdvisorSignal } from "@/lib/ai/advisor/types"

function parseSnapshotSignals(value: unknown): AdvisorSignal[] {
  return Array.isArray(value) ? value as AdvisorSignal[] : []
}

export const GET = withRlsAuth("ai", "read", async (_req, auth) => {
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ data: null })
  }

  const snapshot = await getPreviousAdvisorSignalSnapshot(auth.orgId, new Date())
  if (!snapshot) {
    return NextResponse.json({ data: null })
  }

  return NextResponse.json({
    data: {
      id: snapshot.id,
      snapshotKey: snapshot.snapshotKey,
      snapshotAt: snapshot.snapshotAt,
      totalSignals: snapshot.totalSignals,
      criticalCount: snapshot.criticalCount,
      highCount: snapshot.highCount,
      moneyAtRisk: snapshot.moneyAtRisk,
      signalIds: snapshot.signalIds,
      domainCounts: snapshot.domainCounts,
      ownerCounts: snapshot.ownerCounts,
      signals: parseSnapshotSignals(snapshot.signals),
    },
  })
})
