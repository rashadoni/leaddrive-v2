import { redirect } from "next/navigation"
import { Suspense } from "react"
import { BOOKING_WORKSPACE_ENABLED } from "@/lib/booking/release-phase"
import { BookingWorkspace } from "@/components/booking/booking-workspace"

export default function MeetingsPage() {
  if (!BOOKING_WORKSPACE_ENABLED) redirect("/tasks")
  return <Suspense><BookingWorkspace section="team" /></Suspense>
}
