"use client"

/**
 * Kanban board — help article (English).
 * Covers only the /boards/[divisionId] page: the Board/List/Reports tabs,
 * drag-and-drop moves, the card ⋯ quick menu, filters, creating a task and the
 * windowed DONE column. Board CREATION and column configuration live on separate
 * pages (the Boards list + board settings) and are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function BoardViewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a team lead or a rep working through tasks"
        goal="Run a board's work as a Kanban — move tasks across columns, filter them, create a new task, and check the reports"
      >
        You reach this page by opening a specific board from the{" "}
        <HelpKey>Boards</HelpKey> list. You only see boards you've been granted
        access to — if a board isn't shared with you, opening it shows a "No access to
        this board" message. Everything you see here — columns, cards, counts — is read
        from this board's tasks, so it updates instantly when you move or edit a card.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top sits the board name with a short <strong>key</strong> badge next to
          it (e.g. KHS), and above it a link back to the <HelpKey>Boards</HelpKey> list.
          If you have more than one board, a switcher dropdown appears next to the name for
          jumping between boards. The top-right holds the action buttons:{" "}
          <HelpKey>Refresh</HelpKey> (circular-arrow icon), an admin-only{" "}
          <HelpKey>Configuration</HelpKey> (gear icon), an export menu, and the orange{" "}
          <HelpKey>New Task</HelpKey> button.
        </p>
        <p>
          Under the title are three tabs: <HelpKey>Board</HelpKey>, <HelpKey>List</HelpKey>{" "}
          and <HelpKey>Reports</HelpKey>. The <strong>Board</strong> tab shows a sticky
          toolbar (filters) on top, then the columns. Each column has a name with a task
          count beside it and a colored strip along its top edge; cards stack inside.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Board (tab)">The Kanban view — tasks as cards laid out in columns; moved by drag-and-drop.</HelpDef>
          <HelpDef term="List (tab)">A table view of the same tasks — rows grouped by column, with fields editable inline.</HelpDef>
          <HelpDef term="Reports (tab)">Reports over this board's tasks, plus an operational report.</HelpDef>
          <HelpDef term="Column">A stage (e.g. BACKLOG, TO DO, IN PROGRESS, TESTING, REVIEW, DONE). A board's columns can be customized; the count in the header is the number of tasks in that column.</HelpDef>
          <HelpDef term="Card">A single task. It shows the title, a type glyph, the key (e.g. KHS-12), a priority glyph, a due date if set, and the assignee's avatar.</HelpDef>
          <HelpDef term="Key (on a card)">The task's short code (e.g. KHS-12) — for quick search and reference.</HelpDef>
          <HelpDef term="Quarter badge (Q1–Q4)">If a quarter is set on a card, an orange Q badge appears on it and the card stands out with an amber border.</HelpDef>
        </dl>
        <p>
          Each card has a three-dot (<HelpKey>⋯</HelpKey>) menu in its top-right corner —
          for changing status, priority, type and assignee without opening the card. If a
          checklist has been added to a task, a thin progress bar with a percentage shows at
          the bottom of the card. The <strong>DONE</strong> column shows only the last 14
          days' tasks (up to 10) by default; the rest hide behind a "+N more completed"
          button.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: move a task between columns">
        <HelpStep n={1}>
          <p>
            Make sure you're on the <HelpKey>Board</HelpKey> tab. Grab the card you want to
            move with your mouse and drag it to another column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While dragging, a "lifted" copy of the card follows the cursor at a slight tilt
            and the source card dims. The column you hover over darkens and gets a dashed
            outline.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Drop the card over the target column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card settles into the new column with a soft animation, and both columns'
            header counts change to match. If you don't have permission for that stage
            transition, the card snaps back to its original spot and a "You don't have
            permission for this status transition" toast appears at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Simply <strong>clicking</strong> a card (without dragging) opens the full task
            view. A move only starts after you drag a card a little (about 8 pixels) — so an
            accidental click won't change a task's place.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: quick-edit a card (⋯ menu)">
        <HelpStep n={1}>
          <p>
            Click the three-dot (<HelpKey>⋯</HelpKey>) button in the card's top-right corner.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small dropdown menu opens, organized into sections: <strong>Status</strong>{" "}
            (the board's columns), <strong>Priority</strong>, <strong>Type</strong> if the
            board has types, <strong>Event type</strong> if event types exist, and{" "}
            <strong>Assignee</strong>. A green ✓ marks the current choice.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the value you want — for example a new priority or assignee. The assignee
            list loads the first time you open the menu; choose <HelpKey>Unassigned</HelpKey>
            to clear the assignment.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After your choice the menu closes and the card reflects the new value (pick a
            status and the card moves to the matching column). If you lack permission, a
            "You don't have permission to edit this task" toast appears at the bottom.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a new task">
        <HelpStep n={1}>
          <p>
            Click the orange <HelpKey>New Task</HelpKey> button in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "New Task" dialog opens. It has a <strong>Title</strong> field (with a "Task
            title" hint), side-by-side <strong>Type</strong> and <strong>Priority</strong>{" "}
            dropdowns, <strong>Assignee</strong> and <strong>Quarter</strong> dropdowns, and
            a <strong>Due date</strong> picker at the end.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Title</strong> — it's the only required field (at least 3, at most
            200 characters). Optionally pick a type, priority, assignee, quarter and due date.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While the title is too short the <strong>Create</strong> button stays dimmed and
            disabled. Priority defaults to "Medium". The assignee and quarter dropdowns start
            on "—" (empty).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>, the × in the top-right, or a click outside the dialog.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Creating…", then the dialog closes and the new task
            appears on the board in the <strong>BACKLOG</strong> column (new tasks start at
            that stage). If the server returns an error, a red explanation shows inside the
            dialog.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter and search">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>Board</HelpKey> tab, click the{" "}
            <HelpKey>Assigned to me</HelpKey> or <HelpKey>Created by me</HelpKey> pills in
            the toolbar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The active pill lights up with an orange border, and the columns show only tasks
            assigned to (or created by) you; your column counts drop accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To filter by name or key, type into the <HelpKey>Search</HelpKey> box. To narrow
            further, pick a value from the <HelpKey>Type</HelpKey>, <HelpKey>Event</HelpKey>,{" "}
            <HelpKey>Priority</HelpKey> and <HelpKey>Assignee</HelpKey> dropdowns.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The board filters instantly as you type. The <strong>Assignee</strong> dropdown
            lists only users who are an assignee on this board's tasks. Your chosen filters
            are kept in the address bar — share the link or refresh the page and the same
            filters stay.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To clear a filter, return the dropdown to its first (empty "Type", "Priority",
            etc.) option, empty the search box, or click the pills again to toggle them off.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As each filter clears, the hidden cards return and the column counts reflect all
            tasks again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: open a task and expand the DONE column">
        <HelpStep n={1}>
          <p>
            Click any card once (without dragging).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The full task view opens over the board — there you can edit the title, status,
            assignee and other fields. When you close it with × or a click outside, the board
            reflects the latest changes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To see more completed tasks in the <strong>DONE</strong> column, click{" "}
            <HelpKey>+N more completed — show all ↓</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The column expands in place to show all completed tasks; the button changes to{" "}
            <HelpKey>Show less ↑</HelpKey>, which returns you to the last-14-days view.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The Board and List tabs show the same tasks — just a different view. If you'd
          rather not drag cards, switch to the <HelpKey>List</HelpKey> tab and change the
          status inline in the table; the task moves to the matching column on the board too.
          The board auto-refreshes when it regains focus, but you can press{" "}
          <HelpKey>Refresh</HelpKey> any time to be sure.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A move or edit can sometimes be undone: if the server refuses it (for example, that
          status transition is blocked for you), the change is rolled back automatically and a
          short toast shows at the bottom of the screen. When that happens, don't assume the
          change went through — read the toast.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          You only see boards you've been granted access to; another board's tasks aren't
          visible to you. The <strong>Configuration</strong> (gear) button is shown only to
          board admins — manager, admin and superadmin roles. Moves between columns and edits
          are also checked against your permissions on the server, so even when a button is
          visible, a change you're not allowed to make is rejected.
        </p>
      </HelpCallout>
    </div>
  )
}
