"use client"

/**
 * Approval Routing Rules — help article (English).
 * Covers only Settings → Approval Routing Rules
 * (create/edit a rule, conditions, actions — add/skip stage,
 * template scope, active/inactive state, deactivating a rule).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function approvalrulesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an operations admin or sales manager"
        goal="Set up rules that automatically add a stage to the approval chain — or skip an existing one — based on contract attributes"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Approval Routing Rules</HelpKey>.
        All rules are scoped to your organization. Rules are evaluated{" "}
        <strong>the moment a contract is submitted for approval</strong>: every rule whose conditions
        match automatically adds a stage to the approval chain or skips an existing one. Creating,
        editing, or deactivating a rule requires the <strong>admin</strong>, <strong>manager</strong>,
        or <strong>superadmin</strong> role — other roles can only read the list.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          To the left of the title there's an arrow back to <HelpKey>Settings</HelpKey>, next to it a
          branch (GitMerge) icon with the title <HelpKey>Approval Routing Rules</HelpKey>, and below it
          the line "Conditional stage add / skip based on contract attributes". If you have write
          access, an <HelpKey>Add Rule</HelpKey> button shows on the right. The rules list comes below
          — if there are none yet, an empty-state card appears instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Rule">A named bundle: a set of conditions (when it fires) + a set of actions (what it does) + match logic + an active/inactive state.</HelpDef>
          <HelpDef term="Condition">A contract attribute being checked — value (amount), type, or currency — with an operator (gte, lte, gt, lt, eq, neq, in) and a value.</HelpDef>
          <HelpDef term="Match logic">"All conditions" (AND — every one must be true) vs. "Any condition" (OR — one is enough).</HelpDef>
          <HelpDef term="Action">What happens when the rule fires: "add_stage" (inserts an approval stage into the chain) or "skip_stage" (skips an existing stage).</HelpDef>
          <HelpDef term="Template scope">Whether the rule applies to just one contract template or to all contracts (org-wide).</HelpDef>
          <HelpDef term="Position">For "add_stage", where in the chain the new stage is inserted (blank = appended to the end).</HelpDef>
          <HelpDef term="Assignee role">The role that approves the added stage (e.g. manager, director).</HelpDef>
        </dl>
        <p>
          Each rule card shows the name, an <strong>Active</strong> / <strong>Inactive</strong> badge
          next to it, then either the template-name badge or an{" "}
          <strong>All contracts (org-wide)</strong> badge. Below is a one-line summary:{" "}
          <em>Match logic</em> (All conditions / Any condition), the condition count, and the action
          count. On the right are the controls: an expand/collapse chevron (reveals condition and
          action detail), edit (gear icon), and — if the rule is active — a red trash icon
          (deactivate). The edit and deactivate buttons appear only when you have write access.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new rule">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Add Rule</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Create Rule" dialog opens. In order it contains <strong>Rule Name *</strong>,{" "}
            <strong>Template scope (optional)</strong>, <strong>Match logic</strong>, a{" "}
            <strong>Rule is active</strong> checkbox (ticked by default), a <strong>Conditions</strong>{" "}
            section, and an <strong>Actions *</strong> section.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Rule Name</strong> — this field is required (e.g. "High-value CFO review").
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field shows the placeholder "e.g. High-value CFO review". If you leave the name blank
            and try to save, a red "Rule name is required." warning appears near the bottom of the
            dialog.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick from the <strong>Template scope (optional)</strong> dropdown: bind the rule to a
            single contract template, or leave it as <HelpKey>All contracts (org-wide)</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The first dropdown option is "All contracts (org-wide)"; below it your organization's
            existing contract templates are listed. (If there are no templates, only the org-wide
            option shows.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Choose the <strong>Match logic</strong>: <HelpKey>All conditions (AND)</HelpKey> — every
            condition must be true for the rule to fire; <HelpKey>Any condition (OR)</HelpKey> — one
            true condition is enough.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown offers two options: "All conditions (AND)" and "Any condition (OR)". "All
            conditions" is selected by default.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Optionally add conditions. In the <strong>Conditions</strong> section each row has three
            controls: a <strong>field</strong> dropdown (value / type / currency), an{" "}
            <strong>operator</strong> dropdown, and a <strong>value</strong> input. Use{" "}
            <HelpKey>Add condition</HelpKey> for a new row, or the × next to a row to remove it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field dropdown offers "value (amount)", "type", and "currency". The operator dropdown
            lists gte (&gt;=), lte (&lt;=), gt (&gt;), lt (&lt;), eq (=), neq (≠), and in. When the
            operator is <HelpKey>in</HelpKey>, the value placeholder switches to "val1, val2, ..." so
            you can enter several comma-separated values. Conditions with a blank value are ignored on
            save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            In the <strong>Actions *</strong> section build at least one action. For each action choose
            a type — <HelpKey>add_stage</HelpKey> or <HelpKey>skip_stage</HelpKey> — and type a{" "}
            <strong>Stage label *</strong> (required). When the type is "add_stage", extra{" "}
            <strong>Insert at position</strong> (number) and <strong>Assignee role</strong> fields
            appear. Use <HelpKey>Add action</HelpKey> for another action.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each action sits in its own bordered box. Choosing "add_stage" reveals "Insert at position"
            (with the placeholder "blank = append") and "Assignee role" (placeholder "manager,
            director..."); choosing "skip_stage" hides those extra fields. When more than one action
            exists, each box has a × on the right to remove it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Click <HelpKey>Save Rule</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While saving, a spinner appears next to the button and the button is briefly disabled. On
            success the dialog closes and the new rule appears in the list. If an action is missing its
            stage label, "All actions must have a stage label." is shown; if the server rejects the
            save, "Failed to save rule. Please try again." appears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read, edit, and deactivate a rule">
        <HelpStep n={1}>
          <p>
            To see a rule's conditions and actions, click the down-chevron on the right of the card
            (click again to collapse).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card expands into two blocks: <strong>Conditions</strong> (the match logic is shown in
            parentheses; each condition as a monospaced "field operator value" line) and{" "}
            <strong>Actions</strong> (each with an "add_stage" or "skip_stage" badge, the stage label,
            an optional "@ position N", and the assignee role in parentheses). If there are no
            conditions, "No conditions (rule always matches)" is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change a rule, click the gear-icon (<HelpKey>Edit Rule</HelpKey>) button on the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens titled "Edit Rule", pre-filled with the existing name, template, logic,
            state, conditions, and actions. Make your changes and confirm with{" "}
            <HelpKey>Save Rule</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To deactivate a rule, click the red trash-icon button on the card. (This button shows only
            while the rule is active.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The rule is deactivated: its badge switches from <strong>Active</strong> to a grey{" "}
            <strong>Inactive</strong>, and the red trash icon disappears from the card. The rule itself
            stays in the list — it just no longer fires at approval time. To turn it back on, edit the
            rule and tick the <HelpKey>Rule is active</HelpKey> checkbox.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          A rule with no conditions applies to <strong>every contract</strong> — the page labels this
          "No conditions (rule always matches)". To add one approval stage to all contracts, leave the
          conditions empty and just set up the action. Add conditions only when you want to narrow the
          rule by the contract's amount, type, or currency.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The red trash button on the card does not <strong>delete</strong> a rule — it{" "}
          <strong>deactivates</strong> it; the rule stays in the list, it just stops firing. Every
          action must have a stage label; you can't save a rule with a blank stage label. Remember that
          rules are evaluated only at the <strong>moment a contract is submitted for approval</strong>
          {" "}— they don't retroactively rewrite the chain of contracts already in progress.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All rules are scoped to your organization — you only see your own tenant's rules and contract
          templates. Creating, editing, and deactivating rules is available only to users with the{" "}
          <strong>admin</strong>, <strong>manager</strong>, or <strong>superadmin</strong> role; for
          other roles the <HelpKey>Add Rule</HelpKey>, edit, and deactivate buttons are not shown at
          all.
        </p>
      </HelpCallout>
    </div>
  )
}
