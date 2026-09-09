/**
 * Sparkline — a minimal inline-SVG trend line. No charting dependency.
 *
 * Renders nothing for <2 points (a single dot/flat line conveys no trend and
 * reads as fake precision). Width-flexible via viewBox + preserveAspectRatio.
 */
interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  className?: string
  /** Tailwind stroke-* class for the line colour (default: stroke-current). */
  strokeClassName?: string
}

export function Sparkline({
  values,
  width = 64,
  height = 18,
  className,
  strokeClassName = "stroke-current",
}: SparklineProps) {
  if (values.length < 2) return null

  const pad = 1.5
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const span = values.length - 1

  const points = values
    .map((v, i) => {
      const x = pad + (i / span) * (width - 2 * pad)
      const y = height - pad - ((v - min) / range) * (height - 2 * pad)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClassName}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
