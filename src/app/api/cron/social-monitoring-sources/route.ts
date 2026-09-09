import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { reapStaleMonitoringSourceLeases, runDueMonitoringSources } from "@/lib/social/monitoring-collector"
import { runSocialCoverageSloChecks } from "@/lib/social/coverage-slo"
import { repairLegacyFacebookScenarioSources } from "@/lib/social/monitoring-scenarios"
import { recordSocialMonitoringScheduleTick } from "@/lib/social/monitoring-schedule-status"

export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
    const cronError = requireCronAuth(req)
    if (cronError) return cronError

    try {
      const { searchParams } = new URL(req.url)
      const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "25", 10) || 25, 1), 100)
      const organizationId = searchParams.get("organizationId") || undefined
      // Пульс планировщика (#665) пишется ДО обхода и намеренно не является
      // лизой: интерфейсу нужна отметка «планировщик дошёл до приложения», а
      // не сериализация сбора. Лиза сделала бы обход платформенно
      // последовательным, задержала бы reaper и оставляла бы `status=running`
      // после рестарта — а именно на такие строки смотрит карантин деплоя.
      // От двойного сбора защищает claim на самом источнике.
      // Пульс — наблюдаемость: его сбой не имеет права остановить сбор.
      await recordSocialMonitoringScheduleTick().catch(error => {
        console.error("[cron/social-monitoring-sources] heartbeat write failed", error)
      })
      const data = await collectDueSources({ organizationId, limit })
      return NextResponse.json({ success: true, data })
    } catch (error) {
      console.error("[cron/social-monitoring-sources] error", error)
      return NextResponse.json({ error: "Social monitoring source cron failed" }, { status: 500 })
    }
  })
}

async function collectDueSources(
  { organizationId, limit }: { organizationId?: string; limit: number },
) {
  const reaper = await reapStaleMonitoringSourceLeases({ organizationId, limit: 100 })
  const scenarioSourceRepair = await repairLegacyFacebookScenarioSources({
    organizationId,
    limit: Math.min(limit * 4, 100),
  })
    .catch((error) => {
      console.error("[cron/social-monitoring-sources] facebook scenario source repair failed", error)
      return {
        scanned: 0,
        organizations: 0,
        scenarios: 0,
        failedOrganizations: 1,
        hasMore: false,
      }
    })
  const result = await runDueMonitoringSources({ organizationId, limit })
  const slo = await runSocialCoverageSloChecks({ organizationId })
  return { ...result, reaper, scenarioSourceRepair, slo }
}
