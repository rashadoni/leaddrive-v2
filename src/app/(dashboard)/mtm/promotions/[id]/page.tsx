import { Suspense } from "react"
import { MtmFeatureGate } from "@/components/mtm/mtm-feature-gate"
import { PharmacyPromotionDetail } from "@/components/mtm/pharmacy-promotion-detail"

export default async function MtmPharmacyPromotionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <MtmFeatureGate feature="pharmacyPromotionsEnabled">
    <Suspense fallback={<div aria-hidden="true" className="mx-auto min-h-[60vh] max-w-[1500px] bg-muted/20 motion-safe:animate-pulse" />}>
      <PharmacyPromotionDetail executionId={id} />
    </Suspense>
    </MtmFeatureGate>
  )
}
