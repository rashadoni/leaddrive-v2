"use client"

/**
 * Tasks — help article (English).
 *
 * Covers recurring task series (#22), task templates (#21), and the
 * day-to-day task workflow. Audience: sales reps / CS / operations
 * folks who live inside /tasks.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TasksHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="What you can do here">
        <p>
          The Tasks page is where you track <strong>everything you owe</strong> — calls to make,
          emails to send, paperwork to file. Beyond plain to-dos, two power features make Tasks
          worth living in:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Recurring series</strong> — auto-spawn a follow-up every N days/weeks/months.</li>
          <li><strong>Templates</strong> — save a checklist once, reuse it on every new deal.</li>
        </ul>
      </HelpSection>

      <HelpSection title="Creating a one-off task">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Task</HelpKey> at the top of the page.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill in the title, optionally link to a deal / contact / company, set a due date,
            choose a priority and an assignee.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Save. The task appears in the list under <strong>Pending</strong> status. Mark it
            <em>Completed</em> via the checkbox or by opening the detail page.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Recurring series (auto-follow-up)">
        <p>
          For tasks you do every week / month / quarter — set up a series once and let the system
          spawn the next instance whenever you complete the current one.
        </p>
        <HelpStep n={1}>
          <p>
            On a task detail page, open the <strong>Recurring</strong> panel.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a recurrence rule. Supported shortcuts: <em>daily</em>, <em>weekly</em>,{" "}
            <em>monthly</em>, <em>yearly</em>. For arbitrary intervals use{" "}
            <code>every:N:day</code>, <code>every:N:week</code>, or <code>every:N:month</code>{" "}
            (e.g. <code>every:3:day</code> = every 3 days). Monthly rules keep the same
            day-of-month as the start; Jan 31 → Feb 28 (clamped).
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Save. From now on, completing this task automatically creates the next one with the
            due date shifted by your rule. Stop the series any time via the{" "}
            <HelpKey>Stop series</HelpKey> button — already-spawned tasks stay, no future ones
            generate. The system clears the rule on the parent AND all children atomically, so
            &quot;stop&quot; means actually stop.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Series chain via a <em>recurrenceParentId</em> link, so you can see every instance
            that came from the original rule. Use this to spot stale follow-ups that should have
            been cancelled long ago.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Task templates (save a task you create often)">
        <p>
          When the same task comes up week after week — <em>&quot;weekly status report&quot;</em>,{" "}
          <em>&quot;new customer welcome email&quot;</em>, <em>&quot;quarterly review prep&quot;</em>{" "}
          — save it as a template once, instantiate with one click.
        </p>
        <HelpStep n={1}>
          <p>
            Go to <HelpKey>Settings → Task Templates</HelpKey>. Click <HelpKey>New template</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Name the template, write the task title (supports placeholders:{" "}
            <code>{`{{date}}`}</code>, <code>{`{{user}}`}</code>, <code>{`{{month}}`}</code>,{" "}
            <code>{`{{week}}`}</code> — auto-filled when instantiated). Set priority, optional{" "}
            <em>due-date offset</em> (e.g. <em>+3 days from creation</em>), default assignee, and
            an optional <strong>checklist</strong> of sub-items.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Toggle <em>Share with team</em> if you want colleagues to use the template too
            (off by default — personal templates).
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Save. On any task creation form, click <HelpKey>From template</HelpKey>, pick your
            template, and the task spawns pre-filled with all fields and the checklist.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Status & lifecycle">
        <dl className="rounded-md border p-3">
          <HelpDef term="Pending">Default state for new tasks. Filterable from the toolbar.</HelpDef>
          <HelpDef term="In progress">Mark when you start work. Visible to your manager as &quot;active load&quot;.</HelpDef>
          <HelpDef term="Completed">Terminal — locks the task. If part of a series, this is the trigger that spawns the next instance.</HelpDef>
          <HelpDef term="Cancelled">Terminal — no follow-up spawn, the chain stops.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Tips">
        <HelpCallout kind="tip">
          <p>
            Combine recurring series with a template: save a &quot;Quarterly Business Review&quot;
            template, then set <code>every:90:day</code> recurrence on the first instance — every
            90 days you get a fresh task pre-filled with your checklist.
          </p>
        </HelpCallout>
        <HelpCallout kind="warning">
          <p>
            Cancelling a task in a recurring series <strong>stops the chain</strong> — future
            instances will NOT spawn. If you just want to skip one instance, mark it{" "}
            <em>Completed</em> and the next will spawn normally.
          </p>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
