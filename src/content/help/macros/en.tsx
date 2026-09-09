"use client"

/**
 * Macros — help article (English).
 * Covers T7 Ticket Macros. Cross-checked against TicketMacro model
 * (prisma:1561) + the 7 action types in settings/macros/page.tsx.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MacrosHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="What macros do">
        <p>
          A <strong>macro</strong> is a saved sequence of actions you apply to a ticket in one
          click. Instead of clicking through <em>set status → set priority → reassign → add a
          canned reply → tag</em>, you trigger one macro and the whole sequence runs atomically.
        </p>
        <p>
          Designed for support / ops teams that handle high-volume tickets with repeated
          workflows: <em>&quot;triage as billing&quot;</em>, <em>&quot;escalate to tier-2&quot;</em>,
          <em>&quot;close as duplicate&quot;</em>.
        </p>
      </HelpSection>

      <HelpSection title="Creating a macro">
        <HelpStep n={1}>
          <p>
            Go to <HelpKey>Settings → Macros</HelpKey>. Click <HelpKey>New macro</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Name it (e.g. <em>&quot;Triage as billing&quot;</em>), pick a category{" "}
            (<em>general / billing / technical / onboarding / sales</em>), optionally add a
            description and a keyboard shortcut.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Add <strong>actions</strong> in order. The macro runs them top-to-bottom. Available
            action types:
          </p>
          <dl className="rounded-md border p-3 mt-2">
            <HelpDef term="set_status">Change ticket status to one of: new / in_progress / waiting / resolved / closed.</HelpDef>
            <HelpDef term="set_priority">Change priority to: low / medium / high / critical.</HelpDef>
            <HelpDef term="set_assignee">Assign the ticket to a user.</HelpDef>
            <HelpDef term="add_comment">Append a public reply (customer-visible).</HelpDef>
            <HelpDef term="add_internal_note">Append a private note (internal-only).</HelpDef>
            <HelpDef term="add_tag">Add a tag to the ticket.</HelpDef>
            <HelpDef term="remove_tag">Remove a tag from the ticket.</HelpDef>
          </dl>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally set a <strong>keyboard shortcut</strong> (e.g. <code>cmd+shift+1</code>)
            so the macro fires from any ticket without opening the macro menu. Save with the{" "}
            <em>Active</em> toggle on.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Running a macro on a ticket">
        <HelpStep n={1}>
          <p>
            Open a ticket detail page. Find the <HelpKey>Macros</HelpKey> launcher (icon or
            button in the toolbar).
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the macro by name, or fire its keyboard shortcut from anywhere on the ticket
            page. All actions run in sequence, the ticket re-renders with everything applied.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            The <em>usageCount</em> on the macro increments — popular macros surface higher in
            the launcher next time.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Useful macro patterns">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Triage as billing</strong> — <em>set_priority=medium</em>, <em>add_tag=billing</em>,{" "}
            <em>set_assignee=billing-team-lead</em>, <em>add_internal_note=&quot;Routed via macro&quot;</em>.
          </li>
          <li>
            <strong>Close as duplicate</strong> — <em>set_status=closed</em>, <em>add_tag=duplicate</em>,
            <em>add_comment=&quot;Duplicate of #XYZ — please follow the original.&quot;</em>.
          </li>
          <li>
            <strong>Escalate to tier-2</strong> — <em>set_priority=high</em>,{" "}
            <em>set_assignee=tier2-lead</em>, <em>add_tag=escalated</em>,{" "}
            <em>add_internal_note=&quot;See thread for context.&quot;</em>.
          </li>
          <li>
            <strong>Awaiting customer</strong> — <em>set_status=waiting</em>,{" "}
            <em>add_tag=awaiting-customer</em>, <em>add_comment=&quot;We need a bit more info...&quot;</em>.
          </li>
        </ul>
      </HelpSection>

      <HelpSection title="Tips & guardrails">
        <HelpCallout kind="tip">
          <p>
            <strong>Order matters.</strong> Actions run top-to-bottom — so if you{" "}
            <em>set_status=closed</em> first and <em>add_comment</em> second, the comment lands
            after closure (still visible, but timestamp shows post-close). Reorder if that
            matters for your audit trail.
          </p>
        </HelpCallout>
        <HelpCallout kind="warning">
          <p>
            Macros can&apos;t un-do. There&apos;s no &quot;undo macro&quot; button. If a macro
            misfires (wrong customer, wrong tag), reverse each action manually. For risky
            macros, keep the <em>Active</em> toggle off until you&apos;ve dry-run on a test
            ticket.
          </p>
        </HelpCallout>
        <HelpCallout kind="security">
          <p>
            Macros run with <strong>the calling user&apos;s session</strong> — there&apos;s no
            privilege boundary inside the macro itself. A macro&apos;s effect is exactly what
            the same user could do by editing the ticket manually, just bundled into one click.
            Be deliberate about who can author shared macros: an authored macro that closes
            tickets can be triggered by anyone who can run macros at all.
          </p>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
