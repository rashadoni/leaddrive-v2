import { MtmModuleNavigation } from "@/components/mtm/mtm-module-navigation"

export default function MtmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <MtmModuleNavigation />
      {children}
    </div>
  )
}
