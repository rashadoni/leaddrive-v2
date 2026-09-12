function finite(value) {
  return typeof value === "number" && Number.isFinite(value)
}

export function compareSupportPerformance(currentPerformance, currentMetrics, baselineResult, budgets = {}) {
  if (!baselineResult?.performance || !baselineResult?.metrics) return { status: "baseline_matrix_missing", regressions: [] }

  const regressions = []
  const compareUpperBound = (metric, current, previous, absoluteAllowance, ratio = 0.1) => {
    if (!finite(current) || !finite(previous)) return
    const measuredBudget = finite(budgets[metric]) ? budgets[metric] : Number.NEGATIVE_INFINITY
    const limit = Math.max(previous + absoluteAllowance, previous * (1 + ratio), measuredBudget)
    if (current > limit) regressions.push({ metric, current, baseline: previous, limit: Number(limit.toFixed(6)) })
  }

  compareUpperBound("loadP75", currentPerformance.loadP75, baselineResult.performance.loadP75, 100)
  compareUpperBound("filterP50", currentPerformance.filterP50, baselineResult.performance.filterP50, 50)
  compareUpperBound("interactionP75", currentPerformance.interactionP75, baselineResult.performance.interactionP75, 50)
  if (finite(currentMetrics.primaryWorkTop) && finite(baselineResult.metrics.primaryWorkTop) && currentMetrics.primaryWorkTop > baselineResult.metrics.primaryWorkTop) {
    regressions.push({ metric: "primaryWorkTop", current: currentMetrics.primaryWorkTop, baseline: baselineResult.metrics.primaryWorkTop, limit: baselineResult.metrics.primaryWorkTop })
  }
  if (finite(currentMetrics.renderedRows) && finite(baselineResult.metrics.renderedRows) && currentMetrics.renderedRows > baselineResult.metrics.renderedRows) {
    regressions.push({ metric: "renderedRows", current: currentMetrics.renderedRows, baseline: baselineResult.metrics.renderedRows, limit: baselineResult.metrics.renderedRows })
  }
  if (finite(currentMetrics.borderedRoundedBlocks) && finite(baselineResult.metrics.borderedRoundedBlocks) && currentMetrics.borderedRoundedBlocks > baselineResult.metrics.borderedRoundedBlocks) {
    regressions.push({ metric: "borderedRoundedBlocks", current: currentMetrics.borderedRoundedBlocks, baseline: baselineResult.metrics.borderedRoundedBlocks, limit: baselineResult.metrics.borderedRoundedBlocks })
  }
  compareUpperBound(
    "cumulativeLayoutShift",
    currentPerformance.cumulativeLayoutShift,
    baselineResult.performance.cumulativeLayoutShift,
    0.001,
  )
  return { status: regressions.length > 0 ? "regressed" : "matched", regressions }
}
