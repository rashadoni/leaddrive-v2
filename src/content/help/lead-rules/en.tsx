"use client"

/**
 * Lead Assignment Rules — help article (English).
 * Covers Settings → Lead Assignment Rules: creating a rule (inline edit),
 * conditions (field/operator/value), round-robin vs condition method,
 * priority, assignees, active/inactive, stat cards and deletion.
 * First help article for this page.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LeadRulesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager or operations administrator"
        goal="Set up rules so incoming leads are routed automatically to the right team members — either by conditions or by round-robin"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Lead Assignment Rules</HelpKey>.
        All rules belong to your organization only. Rules are listed in <strong>priority</strong> order
        (lower number first), and everything you see — the counts and the cards — reads from the same
        list, so the stat cards at the top update instantly as you make changes.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a filter icon with the title <HelpKey>Lead Assignment Rules</HelpKey>, the
          subtitle "Automated lead routing based on conditions or round-robin", and an{" "}
          <HelpKey>Add Rule</HelpKey> button in the top right. Below are three stat cards:{" "}
          <strong>Total Rules</strong>, <strong>Active Rules</strong> (a green number) and{" "}
          <strong>Assignees</strong>. Under those comes the rules list — if you have none yet, an empty
          state is shown instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Rules">Count of all rules you've created (active and inactive combined).</HelpDef>
          <HelpDef term="Active Rules">Count of rules currently running (active) — shown in green.</HelpDef>
          <HelpDef term="Assignees">The number of unique assignees across all rules (counted without duplicates).</HelpDef>
          <HelpDef term="Rule">A named assignment rule with a method, priority, conditions and assignees.</HelpDef>
          <HelpDef term="Method">One of two choices: "Condition-based" (routes when conditions match) or "Round Robin" (hands leads to assignees in turn).</HelpDef>
          <HelpDef term="Condition">A single row of three parts: field (e.g. source) + operator (e.g. ==) + value (e.g. website). Round-robin rules show no conditions.</HelpDef>
          <HelpDef term="Priority">A number — lower is checked first. The list is ordered by priority ascending.</HelpDef>
          <HelpDef term="Assignee">The name of a person a lead can be assigned to (entered as comma-separated text).</HelpDef>
        </dl>
        <p>
          Each rule card's header shows, from the left: an <strong>Active</strong> /{" "}
          <strong>Inactive</strong> badge, a method badge (<strong>Round Robin</strong> with a refresh
          icon, or <strong>Condition</strong> with a filter icon) and a "Priority: N" label. On the
          right are three controls: a <HelpKey>Disable</HelpKey> / <HelpKey>Enable</HelpKey> text
          button, a pencil edit button (it becomes an × while editing) and a red trash-can delete
          button. The card body shows the rule name, its description if any, the conditions as monospace
          "field operator "value"" chips, and assignees as chips (or "No assignees" if there are none).
          An inactive rule's card looks dimmed (semi-transparent).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new rule">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Add Rule</HelpKey> in the top right. (If you have no rules yet, the{" "}
            <HelpKey>Create First Rule</HelpKey> button in the middle of the empty state does the same
            thing.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Rule created" toast appears. No dialog opens — a new rule is added to the list right away
            (named "New Rule", method "Condition-based", priority 50, status <strong>Inactive</strong>,
            with one empty condition ready) and that card opens directly in edit mode. The{" "}
            <strong>Total Rules</strong> count goes up by one.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the edit form, type a meaningful <strong>Name</strong> (e.g. "Website leads"), and adjust
            the number in <strong>Priority (lower = first)</strong> next to it if needed. Optionally add
            a one-line <strong>Description</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Name and Priority sit side by side in two columns, with the Description field below. The
            Priority field accepts numbers only. Nothing is saved yet — changes stay temporary until you
            click Save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick a <strong>Method</strong> from the dropdown: <HelpKey>Condition-based</HelpKey> (routes
            when a lead matches the conditions) or <HelpKey>Round Robin</HelpKey> (hands leads to
            assignees in turn).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Choosing "Round Robin" hides the <strong>Conditions</strong> section entirely — that method
            needs no conditions. Choosing "Condition-based" brings the conditions section back.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If the method is "Condition-based", in the <strong>Conditions</strong> section pick three
            things per condition: a <strong>field</strong> (source, estimated_value, interest,
            company_size, country, industry), an <strong>operator</strong> (==, !=, &gt;=, &lt;=,
            contains, starts_with) and a <strong>value</strong>. Use <HelpKey>Add Condition</HelpKey>{" "}
            for more; remove a condition with the red trash icon beside it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each condition appears on its own row: two dropdowns, a text box (with a "Value"
            placeholder) and a delete icon. <HelpKey>Add Condition</HelpKey> creates a new "source == "
            row by default.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            In <strong>Assignees (comma-separated names)</strong>, type the names separated by commas
            (e.g. <HelpKey>John Doe, Jane Smith</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field shows example names as a placeholder. What you type is split into separate names by
            the commas; empty gaps are dropped automatically.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Click <HelpKey>Save</HelpKey> at the bottom. (Changed your mind? Click{" "}
            <HelpKey>Cancel</HelpKey> to close the editor.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Save button briefly shows a spinning icon, then a "Rule saved" toast appears and the card
            returns to normal (view) mode: the name, condition chips and assignee chips show the updated
            values.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit, enable/disable or delete a rule">
        <HelpStep n={1}>
          <p>
            To change an existing rule, click the pencil-icon button on the right of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card switches to the same edit form, pre-filled with the name, priority, description,
            method, conditions and assignees. The pencil icon turns into an × — click it to close the
            editor without saving.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To switch a rule on or off without deleting it, click the <HelpKey>Enable</HelpKey> (on an
            inactive rule) or <HelpKey>Disable</HelpKey> (on an active rule) text button on the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge flips instantly between green <strong>Active</strong> and grey{" "}
            <strong>Inactive</strong>, the card's dimming changes, and the <strong>Active Rules</strong>{" "}
            count at the top goes up or down accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To remove a rule entirely, click the red trash-can icon button on the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The rule disappears from the list at once, a "Rule deleted" toast appears, and{" "}
            <strong>Total Rules</strong> (and <strong>Active Rules</strong> too, if the rule was active)
            goes down.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Delete has no extra confirmation dialog — the moment you click, the rule is gone and that
            can't be undone. If you only want to pause a rule, disable it with <HelpKey>Disable</HelpKey>{" "}
            instead — the rule and all its settings remain, it just won't run.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          A new rule is created <strong>inactive</strong> by default — so it won't route leads until
          you've finished setting it up and are confident in its contents. Once everything's right,
          turn it on with <HelpKey>Enable</HelpKey>. Use priority to control which rule is checked
          first: a lower number comes first, so give narrower/more specific rules a smaller priority.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All rules are scoped to your organization — you only see and edit your own tenant's rules and
          have no access to other organizations'. Page requests are sent with your current organization
          identity.
        </p>
      </HelpCallout>
    </div>
  )
}
