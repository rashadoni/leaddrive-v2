import { WorkforceAttendanceAdministration } from "@/components/workforce/workforce-attendance-administration"
import { WorkforceAccessManagement } from "@/components/workforce/workforce-access-management"
import { WorkforceCalendarConfiguration } from "@/components/workforce/workforce-calendar-configuration"
import { WorkforceConfigurationWorkbench } from "@/components/workforce/workforce-configuration-workbench"

export default function WorkforceConfigurationPage() {
  return <div className="space-y-8"><WorkforceConfigurationWorkbench /><WorkforceCalendarConfiguration /><WorkforceAccessManagement /><WorkforceAttendanceAdministration /></div>
}
