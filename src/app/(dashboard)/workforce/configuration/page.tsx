import { WorkforceAttendanceAdministration } from "@/components/workforce/workforce-attendance-administration"
import { WorkforceConfigurationWorkbench } from "@/components/workforce/workforce-configuration-workbench"

export default function WorkforceConfigurationPage() {
  return <div className="space-y-8"><WorkforceConfigurationWorkbench /><WorkforceAttendanceAdministration /></div>
}
