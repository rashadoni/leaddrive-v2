import { MtmModuleNavigation } from "@/components/mtm/mtm-module-navigation"
import { MtmFieldScopeGate } from "@/components/mtm/field-scope-gate"

export default function MtmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <MtmModuleNavigation />
      <MtmFieldScopeGate>{children}</MtmFieldScopeGate>
    </div>
  )
}
