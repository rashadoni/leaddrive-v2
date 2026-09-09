"use client"

/** Pharmacy promotions — role-based guide to fact capture, review and configuration. */
import {
  HelpCallout,
  HelpDef,
  HelpKey,
  HelpScenario,
  HelpSection,
  HelpStep,
} from "@/components/help/help-content"

export default function MtmPromotionsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a field agent, reviewer, manager or MTM administrator"
        goal="Move a pharmacy promotion fact through capture and review without confusing a calculation preview with posted points"
      >
        Open <HelpKey>Route &amp; Field</HelpKey> → <HelpKey>Pharmacy Promotions</HelpKey>.
        The page shows only the views and actions allowed for your role.
      </HelpScenario>

      <HelpSection title="Start with your role">
        <dl className="rounded-md border p-3">
          <HelpDef term="Field agent">
            Use <strong>Registry</strong> to select one assigned pharmacy, link the completed visit
            when required, enter the actual quantity and confirm the fact.
          </HelpDef>
          <HelpDef term="Reviewer or manager">
            Start in <strong>Review queue</strong>. The server chooses the current L1 or L2 step;
            you choose the decision and confirm its preview.
          </HelpDef>
          <HelpDef term="Administrator">
            Use <strong>Campaigns</strong> for signed definitions and campaign revisions. Operational
            decisions stay in <strong>Review queue</strong>.
          </HelpDef>
          <HelpDef term="Read-only user">
            Use <strong>Registry</strong> to inspect facts, evidence, review states and the next
            responsible role without changing them.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Field agent: record one fact">
        <HelpStep n={1}>
          Select the <HelpKey>Planned pharmacy</HelpKey> yourself. Nothing is selected
          automatically, and the list contains only assignments allowed for your account.
        </HelpStep>
        <HelpStep n={2}>
          Choose the matching <HelpKey>Completed visit</HelpKey> when the signed eligibility rule
          requires it, then enter the <HelpKey>Actual quantity</HelpKey>. The page explains when a
          required visit is missing; it does not invent an exception.
        </HelpStep>
        <HelpStep n={3}>
          Press <HelpKey>Save fact</HelpKey>, check the pharmacy, visit, plan and actual quantity in
          the confirmation, then confirm. The operation is stored in the device queue first and the
          server re-checks it during synchronization.
        </HelpStep>
        <HelpCallout kind="tip">
          If the connection disappears, keep the queued operation. <HelpKey>Sync</HelpKey> sends it
          when the network returns. Use <HelpKey>Retry</HelpKey> for a temporary error; discard only
          an operation you intentionally do not want to send.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Reviewer: decide at the server-assigned step">
        <HelpStep n={1}>
          Open <HelpKey>Review queue</HelpKey> and inspect the pharmacy, plan/fact, evidence, L1/L2
          states, policy blockers and next responsible role. Open the row when you need the full
          audit history.
        </HelpStep>
        <HelpStep n={2}>
          Press <HelpKey>Review</HelpKey>. The dialog displays the current L1 or L2 step; you cannot
          choose or skip that step. Choose <HelpKey>Approved</HelpKey>,{" "}
          <HelpKey>Return for correction</HelpKey> or <HelpKey>Rejected</HelpKey>. Return and Reject
          require a reason.
        </HelpStep>
        <HelpStep n={3}>
          Press <HelpKey>Build server preview</HelpKey>. Check the server-calculated values and next
          state, then apply the decision. Changing the decision or reason invalidates the old preview,
          and the server checks your access, current versions and the exact preview again before
          applying it.
        </HelpStep>
        <HelpCallout kind="warning">
          Bulk review is available only for the explicitly selected rows at the same current review
          step. A row without a Review action is not ready for your role.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Manager: read points correctly">
        <dl className="rounded-md border p-3">
          <HelpDef term="Preview">
            A server calculation for the current fact and pinned rule version. It is not an awarded
            balance.
          </HelpDef>
          <HelpDef term="Posted ledger">
            The recorded points entry after the required decisions and posting gate succeed. Use the
            detail history when you need to verify the posting or a later adjustment.
          </HelpDef>
          <HelpDef term="Posting blocked">
            The fact remains saved and reviewable, but the ledger cannot post until the required
            signed rules and organization permission are ready. Blocked does <strong>not</strong>{" "}
            mean zero points.
          </HelpDef>
        </dl>
        <p>
          Filter the registry or save a personal view to follow a team, manager, campaign or review
          state. Treat the ledger as the source of posted points; corrections remain separate,
          auditable records rather than silent edits.
        </p>
      </HelpSection>

      <HelpSection title="Administrator: configure, sign, then publish">
        <HelpStep n={1}>
          In <HelpKey>Signed definition catalog</HelpKey>, create draft promotion types, formulas and
          L1/L2 policies only from an approved source. For formulas and policies, compare the server
          hash with the approved document and provide its approval reference before activation.
        </HelpStep>
        <HelpStep n={2}>
          In <HelpKey>Campaign revisions</HelpKey>, create a campaign and an immutable revision using
          active signed definitions. Enter the approved period, timezone, eligibility definition and
          source details; then compare the revision hash and approval references before publishing.
        </HelpStep>
        <HelpStep n={3}>
          Publishing a revision and enabling points posting are separate controls. If the page
          says posting is blocked, resolve the named signed-rule or tenant-setting blocker; do not
          replace the missing rule with a guessed value.
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="security">
        Never invent formulas, eligibility criteria, L1/L2 roles, approval references, periods or
        timezones. The interface intentionally leaves unsupported business values empty and fails
        closed until an approved source is supplied.
      </HelpCallout>
    </div>
  )
}
