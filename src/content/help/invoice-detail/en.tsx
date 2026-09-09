"use client"

/**
 * Invoice detail — help article (English).
 * Covers a single invoice record: header actions (Send, PDF / PDF without
 * Stamp, Act, Duplicate, Delete), the pipeline + KPI cards, six tabs
 * (Overview / Items / Payments / Activity / Chain / Preview), recording a
 * payment, sending the invoice, and the automatic reminder chain.
 * Creating and editing an invoice live on SEPARATE pages — NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InvoicedetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales or finance team member"
        goal="Send an invoice to a client, record an incoming payment, and track the balance due — and set up an automatic reminder chain when needed"
      >
        You reach this page by clicking a row in the invoice list. The header shows the invoice
        number (e.g. <HelpKey>INV-0001</HelpKey>) and a colored status badge beside it. Every amount,
        payment and activity here belongs only to this one invoice in your organization. Anything you
        change — adding a payment, sending it — updates the KPI cards and status at the top
        immediately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a <strong>back arrow</strong> (returns to the list), the invoice number,
          the status badge and, if set, the invoice title. On the right is a row of action buttons:{" "}
          <HelpKey>Edit</HelpKey>, <HelpKey>Send</HelpKey>, <HelpKey>Download PDF</HelpKey>,{" "}
          <HelpKey>PDF without Stamp</HelpKey>, <HelpKey>Act</HelpKey>, <HelpKey>Duplicate</HelpKey>{" "}
          and a red <HelpKey>Delete</HelpKey>. Below them is a three-stage pipeline strip
          (<strong>Draft → Sent → Paid</strong>) and five KPI cards. Further down are six tabs.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">The invoice's current state: Draft, Sent, Viewed, Partially Paid, Paid, Overdue, Cancelled, or Refunded.</HelpDef>
          <HelpDef term="Pipeline">A three-stage strip — Draft, Sent, Paid; the stage the invoice is in lights up.</HelpDef>
          <HelpDef term="Subtotal (excl. tax)">The sum of line items before tax; if tax applies, the rate appears on the line below.</HelpDef>
          <HelpDef term="Total Amount (incl. tax)">The final amount the client owes.</HelpDef>
          <HelpDef term="Balance Due">The portion still unpaid; red when above zero, green when zero.</HelpDef>
          <HelpDef term="Paid">The sum of all payments recorded so far.</HelpDef>
          <HelpDef term="Days Until Due / Overdue">How many days remain until the due date; once it's past, it shows red as "days overdue".</HelpDef>
        </dl>
        <p>
          Tabs: <strong>Overview</strong> (invoice and client info + notes),{" "}
          <strong>Items</strong> (line-by-line goods/services and a totals table),{" "}
          <strong>Payments</strong> (payment history and the record-payment action),{" "}
          <strong>Activity</strong> (created, sent, viewed, paid — on a timeline),{" "}
          <strong>Chain</strong> (the automatic reminder flow) and <strong>Preview</strong>{" "}
          (the invoice as a PDF).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: send the invoice to the client">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Send</HelpKey> in the header.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Send" dialog opens with <strong>Recipient Email</strong>, <strong>Subject</strong> and{" "}
            <strong>Message</strong> fields. The email and subject come pre-filled — the recipient is
            the invoice's recipient email (or, if empty, the contact's email), and the subject reads
            "Invoice &lt;number&gt;".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Adjust the email and subject if needed, add a few words in the <strong>Message</strong>{" "}
            field, then click <HelpKey>Send</HelpKey> at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Sending..." and the dialog closes. The status badge becomes{" "}
            <strong>Sent</strong>, the pipeline advances to the second stage, and an "Invoice sent"
            entry appears in the <strong>Activity</strong> tab. If the send fails, a red error message
            shows inside the dialog.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: record an incoming payment">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Payments</HelpKey> tab and click <HelpKey>Record Payment</HelpKey> at the
            top right. (This button only appears while the balance due is above zero.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Record Payment" dialog opens. <strong>Amount</strong> is pre-filled with the balance
            due; below it are <strong>Payment Method</strong> (Bank Transfer, Cash, Card, Check,
            Other), <strong>Payment Date</strong> (defaults to today), <strong>Reference</strong> and{" "}
            <strong>Notes</strong> fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Check the amount (change it for a partial payment), pick the method and date, optionally
            add a reference, then click <HelpKey>Record Payment</HelpKey> at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes and the payment is added to the <strong>Payments</strong> table with a
            green amount. The <strong>Paid</strong> and <strong>Balance Due</strong> KPI cards update;
            when fully paid the status becomes <strong>Paid</strong>, and on a partial payment it
            becomes <strong>Partially Paid</strong>. On an error, a red message shows in the dialog.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: PDF, Act and Duplicate">
        <HelpStep n={1}>
          <p>
            For a stamped PDF click <HelpKey>Download PDF</HelpKey> in the header; for an unstamped
            copy click <HelpKey>PDF without Stamp</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The invoice PDF opens in a new browser tab. You can also see the same rendering without
            leaving the page in the <strong>Preview</strong> tab.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For an acceptance act click <HelpKey>Act</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The act document opens in a new tab as HTML.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To create a new invoice with the same items, click <HelpKey>Duplicate</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The system creates a new draft invoice and takes you straight to that new invoice's page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set up an automatic reminder chain">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Chain</HelpKey> tab. The first time around you'll see "Chain not
            configured" with a <HelpKey>Set up chain</HelpKey> button in the middle — click it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chain builder opens with a "Trigger: invoice sent" starting node. Below it is a dashed
            frame to <HelpKey>Add step</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Add step</HelpKey> and pick a type: <strong>Email</strong>,{" "}
            <strong>SMS</strong>, <strong>Wait</strong>, <strong>Telegram</strong>,{" "}
            <strong>WhatsApp</strong> or <strong>Condition</strong>. Fill in the text and confirm
            with <HelpKey>Add</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog with a three-column type picker opens. Subject/message fields come pre-filled with
            a ready template in the matching language (with variables like{" "}
            <HelpKey>{"{{invoice_number}}"}</HelpKey>, <HelpKey>{"{{amount}}"}</HelpKey>,{" "}
            <HelpKey>{"{{balance_due}}"}</HelpKey>). Pick "Condition" and you get ready-made recipes —
            for example "If paid → stop". After adding, the step shows as a numbered card under the
            trigger.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Once you've added steps, first click <HelpKey>Save steps</HelpKey>, then{" "}
            <HelpKey>Start</HelpKey> to run the chain.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If there are unsaved changes, the <strong>Start</strong> button stays disabled reading
            "Save first". After saving you can start it; when active a green "Chain is active" bar with
            a pulsing dot appears at the top, showing the next action time if any. To stop it, click{" "}
            <HelpKey>Stop</HelpKey>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>Edit</strong> button takes you to the invoice's separate edit page, where you
          can change the line items, dates and client info. If you just want to see what happened, the{" "}
          <strong>Activity</strong> tab gathers creation, sending, the client's view and every payment
          in one chronological feed.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The <HelpKey>Delete</HelpKey> button removes the invoice entirely after a confirmation
          dialog, and that can't be undone. Rather than deleting an invoice that already has payments,
          consider changing its status instead. Always <HelpKey>Save steps</HelpKey> before you{" "}
          <strong>Start</strong> a chain — otherwise start won't work.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All invoices, payments and chains are scoped to your organization — you only see and change
          your own tenant's invoice. Actions like sending the invoice, recording a payment and
          deleting are logged in the audit trail under the <strong>Activity</strong> tab.
        </p>
      </HelpCallout>
    </div>
  )
}
