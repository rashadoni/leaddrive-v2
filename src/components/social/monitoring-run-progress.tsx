"use client"

type MonitoringRunProgressProps = {
  completed: number
  total: number
  active?: boolean
  ariaLabel: string
  ariaValueText?: string
  className?: string
}

/**
 * The solid fill is determinate and evidence-based. While a source is active,
 * only its next segment receives a sweep: this shows that the worker is alive
 * without inventing a provider percentage or ETA.
 */
export function MonitoringRunProgress({
  completed,
  total,
  active = false,
  ariaLabel,
  ariaValueText,
  className = "",
}: MonitoringRunProgressProps) {
  const safeTotal = Math.max(0, Math.trunc(total))
  const safeCompleted = Math.min(safeTotal, Math.max(0, Math.trunc(completed)))
  const ratio = safeTotal > 0 ? safeCompleted / safeTotal : 0
  const showActiveSegment = active && safeTotal > 0 && safeCompleted < safeTotal
  const segmentLeft = `${ratio * 100}%`
  const segmentWidth = `${100 / safeTotal}%`

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-valuenow={safeCompleted}
      aria-valuetext={ariaValueText}
      className={`relative h-2 overflow-hidden rounded-full bg-muted ${className}`}
    >
      <div
        className="absolute inset-0 origin-left rounded-full bg-primary transition-transform duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ transform: `scaleX(${ratio})` }}
      />
      {showActiveSegment && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 overflow-hidden bg-primary/15"
          style={{ left: segmentLeft, width: segmentWidth }}
        >
          <span className="monitoring-progress-sweep absolute inset-y-0 w-1/2 bg-primary/55" />
        </span>
      )}
    </div>
  )
}
