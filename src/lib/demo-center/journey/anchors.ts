/**
 * Anchor registry — the tour contract between the scenario and the screens.
 *
 * LeadDrive already marks its important regions with `data-tour-id` for the
 * in-app tours (`src/lib/tour-definitions.ts`). The demo reuses those ids
 * wherever a real page has one, so a scene built from the real component
 * inherits its anchor for free. Ids marked `real` must exist in the listed
 * files today (the manifest test greps for them); `planned` ids are added to
 * the real components in Phase B and flipped to `real` in the same change.
 *
 * Never point a step at a CSS selector: the anchor id is the only contract.
 */
import type { DemoJourneyArea } from "./types"

export interface DemoAnchorDefinition {
  readonly area: DemoJourneyArea
  readonly source: "real" | "planned"
  /** Repo-relative files that carry (or will carry) the attribute. */
  readonly files: readonly string[]
  readonly label: string
}

const LEADS_LIST = "src/app/(dashboard)/leads/page.tsx"
const LEAD_CARD = "src/app/(dashboard)/leads/[id]/page.tsx"
const DEALS_BOARD = "src/app/(dashboard)/deals/page.tsx"
const DEAL_CARD = "src/app/(dashboard)/deals/[id]/page.tsx"
const BOARDS_INDEX = "src/app/(dashboard)/boards/page.tsx"
const BOARD_PAGE = "src/app/(dashboard)/boards/[divisionId]/page.tsx"
const TASK_DETAIL = "src/components/tasks/task-detail-view.tsx"
const CAMPAIGNS_PAGE = "src/app/(dashboard)/campaigns/page.tsx"
const CAMPAIGN_DETAIL = "src/app/(dashboard)/campaigns/[id]/page.tsx"
const INBOX_PAGE = "src/app/(dashboard)/inbox/page.tsx"
const INBOX_AI_DRAFT = "src/components/inbox/ai-draft-panel.tsx"
const QUOTES_LIST = "src/app/(dashboard)/quotes/page.tsx"
const QUOTE_DETAIL = "src/app/(dashboard)/quotes/[id]/page.tsx"
const QUOTE_CREATE = "src/components/cpq/quote-create-dialog.tsx"
const DEMO_SHELL = "src/components/demo-center/demo-journey-shell.tsx"

export const DEMO_ANCHORS: Readonly<Record<string, DemoAnchorDefinition>> = {
  /* ── Demo shell (orientation, summary) ── */
  "demo-sidebar": { area: "shell", source: "planned", files: [DEMO_SHELL], label: "Reduced sidebar: four groups" },
  "demo-guide-panel": { area: "shell", source: "planned", files: [DEMO_SHELL], label: "Guide panel with progress and checklist" },
  "demo-watermark": { area: "shell", source: "planned", files: [DEMO_SHELL], label: "Prospect watermark" },
  "demo-assistant": { area: "shell", source: "planned", files: [DEMO_SHELL], label: "Da Vinci assistant launcher" },
  "journey-summary": { area: "summary", source: "planned", files: [DEMO_SHELL], label: "Completed-steps summary" },
  "journey-attribution": { area: "summary", source: "planned", files: [DEMO_SHELL], label: "Source → closed-won attribution" },
  "journey-finish": { area: "summary", source: "planned", files: [DEMO_SHELL], label: "Close session / contact sales" },

  /* ── Marketing → Campaigns ── */
  "campaigns-stats": { area: "campaigns", source: "real", files: [CAMPAIGNS_PAGE], label: "Status cards" },
  "campaigns-list": { area: "campaigns", source: "real", files: [CAMPAIGNS_PAGE], label: "Campaign cards" },
  "campaigns-new": { area: "campaigns", source: "real", files: [CAMPAIGNS_PAGE], label: "New campaign" },
  "campaigns-tabs": { area: "campaigns", source: "planned", files: [CAMPAIGNS_PAGE], label: "List / analytics switch" },
  "campaigns-analytics": { area: "campaigns", source: "planned", files: [CAMPAIGNS_PAGE], label: "Campaign analytics" },
  "campaign-detail": { area: "campaigns", source: "planned", files: [CAMPAIGN_DETAIL], label: "Campaign card" },

  /* ── Communication → Inbox ── */
  "inbox-views": { area: "inbox", source: "planned", files: [INBOX_PAGE], label: "All / Me / Unassigned / … views" },
  "inbox-status-tabs": { area: "inbox", source: "planned", files: [INBOX_PAGE], label: "Opened / Closed / Snoozed" },
  "inbox-filters": { area: "inbox", source: "planned", files: [INBOX_PAGE], label: "Channel / folder / lifecycle filters" },
  "inbox-conversations": { area: "inbox", source: "planned", files: [INBOX_PAGE], label: "Conversation list" },
  "inbox-thread": { area: "inbox", source: "planned", files: [INBOX_PAGE], label: "Message thread" },
  "inbox-composer": { area: "inbox", source: "planned", files: [INBOX_PAGE], label: "Reply / internal note composer" },
  "inbox-ai-draft": { area: "inbox", source: "planned", files: [INBOX_AI_DRAFT], label: "AI draft review panel" },
  "inbox-contact-panel": { area: "inbox", source: "planned", files: [INBOX_PAGE], label: "Contact side panel" },

  /* ── Sales → Leads (list) ── */
  "leads-list": { area: "leads", source: "real", files: [LEADS_LIST], label: "Lead list" },
  "leads-score": { area: "leads", source: "real", files: [LEADS_LIST], label: "AI score column" },
  "leads-status-filter": { area: "leads", source: "real", files: [LEADS_LIST], label: "Status pills" },
  "leads-convert": { area: "leads", source: "real", files: [LEADS_LIST, LEAD_CARD], label: "Convert action" },
  "leads-stats": { area: "leads", source: "planned", files: [LEADS_LIST], label: "Lead stats" },
  "leads-toolbar": { area: "leads", source: "planned", files: [LEADS_LIST], label: "Search / category / source / sort" },
  "leads-view-toggle": { area: "leads", source: "planned", files: [LEADS_LIST], label: "Kanban / table toggle" },
  "leads-kanban": { area: "leads", source: "planned", files: [LEADS_LIST], label: "Lead kanban" },

  /* ── Sales → Lead card ── */
  "lead-header-actions": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Convert / edit / call actions" },
  "lead-status-bar": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Status pipeline bar" },
  "lead-overview": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Overview: score, evaluation, stat boxes" },
  "lead-voice-permission": { area: "leads", source: "planned", files: [LEAD_CARD], label: "AI-call consent control" },
  "lead-kpi": { area: "leads", source: "planned", files: [LEAD_CARD], label: "KPI cards" },
  "lead-tabs": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Tab bar" },
  "lead-details": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Details tab" },
  "lead-activities": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Activities tab" },
  "lead-timeline": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Unified timeline tab" },
  "lead-sentiment": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Sentiment tab" },
  "lead-tasks": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Tasks tab" },
  "lead-ai-scoring": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Da Vinci scoring tab" },
  "lead-convert-dialog": { area: "leads", source: "planned", files: [LEAD_CARD], label: "Convert dialog" },
  "lead-ai-call": { area: "leads", source: "planned", files: [LEAD_CARD], label: "AI call action (Phase D)" },

  /* ── CRM → Boards (the task surface; /tasks is unlinked from the sidebar) ── */
  "boards-index": { area: "tasks", source: "planned", files: [BOARDS_INDEX], label: "Board list by department" },
  "board-header": { area: "tasks", source: "planned", files: [BOARD_PAGE], label: "Board header" },
  "board-tabs": { area: "tasks", source: "planned", files: [BOARD_PAGE], label: "Board / reports switch" },
  "board-toolbar": { area: "tasks", source: "planned", files: [BOARD_PAGE], label: "Mine / created-by-me / search" },
  "board-columns": { area: "tasks", source: "planned", files: [BOARD_PAGE], label: "Stage columns" },
  "board-card": { area: "tasks", source: "planned", files: [BOARD_PAGE], label: "Task card" },
  "board-card-menu": { area: "tasks", source: "planned", files: ["src/components/boards/card-quick-menu.tsx"], label: "Card quick menu" },
  "board-reports": { area: "tasks", source: "planned", files: ["src/components/boards/board-reports.tsx"], label: "Board reports" },
  "task-status": { area: "tasks", source: "real", files: [TASK_DETAIL], label: "Task status" },
  "task-info": { area: "tasks", source: "planned", files: [TASK_DETAIL], label: "Task info card" },
  "task-comments": { area: "tasks", source: "planned", files: [TASK_DETAIL], label: "Comments" },

  /* ── Sales → Deals (board) ── */
  "deals-view-tabs": { area: "deals", source: "planned", files: [DEALS_BOARD], label: "Kanban / list / analytics" },
  "deals-pipeline-select": { area: "deals", source: "real", files: [DEALS_BOARD], label: "Pipeline select" },
  "deals-new": { area: "deals", source: "real", files: [DEALS_BOARD], label: "New deal" },
  "deals-summary": { area: "deals", source: "real", files: [DEALS_BOARD], label: "Funnel summary" },
  "deals-kanban": { area: "deals", source: "planned", files: [DEALS_BOARD], label: "Kanban board" },
  "deals-card": { area: "deals", source: "real", files: [DEALS_BOARD, "src/components/deals/kanban-board.tsx", "src/components/deals/deal-card.tsx"], label: "Deal card on the board" },
  "deals-list": { area: "deals", source: "planned", files: [DEALS_BOARD], label: "List view" },
  "deal-detail-sheet": { area: "deals", source: "planned", files: ["src/components/deals/deal-detail-sheet.tsx"], label: "Quick-view sheet" },

  /* ── Sales → Deal card ── */
  "deal-stage-progress": { area: "deals", source: "real", files: [DEAL_CARD], label: "Stage chevrons" },
  "deal-sidebar": { area: "deals", source: "real", files: [DEAL_CARD], label: "Data sidebar" },
  "deal-kpi-chips": { area: "deals", source: "real", files: [DEAL_CARD], label: "KPI chips" },
  "deal-customer-details": { area: "deals", source: "planned", files: [DEAL_CARD], label: "Customer details" },
  "deal-quick-actions": { area: "deals", source: "real", files: [DEAL_CARD], label: "Quick action bar" },
  "deal-timeline": { area: "deals", source: "real", files: [DEAL_CARD], label: "Unified timeline" },
  "deal-ai-prediction": { area: "deals", source: "real", files: [DEAL_CARD], label: "AI prediction" },
  "deal-ai-suggestions": { area: "deals", source: "real", files: [DEAL_CARD], label: "AI suggestions" },
  "deal-next-best-offers": { area: "deals", source: "planned", files: [DEAL_CARD], label: "Next best offers" },
  "deal-stage-checklist": { area: "deals", source: "planned", files: [DEAL_CARD], label: "Stage checklist dialog" },

  /* ── Sales → Quotes ── */
  "quotes-new": { area: "quotes", source: "planned", files: [QUOTES_LIST], label: "New quote" },
  "quotes-filters": { area: "quotes", source: "planned", files: [QUOTES_LIST], label: "Search + status filter" },
  "quotes-table": { area: "quotes", source: "planned", files: [QUOTES_LIST], label: "Quote table" },
  "quote-create-dialog": { area: "quotes", source: "planned", files: [QUOTE_CREATE], label: "Create dialog" },
  "quote-header": { area: "quotes", source: "planned", files: [QUOTE_DETAIL], label: "Number, status, linked deal" },
  "quote-transition": { area: "quotes", source: "planned", files: [QUOTE_DETAIL], label: "Status transition buttons" },
  "quote-customer": { area: "quotes", source: "planned", files: [QUOTE_DETAIL], label: "Customer block" },
  "quote-line-items": { area: "quotes", source: "planned", files: [QUOTE_DETAIL], label: "Line items" },
  "quote-summary": { area: "quotes", source: "planned", files: [QUOTE_DETAIL], label: "Totals and validity" },
}

export function isDemoAnchor(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEMO_ANCHORS, id)
}
