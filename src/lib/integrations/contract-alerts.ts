/**
 * CLM Slice 7a — Contract event alert dispatcher.
 *
 * `sendContractAlert(orgId, kind, contract)` fans a contract event out to ALL
 * active ChannelConfig rows for this org that:
 *   - have channelType "slack" or "teams"
 *   - have isActive = true
 *   - have settings.contractAlerts = true
 *
 * The call is BEST-EFFORT: every failure is caught and logged; it NEVER throws.
 * Callers must ensure this is invoked AFTER the critical DB operation so an
 * alert failure cannot affect the contract lifecycle.
 *
 * No schema change — reuses ChannelConfig + the existing settings JSON column
 * for the `contractAlerts` toggle.
 */
import { prisma } from "@/lib/prisma"
import {
  sendSlackNotification,
  formatContractSlackMessage,
  formatContractTeamsMessage,
  type ContractAlertData,
} from "@/lib/slack"
import { sendTeamsNotification } from "@/lib/integrations/teams"

export type ContractAlertKind =
  | "contract.signed"
  | "contract.approval_requested"
  | "contract.approved"
  | "contract.declined"
  | "contract.renewal_due"

/**
 * Fan a contract event out to all active Slack/Teams webhook configs for the
 * given org whose settings have contractAlerts enabled.
 *
 * Never throws. All errors are swallowed and logged after the fact.
 */
export async function sendContractAlert(
  orgId: string,
  kind: ContractAlertKind,
  contract: ContractAlertData,
): Promise<void> {
  let configs: Array<{
    id: string
    channelType: string
    webhookUrl: string
    settings: unknown
  }>

  try {
    configs = await prisma.channelConfig.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        channelType: { in: ["slack", "teams"] },
      },
      select: {
        id: true,
        channelType: true,
        webhookUrl: true,
        settings: true,
      },
      // Cap the fan-out — no org legitimately has 100 alert webhooks; bounds the
      // parallel outbound burst per contract event (DoS guard, Codex 2026-06-08).
      // orderBy makes the cap deterministic (oldest-first) if it's ever hit.
      orderBy: { createdAt: "asc" },
      take: 100,
    })
  } catch (err) {
    console.error("[contract-alerts] Failed to load ChannelConfigs:", err)
    return
  }

  // Filter to configs that have contractAlerts enabled
  const eligible = configs.filter((cfg) => {
    if (!cfg.settings || typeof cfg.settings !== "object") return false
    return (cfg.settings as Record<string, unknown>).contractAlerts === true
  })

  if (eligible.length === 0) return

  // Fire all sends in parallel — best-effort, never throw
  await Promise.allSettled(
    eligible.map(async (cfg) => {
      try {
        // FIX 4: title is opt-in (PII) — only include when settings.includeContractTitle === true
        const includeTitle =
          cfg.settings !== null &&
          typeof cfg.settings === "object" &&
          (cfg.settings as Record<string, unknown>).includeContractTitle === true

        if (cfg.channelType === "slack") {
          const msg = formatContractSlackMessage(kind, contract, { includeTitle })
          const ok = await sendSlackNotification(cfg.webhookUrl, msg)
          if (!ok) {
            console.error(`[contract-alerts] Slack send failed for config ${cfg.id} (kind=${kind})`)
          }
        } else if (cfg.channelType === "teams") {
          const card = formatContractTeamsMessage(kind, contract, { includeTitle })
          const ok = await sendTeamsNotification(cfg.webhookUrl, card)
          if (!ok) {
            console.error(`[contract-alerts] Teams send failed for config ${cfg.id} (kind=${kind})`)
          }
        }
      } catch (err) {
        console.error(`[contract-alerts] Unexpected error for config ${cfg.id} (kind=${kind}):`, err)
      }
    }),
  )
}
