import { PageSkeleton } from "@/components/ui/page-skeleton"

// Shown inside the dashboard shell (sidebar and header stay) while the next
// page's code and server payload load, so a click on the menu answers at once
// with the shape of a page instead of the previous page frozen on screen.
export default function DashboardLoading() {
  return <PageSkeleton />
}
