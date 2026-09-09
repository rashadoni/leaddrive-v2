import { Suspense } from "react"
import { PharmacyPromotionWorkspace } from "@/components/mtm/pharmacy-promotion-workspace"

export default function MtmPharmacyPromotionsPage() {
  return (
    <Suspense fallback={<div aria-hidden="true" className="mx-auto min-h-[60vh] max-w-[1680px] bg-muted/20 motion-safe:animate-pulse" />}>
      <PharmacyPromotionWorkspace />
    </Suspense>
  )
}
