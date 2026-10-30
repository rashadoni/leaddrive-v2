import { redirect } from "next/navigation"
import { BOOKING_WORKSPACE_ENABLED } from "@/lib/booking/release-phase"
import LegacyBookingSettings from "@/components/booking/legacy-booking-settings"

export default function BookingSettingsPage() {
  if (BOOKING_WORKSPACE_ENABLED) redirect("/meetings?tab=pages")
  return <LegacyBookingSettings />
}
