"use client"

/**
 * MTM Field Tasks — help article (English).
 * Covers only Route & Field → Field Tasks (Kanban / list views, stat cards,
 * search/sort/filter, create-edit task form, status-move buttons, delete).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmTasksHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a field-operations supervisor or field-team manager"
        goal="Assign tasks to field agents, track their progress on a Kanban board, and close them out by status"
      >
        You reach this page via <HelpKey>Route &amp; Field</HelpKey> →{" "}
        <HelpKey>Field Tasks</HelpKey>. All tasks, agents, and customers belong to your organization
        only. When the page loads it pulls the latest 200 tasks; the stat cards and Kanban columns
        all read from the same list, so counts update instantly as you change a task.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading shows <HelpKey>Field Tasks</HelpKey> with the currently shown task count in
          parentheses, and beneath it the line «Tasks assigned to field agents». Top-right holds two
          things: a view toggle (two side-by-side buttons — a <strong>grid/Kanban</strong> icon and a{" "}
          <strong>list</strong> icon) and the <HelpKey>Add Task</HelpKey> button. Below that come four
          stat cards, then a search bar, and at the bottom either the Kanban board or a table,
          depending on the selected view.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Tasks">Total number of all tasks.</HelpDef>
          <HelpDef term="Pending">Tasks in the «Pending» status that haven't been started.</HelpDef>
          <HelpDef term="In Progress">Tasks currently being worked on.</HelpDef>
          <HelpDef term="Completed">Tasks that have been closed (completed).</HelpDef>
          <HelpDef term="Kanban view">Shows tasks in three columns: To Do, In Progress, Completed. This is the default view.</HelpDef>
          <HelpDef term="List view">Shows the same tasks as a table, with status filters and sorting.</HelpDef>
          <HelpDef term="Priority">A task's urgency: Low, Medium, High, Urgent — shown as a colored pill on the card.</HelpDef>
        </dl>
        <p>
          A Kanban card shows the task title with a priority pill on the right, the description (if
          any), then the agent name, due date, and customer name (if set). The bottom of the card has
          status-progress buttons on one side and pencil (edit) and trash (delete) icons on the other.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new task">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Add Task</HelpKey> button in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Add Task» dialog opens. It has a <strong>Title *</strong> field, an{" "}
            <strong>Agent *</strong> and <strong>Customer</strong> dropdown on one row,{" "}
            <strong>Priority</strong>, <strong>Status</strong>, and <strong>Due Date</strong> on the
            next row, and a <strong>Description</strong> text area at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter a <strong>Title</strong> (e.g. «Take a storefront photo») and pick a rep from the{" "}
            <strong>Agent</strong> dropdown. These two fields are required.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Agent dropdown defaults to «— Select agent —» and lists your organization's field
            agents. If you leave a required field empty, the browser won't let you save the form.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally assign a <strong>Customer</strong>, choose a <strong>Priority</strong> (Low /
            Medium / High / Urgent — defaults to Medium) and a <strong>Status</strong> (defaults to
            Pending), fill the <strong>Due Date</strong> calendar, and add a <strong>Description</strong>{" "}
            if needed.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Customer dropdown has a default «— None —» option, so a customer is optional. The Due
            Date field opens a calendar picker.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving...» while it saves, then the dialog closes and the new task
            appears in the Kanban column that matches its status. The count in the heading and the{" "}
            <strong>Total Tasks</strong> (and matching status) card go up by one. If the save fails, a
            red error message appears at the top of the form.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: move a task on the Kanban board">
        <HelpStep n={1}>
          <p>
            You start in Kanban view. There are three columns: <HelpKey>To Do</HelpKey>,{" "}
            <HelpKey>In Progress</HelpKey>, and <HelpKey>Completed</HelpKey>. Each column header shows
            a colored dot and a count of the tasks in it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Tasks are distributed into the columns by status and sorted by priority within each
            column. If a column is empty, it shows a «No tasks» message inside a dashed border.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To advance a task to the next stage, click the status button at the bottom of the card:{" "}
            <HelpKey>Start →</HelpKey> in the «To Do» column, <HelpKey>Done ✓</HelpKey> in the «In
            Progress» column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The task moves to the new column immediately, both columns' count badges update, and the
            stat cards at the top (Pending / In Progress / Completed) change accordingly. A short
            confirmation toast appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To send a task back, click <HelpKey>← To Do</HelpKey> on a card in the «In Progress» or
            «Completed» column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The task returns to the «To Do» column and the counts adjust.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter and sort with list view">
        <HelpStep n={1}>
          <p>
            Click the list icon in the top-right view toggle.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The board turns into a table. Columns are <strong>Title</strong>, <strong>Agent</strong>,{" "}
            <strong>Customer</strong>, <strong>Priority</strong>, <strong>Status</strong>,{" "}
            <strong>Due Date</strong>, plus edit/delete icons on each row. Above the table appear
            status filter buttons (All, Pending, In Progress, Completed, Cancelled — each with a
            count), and a sort dropdown appears next to the search bar.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a task title or agent name into the search bar; narrow by status with a filter
            button; change the order from the sort dropdown — <HelpKey>Due Date ↓</HelpKey>,{" "}
            <HelpKey>Due Date ↑</HelpKey>, <HelpKey>By Priority</HelpKey>, or <HelpKey>By Title</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table filters as you type and the heading count adjusts. If nothing matches the filter
            it shows «No tasks match the filter»; if there are no tasks at all it shows «No tasks yet».
            The sort dropdown only appears in list view (not in Kanban).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete a task">
        <HelpStep n={1}>
          <p>
            To change a task, click the pencil <HelpKey>edit</HelpKey> button on the card (Kanban) or
            row (list).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Edit Task» dialog opens pre-filled with the existing title, agent, customer, priority,
            status, due date, and description. Make your changes and confirm with the{" "}
            <HelpKey>Update</HelpKey> button at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete a task, click the red trash <HelpKey>delete</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog opens showing the task's name. You can back out with{" "}
            <HelpKey>Cancel</HelpKey> or remove it with the red confirm button; once confirmed the task
            leaves the list and the counts update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The status buttons only move one step forward/back (To Do → In Progress → Completed). To set
          a task straight to «Cancelled» or skip a status, open the form with the pencil icon and
          change the <strong>Status</strong> field — it offers Pending, In Progress, Completed, and
          Cancelled.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Delete asks for confirmation but is not reversible. If you want to keep a task on record but
          stop treating it as active, set its status to <strong>Cancelled</strong> instead of deleting
          — the task then stays in your records.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All tasks, agents, and customers are scoped to your organization — you can only assign tasks
          to your own tenant's agents and you never see another organization's tasks. The agent and
          customer dropdowns are drawn from your organization's data.
        </p>
      </HelpCallout>
    </div>
  )
}
