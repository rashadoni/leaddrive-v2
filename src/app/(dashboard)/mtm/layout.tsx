import { MtmModuleNavigation } from "@/components/mtm/mtm-module-navigation"
import { MtmFieldScopeNotice } from "@/components/mtm/field-scope-notice"

export default function MtmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <MtmModuleNavigation />
      <MtmFieldScopeNotice />
      {children}
    </div>
  )
}
