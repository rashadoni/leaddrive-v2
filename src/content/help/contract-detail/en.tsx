"use client"

/**
 * Contract detail (record) page — help article (English).
 * Covers the single-contract record workflow: header + action buttons,
 * stat cards, Details, Approval Chain, Version History + AI Redline,
 * E-Signature, Deviations, Revenue Recognition, AI Insights + Risk,
 * Milestones, View Document / Amend dialogs. The LIST page (contracts)
 * is a separate "contracts" article.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You work in sales, legal, or finance and are handling one specific contract"
        goal="Open a contract record, read every section, and take the key actions: submit for approval, send for signature, amend, and track milestones and risk"
      >
        You reach this page by clicking a row in the contracts list (or a direct contract link). The
        back arrow (<HelpKey>←</HelpKey>) at top-left returns you to the list. All data and actions are
        scoped to your organization; a few panels (Revenue Recognition, Create Invoice, Reindex) are
        only visible to <strong>admin / superadmin / manager</strong> roles.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a document icon, the contract title, the contract number below it, and a
          colored <strong>status badge</strong> (e.g. <em>Draft</em>, <em>Pending Approval</em>,{" "}
          <em>Active</em>). If the contract was auto-spawned from an accepted quote, a green
          "view source" chip appears under the number. Top-right holds the action buttons: when the
          status fits, <HelpKey>Submit for Approval</HelpKey>; <HelpKey>Open editor</HelpKey> for
          editing; <HelpKey>View document</HelpKey>; and a three-dot (<HelpKey>⋯</HelpKey>)
          "More actions" menu.
        </p>
        <p>
          Below the title sit four stat cards: <strong>Days active</strong>, <strong>Value</strong>,{" "}
          <strong>Type</strong>, and <strong>Days left</strong>. Further down, cards (panels) stack
          one after another: <strong>Details</strong>, the <strong>Approval Chain</strong> (if any),{" "}
          <strong>Version History</strong>, <strong>AI Redline</strong> (when 2+ versions exist),{" "}
          <strong>E-Signature</strong>, <strong>Deviations</strong>, <strong>Revenue Recognition</strong>{" "}
          (finance users), <strong>AI Insights</strong>, <strong>Risk Score vs Playbook</strong>,{" "}
          <strong>AI Search Index</strong> (finance), and <strong>Milestones</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">Shows the contract's stage (Draft, Pending Approval, Active, Expired, etc.) — repeated in the header and the Details card.</HelpDef>
          <HelpDef term="Approval Chain">The stages a contract passes to be approved — appears only after you submit the contract for approval.</HelpDef>
          <HelpDef term="Version">A saved snapshot of the contract body (number, source, date, content hash). Amending and signing each create a new version.</HelpDef>
          <HelpDef term="AI Redline">An AI comparison of clause-level changes between two versions (added / removed / modified).</HelpDef>
          <HelpDef term="Envelope (E-Signature)">A signing package sent to signers — each signer carries its own status.</HelpDef>
          <HelpDef term="Deviation">A contract clause that drifts from the standard (playbook) — a critical / warning / info flag.</HelpDef>
          <HelpDef term="Performance obligation (Revenue Recognition)">A deliverable under the contract and how its revenue is recognized (point in time, straight-line, milestone, usage-based).</HelpDef>
          <HelpDef term="Milestone">A dated deliverable or payment point on the contract — with a status and an owner.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: submit the contract for approval">
        <HelpStep n={1}>
          <p>
            If the contract is in <strong>Draft</strong> status, a blue{" "}
            <HelpKey>Submit for Approval</HelpKey> button shows at top-right — click it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Submit for Approval" dialog opens. At the top: "Add approval stages. Each stage will be
            processed sequentially," then one stage block below. If the body still has unfilled{" "}
            <HelpKey>{"{{variables}}"}</HelpKey>, the button shows a red warning instead of the dialog
            and asks you to fill those variables first.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In each stage type a <strong>label</strong> (e.g. "Manager, Legal, CFO"), optionally an{" "}
            <strong>SLA hours</strong> value, and pick a <strong>mode</strong>:{" "}
            <HelpKey>All must approve</HelpKey>, <HelpKey>Any one approves</HelpKey>, or{" "}
            <HelpKey>Quorum</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Choosing "Quorum" opens a small number field asking how many approvals suffice (1 up to the
            approver count). Inside a stage you can add a role (e.g. <em>admin / manager</em>) with{" "}
            <HelpKey>Add approver</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Add more stages if needed (up to 5) with <HelpKey>Add stage</HelpKey>, then confirm with{" "}
            <HelpKey>Submit for Approval</HelpKey> at the bottom-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button turns to "Submitting…", the dialog closes, and a new <strong>Approval Chain</strong>{" "}
            card appears on the page — each stage with its mode, SLA, and status (pending / approved /
            rejected). The contract status updates too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If you are an approver and the stage is current, green <HelpKey>Approve</HelpKey> and red{" "}
            <HelpKey>Reject</HelpKey> buttons appear on that row — click the right one.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After your decision the row's status updates and the chain advances to the next stage.
            Stages whose turn hasn't come show no buttons — hovering shows a "waiting for its turn" hint.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: send for signature (e-signature)">
        <HelpStep n={1}>
          <p>
            In the <strong>E-Signature</strong> card, click <HelpKey>Send for Signature</HelpKey> at
            the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Send for Signature" dialog opens. The <strong>Subject</strong> is pre-filled from the
            contract title; below it sit an optional <strong>Message</strong> and the{" "}
            <strong>Signers</strong> list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For each signer enter a <strong>name</strong>, <strong>email</strong>, and pick a role:{" "}
            <HelpKey>Signer</HelpKey> or <HelpKey>CC</HelpKey>. Add more people (up to 10) with{" "}
            <HelpKey>Add signer</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A note at the bottom reads: "Signing links are returned in the next step so you can copy
            them directly — email delivery is best-effort." If a name or email is empty, a red error
            message appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Send for Signature</HelpKey> at the bottom-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Sent for signature" toast appears, followed by a <strong>Signing Links</strong> dialog —
            each signer with a <HelpKey>Copy link</HelpKey> button. After you close it, the new envelope
            shows in the <strong>E-Signature</strong> card with its status and signer list. Refresh
            envelopes with the <HelpKey>↻</HelpKey> button.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: amend the contract (new version)">
        <HelpStep n={1}>
          <p>
            Open the three-dot <HelpKey>⋯</HelpKey> menu at top-right and choose <HelpKey>Amend</HelpKey>.
            (This option only shows in eligible statuses — draft, pending approval, active, approved,
            signed.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Amend Contract" dialog opens with the body field full of the current document. The note
            at the top explains: the current signed version is preserved in history, and the amendment
            needs later approval and re-signing to become canonical.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Edit the <strong>Amended document</strong> body; optionally change the title or add a
            one-line <strong>Change note</strong>. Then click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After saving the dialog closes and a new version (source: <em>amendment</em>) is added to
            the <strong>Version History</strong> card. If the body is left empty, saving is blocked and
            a red warning appears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: compare versions and generate an AI redline">
        <HelpStep n={1}>
          <p>
            In the <strong>Version History</strong> card, when at least two versions exist,{" "}
            <HelpKey>From</HelpKey> and <HelpKey>To</HelpKey> dropdowns appear below. Pick two different
            versions and click <HelpKey>Compare</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A line-by-line diff dialog opens: removed lines marked red "−", additions green "+". If the
            document is very large, a "too large" message shows with a <HelpKey>Download PDF</HelpKey>
            offer instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For a deeper analysis, in the <strong>AI Redline</strong> card pick two versions (the latest
            two are pre-selected) and click <HelpKey>Generate AI Redline</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Generating…", then an overall assessment and a "Clause-level
            changes" list appear — each tagged added / removed / modified with a severity color. If
            there are no differences, "No material clause-level differences detected" shows; the model,
            cost, and date are noted below.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: AI insights and playbook risk">
        <HelpStep n={1}>
          <p>
            In the <strong>AI Insights</strong> card, click <HelpKey>Extract clauses &amp; obligations</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After an "Extracting…" wait, <strong>Clauses</strong> and <strong>Obligations</strong> lists
            appear — each clause with a category and risk badge, each obligation with party, due date,
            and condition. Model, time, and token info are noted at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Once extraction is done, the <HelpKey>Score risk vs playbook</HelpKey> button in the{" "}
            <strong>Risk Score vs Playbook</strong> card becomes active — click it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An overall risk badge (low / medium / high) shows in the title, plus per-clause risk scores.
            If new deviation flags were created, their count shows with a "See the Deviations panel
            above" hint. The button stays disabled until extraction is complete.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <strong>Deviations</strong> card, on each flagged clause click <HelpKey>Acknowledge</HelpKey>{" "}
            or <HelpKey>Waive</HelpKey>. <HelpKey>Re-scan</HelpKey> refreshes the flags.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking "Waive" opens a small dialog asking for a reason. After your decision the flag's
            status changes (flagged → acknowledged / waived). If there are no deviations, a "No
            deviations detected" message shows.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: track milestones (and view the document)">
        <HelpStep n={1}>
          <p>
            In the <strong>Milestones</strong> card click <HelpKey>Add milestone</HelpKey>, then type a{" "}
            <strong>Label</strong> and <strong>Due date</strong> (required), optionally a description,
            status, and owner, and confirm with <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new milestone appears in the card; a past-due, uncompleted milestone gets a red{" "}
            <em>Overdue</em> badge. Each milestone has <HelpKey>Mark complete</HelpKey>,{" "}
            <HelpKey>Edit</HelpKey>, and <HelpKey>Delete</HelpKey> buttons.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To read the contract body, click <HelpKey>View document</HelpKey> at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The full text shows in a dialog with a <HelpKey>Download PDF</HelpKey> button below. If there
            is no text yet, the note "This contract has no document text yet. Generate it from a template
            or upload a file" appears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Finance users (admin / superadmin / manager) also see the <strong>Revenue Recognition</strong>{" "}
          panel: there you add a performance obligation (description, recognition method, period, and
          milestones if needed) with <HelpKey>Add obligation</HelpKey>, and refresh the schedule with{" "}
          <HelpKey>Recalculate allocation</HelpKey>. The same users get <HelpKey>Create Invoice</HelpKey>{" "}
          in the ⋯ menu and <HelpKey>Reindex for AI Search</HelpKey> in the{" "}
          <strong>AI Search Index</strong> panel.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Delete Contract</HelpKey> in the ⋯ menu is irreversible and takes everything tied to
          the contract (versions, envelopes, milestones) with it. If you only want to pause the
          contract, edit its status or cancel the approval/signature flow instead of deleting.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All contract data is scoped to your organization — you cannot see or change another tenant's
          contract. For approval, only matching-role or assigned users see the approve/reject buttons,
          and the server re-checks every decision. Revenue Recognition, Create Invoice, and Reindex are
          open only to admin / superadmin / manager roles.
        </p>
      </HelpCallout>
    </div>
  )
}
