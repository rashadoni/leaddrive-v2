"use client"

/**
 * Projects — help article (English).
 *
 * Covers the Projects section: the list (KPIs / filters / search / bulk /
 * export) and the project record (Overview / Tasks / CRM Activity /
 * Members / Milestones / Budget), plus how completion and cost roll up.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProjectsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="What Projects is for">
        <p>
          A <strong>project</strong> is a piece of work you run to completion — with a budget, a
          timeline, a team, milestones, and tasks. It sits on top of your CRM: a project can be
          tied to a <strong>company</strong> and a <strong>deal</strong>, so delivery work stays
          connected to the revenue it came from.
        </p>
        <p>
          The list page is your portfolio view; opening one project drills into everything that
          makes it move.
        </p>
      </HelpSection>

      <HelpSection title="The list — your project portfolio">
        <p>
          Four KPI cards sit at the top — <HelpKey>Total</HelpKey>, <HelpKey>Active</HelpKey>,{" "}
          <HelpKey>Completed</HelpKey>, and <HelpKey>Overdue</HelpKey>. Each card is clickable and
          acts as a quick filter.
        </p>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>New project</HelpKey> to open the form. Set a name (required),
            description, status, priority, start / end dates, manager, company, deal, currency,
            budget, a color, and tags. If you don&apos;t enter a code, one is generated for you in
            the form <em>PRJ-001</em>, <em>PRJ-002</em>, …
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Narrow the list with the status filter pills (<em>Planning</em>, <em>Active</em>,{" "}
            <em>On hold</em>, <em>Completed</em>, <em>Cancelled</em>) — a pill only appears when at
            least one project has that status. The search box matches on the project{" "}
            <strong>name</strong>.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click any row to open the project. The list is paginated 20 per page; the column shows
            a colored completion bar and turns the end date red when a project is past due.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Tick the checkboxes to select rows, then use the bulk bar to{" "}
            <HelpKey>Change status…</HelpKey> for all of them at once or delete them together.{" "}
            <HelpKey>Export</HelpKey> downloads the current list as a CSV (name, code, status,
            priority, company, completion, budget, currency, dates).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Status, priority &amp; overdue">
        <p>
          Every project carries a <strong>status</strong> and a <strong>priority</strong>, and the
          list flags anything that has slipped past its end date.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status">planning → active → on&nbsp;hold → completed / cancelled</HelpDef>
          <HelpDef term="Priority">low, medium, high, critical</HelpDef>
          <HelpDef term="Overdue">end&nbsp;date is in the past and status isn&apos;t completed or cancelled</HelpDef>
        </dl>
        <HelpCallout kind="next">
          <p>
            Setting a project to <em>Active</em> stamps its actual start date; setting it to{" "}
            <em>Completed</em> stamps the actual end date and snaps completion to{" "}
            <strong>100%</strong>. This happens whether you edit one project or change status in
            bulk.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Inside a project — six tabs">
        <p>
          Open a project and a sidebar shows the at-a-glance summary (completion, status, priority,
          manager, company, dates, budget vs. actual cost, plus an <em>Overdue</em> badge). The
          work itself lives across six tabs:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Overview">task breakdown, budget summary, and a milestone timeline</HelpDef>
          <HelpDef term="Tasks">the project&apos;s own task list, as a List or Kanban board</HelpDef>
          <HelpDef term="CRM Activity">CRM tasks linked to this project from the Tasks page</HelpDef>
          <HelpDef term="Members">people on the project, with role and logged hours</HelpDef>
          <HelpDef term="Milestones">phases, each with its own progress bar</HelpDef>
          <HelpDef term="Budget">budget, actual cost, remaining, and per-member cost</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Tasks &amp; milestones">
        <p>
          Project tasks move through <strong>To do → In progress → Review → Done</strong> (plus a{" "}
          <em>Cancelled</em> state). Each task can have a priority, an assignee, a due date,
          estimated hours, and a milestone.
        </p>
        <HelpStep n={1}>
          <p>
            On the Tasks tab, switch between a <HelpKey>List</HelpKey> and a{" "}
            <HelpKey>Kanban</HelpKey> board. On the board, drag a card to a new column to change its
            status. Filter by status, milestone, or assignee.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Use <HelpKey>Add milestone</HelpKey> to create a phase with a due date and a color. A
            milestone&apos;s progress bar fills as its tasks reach <em>Done</em>, and its due date
            turns red once it&apos;s overdue.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            A project&apos;s overall <strong>completion %</strong> isn&apos;t typed in by hand — it
            is recalculated from finished work: project tasks marked <em>Done</em> plus linked CRM
            tasks marked <em>Completed</em>, over the total. A project with no tasks at all reads
            0%.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Members, budget &amp; cost">
        <p>
          Add teammates on the <HelpKey>Members</HelpKey> tab with a role —{" "}
          <strong>Manager</strong>, <strong>Member</strong>, or <strong>Viewer</strong>. A member
          can carry an hourly rate and logged hours.
        </p>
        <HelpStep n={1}>
          <p>
            The <HelpKey>Budget</HelpKey> tab shows budget, actual cost, and remaining. The
            &quot;% used&quot; bar is green up to 70%, amber above 70%, and red above 90%; on the
            Overview tab&apos;s budget summary the remaining figure turns red once you&apos;ve
            overspent.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For every member who has an hourly rate, the Budget tab lists{" "}
            <em>hours × rate</em> and totals it — a quick read on where labour cost is going.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="CRM Activity — work linked from Tasks">
        <p>
          This tab is the other half of the link to your CRM. Tasks you tagged to this project from
          the <strong>Tasks</strong> page show up here, grouped into <HelpKey>Open</HelpKey> and{" "}
          <HelpKey>Completed</HelpKey>. Click one to jump straight to that task.
        </p>
        <HelpCallout kind="warning">
          <p>
            This list loads up to <strong>200</strong> linked tasks; past that you&apos;ll see a
            banner and should manage the rest from the Tasks page. The empty state points you to it:
            open a task and pick this project, or use the project filter on{" "}
            <strong>/tasks</strong>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Everything here is scoped to your organization — you only see and act on your own
          tenant&apos;s projects. Deleting a project is <strong>permanent</strong> (there&apos;s no
          trash): it removes that project&apos;s members, milestones, and project tasks, and unlinks
          any CRM task that pointed at it. The manager, company, and deal it referenced — and those
          unlinked CRM tasks — are not deleted.
        </p>
      </HelpCallout>
    </div>
  )
}
