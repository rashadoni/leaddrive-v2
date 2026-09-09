"use client"

/**
 * Boards index — help article (English).
 * Covers only the /boards list page: the list of boards (divisions),
 * creating a board, editing a board (name, color, members, columns),
 * importing board-less tasks and archiving a board. The board INTERIOR
 * (Kanban cards, status transitions) lives at /boards/[id] and is NOT
 * covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function BoardsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a team lead, manager or administrator"
        goal="Split team work into Kanban boards (divisions) and control who can access each board and what columns it has"
      >
        You reach this page from the <HelpKey>Boards</HelpKey> item in the sidebar. It lists every Kanban
        board in your organization as cards. Creating, editing and archiving boards is open only to{" "}
        <strong>admin</strong>, <strong>superadmin</strong> and <strong>manager</strong> roles; other
        users can see and open boards, but the create/edit buttons do not appear for them.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a columns icon next to the <HelpKey>Boards</HelpKey> title. If you have
          management permission, a <HelpKey>New Board</HelpKey> button sits at the top right. Below,
          boards are shown in a three-column card grid. If there are no boards yet, an empty state
          (<HelpKey>No boards yet</HelpKey>) is shown instead. A brief "Loading…" line may appear while
          the page loads.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Board (division)">A self-contained Kanban workspace — with its own key, name, color, columns, members and tasks.</HelpDef>
          <HelpDef term="Key">The board's 1–16-character short code (letters and digits only, e.g. KHS) — shown as a colored badge on the card and uppercased automatically.</HelpDef>
          <HelpDef term="Members">Users who have access to this board. You and admins always have access; selected users see only this board.</HelpDef>
          <HelpDef term="Columns">The board's Kanban columns — they can be renamed, reordered and recolored. Each column has a "Counts as" stage (the status a task takes when moved into it).</HelpDef>
          <HelpDef term="Counts as">The standard stage assigned to a column: Backlog, To Do, In Progress, Testing, Review or Done.</HelpDef>
          <HelpDef term="Archive">Removes a board from the list but keeps its tasks (it is not a delete).</HelpDef>
        </dl>
        <p>
          Each board card shows the board's colored <strong>key</strong> badge at the top left, the
          board <strong>name</strong> below it, then the task count (e.g. "12 tasks") and, if set, the
          board head's name. If you have management permission, a pencil-icon{" "}
          <HelpKey>Edit board</HelpKey> button appears at the top right of the card; if you don't, an
          arrow appears in its place when you hover over the card. Clicking the card itself (key/name)
          takes you into the board — its Kanban page.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a board">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Board</HelpKey> at the top right. (If there are no boards yet, the button
            in the middle of the empty state works too.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "New Board" dialog opens. It contains a <strong>Key</strong> field (placeholder "KHS"), a{" "}
            <strong>Name</strong> field, a palette of seven color circles, a <strong>Members (who has
            access)</strong> picker, and <HelpKey>Cancel</HelpKey> / <HelpKey>Create</HelpKey> buttons at
            the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Key</strong> — a short code (letters and digits only, 1–16 characters). It is
            uppercased automatically as you type. Then type the board's name in the <strong>Name</strong>{" "}
            field.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The key appears in uppercase. If the key is not a valid format (empty or has disallowed
            characters) or the name is empty, the <HelpKey>Create</HelpKey> button stays dimmed
            (not clickable).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Pick a color from the palette (click it) — this becomes the background of the key badge on the card.</p>
          <HelpCallout kind="see" label="What you'll see">
            A dark ring appears around the circle you picked, marking it as the current selection.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally, in <strong>Members</strong>, type a name or email in the search box to filter
            users, then tick the checkboxes next to them.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A user list (name + email) appears under the search box; matches are filtered as you type.
            Below the list is the hint "You and admins always have access; selected users see only this
            board."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Use <HelpKey>Cancel</HelpKey>{" "}
            or the × at the top right.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Creating…", then the dialog closes and the new board appears in the
            card grid. If something fails, a red error message (e.g. "Change failed") is shown inside the
            dialog.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            The users you tick at creation immediately become board members — they get full access to the
            board (view, create tasks, edit, move across columns and comment).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: edit a board (name, color, members, columns)">
        <HelpStep n={1}>
          <p>
            Click the pencil-icon <HelpKey>Edit board</HelpKey> button at the top right of the board card
            you want to manage.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Edit board · &lt;KEY&gt;" dialog opens, pre-filled with the current <strong>Name</strong>,
            the color palette, the <strong>Members</strong> picker, the <strong>Columns</strong> editor,
            and an <HelpKey>Import unassigned tasks into this board</HelpKey> button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Change the <strong>Name</strong>, pick a different color if needed, and update who has access
            by ticking/unticking checkboxes in the <strong>Members</strong> list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The member picker shows the board's current members pre-ticked. Unticking a user revokes their
            access; ticking a new user grants it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <strong>Columns</strong> editor, reorder columns with the up/down arrows on each row,
            click the colored dot on the left to set a color (<HelpKey>Auto</HelpKey> or a preset), rename
            the column in the middle field, and set its stage with the <HelpKey>Counts as</HelpKey>{" "}
            dropdown on the right. Use <HelpKey>Add column</HelpKey> for a new one, or the trash icon to
            remove one.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking the colored dot opens a small color picker (Escape closes it). The{" "}
            <HelpKey>Counts as</HelpKey> dropdown offers the six standard stages: Backlog, To Do, In
            Progress, Testing, Review, Done. <HelpKey>Add column</HelpKey> dims once there are 12 columns,
            and the remove button dims when only one column is left. Below the editor is the hint
            "…'Counts as' sets the stage a task takes when moved here."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Save</HelpKey> at the bottom right. (<HelpKey>Cancel</HelpKey> or × discards the
            changes and closes the dialog.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving…", then the dialog closes and the card shows the updated
            name/color. If you leave the name empty or have an unnamed column, <HelpKey>Save</HelpKey>{" "}
            stays dimmed; if an access change doesn't fully apply, a red error message is shown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: import board-less tasks and archive a board">
        <HelpStep n={1}>
          <p>
            In the edit dialog, click the middle <HelpKey>Import unassigned tasks into this board</HelpKey>{" "}
            button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation appears: "Move all tasks that aren't on any board into this board? They
            become visible only to this board's members." After you confirm, the import runs and a
            "&lt;count&gt; tasks moved into this board." notice is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To remove a board from the list, click the red trash-icon <HelpKey>Archive</HelpKey> button at
            the bottom left of the edit dialog.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation appears: "Archive this board? It disappears from the list; its tasks
            are kept." After you confirm, the dialog closes and the board disappears from the card grid.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Import</strong> only affects tasks that currently belong to NO board, and once moved
            they become visible only to this board's members — i.e. it narrows who can see them.{" "}
            <strong>Archive</strong>, on the other hand, does not delete the board: tasks stay in place,
            the board just disappears from the list.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Clicking a board card (its key or name) opens the board's INTERIOR — the Kanban page — not the
          edit dialog. To change a board's settings, click the pencil-icon button at the top right
          instead.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All boards and member assignments are scoped to your organization — you can only add users from
          your own tenant as members. The create, edit and archive buttons are visible only to
          admin/superadmin/manager roles; view-only users cannot perform these actions.
        </p>
      </HelpCallout>
    </div>
  )
}
