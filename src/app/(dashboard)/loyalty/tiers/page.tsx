"use client"

/**
 * D8 Loyalty — tier ladder admin page.
 *
 * Thin wrapper around <TiersSection> (Slice 2 step 3b extraction). The section
 * holds all the CRUD logic + markup; this page just wraps it in MotionPage so
 * the standalone /loyalty/tiers route renders identically to before, while the
 * Loyalty Builder reuses the SAME section as a tab. Edit the section, not here.
 */
import { MotionPage } from "@/components/ui/motion"
import { TiersSection } from "@/app/(dashboard)/loyalty/builder/_sections/tiers-section"

export default function LoyaltyTiersPage() {
  return (
    <MotionPage className="p-6">
      <TiersSection />
    </MotionPage>
  )
}
