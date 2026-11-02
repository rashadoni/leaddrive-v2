import { redirect } from "next/navigation"
import { BOOKING_WORKSPACE_ENABLED } from "@/lib/booking/release-phase"
import { Suspense } from "react"
import { BookingWorkspace } from "@/components/booking/booking-workspace"

export default function MeetingsPage() {
  if (!BOOKING_WORKSPACE_ENABLED) redirect("/tasks")
  return <Suspense><BookingWorkspace /></Suspense>
}
