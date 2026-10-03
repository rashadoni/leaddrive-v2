"use client"

/**
 * Agent Calendar — help article (English).
 * Video-script format: read-only weekly calendar that merges Tickets + Tasks +
 * Events + Activities from /api/v1/calendar/agent. Nothing is created/edited here —
 * it is a planning view; clicking an item opens details before source navigation.
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
        goal="Review this week's tickets, tasks, events and activities in one calendar, open an item's details, and continue to its source when available"
      >
        The page rolls four separate places — <HelpKey>Tickets</HelpKey>, <HelpKey>Tasks</HelpKey>,{" "}
        <HelpKey>Events</HelpKey> and <HelpKey>Activities</HelpKey> (calls, emails, meetings, notes,
        task-activities) — into a single weekly view. All data is for your organization only and is{" "}
        <strong>read-only</strong>: you don&apos;t create anything here, it&apos;s a planning view that shows
        the calendar items in one place.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left shows a calendar icon and the <HelpKey>Agent Calendar</HelpKey> title, with the current
          week&apos;s date range underneath (e.g. &quot;Jun 15 — Jun 21, 2026&quot;). Top-right has navigation
          arrows: <HelpKey>‹</HelpKey> (previous week) and <HelpKey>›</HelpKey> (next week), with{" "}
          <HelpKey>Today</HelpKey> between them. On a small screen, Today sits below the header.
          A compact summary strip shows the week&apos;s counts for <strong>Tickets</strong>,{" "}
          <strong>Tasks</strong>, <strong>Events</strong> and <strong>Activities</strong>.
        </p>
        <p>
          On a wide screen, the compact week board has seven day columns (Mon–Sun). Each header shows the
          date and item count; today&apos;s header is highlighted. Each column starts with up to six items.
          On narrower screens, choose a day in the seven-day picker to see its agenda below, starting
          with up to 20 items. All-day items come first, followed by timed items in chronological order.
        </p>
        <p>
          If the displayed week contains a future timed item, <HelpKey>Next scheduled item</HelpKey> appears
          above the calendar. If some data sources fail to load, a notice names them and offers{" "}
          <HelpKey>Try again</HelpKey>; the available data remains visible.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Week totals">The compact strip with counts for the four calendar sources.</HelpDef>
          <HelpDef term="Day picker">On narrower screens, select the day whose items you want to read.</HelpDef>
          <HelpDef term="ALL DAY">A label on an item without a specific time; the item stays in its day&apos;s list.</HelpDef>
          <HelpDef term="Outside 07:00–19:00">A timed item outside the standard business-hour window. It remains visible.</HelpDef>
          <HelpDef term="Priority">An outlined label shown when the item has a priority.</HelpDef>
          <HelpDef term="Show … more">Reveals the remaining items in a day column or another batch in the selected-day agenda.</HelpDef>
          <HelpDef term="Open record">A button in item details, available when the item has a source link.</HelpDef>
        </dl>
        <p>
          Each item shows an icon, title, time or <HelpKey>ALL DAY</HelpKey>, and type name.
          Priority and the outside-hours label appear when applicable. Click the item to read its details.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: navigate between weeks">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>›</HelpKey> arrow at the top-right to move to the next week, or <HelpKey>‹</HelpKey>{" "}
            to go back to the previous week.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The date range moves seven days forward or back, and the calendar and summary counts reload.
            Placeholder rows appear while loading.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Today</HelpKey> to return to the current week. On a small screen, the button is
            below the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The calendar returns to the week containing today. The wide board highlights today&apos;s header;
            the narrower view selects today and shows its agenda.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read an item and jump to it">
        <HelpStep n={1}>
          <p>
            Read the item&apos;s title, time and type, then click it to open its details.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A detail panel opens on the right, or fills the screen on mobile. It shows the date and time,
            plus status, priority, location and online format when available.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the detail panel, click <HelpKey>Open record</HelpKey> to continue to the source page.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The linked record or list opens, such as a ticket detail or the Tasks list.
            If there is no source link, the panel still shows the item&apos;s details but has no Open record button.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read a day's work">
        <HelpStep n={1}>
          <p>
            On a wide screen, read the relevant day column. On a narrower screen, select its date in the
            day picker above the agenda.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            All-day items come first, followed by timed items. An empty day shows <HelpKey>No scheduled work</HelpKey>.
            If there are more items, use <HelpKey>Show … more</HelpKey>. A wide column can be collapsed again
            with <HelpKey>Show less</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If <HelpKey>Next scheduled item</HelpKey> is shown above the calendar, click it to inspect the
            next future timed item in the displayed week.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same detail panel opens. This shortcut is absent when the displayed week has no future timed item.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Work before 07:00 or from 19:00 onward stays visible and is marked <HelpKey>Outside 07:00–19:00</HelpKey>.
          On narrower screens, switch days with the day picker instead of scrolling an hourly grid.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is <strong>read-only</strong>: you can&apos;t create or edit a ticket, task, event or activity
          here. To change anything, open its details, use Open record when available, and work on its source page — the calendar will
          reflect the updated state on its next load.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All calendar data is scoped to your organization — you only see your own tenant&apos;s tickets, tasks, events
          and activities. The data is read from the <HelpKey>/api/v1/calendar/agent</HelpKey> endpoint with your
          organization ID.
        </p>
      </HelpCallout>
    </div>
  )
}
