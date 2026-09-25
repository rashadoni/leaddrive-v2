"use client"

/**
 * MTM Field Tasks — help (English). Rewritten 2026-09 for the status-chip screen.
 */
import { HelpCallout, HelpKey, HelpScenario, HelpSection } from "@/components/help/help-content"

export default function MtmTasksHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="You manage a field team" goal="See what is overdue and what waits for your review, and open a task in one click">
        The page opens on open tasks: the longest overdue first, then the nearest due dates.
      </HelpScenario>

      <HelpSection title="Status chips">
        <p>
          Above the list: <HelpKey>Open</HelpKey>, <HelpKey>Overdue</HelpKey>, <HelpKey>Awaiting review</HelpKey>, <HelpKey>Completed</HelpKey> (and <HelpKey>Cancelled</HelpKey> when there are any). The number on a chip is how many tasks it will show. The pressed chip is the filter.
        </p>
        <HelpCallout kind="tip">
          Overdue is an open task past its due date; under the date it says in red how late it is. Awaiting review is a completed task a manager has neither accepted nor returned yet.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Search and filters">
        <p>
          Search looks in the title, description, customer and employee. <HelpKey>More filters</HelpKey> holds team and employee; the number on the button is how many are set.
        </p>
      </HelpSection>

      <HelpSection title="A task">
        <p>
          Click anywhere on a row to open the task: its history, documents, and <HelpKey>Accept</HelpKey> / <HelpKey>Return</HelpKey> for a completed one.
        </p>
        <HelpCallout kind="tip">
          Tick open tasks to reassign them to another employee at once. Completed and cancelled tasks have no tick box — they are not reassigned.
        </HelpCallout>
        <p>
          A new task — the <HelpKey>Add task</HelpKey> button at the top right.
        </p>
      </HelpSection>
    </div>
  )
}
