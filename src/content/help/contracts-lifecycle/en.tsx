"use client"

/**
 * Contract Lifecycle — help article (English).
 *
 * Split out of the old shared "contracts" article (which covered the
 * register, leaving the lifecycle dashboard with no real help). Covers
 * ONLY /contracts/lifecycle: the two-stream dashboard — renewal alerts
 * (upcoming/overdue) and the approval queue (contracts stuck pending
 * approval, grouped by bottleneck stage) — plus the approve/reject
 * confirm dialog. The register (contract list/creation) is NOT covered.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractsLifecycleHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're in sales ops or you manage contracts"
        goal="See which contracts are coming up for renewal and which are stuck pending approval — all on one screen — and approve or reject the stalled stages"
      >
        This page is called <HelpKey>Contract Lifecycle</HelpKey>. It is not the
        register — you don't create contracts here. It tracks two things:{" "}
        <strong>renewal alerts</strong> (contracts approaching expiry) and the{" "}
        <strong>approval queue</strong> (contracts waiting for approval). Data
        loads automatically on open; every number and row is scoped to your
        organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a document icon with the title{" "}
          <HelpKey>Contract Lifecycle</HelpKey> and a short subtitle below it.
          Under that are four KPI cards, then two columns: <strong>Renewal
          alerts</strong> on the left and the <strong>Approval queue</strong> on
          the right. Two explanatory footnotes sit at the very bottom. While
          loading you see a spinner with "Loading…"; on error a red-bordered
          banner appears.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Renewal alerts (90d)">
            Total contracts with a renewal alert in the next 90 days.
          </HelpDef>
          <HelpDef term="Overdue renewals">
            Count of alerts whose renewal date has already passed; the number
            turns red when it's above zero.
          </HelpDef>
          <HelpDef term="Pending approval">
            Total contracts currently stuck pending approval.
          </HelpDef>
          <HelpDef term="Bottleneck stage">
            Name of the stage where the most contracts are stuck; clicking it
            jumps down to that stage's group.
          </HelpDef>
          <HelpDef term="Renewal alert">
            A reminder scheduled before a contract expires — shows the company,
            contract number/title, value, and how many days are left.
          </HelpDef>
          <HelpDef term="Approval stage">
            A step in the contract's approval chain. Stages are sequential — one
            unlocks only after the previous is approved.
          </HelpDef>
          <HelpDef term="Age">
            How long a contract has waited at its current stage (e.g. "3d",
            "2mo"); turns red after 7 days, amber after 3.
          </HelpDef>
        </dl>
        <p>
          In the <strong>Renewal alerts</strong> column each card shows the
          company, contract number and title, value and a "{"{days}"}d alert"
          note, plus an <HelpKey>Open contract</HelpKey> link. On the right it
          shows the time left (e.g. "Today", "Tomorrow", "in 3d", or "5d
          overdue") and the end date. Overdue cards have a red border; those due
          in 14 days or less are amber. When there are none, a green check shows
          "No renewal alerts in the next 90 days."
        </p>
        <p>
          In the <strong>Approval queue</strong> column contracts are grouped by
          the name of their current stage. Each group header has the stage name
          and a "{"{count}"} waiting" badge (amber when 3 or more). Each row shows
          the contract number, company, title, value, the age on the right, and{" "}
          <HelpKey>Approve</HelpKey> and <HelpKey>Reject</HelpKey> buttons below.
          When the queue is empty, a green check shows "No contracts stuck pending
          approval."
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read renewal alerts and open a contract">
        <HelpStep n={1}>
          <p>
            Open the page. Scan the four KPI cards at the top — especially the{" "}
            <HelpKey>Overdue renewals</HelpKey> number.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Once loading finishes the cards show real counts. If overdue is above
            zero, that number is shown in red.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Move to the <HelpKey>Renewal alerts</HelpKey> column on the left and
            look at the cards near the top (the most urgent).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows the company, contract number/title, value, and the
            time left on the right. Overdue ones are red-bordered, those within
            14 days are amber. If there are more than 20 alerts, a "+{"{count}"}
            {" "}more" line appears at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To renew or amend a contract, click the{" "}
            <HelpKey>Open contract</HelpKey> link on its card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            That contract's detail page opens. There is no renew action on this
            lifecycle page — you do the renew/amend work on the contract's own
            page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: jump to the bottleneck stage">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Bottleneck stage</HelpKey> KPI card — it names
            the stage where the most contracts are stuck, with "{"{count}"}
            {" "}waiting".
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If nothing is stuck, the card shows "—" instead of a stage name.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the stage name (the card acts as a button — it underlines on
            hover).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The page smooth-scrolls down to that stage's group card in the right
            column, so you see the stuck contracts right away.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: approve or reject a stage">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Approval queue</HelpKey> column on the right, find the
            contract row. Press the green <HelpKey>Approve</HelpKey> to advance
            the next stage, or the red <HelpKey>Reject</HelpKey> to stop the
            contract.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirm dialog opens — no decision fires on a single click. The
            title reads "Approve this stage?" or "Reject this stage?", and below
            it shows the company, contract number/title, value, and an{" "}
            <HelpKey>Open contract</HelpKey> link.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type into the <strong>Decision note</strong> field. It's optional for
            approve; for <strong>reject</strong> a reason is required (a red * is
            shown on the label).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field shows the placeholder "Why? (required on reject)". If you
            chose reject and the field is empty, the confirm button stays disabled
            and can't be pressed.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Confirm with the footer button — <HelpKey>Approve</HelpKey> for
            approve, the red <HelpKey>Reject</HelpKey> for reject. To back out,
            press <HelpKey>Cancel</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button label briefly shows "…", the dialog closes, and the data
            reloads. An approved contract advances one stage in the chain; a
            rejected one leaves the queue. The KPI cards ("Pending approval",
            "Bottleneck stage") update accordingly.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Each group shows only the first 5 contracts and each column only the
          first 20 alerts; the rest collapse into a "+{"{count}"} more" line. When
          there's a lot of data the system fetches a slice and an amber banner —
          "Showing the first {"{count}"} …" — appears at the top, signalling not
          everything was loaded, so clear the most urgent work first.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Reject</strong> rejects the whole contract and stops the
          approval chain — it doesn't just skip a step. That's why a reason is
          required in the dialog. Always review the contract via{" "}
          <HelpKey>Open contract</HelpKey> before approving or rejecting.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All renewal alerts, approval rows, and decisions are scoped to your
          organization — you only see your own tenant's contracts and can only
          approve/reject their stages. The approve/reject action follows the
          contract's own approval rules.
        </p>
      </HelpCallout>
    </div>
  )
}
