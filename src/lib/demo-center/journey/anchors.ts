/**
 * Anchor registry — the tour contract between the scenario and the screens.
 *
 * Every step points at an anchor id, never a CSS selector. Two things are
 * recorded for each id and both are verified by
 * `src/__tests__/demo-journey-manifest.test.ts`:
 *
 *   `scene`        — the demo component that renders this anchor today, or
 *                    null while that scene is still unbuilt. When non-null
 *                    the file must actually carry `data-tour-id="<id>"`.
 *   `productFiles` — real LeadDrive files that already carry the same id for
 *                    the in-app tours (`src/lib/tour-definitions.ts`). The
 *                    demo borrows the product's own tour vocabulary wherever
 *                    it exists, so one id means one thing in both places.
 *                    Listed files must contain the id.
 *
 * An anchor with `productFiles: []` is one the demo introduced; if the same
 * region later gets an in-app tour, add the id to the product file and list
 * it here in the same change.
 */
import type { DemoJourneyArea } from "./types"

export interface DemoAnchorDefinition {
  readonly area: DemoJourneyArea
  readonly scene: string | null
  readonly productFiles: readonly string[]
  readonly label: string
}

/* Demo components */
const SHELL = "src/components/demo-center/journey/demo-journey-player.tsx"
const SIDEBAR = "src/components/demo-center/journey/demo-journey-sidebar.tsx"
const GUIDE = "src/components/demo-center/journey/demo-journey-guide.tsx"
const LEAD_SCENE = "src/components/demo-center/journey/scenes/lead-scene.tsx"
const CAMPAIGN_SCENE = "src/components/demo-center/journey/scenes/campaign-scene.tsx"
const INBOX_SCENE = "src/components/demo-center/journey/scenes/inbox-scene.tsx"
const AI_AGENT_SCENE = "src/components/demo-center/journey/scenes/ai-agent-scene.tsx"
const BOARD_SCENE = "src/components/demo-center/journey/scenes/board-scene.tsx"
const DEAL_SCENE = "src/components/demo-center/journey/scenes/deal-scene.tsx"
const QUOTE_SCENE = "src/components/demo-center/journey/scenes/quote-scene.tsx"
const SUMMARY_SCENE = "src/components/demo-center/journey/scenes/summary-scene.tsx"
const NEXT_MODULE_SCENE = "src/components/demo-center/journey/scenes/next-module-scene.tsx"
const SUPPORT_SCENE = "src/components/demo-center/journey/scenes/support-scene.tsx"
const CALLS_SCENE = "src/components/demo-center/journey/scenes/calls-scene.tsx"
const MTM_SCENE = "src/components/demo-center/journey/scenes/mtm-scene.tsx"
const PERSONNEL_SCENE = "src/components/demo-center/journey/scenes/personnel-scene.tsx"
const CONTRACTS_SCENE = "src/components/demo-center/journey/scenes/contracts-scene.tsx"

/* Real product files */
const LEADS_LIST = "src/app/(dashboard)/leads/page.tsx"
const DEALS_BOARD = "src/app/(dashboard)/deals/page.tsx"
const DEAL_CARD = "src/app/(dashboard)/deals/[id]/page.tsx"
const TASK_DETAIL = "src/components/tasks/task-detail-view.tsx"
const CAMPAIGNS_PAGE = "src/app/(dashboard)/campaigns/page.tsx"

export const DEMO_ANCHORS: Readonly<Record<string, DemoAnchorDefinition>> = {
  /* ── Demo shell ── */
  "demo-sidebar": { area: "shell", scene: SIDEBAR, productFiles: [], label: "Reduced sidebar: five groups" },
  "demo-guide-panel": { area: "shell", scene: GUIDE, productFiles: [], label: "Guide panel with progress and checklist" },
  "demo-watermark": { area: "shell", scene: SHELL, productFiles: [], label: "Prospect watermark" },
  "demo-assistant": { area: "shell", scene: GUIDE, productFiles: [], label: "Da Vinci assistant prompts" },
  "demo-next-modules": { area: "shell", scene: NEXT_MODULE_SCENE, productFiles: [], label: "What next: the modules to choose from" },

  /* ── Summary ── */
  "journey-summary": { area: "summary", scene: SUMMARY_SCENE, productFiles: [], label: "Completed-steps summary" },
  "journey-attribution": { area: "summary", scene: SUMMARY_SCENE, productFiles: [], label: "Source → closed-won attribution" },
  "journey-finish": { area: "summary", scene: SUMMARY_SCENE, productFiles: [], label: "Close session / contact sales" },

  /* ── Marketing → Campaigns ── */
  "campaigns-stats": { area: "campaigns", scene: CAMPAIGN_SCENE, productFiles: [CAMPAIGNS_PAGE], label: "Status cards" },
  "campaigns-list": { area: "campaigns", scene: CAMPAIGN_SCENE, productFiles: [CAMPAIGNS_PAGE], label: "Campaign cards" },
  "campaigns-new": { area: "campaigns", scene: CAMPAIGN_SCENE, productFiles: [CAMPAIGNS_PAGE], label: "New campaign" },
  "campaigns-tabs": { area: "campaigns", scene: CAMPAIGN_SCENE, productFiles: [], label: "List / analytics switch" },
  "campaigns-analytics": { area: "campaigns", scene: CAMPAIGN_SCENE, productFiles: [], label: "Campaign analytics" },
  "campaign-detail": { area: "campaigns", scene: CAMPAIGN_SCENE, productFiles: [], label: "Campaign card" },
  // Composed from the campaign ROI screen rather than mirroring one element
  // of it, so no product file is listed — same as the other demo-composed
  // campaign anchors above.
  "campaign-funnel": { area: "campaigns", scene: CAMPAIGN_SCENE, productFiles: [], label: "Conversion funnel" },
  "campaign-roi": { area: "campaigns", scene: CAMPAIGN_SCENE, productFiles: [], label: "Campaign money and ROI" },

  /* ── Communication → Inbox ── */
  "inbox-views": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "All / Me / Unassigned / … views" },
  "inbox-channels": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Channels with their counts; one click filters the list" },
  "inbox-assign": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Assign the conversation to a colleague" },
  "inbox-status-tabs": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Opened / Closed / Snoozed" },
  "inbox-filters": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Channel / folder / lifecycle filters" },
  "inbox-conversations": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Conversation list" },
  "inbox-thread": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Message thread" },
  "inbox-composer": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Reply / internal note composer" },
  "inbox-ai-draft": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "AI draft review panel" },
  "inbox-contact-panel": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Contact side panel" },
  "inbox-reply-matrix": { area: "inbox", scene: AI_AGENT_SCENE, productFiles: [], label: "Who answers in each channel: Human / Draft / AI agent" },
  "inbox-agent-prompt": { area: "inbox", scene: AI_AGENT_SCENE, productFiles: [], label: "The agent's system prompt, with its communication style" },
  "inbox-agent-knowledge": { area: "inbox", scene: AI_AGENT_SCENE, productFiles: [], label: "The agent's knowledge base: facts apart from rules" },
  "inbox-agent-settings": { area: "inbox", scene: AI_AGENT_SCENE, productFiles: [], label: "Model, reply language and temperature" },
  "inbox-agent-sources": { area: "inbox", scene: AI_AGENT_SCENE, productFiles: [], label: "Published knowledge-base articles the AI answers from" },

  /* ── Sales → Leads (list) ── */
  "leads-list": { area: "leads", scene: LEAD_SCENE, productFiles: [LEADS_LIST], label: "Lead list heading" },
  "leads-score": { area: "leads", scene: LEAD_SCENE, productFiles: [LEADS_LIST], label: "Average score / hot leads" },
  "leads-status-filter": { area: "leads", scene: LEAD_SCENE, productFiles: [LEADS_LIST], label: "Status pills" },
  "leads-convert": { area: "leads", scene: LEAD_SCENE, productFiles: [LEADS_LIST], label: "Convert action" },
  "leads-stats": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Lead stats strip" },
  "leads-toolbar": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Search / category / source / sort" },
  "leads-kanban": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Lead kanban" },

  /* ── Sales → Lead card ── */
  "lead-header-actions": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Convert / edit / call actions" },
  "lead-status-bar": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Status pipeline bar" },
  "lead-overview": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Overview rail: readiness, source, priority" },
  "lead-voice-permission": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "AI-call consent control" },
  "lead-kpi": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "KPI cards" },
  "lead-tabs": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Tab bar" },
  "lead-details": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Details tab" },
  "lead-activities": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Activities tab" },
  "lead-timeline": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Unified timeline tab" },
  "lead-sentiment": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Sentiment tab" },
  "lead-tasks": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Tasks tab" },
  "lead-ai-scoring": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "Da Vinci scoring tab" },
  "lead-ai-call": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "AI call action" },
  "lead-call-result": { area: "leads", scene: LEAD_SCENE, productFiles: [], label: "AI call result on the lead card" },

  /* ── CRM → Boards (the task surface; /tasks is unlinked from the sidebar) ── */
  "boards-index": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Board list by department" },
  "board-header": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Board header" },
  "board-tabs": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Board / reports switch" },
  "board-toolbar": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Mine / created-by-me / search" },
  "board-columns": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Stage columns" },
  "board-card": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Task card" },
  "board-card-menu": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Card quick menu" },
  "board-reports": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Board reports" },
  "task-status": { area: "tasks", scene: BOARD_SCENE, productFiles: [TASK_DETAIL], label: "Task status" },
  "task-info": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Task info card" },
  "task-comments": { area: "tasks", scene: BOARD_SCENE, productFiles: [], label: "Comments" },

  /* ── Sales → Deals (board) ── */
  "deals-view-tabs": { area: "deals", scene: DEAL_SCENE, productFiles: [], label: "Kanban / list / analytics" },
  "deals-new": { area: "deals", scene: DEAL_SCENE, productFiles: [DEALS_BOARD], label: "New deal" },
  "deals-summary": { area: "deals", scene: DEAL_SCENE, productFiles: [DEALS_BOARD], label: "Funnel summary" },
  "deals-kanban": { area: "deals", scene: DEAL_SCENE, productFiles: [], label: "Kanban board" },
  "deals-card": { area: "deals", scene: DEAL_SCENE, productFiles: [DEALS_BOARD], label: "Deal card on the board" },
  "deals-list": { area: "deals", scene: DEAL_SCENE, productFiles: [], label: "List view" },

  /* ── Sales → Deal card ── */
  "deal-stage-progress": { area: "deals", scene: DEAL_SCENE, productFiles: [DEAL_CARD], label: "Stage chevrons" },
  "deal-sidebar": { area: "deals", scene: DEAL_SCENE, productFiles: [DEAL_CARD], label: "Data sidebar" },
  "deal-kpi-chips": { area: "deals", scene: DEAL_SCENE, productFiles: [DEAL_CARD], label: "KPI chips" },
  "deal-customer-details": { area: "deals", scene: DEAL_SCENE, productFiles: [], label: "Customer details" },
  "deal-quick-actions": { area: "deals", scene: DEAL_SCENE, productFiles: [DEAL_CARD], label: "Quick action bar" },
  "deal-timeline": { area: "deals", scene: DEAL_SCENE, productFiles: [DEAL_CARD], label: "Unified timeline" },
  "deal-ai-prediction": { area: "deals", scene: DEAL_SCENE, productFiles: [DEAL_CARD], label: "AI prediction" },
  "deal-ai-suggestions": { area: "deals", scene: DEAL_SCENE, productFiles: [DEAL_CARD], label: "AI suggestions" },
  "deal-next-best-offers": { area: "deals", scene: DEAL_SCENE, productFiles: [], label: "Next best offers" },

  /* ── Sales → Quotes ── */
  "quotes-new": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "New quote" },
  "quotes-filters": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "Search + status filter" },
  "quotes-table": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "Quote table" },
  "quote-create-dialog": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "Create dialog" },
  "quote-header": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "Number, status, linked deal" },
  "quote-transition": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "Status transition buttons" },
  "quote-customer": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "Customer block" },
  "quote-line-items": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "Line items" },
  "quote-summary": { area: "quotes", scene: QUOTE_SCENE, productFiles: [], label: "Totals and validity" },

  /* ── Route & Field (MTM) ── */
  "mtm-home-kpis": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "Today: the day in four figures" },
  "mtm-home-attention": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "Today: what waits for a decision" },
  "mtm-plan-route": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "Route planner: the day's stops, suggest, publish" },
  "mtm-plan-map": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "Route planner: clients on the map" },
  "mtm-live-roster": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "Live map: the team and their statuses" },
  "mtm-live-map": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "Live map" },
  "mtm-visit-card": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "Visit: zone, photos, presentation, signature" },
  "mtm-visit-left-open": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "A visit the agent left open" },
  "mtm-place-request": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "«Client is here»: before / proposed" },
  "mtm-results-team": { area: "mtm", scene: MTM_SCENE, productFiles: [], label: "Results: plan and fact per agent" },

  /* ── Service Desk ── */
  "sd-queue-kpis": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "Queue counters and «take next»" },
  "sd-queue-list": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "Ticket list with SLA time left and escalation level" },
  "sd-ticket-status": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "Ticket status bar and fact strip" },
  "sd-ticket-thread": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "The ticket's comments: the customer's WhatsApp messages and the internal note" },
  "sd-ticket-composer": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "The reply box with Da Vinci's draft" },
  "sd-ticket-sla": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "SLA card: first response and resolution" },
  "sd-resolve-closure": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "Closure request to the customer" },
  "sd-resolve-customer": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "The customer's side: the two WhatsApp messages and the closure page" },
  "sd-rules-sla": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "SLA policies by priority" },
  "sd-rules-escalation": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "Escalation rules and when they fire" },
  "sd-results-metrics": { area: "support", scene: SUPPORT_SCENE, productFiles: [], label: "Agent desk: my figures" },
  /* ── Call Center ── */
  "cc-log-summary": { area: "voip", scene: CALLS_SCENE, productFiles: [], label: "Call log: 30-day summary" },
  "cc-log-timeline": { area: "voip", scene: CALLS_SCENE, productFiles: [], label: "Call log: timeline and direction filter" },
  "cc-call-card": { area: "voip", scene: CALLS_SCENE, productFiles: [], label: "Lead card: phone and the call button" },
  "cc-call-widget": { area: "voip", scene: CALLS_SCENE, productFiles: [], label: "Call window: end, outcome, callback time" },
  "cc-promise-alerts": { area: "voip", scene: CALLS_SCENE, productFiles: [], label: "Overdue promise: seller, then managers" },
  "cc-promise-report": { area: "voip", scene: CALLS_SCENE, productFiles: [], label: "Late callbacks report" },
  /* ── Personnel (Kadr uçotu) ── */
  "prs-today-kpis": { area: "personnel", scene: PERSONNEL_SCENE, productFiles: [], label: "Today: came, late, absent, no check-out; now" },
  "prs-today-requests": { area: "personnel", scene: PERSONNEL_SCENE, productFiles: [], label: "Today: requests awaiting a decision" },
  "prs-today-attention": { area: "personnel", scene: PERSONNEL_SCENE, productFiles: [], label: "Today: who needs attention, explanations" },
  "prs-timesheet": { area: "personnel", scene: PERSONNEL_SCENE, productFiles: [], label: "Timesheet grid and the day card" },
  "prs-risk": { area: "personnel", scene: PERSONNEL_SCENE, productFiles: [], label: "Suspicious records" },
  "prs-n1t": { area: "personnel", scene: PERSONNEL_SCENE, productFiles: [], label: "N-1t timesheet for accounting" },
  "prs-month-close": { area: "personnel", scene: PERSONNEL_SCENE, productFiles: [], label: "Close the month" },
  /* ── Contracts ── */
  "ctr-list-stats": { area: "contracts", scene: CONTRACTS_SCENE, productFiles: [], label: "Contracts list: the six figures" },
  "ctr-list-table": { area: "contracts", scene: CONTRACTS_SCENE, productFiles: [], label: "Contracts table with the quote's draft" },
  "ctr-detail-header": { area: "contracts", scene: CONTRACTS_SCENE, productFiles: [], label: "Contract card: header, status and actions" },
  "ctr-approve-chain": { area: "contracts", scene: CONTRACTS_SCENE, productFiles: [], label: "Approval chain: levels, SLA, decisions" },
  "ctr-sign-envelope": { area: "contracts", scene: CONTRACTS_SCENE, productFiles: [], label: "E-signature: envelope and signer" },
  "ctr-sign-customer": { area: "contracts", scene: CONTRACTS_SCENE, productFiles: [], label: "The signer's page" },
  "ctr-control-renewals": { area: "contracts", scene: CONTRACTS_SCENE, productFiles: [], label: "Lifecycle: renewal alerts and approval queue" },
  "ctr-control-bell": { area: "contracts", scene: CONTRACTS_SCENE, productFiles: [], label: "Renewal alert in the managers' bell" },
}

export function isDemoAnchor(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEMO_ANCHORS, id)
}

/** Areas whose scene is built today. A section in one of these areas must
 *  have every one of its anchors rendered — that is what stops a half-built
 *  scene from shipping with a coach mark pointing at nothing. */
export const DEMO_BUILT_AREAS: readonly DemoJourneyArea[] = [
  "shell", "summary", "campaigns", "inbox", "leads", "tasks", "deals", "quotes", "support", "voip", "mtm", "personnel", "contracts",
]
