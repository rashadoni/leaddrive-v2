import type { ReactNode } from "react"
import { badgeVariants } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type BookingStatusTone = "neutral" | "info" | "success" | "warning" | "destructive"

const STATUS_TONES: Record<string, BookingStatusTone> = {
  confirmed: "info",
  completed: "success",
  cancelled: "destructive",
  no_show: "warning",
}

export function bookingStatusTone(status: string): BookingStatusTone {
  return STATUS_TONES[status] ?? "neutral"
}

export function BookingStatus({ status, children }: { status: string; children: ReactNode }) {
  const tone = bookingStatusTone(status)
  const variant = tone === "neutral" ? "outline" : tone

  // Keep the badge inline so it is also valid inside a meeting-list button.
  return <span data-crm-badge={variant} className={cn(badgeVariants({ variant }), "max-w-full gap-1.5 text-left")}>
    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
    {children}
  </span>
}
