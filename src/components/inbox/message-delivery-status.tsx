import { cn } from "@/lib/utils"

type DeliveryLabels = Record<"unknown" | "read" | "delivered" | "failed" | "sent" | "sending", string>

export function MessageDeliveryStatus({
  status,
  deliveryUnknown,
  labels,
}: {
  status: string
  deliveryUnknown: boolean
  labels: DeliveryLabels
}) {
  const state = deliveryUnknown ? "unknown"
    : status === "read" || status === "delivered" || status === "failed" || status === "sent" ? status
    : "sending"
  const symbol = state === "unknown" ? "⚠" : state === "read" || state === "delivered" ? "✓✓"
    : state === "failed" ? "✕" : state === "sent" ? "✓" : "⏳"

  return (
    <span
      role="img"
      aria-label={labels[state]}
      title={labels[state]}
      className={cn(
        state === "unknown" ? "text-amber-500"
          : state === "read" ? "text-sky-500"
          : state === "delivered" ? "text-emerald-500"
          : state === "failed" ? "text-red-500" : "",
      )}
    >
      {symbol}
    </span>
  )
}
