/* eslint-disable react/no-unescaped-entities */
"use client"

/**
 * Loyalty Earn Rules — help article (English).
 * Covers the guided earn-rule wizard: business scenario, award type,
 * relevant fields, live preview, advanced controls, filters, and pause/delete.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function loyaltyearnrulesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are the marketing or operations admin setting up the loyalty program"
        goal="Create simple point-earning rules without learning the internal rule-engine terms"
      >
        This page is the catalog of earn rules. Each rule answers one business question:{" "}
        <strong>what customer action should earn points?</strong> The normal path is a short wizard:
        choose the scenario, choose how points are awarded, check the example preview, then save. The
        technical controls are still available under <HelpKey>Advanced options</HelpKey>. All rules
        belong to your organization only; you do not see another tenant&apos;s rules.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a coin icon with the <HelpKey>Earn Rules</HelpKey> title and, beneath it, the
          «How transactions turn into loyalty points…» description. Top-right are two buttons:{" "}
          <HelpKey>New rule</HelpKey> and a round <HelpKey>Refresh</HelpKey> icon next to it. Below them
          are two filters — <HelpKey>Trigger:</HelpKey> and <HelpKey>Status:</HelpKey> dropdowns. Further
          down is the list of rules; if there are none, an empty state is shown instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Business scenario">The customer action you want to reward: purchase, signup, referral, birthday, review, survey, or custom.</HelpDef>
          <HelpDef term="Points per purchase amount">Use this for spend-based rules, for example 1 point per 1 AZN.</HelpDef>
          <HelpDef term="Fixed bonus">Use this when the action should always award the same points, for example 100 points for signup.</HelpDef>
          <HelpDef term="Live preview">The example box in the form. It shows the customer outcome before you save.</HelpDef>
          <HelpDef term="Advanced options">Power controls such as priority, product category, date window, and tier multiplier behavior.</HelpDef>
          <HelpDef term="Priority">A higher number is checked first. Use it only when two active rules can match the same action.</HelpDef>
        </dl>
        <p>
          Each rule card shows the name, a grey trigger badge next to it, and a <strong>Inactive</strong>{" "}
          badge when disabled. The main summary reads like a sentence, such as{" "}
          <strong>Purchase: 1 point per 1 AZN, tier bonus applies</strong>. On the right are three actions:
          <HelpKey>Disable</HelpKey>/<HelpKey>Enable</HelpKey>, edit (pencil icon), and delete (red
          trash-can icon).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a rule with the wizard">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New rule</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A form card titled <strong>Create rule</strong> opens above the list. The first area asks for
            the business scenario instead of showing every technical field at once.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Choose the business scenario: <HelpKey>Purchase</HelpKey>,{" "}
            <HelpKey>Signup bonus</HelpKey>, <HelpKey>Referral</HelpKey>,{" "}
            <HelpKey>Birthday</HelpKey>, <HelpKey>Product review</HelpKey>,{" "}
            <HelpKey>Survey response</HelpKey>, or <HelpKey>Custom</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected scenario gets a highlighted border, the rule name is suggested automatically,
            and irrelevant fields are hidden. A signup bonus, for example, does not ask for purchase
            amount fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Choose the award type: <HelpKey>Points per purchase amount</HelpKey> for spend-based earning,
            or <HelpKey>Fixed bonus</HelpKey> for actions like signup, referral, birthday, review, or
            survey. Then fill only the visible fields.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The preview updates immediately. For a purchase rule it can say that a 100 AZN purchase earns
            100 points. For a fixed bonus it shows the exact point bonus the customer receives.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Use <HelpKey>Advanced options</HelpKey> only when you need extra control: product category,
            priority, date window, or whether level bonuses should multiply the points.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The advanced fields expand under the basic form. Editing an existing rule opens advanced
            options automatically because those users usually need the full configuration.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom right. (Changed your mind? Use{" "}
            <HelpKey>Cancel</HelpKey> or the ×.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner appears on the button, then the form closes and the new rule shows up in the list.
            If both points-per-amount and fixed bonus are filled, a warning reminds you that this can
            over-award points. If neither is filled, the rule will not save.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter, edit, or disable a rule">
        <HelpStep n={1}>
          <p>
            To narrow the list, use the <HelpKey>Trigger:</HelpKey> and <HelpKey>Status:</HelpKey>{" "}
            dropdowns at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The list refreshes immediately — only rules matching the chosen trigger and/or status remain.
            The <strong>All</strong> option in each filter clears it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change a rule, click the pencil-icon (<HelpKey>Edit</HelpKey>) button on its card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens, titled <strong>Edit rule</strong> and pre-filled with the existing
            values. The <strong>Trigger</strong> field is dimmed with «(immutable)» next to it — the
            trigger cannot be changed afterwards. Make your edits and confirm with <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To pause a rule without deleting it, click the <HelpKey>Disable</HelpKey> button on the card
            (it reads <HelpKey>Enable</HelpKey> on a disabled rule).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A grey <strong>Inactive</strong> badge appears on or disappears from the card. A disabled rule
            is skipped during point accrual but stays in the list and history.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To remove a rule entirely, click the red trash-can icon (<HelpKey>Delete</HelpKey>) button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation dialog opens reading «Delete rule "{"{name}"}"?» and noting that live
            point balances awarded under this rule are unaffected. After you confirm, the rule leaves the
            list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Most programs need only two starting rules: <strong>1 point per 1 AZN spent</strong> and a
          small signup bonus. Add priority and date windows later, after real activity shows you where
          the program needs tuning.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          If you leave both rate and flat points empty, the rule won&apos;t save — you get an «At least
          one of rate-per-unit or flat amount is required» error. Deleting a rule cannot be undone; to
          pause one temporarily, use <HelpKey>Disable</HelpKey> instead of deleting.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All earn rules are scoped to your organization — you only see and edit your own tenant&apos;s
          rules and have no access to another organization&apos;s loyalty configuration.
        </p>
      </HelpCallout>
    </div>
  )
}
