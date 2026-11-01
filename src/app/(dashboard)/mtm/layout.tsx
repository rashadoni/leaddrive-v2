import { MtmFieldScopeGate } from "@/components/mtm/field-scope-gate"

// The module's menu is the Route & Field group of the left sidebar, and only
// that (owner, 2026-11-01): the tabs that used to sit above every page and the
// «All MTM tools» popover listed the same destinations a second and third time.
export default function MtmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <MtmFieldScopeGate>{children}</MtmFieldScopeGate>
    </div>
  )
}
