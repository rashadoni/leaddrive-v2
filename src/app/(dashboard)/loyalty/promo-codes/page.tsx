"use client"

/**
 * D8 Loyalty — promo-codes admin page.
 *
 * Thin wrapper around <PromosSection> (Slice 2 step 3b extraction). The section
 * holds all the CRUD logic + markup; this page just wraps it in MotionPage so
 * /loyalty/promo-codes renders identically to before, while the Loyalty Builder
 * reuses the SAME section as a tab. Edit the section, not here.
 */
import { MotionPage } from "@/components/ui/motion"
import { PromosSection } from "@/app/(dashboard)/loyalty/builder/_sections/promos-section"

export default function LoyaltyPromoCodesPage() {
  return (
    <MotionPage className="p-6">
      <PromosSection />
    </MotionPage>
  )
}
