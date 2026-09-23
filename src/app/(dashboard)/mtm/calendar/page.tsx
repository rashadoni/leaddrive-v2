"use client"

import { MtmRoutesWorkspace } from "../routes/page"

/**
 * Owner 2026-09-23: «remove the calendar from this section and make a separate
 * Calendar section, where the team calendar is open by default and everything
 * related to it lives». The same workspace, opened on the team calendar.
 */
export default function MtmCalendarPage() {
  return <MtmRoutesWorkspace surface="calendar" />
}
