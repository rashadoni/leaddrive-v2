"use client"

/**
 * Agent Calendar — help article (English).
 * Video-script format: read-only weekly calendar that merges Tickets + Tasks +
 * Events + Activities from /api/v1/calendar/agent. Nothing is created/edited here —
 * it is a planning view; clicking an item takes you to its source page.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AgentCalendarHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support agent or manager"
        goal="See everything that needs you this week — tickets, tasks, events and activities — on one weekly board, and jump straight to whatever you need"
      >
        The page rolls four separate places — <HelpKey>Tickets</HelpKey>, <HelpKey>Tasks</HelpKey>,{" "}
        <HelpKey>Events</HelpKey> and <HelpKey>Activities</HelpKey> (calls, emails, meetings, notes,
        task-activities) — into a single weekly view. All data is for your organization only and is{" "}
        <strong>read-only</strong>: you don't create anything here, it's a planning view that shows
        everything in one place.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left shows a calendar icon and the <HelpKey>Agent Calendar</HelpKey> title, with the current
          week's date range underneath (e.g. "Jun 16 — Jun 22, 2026"). Top-right has three navigation
          buttons: <HelpKey>‹</HelpKey> (previous week), <HelpKey>Today</HelpKey>, and <HelpKey>›</HelpKey>{" "}
          (next week). Below the header sit four colored stat cards: <strong>Tickets</strong>,{" "}
          <strong>Tasks</strong>, <strong>Events</strong> and <strong>Activities</strong> — each showing the
          count for this week.
        </p>
        <p>
          The center holds the weekly grid: a time column on the left (<strong>7:00 to 19:00</strong>), seven
          day headers across the top (Mon–Sun). Today is highlighted — its date number appears inside a circle.
          The small colored dots under a day header tell you which kinds of work fall on that day (red =
          ticket, orange = task, indigo = event, green = activity). If any all-day items exist, a separate{" "}
          <HelpKey>ALL DAY</HelpKey> row appears between the day headers and the hourly rows.
        </p>
        <p>
          At the bottom sit two side-by-side cards: <HelpKey>Legend</HelpKey> on the left (which color maps to
          which type, with counts) and <HelpKey>Today</HelpKey> on the right (today's schedule listed in time
          order).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Tickets / Tasks / Events / Activities">The four top cards — the count of each type this week (content comes from /api/v1/calendar/agent).</HelpDef>
          <HelpDef term="Time column">The 7:00–19:00 time slots down the left edge; timed items land in the hour they start.</HelpDef>
          <HelpDef term="ALL DAY row">Items with no specific hour (e.g. open tickets and tasks) — shown only when such items exist.</HelpDef>
          <HelpDef term="Current time line">A thin line (with a small dot) marking the present moment in today's column.</HelpDef>
          <HelpDef term="Priority dot">The colored dot on an item card: red=urgent, orange=high, yellow=medium, green=low.</HelpDef>
          <HelpDef term="Legend">Bottom-left card — which color is which type, plus its count for this week.</HelpDef>
          <HelpDef term="Today (schedule)">Bottom-right card — today's items: all-day open tickets/tasks first, then timed items in order.</HelpDef>
        </dl>
        <p>
          Each item card has a colored left border, a type icon and a title; if it has a priority, a colored dot
          and the priority name appear underneath. Hovering an item lifts it slightly and reveals its{" "}
          <strong>location</strong> (with a map-pin icon) and <strong>status</strong> badge when present.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: navigate between weeks">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>›</HelpKey> arrow at the top-right to move to the next week, or <HelpKey>‹</HelpKey>{" "}
            to go back to the previous week.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The date range under the title slides seven days forward/back, the grid reloads, and the four stat
            cards update to that week's counts. While loading, a spinner and the text "Loading calendar..." appear
            in place of the grid.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>Today</HelpKey> button in the middle to jump back to the current week at any time.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The calendar returns to the week containing today; today's day column is highlighted (its number in a
            circle), and a thin <strong>current time line</strong> appears across the current hour slot.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read an item and jump to it">
        <HelpStep n={1}>
          <p>
            Look at an item in the grid — its colored left border and icon signal the type (e.g. red = ticket,
            indigo = event). Hover over it for more detail.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card grows slightly and gains a shadow. When present, the location (with a map-pin icon) and a
            status badge ("Open", "In Progress", "Resolved", etc.) appear. The priority dot and name
            (urgent/high/medium/low) are always shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the item to open its full source.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            You're taken to that item's own page (e.g. the ticket detail). A ticket/task stack in the{" "}
            <strong>ALL DAY</strong> row instead opens the <HelpKey>Tickets</HelpKey> or <HelpKey>Tasks</HelpKey>{" "}
            list respectively. An item with no source URL doesn't respond to clicks.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the Legend and Today cards">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Legend</HelpKey> card at the bottom-left to learn which color maps to which kind
            of work.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows a small colored icon, the type name (Ticket, Task, Event, Call, Email, Meeting, Note,
            Task Activity) and its count for this week. Ticket, Task, Event and Call are always listed; other
            types only appear if they occur this week.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <HelpKey>Today</HelpKey> card at the bottom-right for a time-ordered list of today's work.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            First an <HelpKey>ALL DAY</HelpKey> section — open tickets (with a priority breakdown: critical/high/
            medium/low) and open tasks; then a <HelpKey>Scheduled</HelpKey> section — items in time order (time ·
            type). If there's nothing today, a calendar icon and "No items for today" appear.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The grid only spans <strong>7:00–19:00</strong> and may need horizontal scrolling — on narrow screens
          drag the grid left/right to see all seven days. The colored dots under a day header quickly tell you
          which kinds of work fall on that day without opening it.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is <strong>read-only</strong>: you can't create or edit a ticket, task, event or activity
          here. To change anything, click the item and work on it in its own source page — the calendar will
          reflect the updated state on its next load.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All calendar data is scoped to your organization — you only see your own tenant's tickets, tasks, events
          and activities. The data is read from the <HelpKey>/api/v1/calendar/agent</HelpKey> endpoint with your
          organization ID.
        </p>
      </HelpCallout>
    </div>
  )
}
