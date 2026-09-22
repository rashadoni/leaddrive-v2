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
const BOARD_SCENE = "src/components/demo-center/journey/scenes/board-scene.tsx"
const DEAL_SCENE = "src/components/demo-center/journey/scenes/deal-scene.tsx"
const QUOTE_SCENE = "src/components/demo-center/journey/scenes/quote-scene.tsx"
const SUMMARY_SCENE = "src/components/demo-center/journey/scenes/summary-scene.tsx"

/* Real product files */
const LEADS_LIST = "src/app/(dashboard)/leads/page.tsx"
const DEALS_BOARD = "src/app/(dashboard)/deals/page.tsx"
const DEAL_CARD = "src/app/(dashboard)/deals/[id]/page.tsx"
const TASK_DETAIL = "src/components/tasks/task-detail-view.tsx"
const CAMPAIGNS_PAGE = "src/app/(dashboard)/campaigns/page.tsx"

export const DEMO_ANCHORS: Readonly<Record<string, DemoAnchorDefinition>> = {
  /* ── Demo shell ── */
  "demo-sidebar": { area: "shell", scene: SIDEBAR, productFiles: [], label: "Reduced sidebar: four groups" },
  "demo-guide-panel": { area: "shell", scene: GUIDE, productFiles: [], label: "Guide panel with progress and checklist" },
  "demo-watermark": { area: "shell", scene: SHELL, productFiles: [], label: "Prospect watermark" },
  "demo-assistant": { area: "shell", scene: GUIDE, productFiles: [], label: "Da Vinci assistant prompts" },

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
  "inbox-status-tabs": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Opened / Closed / Snoozed" },
  "inbox-filters": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Channel / folder / lifecycle filters" },
  "inbox-conversations": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Conversation list" },
  "inbox-thread": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Message thread" },
  "inbox-composer": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Reply / internal note composer" },
  "inbox-ai-draft": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "AI draft review panel" },
  "inbox-contact-panel": { area: "inbox", scene: INBOX_SCENE, productFiles: [], label: "Contact side panel" },

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
  "deals-pipeline-select": { area: "deals", scene: DEAL_SCENE, productFiles: [DEALS_BOARD], label: "Pipeline select" },
  "deals-new": { area: "deals", scene: DEAL_SCENE, productFiles: [DEALS_BOARD], label: "New deal" },
  "deals-summary": { area: "deals", scene: DEAL_SCENE, productFiles: [DEALS_BOARD], label: "Funnel summary" },
  "deals-kanban": { area: "deals", scene: DEAL_SCENE, productFiles: [], label: "Kanban board" },
  "deals-card": { area: "deals", scene: DEAL_SCENE, productFiles: [DEALS_BOARD], label: "Deal card on the board" },
  "deals-list": { area: "deals", scene: DEAL_SCENE, productFiles: [], label: "List view" },
  "deal-detail-sheet": { area: "deals", scene: DEAL_SCENE, productFiles: [], label: "Quick-view sheet" },

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
}

export function isDemoAnchor(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEMO_ANCHORS, id)
}

/** Areas whose scene is built today. A section in one of these areas must
 *  have every one of its anchors rendered — that is what stops a half-built
 *  scene from shipping with a coach mark pointing at nothing. */
export const DEMO_BUILT_AREAS: readonly DemoJourneyArea[] = [
  "shell", "summary", "campaigns", "inbox", "leads", "tasks", "deals", "quotes",
]
