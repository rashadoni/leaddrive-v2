import { assertSafeWebhookUrl } from "@/lib/integrations/webhook-url-guard"

export interface SlackMessage {
  text: string
  blocks?: any[]
}

export async function sendSlackNotification(webhookUrl: string, message: SlackMessage): Promise<boolean> {
  // Defense-in-depth SSRF guard — skip + log rather than throw (best-effort sender)
  try {
    assertSafeWebhookUrl(webhookUrl, "slack")
  } catch (guardErr) {
    console.error("[Slack] Blocked unsafe webhook URL:", (guardErr as Error).message)
    return false
  }
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      // Never follow redirects — a 30x from an allowlisted host to an internal IP
      // would bypass the pre-flight SSRF guard (P1 fix 2026-06-08).
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    })
    return response.ok
  } catch (error) {
    console.error("[Slack] Notification failed:", error)
    return false
  }
}

export function formatDealNotification(deal: {
  name: string
  value?: number
  stage?: string
  owner?: string
}): SlackMessage {
  return {
    text: `New Deal: ${deal.name}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*New Deal:* ${deal.name}`,
            deal.value != null ? `*Value:* $${deal.value.toLocaleString()}` : null,
            deal.stage ? `*Stage:* ${deal.stage}` : null,
            deal.owner ? `*Owner:* ${deal.owner}` : null,
          ].filter(Boolean).join("\n"),
        },
      },
    ],
  }
}

export function formatTicketNotification(ticket: {
  ticketNumber?: string
  subject: string
  priority?: string
  status?: string
}): SlackMessage {
  return {
    text: `Ticket ${ticket.ticketNumber || ""}: ${ticket.subject}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*Ticket ${ticket.ticketNumber || ""}:* ${ticket.subject}`,
            ticket.priority ? `*Priority:* ${ticket.priority}` : null,
            ticket.status ? `*Status:* ${ticket.status}` : null,
          ].filter(Boolean).join("\n"),
        },
      },
    ],
  }
}

export function formatGenericNotification(entityType: string, action: string, data: Record<string, any>): SlackMessage {
  return {
    text: `[${entityType}] ${action}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*[${entityType}]* ${action}\n${Object.entries(data).slice(0, 5).map(([k, v]) => `*${k}:* ${v}`).join("\n")}`,
        },
      },
    ],
  }
}

// ─── Contract alert formatters ────────────────────────────────────────────────

/** Shape consumed by contract alert formatters. */
export interface ContractAlertData {
  contractNumber: string
  title: string
  valueAmount?: number | null
  currency?: string | null
}

const CONTRACT_KIND_LABELS: Record<string, string> = {
  "contract.signed":             "Contract Signed",
  "contract.approval_requested": "Approval Requested",
  "contract.approved":           "Contract Approved",
  "contract.declined":           "Contract Declined",
  "contract.renewal_due":        "Renewal Due",
}

/**
 * Format a contract event as a Slack Block Kit message.
 * PII-safe by default: only contract number, event kind, and value are included.
 * Pass `includeTitle: true` (opt-in per ChannelConfig settings.includeContractTitle)
 * to also append the free-text contract title.
 */
export function formatContractSlackMessage(
  kind: string,
  contract: ContractAlertData,
  { includeTitle = false }: { includeTitle?: boolean } = {},
): SlackMessage {
  const label = CONTRACT_KIND_LABELS[kind] ?? kind
  const contractRef = includeTitle
    ? `${contract.contractNumber} — ${contract.title}`
    : contract.contractNumber
  const lines: string[] = [
    `*${label}*`,
    `*Contract:* ${contractRef}`,
  ]
  if (contract.valueAmount != null) {
    const currency = contract.currency ?? "USD"
    lines.push(`*Value:* ${currency} ${Number(contract.valueAmount).toLocaleString()}`)
  }

  return {
    text: `${label}: ${contractRef}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: lines.join("\n"),
        },
      },
    ],
  }
}

/**
 * Format a contract event as a Teams MessageCard payload.
 * Returns the card object (pass to sendTeamsNotification).
 * PII-safe by default: only contract number, event kind, and value are included.
 * Pass `includeTitle: true` (opt-in per ChannelConfig settings.includeContractTitle)
 * to also include the free-text contract title in the facts.
 */
export function formatContractTeamsMessage(
  kind: string,
  contract: ContractAlertData,
  { includeTitle = false }: { includeTitle?: boolean } = {},
): { summary: string; sections: Array<{ facts: Array<{ name: string; value: string }> }> } {
  const label = CONTRACT_KIND_LABELS[kind] ?? kind
  const contractRef = includeTitle
    ? `${contract.contractNumber} — ${contract.title}`
    : contract.contractNumber
  const facts: Array<{ name: string; value: string }> = [
    { name: "Contract", value: contractRef },
    { name: "Event", value: label },
  ]
  if (contract.valueAmount != null) {
    const currency = contract.currency ?? "USD"
    facts.push({ name: "Value", value: `${currency} ${Number(contract.valueAmount).toLocaleString()}` })
  }

  return {
    summary: `${label}: ${contract.contractNumber}`,
    sections: [{ facts }],
  }
}
