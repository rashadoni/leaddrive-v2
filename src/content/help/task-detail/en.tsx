"use client"

/**
 * Task detail (/tasks/[id]) — help article (English).
 * Covers a single task's detail page: title + status/priority badges, top
 * action buttons (Edit / Delete / Sync to Calendar), the clickable status
 * pipeline, the compact stats strip, the Description / Checklist / Attachments
 * / Comments column, and the right-hand "Task Info" card (Assignee,
 * Collaborators, Priority, Type, Event type, Related entity, Project) plus the
 * Series panel for recurring tasks. The same view also opens inside the board's
 * task modal.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TaskDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a team member or a manager"
        goal="Open one task and work it — change its status, assign it, add checklist items and comments, attach a file"
      >
        You reach this page by clicking any task from the task list or the board
        (URL <HelpKey>/tasks/&lt;id&gt;</HelpKey>). The same view also opens as a
        modal when you click a task on the board. Everything you see here —
        status, assignee, checklist, comments — belongs only to your
        organization and is saved in real time: each change re-loads the task.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is a breadcrumb back to the task list, then the task{" "}
          <strong>title</strong> with its status badge (e.g.{" "}
          <HelpKey>In Progress</HelpKey>), priority badge (e.g.{" "}
          <HelpKey>High</HelpKey>), and — if set — related-entity and recurrence
          badges next to it. On the right are the <HelpKey>Edit</HelpKey> and
          red <HelpKey>Delete</HelpKey> buttons; if the task has a due date, a{" "}
          <HelpKey>Sync to Calendar</HelpKey> (Google Calendar) button also
          appears.
        </p>
        <p>
          Below the title is a compact stats strip: days open, time to the due
          date (red "overdue" once it passes), checklist progress, comment and
          attachment counts, and the assignee on the right. Under it is the
          clickable <strong>status pipeline</strong>. The page then splits into
          two columns: on the left <strong>Description</strong>,{" "}
          <strong>Checklist</strong>, <strong>Attachments</strong> and{" "}
          <strong>Comments</strong>; on the right the <strong>Task Info</strong>{" "}
          card and (when present) the <strong>Series</strong> /{" "}
          <strong>Custom Fields</strong> cards.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status pipeline">Stages laid out as a horizontal strip; the current stage lights up in color. Click another stage to change the status directly.</HelpDef>
          <HelpDef term="Stats strip">Days open, due-date countdown, checklist progress, comment and attachment counts, assignee — one line so nothing needs a scroll.</HelpDef>
          <HelpDef term="Checklist">Sub-steps for the task; each item can be ticked, and the header shows a progress percentage.</HelpDef>
          <HelpDef term="Comments">Team discussion; system notes also appear here, dimmed.</HelpDef>
          <HelpDef term="Attachments">Files uploaded to the task (max 10 MB each).</HelpDef>
          <HelpDef term="Task Info card">Assignee, Collaborators, Priority, Type, Event type, Related entity, Project, and created/updated dates — most are editable right here.</HelpDef>
          <HelpDef term="Series">Shows only on recurring tasks; lists every instance of the series and gives a "Stop series" button.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: change the status">
        <HelpStep n={1}>
          <p>
            In the <strong>status pipeline</strong> below the stats strip, click
            the stage you want to move to (e.g. <HelpKey>In Progress</HelpKey> or{" "}
            <HelpKey>Completed</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The stage you clicked lights up in color (filled), earlier ones dim
            as "past". The status badge in the header changes to match. If you
            mark it <HelpKey>Completed</HelpKey>, a green "Completed at" date
            appears in the Task Info card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            While the status saves, the pipeline briefly disables itself — wait
            rather than clicking again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Once saved, the page refreshes and the due-date indicator in the
            stats strip adjusts too (on a finished task the red "overdue"
            warning turns into a plain muted date).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: change assignee, priority and other fields">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Task Info</HelpKey> card on the right, click the{" "}
            <strong>Assignee</strong> row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A user list with a search box at the top opens. An{" "}
            <HelpKey>Unassigned</HelpKey> row sits at the very top; type a name
            to filter the list. Picking a user closes the list and shows that
            name as the assignee.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <strong>Collaborators</strong> row to tick extra team
            members with checkboxes (the assignee isn't in this list — one
            person can't be both assignee and collaborator).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The multi-select list stays open; each toggle shows a small spinner
            while saving and the chosen names gather as rounded chips on the row.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the <strong>Priority</strong> badge and pick a new level (
            <HelpKey>Urgent</HelpKey> / <HelpKey>High</HelpKey> /{" "}
            <HelpKey>Medium</HelpKey> / <HelpKey>Low</HelpKey>). The same way,{" "}
            <strong>Type</strong> and <strong>Event type</strong> are changed
            from a colored-dot dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The badge/label updates the moment you pick. To clear the event
            type, pick the <HelpKey>—</HelpKey> row at the top of its dropdown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click the <strong>Related entity</strong> row to link the task to a
            company, contact, deal, lead or ticket: pick one of the type icons
            at the top, then search by name.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Matches list below as you type; picking one saves the link. If the
            entity resolves, a deep-link (external-link) icon appears next to it.
            To remove the link, pick the <HelpKey>Clear</HelpKey> row at the top
            of the list.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            These inline fields save INSTANTLY — there's no separate "Save"
            button. To change the title, due date or recurrence rule, open the
            full form via the <HelpKey>Edit</HelpKey> button at the top.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: add a checklist item, attachment and comment">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Checklist</HelpKey> card on the left, type into the{" "}
            <HelpKey>Add item...</HelpKey> field at the bottom and press{" "}
            <HelpKey>Enter</HelpKey> (or use the <HelpKey>+</HelpKey> button next
            to it).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new item joins the list. Click the box to its left to mark it
            done — the text gets a strikethrough, and the "done/total" count and
            green progress bar in the header update.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Attachments</HelpKey> card, click{" "}
            <HelpKey>Add file</HelpKey> and choose a document from your computer.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner shows on the button while uploading, then the file appears
            in the list with its name, size and date. Each file has a download
            icon and an × to remove it. If a file is larger than 10 MB, a
            warning appears and it isn't uploaded.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <HelpKey>Comments</HelpKey> card, type your comment in the
            text box and press the send (paper-plane) button (or{" "}
            <HelpKey>Cmd/Ctrl + Enter</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The comment drops into the list below with your initial avatar and a
            "time ago" stamp. The comment count in the header goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit, sync to calendar or delete">
        <HelpStep n={1}>
          <p>
            To change the task's main fields (title, description, due date,
            recurrence rule, etc.), click <HelpKey>Edit</HelpKey> at the top
            right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The task form opens pre-filled with the current values. After you
            save your changes, the page refreshes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If the task has a due date, click <HelpKey>Sync to Calendar</HelpKey>{" "}
            to push it to Google Calendar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows "Syncing..." while it works. On success you get a
            confirmation; if the calendar isn't connected yet, you're offered a
            redirect to <HelpKey>Settings → Integrations</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete the task, click the red <HelpKey>Delete</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Task" confirmation dialog opens showing the task's name.
            After you confirm, the task is deleted and you're returned to the
            task list (in the board modal the dialog just closes).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion is permanent — the task takes its checklist, attachments and
            comments with it. Instead of deleting, setting the status to{" "}
            <HelpKey>Cancelled</HelpKey> is often the safer choice.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Recurring tasks (Series)">
        <p>
          If the task was created with a recurrence rule, its title shows a cycle
          badge (e.g. "weekly") and a <HelpKey>Series</HelpKey> card appears in
          the right column. On the parent task the card lists every instance with
          status pills in chronological order — click any row to jump to that
          instance; the current task is outlined. If you're on a child instance,
          the card shows a link back to the parent.
        </p>
        <HelpStep n={1}>
          <p>
            To stop new instances from being created, click{" "}
            <HelpKey>Stop series</HelpKey> at the top of the Series card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Stop this series? Existing instances stay, but no new ones will be
            created." confirmation opens. After you confirm, a success message
            appears and no further instances spawn; the existing ones remain.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Many fields on this page (status, assignee, collaborators, priority,
          type, event type, related entity, checklist) are edited inline — no
          need to open a form. The full form is only needed for core fields like
          title, description, due date and recurrence rule.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All tasks, comments, attachments and user lists are scoped to your
          organization — you only see your own tenant's tasks and can only set
          assignees/collaborators from your own users. File upload and delete
          actions are checked server-side against permissions (tasks:write /
          tasks:delete).
        </p>
      </HelpCallout>
    </div>
  )
}
