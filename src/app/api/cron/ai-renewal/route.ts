import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { isAiFeatureEnabled, checkAiBudget } from "@/lib/ai/budget"
import { findContractsForRenewal, generateRenewalProposal, writeRenewalShadowAction } from "@/lib/ai/renewal"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * AI Renewal Cron Endpoint
 * Called daily (recommended: 02:00 server time)
 * Scans contracts ending in 28–32 days, drafts renewal proposals via AI,
 * writes to AiShadowAction for manual review (or auto-approves in live mode).
 *
 * Execution of approved actions happens in ai-auto-actions cron.
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  const now = new Date()
  const results = { orgsScanned: 0, orgsSkipped: 0, drafted: 0, errors: 0 }

  try {
    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true, name: true, settings: true },
    })

    for (const org of orgs) {
      const liveEnabled = await isAiFeatureEnabled(org.id, "ai_auto_renewal")
      const shadowEnabled = await isAiFeatureEnabled(org.id, "ai_auto_renewal_shadow")
      if (!liveEnabled && !shadowEnabled) {
        results.orgsSkipped++
        continue
      }

      const budget = await checkAiBudget(org.id)
      if (!budget.allowed) {
        results.orgsSkipped++
        continue
      }

      const orgSettings = (org.settings as Record<string, any>) || {}
      const orgLang = orgSettings.language || orgSettings.locale || "ru"

      results.orgsScanned++
      const contracts = await findContractsForRenewal(org.id, now)

      for (const contract of contracts) {
        try {
          const lang = contract.contact?.preferredLanguage || orgLang
          const draft = await generateRenewalProposal(contract, org.name, lang)
          if (!draft) { results.errors++; continue }
          await writeRenewalShadowAction(org.id, contract, draft, now, !liveEnabled)
          results.drafted++
        } catch (e) {
          console.error(`Renewal draft failed for contract ${contract.id}:`, e)
          results.errors++
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { ...results, timestamp: now.toISOString() },
    })
  } catch (e) {
    console.error("AI Renewal cron error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
