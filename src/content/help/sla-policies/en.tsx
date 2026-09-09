"use client"

/**
 * SLA Policies — help article (English).
 * Covers only Settings → SLA Policies (the policy list/table, creating a
 * policy, first-response and resolution targets, priority, business-hours
 * only, active/inactive, edit and delete). Tickets themselves are NOT in scope.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SlaPoliciesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a support lead or operations admin"
        goal="Set response and resolution time targets for tickets and split them by priority"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>SLA Policies</HelpKey>. All policies
        belong to your organization only. Each policy holds two targets for one priority level
        (critical, high, medium, low): the time for the team to send its <strong>first response</strong>
        {" "}and the time for the ticket to be <strong>fully resolved</strong>.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a clock icon with <HelpKey>SLA Policies</HelpKey>, the line «Response and
          resolution time targets», and the hint «SLA policies: define response and resolution time
          targets for tickets». Top right is the <HelpKey>Add Policy</HelpKey> button. Below sits a card
          titled <HelpKey>SLA Policies</HelpKey> containing the policy table. If you have no policies
          yet, the table shows a «No data available» row instead.
        </p>
        <p>
          Above the table there is a search box (<HelpKey>Search...</HelpKey>) and a results counter;
          search filters by policy name. The table columns are:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Policy Name">The name of the policy (e.g. «Critical SLA»).</HelpDef>
          <HelpDef term="Priority">A colored badge — <strong>Critical</strong> (red), <strong>High</strong> (orange), <strong>Medium</strong> (yellow), <strong>Low</strong> (green). Shows which ticket priority this policy applies to.</HelpDef>
          <HelpDef term="1st Response">The target time for the team to reply to the ticket for the first time, shown as «4h 30m» (hours and minutes).</HelpDef>
          <HelpDef term="Resolution">The target time for the ticket to be closed, in the same «hours minutes» format.</HelpDef>
          <HelpDef term="Business Hours">«Yes» means the target counts business hours only; «No» means time is counted continuously (24/7).</HelpDef>
          <HelpDef term="Status">Whether the policy is <strong>Active</strong> (blue badge) or <strong>Inactive</strong> (grey badge).</HelpDef>
        </dl>
        <p>
          At the end of each row there are two action buttons: a pencil icon (<HelpKey>Edit</HelpKey>)
          and a red trash icon (<HelpKey>Delete</HelpKey>). You can click column headers to sort the
          table; below it are page-size buttons (20 / 50 / 100 / All).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create an SLA policy">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Add Policy</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled «New SLA Policy» opens. It contains: <strong>Policy Name *</strong>, a{" "}
            <strong>Priority</strong> dropdown, an <strong>h</strong> (hours) and <strong>m</strong> (minutes)
            box each for <strong>Response Time (hours) *</strong> and <strong>Resolution Time (hours) *</strong>,
            plus <strong>Business hours only</strong> and <strong>Active</strong> checkboxes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Policy Name</strong> — this is the only text field and it is required (the
            box shows «Critical SLA» as a placeholder example).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the box as you type. Because the name is required, leaving it empty makes
            the browser prompt you to fill it in.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Choose a <strong>Priority</strong> — <HelpKey>Critical</HelpKey>, <HelpKey>High</HelpKey>,{" "}
            <HelpKey>Medium</HelpKey> or <HelpKey>Low</HelpKey> (defaults to <strong>Medium</strong>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown shows your selection. This value later appears in the table as the colored
            priority badge.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Set the <strong>Response Time (hours)</strong>: hours in the <em>h</em> box, minutes in the{" "}
            <em>m</em> box (default 4h 0m). Fill the <strong>Resolution Time (hours)</strong> boxes the
            same way (default 24h 0m).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Both fields accept numbers only; the minutes box is capped at 0–59. Each target needs at
            least 1 minute — if hours and minutes are both left at zero, saving shows the red warning
            «Minimum 1 minute — set hours and/or minutes.» at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Optionally tick <HelpKey>Business hours only</HelpKey> (checked by default), and toggle{" "}
            <HelpKey>Active</HelpKey> as needed (also checked by default).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With «Business hours only» ticked, the target is measured against working hours only. If you
            clear «Active», the policy will appear as <strong>Inactive</strong> in the table.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to <strong>Saving...</strong> while it saves, then the dialog closes and
            the new policy appears in the table — with its name, the colored priority badge, both targets
            in «hours minutes» format, Yes/No for business hours, and the status badge.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete a policy">
        <HelpStep n={1}>
          <p>
            To change a policy, click the pencil icon (<HelpKey>Edit</HelpKey>) on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens titled «Edit SLA Policy», pre-filled with the existing name, priority,
            targets, business hours and status. Make your changes and confirm with <HelpKey>Update</HelpKey>
            {" "}at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To remove a policy, click the red trash icon (<HelpKey>Delete</HelpKey>) on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog titled «Delete SLA Policy» opens and reads «This action cannot be undone.
            &lt;policy name&gt; will be permanently deleted.» After you confirm with <HelpKey>Delete</HelpKey>,
            the policy leaves the table.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion cannot be undone. If you only want to switch a policy off temporarily, edit it and
            clear the <HelpKey>Active</HelpKey> checkbox instead — the policy stays, just shown as{" "}
            <strong>Inactive</strong> in the table.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          A common setup is one policy per priority: a short response/resolution target for critical
          tickets, a wider one for low priority. The «Business hours only» option keeps nights and
          weekends from counting toward the target — leave it ticked unless you promise 24/7 support.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All SLA policies are scoped to your organization — you can't see or change another
          organization's policies. The table and form operate only on your own tenant's data.
        </p>
      </HelpCallout>
    </div>
  )
}
