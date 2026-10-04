import { WorkforceAttendanceAdministration } from "@/components/workforce/workforce-attendance-administration"
import { WorkforceAccessManagement } from "@/components/workforce/workforce-access-management"
import { WorkforceConfigurationWorkbench } from "@/components/workforce/workforce-configuration-workbench"
import { WorkforcePolicyVersionComparisonLink } from "@/components/workforce/workforce-policy-version-comparison"

export default function WorkforceConfigurationPage() {
  return <div className="space-y-8"><WorkforcePolicyVersionComparisonLink /><WorkforceConfigurationWorkbench /><WorkforceAccessManagement /><WorkforceAttendanceAdministration /></div>
}
