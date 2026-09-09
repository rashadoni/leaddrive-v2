"use client"

/**
 * Project detail — help article (English).
 * Covers the project record page (/projects/[id]): header + status/priority
 * badges, left sidebar (overview metrics), six tabs (Overview · Tasks ·
 * CRM Activity · Members · Milestones · Budget) and the edit/delete buttons.
 * Main workflow: managing tasks, milestones and the team.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProjectDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a project manager or team member"
        goal="Track a project's progress — manage its tasks, milestones, team and budget on one screen"
      >
        You reach this page by clicking any project's name in the <HelpKey>Projects</HelpKey> list. All
        data belongs to your organization only. When the page opens you see the project name, status and
        priority at the top, an overview sidebar on the left, and the tabs on the right. Every change you
        make here (adding a task, completing a milestone, adding a member) feeds the project's{" "}
        <strong>completion percentage</strong>, and the metrics update immediately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left there's a back arrow (<HelpKey>Back to Projects</HelpKey>), then a colored dot and the
          project name. Next to the name are two badges: <strong>status</strong> (Planning / Active / On
          hold / Completed / Cancelled) and <strong>priority</strong> (Low / Medium / High / Critical).
          If present, the project code, description and tags show below it. Top-right are the{" "}
          <HelpKey>Edit</HelpKey> and <HelpKey>Delete</HelpKey> buttons.
        </p>
        <p>
          Below, the page splits into two columns. On the left is the <strong>overview sidebar</strong>:
          a completion bar and percentage, a red "Overdue" warning if the end date has passed, then
          status, priority, manager, company, start/end dates, budget, actual cost and created date. On
          the right is a six-tab section.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Overview">Metric cards, the task breakdown by status, a budget summary and a milestone timeline.</HelpDef>
          <HelpDef term="Tasks">The project's own task list — in List or Kanban view, with status / milestone / assignee filters. The count is shown in the tab label.</HelpDef>
          <HelpDef term="CRM Activity">CRM tasks linked to this project from the /tasks side (grouped as Open and Completed); clicking one jumps to that task.</HelpDef>
          <HelpDef term="Members">The project team — role (Manager / Member / Viewer), hours logged, hourly rate and join date. The count is shown in the tab label.</HelpDef>
          <HelpDef term="Milestones">The project's milestones — due date, color and task-based progress. The count is shown in the tab label.</HelpDef>
          <HelpDef term="Budget">Budget, actual cost, remaining funds, a usage bar and a cost table for members with an hourly rate.</HelpDef>
        </dl>
        <p>
          Each tab label shows a count in parentheses (e.g. <HelpKey>Tasks (8)</HelpKey>), so you can
          tell how many items are inside before opening the tab.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: add and manage a task">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Tasks</HelpKey> tab on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top a <HelpKey>List</HelpKey> / <HelpKey>Kanban</HelpKey> view toggle, dropdown filters
            by status, milestone and assignee next to it, and an <HelpKey>Add task</HelpKey> button on the
            right. If there are no tasks, "No tasks match filters" shows in the center.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Add task</HelpKey> and in the form that opens type a <strong>Name</strong>{" "}
            (required). Optionally pick status, priority, assignee, milestone, due date and estimated
            hours.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A form opens above the list: a name field, four dropdowns (status, priority, assigned to,
            milestone), a date picker and an "Estimated hours" field. The <HelpKey>Create</HelpKey>{" "}
            button stays disabled while the name is empty.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create</HelpKey>. To change an existing task click the pencil icon on its row;
            to delete it click the trash icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new task appears in the table (with name, status, priority, assignee, due date and
            milestone columns). The task count updates in the tab label and in the metrics on the{" "}
            <HelpKey>Overview</HelpKey> tab.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Switch the view to <HelpKey>Kanban</HelpKey> — drag tasks between columns to change their
            status.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Four columns appear: <strong>To do</strong>, <strong>In progress</strong>,{" "}
            <strong>Review</strong>, <strong>Done</strong>. Dropping a card into another column updates
            its status automatically and the column counts reflect it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a milestone">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Milestones</HelpKey> tab and click <HelpKey>Add milestone</HelpKey> in the
            top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A form opens: a <strong>Name</strong> field, a due-date picker and a color picker (defaults to
            purple, its code shown alongside). If there are no milestones yet, "No milestones yet" shows
            before this.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the name, optionally pick a due date and color, then click <HelpKey>Create</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The milestone is added to the list as a card — its left edge in the color you chose, with the
            due date, an "X/Y tasks" count, a status badge and a progress bar below it. Progress is
            computed from the completed tasks linked to that milestone.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To link tasks to a milestone, edit a task on the <HelpKey>Tasks</HelpKey> tab and pick this
            milestone from its "Milestones" dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The task's <strong>Milestones</strong> column shows the milestone name with a colored dot; the
            "X/Y tasks" count and progress bar on the milestone card update accordingly.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add a team member">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Members</HelpKey> tab and click <HelpKey>Add member</HelpKey> in the top
            right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A form with two dropdowns opens: the first lists users (only those who are NOT already
            members), the second sets the role — <strong>Manager</strong>, <strong>Member</strong> or{" "}
            <strong>Viewer</strong>. If there are no members yet, "No members yet" shows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the user and role, then click <HelpKey>Create</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The member is added to the table with an initial-letter avatar, role (a colored dot + a
            changeable dropdown), hours logged (with hourly rate if set) and join date columns. The count
            in the <HelpKey>Members</HelpKey> tab label goes up by one.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To change a member's role pick a new role from the role dropdown on their row; to remove a
            member click the trash icon at the end of the row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The role updates immediately. A removed member disappears from the table and becomes available
            again in the <HelpKey>Add member</HelpKey> dropdown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the budget and overview">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Overview</HelpKey> tab for an at-a-glance view of the project.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Four metric cards at the top: <strong>Tasks</strong>, <strong>Members</strong>,{" "}
            <strong>Milestones</strong> and <strong>Completion</strong>. Below them are the task
            breakdown by status (To do / In progress / Review / Done), a budget summary and a milestone
            timeline (when milestones exist).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For financial detail open the <HelpKey>Budget</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three cards: <strong>Budget</strong>, <strong>Actual cost</strong> and remaining budget. Below
            is a colored usage bar (red above 90%, amber above 70%, green otherwise) and an "X% used"
            label. If any members have an hourly rate, their hours × rate = cost table and a{" "}
            <strong>Total</strong> row are shown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete the project">
        <HelpStep n={1}>
          <p>
            To change the project's core details click <HelpKey>Edit</HelpKey> (pencil icon) in the top
            right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The "Edit project" dialog opens pre-filled with the current values: name, description, status,
            priority, start/end dates, manager, company, deal, currency, budget, color and tags. Make your
            changes and confirm with <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete the project click <HelpKey>Delete</HelpKey> (red trash icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog opens showing the project name. After you confirm, the project is
            deleted and you're returned to the <HelpKey>Projects</HelpKey> list.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion can't be undone — the project goes along with its tasks, milestones and member
            assignments. If you only want to pause the project, use <HelpKey>Edit</HelpKey> to set the
            status to <strong>On hold</strong> or <strong>Cancelled</strong> instead of deleting.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>Tasks</strong> tab is the project's own task list; the{" "}
          <strong>CRM Activity</strong> tab shows tasks linked to this project from the CRM side (the
          /tasks page). Both feed the completion percentage. If no CRM task is linked, the tab shows "No
          CRM tasks linked to this project yet".
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All project data, tasks, members and budget are scoped to your organization — you can only add
          your own tenant's users as members, and you can't see other organizations' projects. The member
          and manager dropdowns come from your organization's users.
        </p>
      </HelpCallout>
    </div>
  )
}
