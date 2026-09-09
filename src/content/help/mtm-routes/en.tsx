"use client"

/**
 * MTM Routes — help article (English).
 * REWRITE: previously shared with visits and tasks — those now have
 * their own articles. This article covers ONLY the /mtm/routes page
 * (route planning + list/calendar views + detail panel). Visit and
 * task management is NOT included here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmroutesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a field-operations supervisor or route planner"
        goal="Plan daily routes for your agents, line up which customer points they visit, and track how execution is going"
      >
        You reach this page from the <HelpKey>Routes</HelpKey> section. It opens in{" "}
        <HelpKey>Calendar</HelpKey> view so you can understand the month before making changes. The visible
        month and week are loaded in full within your access scope, and every route belongs to your
        organization only. For search and history, open <HelpKey>More</HelpKey> → <HelpKey>All routes</HelpKey>.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          <HelpKey>Calendar</HelpKey> is the primary view. Managers and reviewers also see{" "}
          <HelpKey>Team week</HelpKey>. <HelpKey>More</HelpKey> contains <HelpKey>All routes</HelpKey>, the
          week planner and, when your role allows it, approvals. Agents see their own history there as{" "}
          <HelpKey>My routes</HelpKey>. <HelpKey>Plan route</HelpKey> starts a new route from any view.
          A compact monthly summary shows <strong>This month</strong>, <strong>Planned</strong>,{" "}
          <strong>In Progress</strong> and <strong>Completed</strong> without taking attention away from the
          plan itself.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="This month">All routes in the month currently shown in the calendar.</HelpDef>
          <HelpDef term="Planned">Routes in the visible month that are ready for field execution.</HelpDef>
          <HelpDef term="In Progress">Routes in the visible month that agents have started.</HelpDef>
          <HelpDef term="Completed">Routes in the visible month that agents have completed.</HelpDef>
          <HelpDef term="Incomplete">Routes whose day ended while they were still open. The system closes them a few hours after midnight and keeps everything that was visited; nobody cancelled them.</HelpDef>
          <HelpDef term="Route">A daily plan with one agent, one date and an ordered list of customer points; status can be DRAFT / PLANNED / IN_PROGRESS / COMPLETED / INCOMPLETE / CANCELLED.</HelpDef>
          <HelpDef term="Point">A customer added to the route; its visit state can be VISITED (green), SKIPPED (red) or neutral.</HelpDef>
        </dl>
        <p>
          <HelpKey>All routes</HelpKey> is the best view for search and history. Each route card shows the agent’s
          name, the date, a status badge on the right, plus
          edit (pencil) and delete (trash) buttons. Below that is a row with the point count, the visited
          count, a percentage progress bar, and a strip of small numbered chips for each point. Clicking the
          card itself opens a detail panel above the list.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a route">
        <HelpStep n={1}>
          <p>
            Start from the place that matches your task: click <HelpKey>Plan route</HelpKey>, choose an empty
            date in <HelpKey>Calendar</HelpKey>, or choose an empty employee/date cell in{" "}
            <HelpKey>Team week</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The full-page route builder opens. A calendar date is filled in automatically; a Team week cell
            also fills in the employee. You can change either value before saving.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Follow the first two steps shown at the top: <HelpKey>Who and when</HelpKey>, then{" "}
            <HelpKey>Customers</HelpKey>. Choose the employee and date, then add organizations, doctors or
            contacts with the direction tabs, search and filters.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each finished step gets a check mark. Selected customers stay selected while you search, change
            filters or move between customer groups. Optional route name, participants and notes stay under
            the additional settings section.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Review the selected stops, their order and planned times. Then choose <HelpKey>Save draft</HelpKey>
            or, if your role allows it, publish the route.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The third step becomes ready only after an employee, date and at least one customer are selected.
            After saving, you return to the Calendar, All routes or Team week view from which you opened the
            builder, and the saved route is selected there.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search, filter and sort routes">
        <HelpStep n={1}>
          <p>
            Open <HelpKey>More</HelpKey> → <HelpKey>All routes</HelpKey>, then click one of the status filter
            buttons: <HelpKey>All</HelpKey>, <HelpKey>Draft</HelpKey>,{" "}
            <HelpKey>Planned</HelpKey>, <HelpKey>In Progress</HelpKey>, <HelpKey>Completed</HelpKey>,{" "}
            <HelpKey>Incomplete</HelpKey> or <HelpKey>Cancelled</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each button shows the count of routes in that status in parentheses. The selected filter
            highlights and the list narrows to routes in that status only.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a specific route, type into the <HelpKey>Search routes...</HelpKey> field.
          </p>
          <HelpCallout kind="see" label="What you’ll see">
            The list filters as you type — search matches both the agent’s name and the route name. If
            nothing matches you’ll see “No routes match the filter”; if there are no routes at all, “No
            routes yet”.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick a sort from the dropdown on the right: <HelpKey>Date ↓</HelpKey> (newest first),{" "}
            <HelpKey>Date ↑</HelpKey> (oldest first) or <HelpKey>By Status</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list immediately re-orders to the chosen sort.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: view route details">
        <HelpStep n={1}>
          <p>
            Click any route card in the list (or, in calendar view, click a route chip on a day).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A detail panel opens above. The header shows the route name (or agent name) with the date, and
            an × to close on the right. Below it sit five metric tiles: <strong>Completed</strong>{" "}
            (visited/total), <strong>Execution</strong> (completion percentage), <strong>Duration</strong>{" "}
            (elapsed time if start and finish are recorded), <strong>Points</strong> (point count), and{" "}
            <strong>Distance</strong> (kilometers, if available).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Keep scanning the panel if the points have coordinates.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If at least one point has coordinates, a small map shows below the metrics. Further down the
            points are listed with a sequence number (1, 2, 3 …), the customer name and a status badge
            (VISITED / SKIPPED / other); if a visit time exists, it appears at the end of the row.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            When done, close the panel with the × in its top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The detail panel closes and you stay in the Calendar, All routes or Team week view you were using.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: calendar, team week, edit and delete">
        <HelpStep n={1}>
          <p>
            Use the default <HelpKey>Calendar</HelpKey> view to plan by date. Use the arrows to change months
            or <HelpKey>Today</HelpKey> to return to the current date.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On desktop, the complete month appears as a grid. On a phone or tablet, you get a touch-friendly
            month selector and an agenda for the selected day instead of a squeezed desktop grid. A route
            shows its employee, customer summary, point count and status. Choose a route to open it, or an
            empty date to start a route with that date already filled in.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Open <HelpKey>Team week</HelpKey> to compare employees across seven days.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If your role permits team planning, employees are rows and dates are columns. The employee column stays visible while you scroll.
            Choose an empty cell to start a route with both the employee and date already filled in.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To change a route, click the pencil icon (<HelpKey>Edit Route</HelpKey>) on its card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The route builder opens with the existing employee, date, customers and notes. Make the allowed
            changes and save. Completed or skipped stops remain locked so field history is not rewritten.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To delete a route, click the red trash icon (<HelpKey>Delete Route</HelpKey>) on its card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the route is already published, removing a customer point creates a change request. The point
            stays on the route until a manager approves it; rejected requests leave the route unchanged.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Excel exchange for routes and reference data">
        <p>
          Administrators and enabled managers can open <HelpKey>Excel exchange</HelpKey>, choose Customers,
          Routes, Sales facts or Plan, and download a localized template. Uploading validates every row first:
          create, update, unchanged and error counts are shown before any business data is written.
        </p>
        <HelpCallout kind="tip">
          Fix the downloadable row-and-column error workbook before applying. Route external IDs, agent codes
          and customer codes are used to update existing records safely; duplicate or conflicting routes are
          blocked unless an authorized reviewer explicitly accepts the conflict.
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          The mobile app does not show a route whose date is in the past. That’s why the form warns you on a
          past date — keep the date today or in the future so the agent actually sees the route on their
          phone.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All routes, agents and customers are scoped to your organization — only your tenant’s routes are
          loaded into the list, and the form only lets you pick agents and customers from your own
          organization. You never see another organization’s routes.
        </p>
      </HelpCallout>
    </div>
  )
}
