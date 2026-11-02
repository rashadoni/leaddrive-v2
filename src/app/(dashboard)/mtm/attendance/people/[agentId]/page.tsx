import { MtmAttendanceEmployeePage } from "@/components/mtm/attendance-employee-page"
import type { AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

const LIST = "/mtm/attendance/people?tab=employees"

/** Personnel → Employees → one employee; «back» returns to the list as it was (search, department, page). */
export default async function PersonnelEmployeePage({ params, searchParams }: { params: Promise<{ agentId: string }>; searchParams: AttendanceSearchParams }) {
  const { agentId } = await params
  const raw = (await searchParams).back
  const back = typeof raw === "string" && raw.startsWith("/mtm/attendance/people?") && !raw.includes("//") ? raw : LIST
  return <MtmAttendanceEmployeePage agentId={decodeURIComponent(agentId)} back={back} />
}
