import type { FeedItem } from "@/lib/tasks/task-feed"

type EventItem = Extract<FeedItem, { kind: "event" }>
type Translate = (key: string, values?: Record<string, string>) => string

/**
 * One line of the card's time line for an event, in the viewer's language
 * («Sabina son tarixi 12 mar etdi»). Keys live under `taskPanel.events`.
 * The other tool's own history (`external_event`) keeps its words.
 */
export function describeFeedEvent(
  item: EventItem,
  t: Translate,
  helpers: { status: (value: string) => string; date: (iso: string) => string; priority: (value: string) => string },
): string {
  const name = item.user?.name ?? t("events.someone")
  const to = item.newValue ?? ""
  switch (item.action) {
    case "created": return t("events.created", { name })
    case "status_changed": return t("events.status", { name, to: helpers.status(to) })
    case "assignee_changed": return to ? t("events.assignee", { name, to }) : t("events.assigneeCleared", { name })
    case "reporter_changed": return to ? t("events.reporter", { name, to }) : t("events.reporterCleared", { name })
    case "title_changed": return t("events.title", { name, to })
    case "due_date_changed": return to ? t("events.due", { name, to: helpers.date(to) }) : t("events.dueCleared", { name })
    case "start_date_changed": return to ? t("events.start", { name, to: helpers.date(to) }) : t("events.startCleared", { name })
    case "priority_changed": return t("events.priority", { name, to: helpers.priority(to) })
    case "subtask_completed": return t("events.subtaskDone", { name, to })
    case "subtask_reopened": return t("events.subtaskReopened", { name, to })
    case "board_changed": return t("events.board", { name, to })
    case "external_event": return `${name} ${item.text ?? ""}`.trim()
    default: return t("events.other", { name, action: item.action })
  }
}
