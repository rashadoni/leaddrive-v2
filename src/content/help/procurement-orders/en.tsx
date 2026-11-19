"use client"

/**
 * «Purchase orders» — approval, sending, delivery and receipt (English).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementOrdersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="A purchasing officer, a manager or finance" goal="Take an order through approval, send it to the supplier and receive the goods">
        An order is made from a supplier quote in a purchase request. Who approves is set in «Approval limits».
      </HelpScenario>

      <HelpSection title="What's on the page">
        <dl className="rounded-md border p-3">
          <HelpDef term="List">number (PO-0001), supplier, deal, status, expected date and total.</HelpDef>
          <HelpDef term="Filters"><HelpKey>Open</HelpKey>, <HelpKey>Awaiting approval</HelpKey>, <HelpKey>Late only</HelpKey>, <HelpKey>Received</HelpKey>, <HelpKey>Cancelled</HelpKey>, <HelpKey>All</HelpKey>.</HelpDef>
          <HelpDef term="Statuses">Draft → Awaiting approval → Approved → Sent to supplier → In production → In transit → Partly received → Received; also Rejected and Cancelled.</HelpDef>
          <HelpDef term="Order page"><HelpKey>Lines</HelpKey> (quantity, price, amount, how much is received), <HelpKey>Approval</HelpKey> (who, which step) and <HelpKey>History</HelpKey>.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: from approval to sending">
        <HelpStep n={1}>
          <p>Open the draft order and press <HelpKey>Send for approval</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The status becomes «Awaiting approval»; the «Approval» block shows the chain for this amount — for example «1. Lalə Quliyeva».</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>The approver presses <HelpKey>Approve</HelpKey> or <HelpKey>Reject</HelpKey> with a reason.</p>
          <HelpCallout kind="see" label="What you'll see">Once approved the status is «Approved»; a rejected order can be corrected and sent again as a new revision.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Press <HelpKey>Mark as sent to supplier</HelpKey>. If needed, tick <HelpKey>E-mail the order PDF to the supplier</HelpKey>, set the address and the PDF language.</p>
          <HelpCallout kind="see" label="What you'll see">The status becomes «Sent to supplier»; the outcome of the e-mail goes to the history. The PDF is always one click away under <HelpKey>PDF</HelpKey>.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: delivery and receipt">
        <HelpStep n={1}>
          <p>As the supplier reports, press <HelpKey>In production</HelpKey> and <HelpKey>In transit</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">Every status change stays in the history.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>The date moves — <HelpKey>Change date</HelpKey>: the new date and <HelpKey>Why did the date move?</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The new expected date shows in the header; a sent order's date does not change without a reason.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>When goods arrive, press <HelpKey>Receive goods</HelpKey> and enter what came for each line.</p>
          <HelpCallout kind="see" label="What you'll see">The «Received» column shows e.g. «8 / 12» and the status «Partly received»; once everything is in — «Received».</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">An order past its date and not yet received is checked every hour: it gets the «Late» mark and the deal owner, the requester and purchasing are told once.</HelpCallout>

      <HelpCallout kind="warning">You can't receive more than was ordered. If the deal changes after sending, the order is flagged «the deal changed — check»: talk to the supplier and press «Checked».</HelpCallout>

      <HelpCallout kind="security">The author of an order can't approve it; an administrator can approve any step. Sales sees the order's status, not its prices.</HelpCallout>
    </div>
  )
}
