import type { AdvisorSignal } from "./types"

export type AdvisorBriefingItem = {
  key: "critical" | "money" | "routes" | "sla" | "kpi" | "new_critical" | "money_delta" | "route_delta" | "sla_delta" | "kpi_delta"
  label: string
  value: string
  detail: string
  signalId?: string
  tone?: "critical" | "money" | "info" | "healthy"
}

export type AdvisorBriefingOptions = {
  previousSignals?: AdvisorSignal[] | null
}

export type AdvisorBriefingLabels = {
  briefingCritical: string
  briefingMoney: string
  briefingRoutes: string
  briefingSla: string
  briefingKpi: string
  revenueAtRisk: string
}

function formatMoney(value: number, currency = "AZN") {
  return `${value.toLocaleString()} ${currency}`
}

function signalText(signal: AdvisorSignal) {
  return [
    signal.title,
    signal.summary,
    signal.domainLabel,
    signal.ownerLabel,
    signal.metric?.label,
    signal.metric?.formatted,
    ...signal.facts.map((factItem) => `${factItem.label} ${factItem.value}`),
  ].filter(Boolean).join(" ").toLowerCase()
}

function signalTime(signal: AdvisorSignal) {
  const time = new Date(signal.detectedAt).getTime()
  return Number.isFinite(time) ? time : 0
}

function rankSignals(signals: AdvisorSignal[]) {
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 }
  return [...signals].sort((a, b) =>
    severityRank[b.severity] - severityRank[a.severity] ||
    signalTime(b) - signalTime(a) ||
    (b.metric?.value || b.amount || 0) - (a.metric?.value || a.amount || 0)
  )
}

function moneyAtRisk(signals: AdvisorSignal[]) {
  return signals.reduce((sum, signal) => sum + (signal.amount || (signal.metric?.kind === "money" ? signal.metric.value : 0)), 0)
}

function signedMoney(value: number, currency = "AZN") {
  const sign = value > 0 ? "+" : ""
  return `${sign}${formatMoney(value, currency)}`
}

function signedCount(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

function buildAdvisorBriefingDelta(signals: AdvisorSignal[], previousSignals: AdvisorSignal[], labels: AdvisorBriefingLabels): AdvisorBriefingItem[] {
  const previousIds = new Set(previousSignals.map((signal) => signal.id))
  const ranked = rankSignals(signals)
  const newCritical = ranked.filter((signal) => !previousIds.has(signal.id) && (signal.severity === "critical" || signal.severity === "high"))
  const currentMoney = moneyAtRisk(signals)
  const previousMoney = moneyAtRisk(previousSignals)
  const moneyDelta = currentMoney - previousMoney
  const routeDelta = signals.filter((signal) => signal.domain === "routes" || signal.domain === "mtm").length -
    previousSignals.filter((signal) => signal.domain === "routes" || signal.domain === "mtm").length
  const slaDelta = signals.filter((signal) => signal.domain === "support" && signalText(signal).includes("sla")).length -
    previousSignals.filter((signal) => signal.domain === "support" && signalText(signal).includes("sla")).length
  const kpiDelta = signals.filter((signal) => signal.domain === "kpi").length -
    previousSignals.filter((signal) => signal.domain === "kpi").length
  const items: AdvisorBriefingItem[] = []

  if (newCritical.length > 0) {
    items.push({
      key: "new_critical",
      label: labels.briefingCritical,
      value: `+${newCritical.length}`,
      detail: newCritical[0].title,
      signalId: newCritical[0].id,
      tone: "critical",
    })
  }
  if (moneyDelta !== 0) {
    const topMoneySignal = ranked.find((signal) => (signal.amount || 0) > 0 || signal.metric?.kind === "money")
    items.push({
      key: "money_delta",
      label: labels.briefingMoney,
      value: signedMoney(moneyDelta, topMoneySignal?.currency || topMoneySignal?.metric?.unit || "AZN"),
      detail: topMoneySignal?.title || labels.revenueAtRisk,
      signalId: topMoneySignal?.id,
      tone: moneyDelta > 0 ? "money" : "healthy",
    })
  }
  if (routeDelta !== 0) {
    const routeSignal = ranked.find((signal) => signal.domain === "routes" || signal.domain === "mtm")
    items.push({
      key: "route_delta",
      label: labels.briefingRoutes,
      value: signedCount(routeDelta),
      detail: routeSignal?.title || labels.briefingRoutes,
      signalId: routeSignal?.id,
      tone: routeDelta > 0 ? "info" : "healthy",
    })
  }
  if (slaDelta !== 0) {
    const slaSignal = ranked.find((signal) => signal.domain === "support" && signalText(signal).includes("sla"))
    items.push({
      key: "sla_delta",
      label: labels.briefingSla,
      value: signedCount(slaDelta),
      detail: slaSignal?.title || labels.briefingSla,
      signalId: slaSignal?.id,
      tone: slaDelta > 0 ? "critical" : "healthy",
    })
  }
  if (kpiDelta !== 0) {
    const kpiSignal = ranked.find((signal) => signal.domain === "kpi")
    items.push({
      key: "kpi_delta",
      label: labels.briefingKpi,
      value: signedCount(kpiDelta),
      detail: kpiSignal?.title || labels.briefingKpi,
      signalId: kpiSignal?.id,
      tone: kpiDelta > 0 ? "info" : "healthy",
    })
  }
  return items
}

export function buildAdvisorBriefing(signals: AdvisorSignal[], labels: AdvisorBriefingLabels, options: AdvisorBriefingOptions = {}): AdvisorBriefingItem[] {
  const ranked = rankSignals(signals)
  const criticalSignals = ranked.filter((signal) => signal.severity === "critical" || signal.severity === "high")
  const moneySignals = ranked.filter((signal) => (signal.amount || 0) > 0 || signal.metric?.kind === "money")
  const routeSignals = ranked.filter((signal) => signal.domain === "routes" || signal.domain === "mtm")
  const slaSignals = ranked.filter((signal) => signal.domain === "support" && signalText(signal).includes("sla"))
  const kpiSignals = ranked.filter((signal) => signal.domain === "kpi")
  const currentMoneyAtRisk = moneyAtRisk(moneySignals)
  const items: AdvisorBriefingItem[] = options.previousSignals?.length
    ? buildAdvisorBriefingDelta(signals, options.previousSignals, labels)
    : []

  if (criticalSignals.length > 0) {
    items.push({
      key: "critical",
      label: labels.briefingCritical,
      value: String(criticalSignals.length),
      detail: criticalSignals[0].title,
      signalId: criticalSignals[0].id,
      tone: "critical",
    })
  }
  if (currentMoneyAtRisk > 0) {
    items.push({
      key: "money",
      label: labels.briefingMoney,
      value: formatMoney(currentMoneyAtRisk, moneySignals[0]?.currency || moneySignals[0]?.metric?.unit || "AZN"),
      detail: moneySignals[0]?.title || labels.revenueAtRisk,
      signalId: moneySignals[0]?.id,
      tone: "money",
    })
  }
  if (routeSignals.length > 0) {
    items.push({
      key: "routes",
      label: labels.briefingRoutes,
      value: routeSignals[0].metric?.formatted || String(routeSignals.length),
      detail: routeSignals[0].title,
      signalId: routeSignals[0].id,
      tone: "info",
    })
  }
  if (slaSignals.length > 0) {
    items.push({
      key: "sla",
      label: labels.briefingSla,
      value: String(slaSignals.length),
      detail: slaSignals[0].title,
      signalId: slaSignals[0].id,
      tone: "critical",
    })
  }
  if (kpiSignals.length > 0) {
    items.push({
      key: "kpi",
      label: labels.briefingKpi,
      value: kpiSignals[0].metric?.formatted || String(kpiSignals.length),
      detail: kpiSignals[0].title,
      signalId: kpiSignals[0].id,
      tone: "healthy",
    })
  }
  return items.slice(0, 5)
}
