"use client"

/**
 * D8 Loyalty — earn-rules admin page.
 *
 * Thin wrapper around <EarnRulesSection> (Slice 2 step 3b extraction). The
 * section holds all the CRUD logic + markup; this page just wraps it in
 * MotionPage so /loyalty/earn-rules renders identically to before, while the
 * Loyalty Builder reuses the SAME section as a tab. Edit the section, not here.
 */
import { MotionPage } from "@/components/ui/motion"
import { EarnRulesSection } from "@/app/(dashboard)/loyalty/builder/_sections/earn-rules-section"

export default function LoyaltyEarnRulesPage() {
  return (
    <MotionPage className="p-6">
      <EarnRulesSection />
    </MotionPage>
  )
}
