"use client"

/**
 * Escalation Rules — help article (English).
 * Covers Settings → Escalation Rules: creating rules that auto-escalate
 * tickets when SLA deadlines are breached (or before, as a warning),
 * toggling active state, and deleting. Real UI: header + "New Rule"
 * button, empty state, rules table (Level/Rule Name/Trigger/Actions/
 * Status), create form (Dialog) and delete confirmation.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EscalationHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support lead or operations admin"
        goal="Set up rules that automatically escalate tickets when SLA deadlines are breached (or before) — notifying managers, raising priority, or reassigning the ticket"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Escalation Rules</HelpKey>. All
        rules belong to your organization only. These rules hang off your SLA (service-level agreement)
        deadlines — so they assume ticket SLAs are already configured; this page defines what happens
        when those deadlines are crossed.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Escalation Rules</HelpKey>, the subtitle "Configure
          automatic escalation when SLA deadlines are breached", and a <HelpKey>New Rule</HelpKey>{" "}
          button at the top right. If you have no rules yet, the center shows an empty state with a
          warning icon: a "No escalation rules" heading, a short description, and a{" "}
          <HelpKey>Create First Rule</HelpKey> button. Once at least one rule exists, a searchable
          table appears instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Level">How deep the escalation is — 1 to 5. Shown in the table as a colored badge (e.g. L1 yellow, L3 and up in red shades).</HelpDef>
          <HelpDef term="Trigger (Trigger Type)">The event that fires the rule: First Response Breach, Resolution Breach, or Resolution Warning.</HelpDef>
          <HelpDef term="First Response Breach">Fires when a ticket isn't answered for the first time in time.</HelpDef>
          <HelpDef term="Resolution Breach">Fires when a ticket isn't closed within the SLA resolution deadline.</HelpDef>
          <HelpDef term="Resolution Warning">Fires BEFORE the resolution deadline is breached, as a heads-up.</HelpDef>
          <HelpDef term="Actions">What the rule does when it fires: Notify, Increase Priority, or Reassign Ticket.</HelpDef>
          <HelpDef term="Status">The rule's Active / Inactive state — toggled by clicking the badge in the table.</HelpDef>
        </dl>
        <p>
          The table columns, left to right: <strong>Level</strong> (an L1–L5 badge), <strong>Rule Name</strong>,{" "}
          <strong>Trigger</strong> (the type name, with "(N min)" beside it when minutes are set),{" "}
          <strong>Actions</strong> (each action as its own badge, with the notify target in parentheses),{" "}
          <strong>Status</strong> (a clickable green <strong>Active</strong> / grey <strong>Inactive</strong>{" "}
          badge), and a trash-icon delete button at the end.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new escalation rule">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Rule</HelpKey> at the top right. (If you have no rules, the{" "}
            <HelpKey>Create First Rule</HelpKey> button in the empty state opens the same form.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled "Create Escalation Rule" opens. It contains a <strong>Rule Name *</strong>{" "}
            field, side-by-side <strong>Trigger Type</strong> and <strong>Escalation Level (1-5)</strong>,
            a minutes field below, then an <strong>Action</strong> picker.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Rule Name</strong> — this is the only required field. The placeholder reads
            "e.g. L1 - Notify manager on first response breach".
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the field as you type. If you try to create with an empty name, the
            browser's required-field check blocks the form from submitting.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick a <strong>Trigger Type</strong> from the dropdown: <HelpKey>First Response Breach</HelpKey>,{" "}
            <HelpKey>Resolution Breach</HelpKey>, or <HelpKey>Resolution Warning</HelpKey>. In the{" "}
            <strong>Escalation Level</strong> field next to it, enter a number from 1 to 5.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The level field accepts numbers only and is clamped between 1 and 5. The chosen type changes
            the label of the minutes field below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Fill in the minutes field. If you chose <strong>Resolution Warning</strong>, the label is
            "Minutes before SLA breach"; for the other two types it's "Minutes after SLA breach".
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The small hint under the field changes with the type: for a warning, "How many minutes
            before the SLA deadline to trigger this rule"; for a breach, "0 = immediately on breach, or
            set delay in minutes after breach".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Pick an <strong>Action</strong>: <HelpKey>Notify</HelpKey>, <HelpKey>Increase Priority</HelpKey>,
            or <HelpKey>Reassign Ticket</HelpKey>. If you pick <HelpKey>Notify</HelpKey>, a{" "}
            <strong>Notify Target</strong> dropdown appears beside it — <HelpKey>Managers</HelpKey> or{" "}
            <HelpKey>Admins Only</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The "Notify Target" field appears only when the action is <strong>Notify</strong>; choosing
            <strong> Increase Priority</strong> or <strong>Reassign Ticket</strong> hides it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Click <HelpKey>Create Rule</HelpKey> at the bottom. (Change your mind? Close it with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While saving, the button switches to a spinner with "Creating..."; on success the dialog
            closes and the new rule appears in the table. On error, a red error message is shown at the
            top of the form.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: toggle a rule active/inactive or delete it">
        <HelpStep n={1}>
          <p>
            To temporarily disable (or re-enable) a rule, click its badge in the{" "}
            <strong>Status</strong> column of the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The badge flips between green <strong>Active</strong> and grey <strong>Inactive</strong>.
            The change saves immediately — no separate confirmation is required.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To remove a rule entirely, click the trash-icon button at the end of its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog titled "Delete Escalation Rule" opens, warning that the rule will be
            permanently deleted and the action can't be undone. It offers <HelpKey>Cancel</HelpKey> and{" "}
            <HelpKey>Delete</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Confirm with <HelpKey>Delete</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Deleting...", then the dialog closes and the rule leaves the table.
            If the delete fails, a red error message appears in the confirmation dialog.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion can't be undone. If you only want to pause a rule, flip its <strong>Status</strong>{" "}
            badge to <strong>Inactive</strong> instead of deleting — the rule stays in the list, it just
            won't fire.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Make the name self-explanatory so the table reads at a glance — bake the level + trigger +
          action into it, like the placeholder ("L1 - Notify manager on first response breach"). You can
          set up several rules at increasing levels for the same event to build a staged escalation chain.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All escalation rules are scoped to your organization — you only see and manage your own
          tenant's rules. Notify targets (Managers / Admins Only) likewise apply to your organization's
          users.
        </p>
      </HelpCallout>
    </div>
  )
}
