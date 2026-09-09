import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { AdvisorDomainKey, AdvisorSignal } from "./types"

export const ADVISOR_SIGNAL_SNAPSHOT_LIMIT = 120

export type AdvisorSignalSnapshotSummary = {
  snapshotKey: string
  snapshotAt: string
  totalSignals: number
  criticalCount: number
  highCount: number
  moneyAtRisk: number
  signalIds: string[]
  domainCounts: Record<string, number>
  ownerCounts: Record<string, number>
  signals: AdvisorSignal[]
}

function incrementCounter(map: Record<string, number>, key: string | null | undefined) {
  const normalized = key?.trim() || "unassigned"
  map[normalized] = (map[normalized] || 0) + 1
}

export function advisorSnapshotKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function buildAdvisorSignalSnapshotSummary(signals: AdvisorSignal[], now: Date): AdvisorSignalSnapshotSummary {
  const domainCounts: Record<AdvisorDomainKey | string, number> = {}
  const ownerCounts: Record<string, number> = {}
  const limitedSignals = signals.slice(0, ADVISOR_SIGNAL_SNAPSHOT_LIMIT)

  for (const signal of signals) {
    incrementCounter(domainCounts, signal.domain)
    incrementCounter(ownerCounts, signal.ownerLabel || signal.ownerId)
  }

  return {
    snapshotKey: advisorSnapshotKey(now),
    snapshotAt: now.toISOString(),
    totalSignals: signals.length,
    criticalCount: signals.filter((signal) => signal.severity === "critical").length,
    highCount: signals.filter((signal) => signal.severity === "high").length,
    moneyAtRisk: signals.reduce((sum, signal) => sum + (signal.amount || (signal.metric?.kind === "money" ? signal.metric.value : 0)), 0),
    signalIds: signals.map((signal) => signal.id),
    domainCounts,
    ownerCounts,
    signals: limitedSignals,
  }
}

export async function persistAdvisorSignalSnapshot(organizationId: string, signals: AdvisorSignal[], now: Date) {
  const summary = buildAdvisorSignalSnapshotSummary(signals, now)
  const jsonSignals = summary.signals as unknown as Prisma.InputJsonValue
  const domainCounts = summary.domainCounts as Prisma.InputJsonValue
  const ownerCounts = summary.ownerCounts as Prisma.InputJsonValue
  const overview = {
    totalSignals: summary.totalSignals,
    criticalCount: summary.criticalCount,
    highCount: summary.highCount,
    moneyAtRisk: summary.moneyAtRisk,
  } satisfies Prisma.InputJsonObject

  return prisma.advisorSignalSnapshot.upsert({
    where: {
      organizationId_snapshotKey: {
        organizationId,
        snapshotKey: summary.snapshotKey,
      },
    },
    create: {
      organizationId,
      snapshotKey: summary.snapshotKey,
      snapshotAt: now,
      totalSignals: summary.totalSignals,
      criticalCount: summary.criticalCount,
      highCount: summary.highCount,
      moneyAtRisk: summary.moneyAtRisk,
      signalIds: summary.signalIds,
      domainCounts,
      ownerCounts,
      overview,
      signals: jsonSignals,
    },
    update: {
      snapshotAt: now,
      totalSignals: summary.totalSignals,
      criticalCount: summary.criticalCount,
      highCount: summary.highCount,
      moneyAtRisk: summary.moneyAtRisk,
      signalIds: summary.signalIds,
      domainCounts,
      ownerCounts,
      overview,
      signals: jsonSignals,
    },
  })
}

export async function getPreviousAdvisorSignalSnapshot(organizationId: string, now: Date) {
  return prisma.advisorSignalSnapshot.findFirst({
    where: {
      organizationId,
      snapshotKey: { lt: advisorSnapshotKey(now) },
    },
    orderBy: { snapshotKey: "desc" },
  })
}
