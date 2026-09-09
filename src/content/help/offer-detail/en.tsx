"use client"

/**
 * Offer detail (record) — help article (English).
 * Covers a single offer card: the /offers/[id] page.
 * Status pipeline (Draft → Sent → Approved), KPI cards, items table + totals,
 * details/client cards, and the core actions: Send (email), PDF,
 * Convert to Invoice, Edit, Delete.
 * The offers list is a SEPARATE article — not covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function OfferDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales rep or the person preparing proposals"
        goal="Open a commercial offer, check its amount and line items, send it to the client, and convert it to an invoice once approved"
      >
        You reach this page by clicking an offer in the <HelpKey>Offers</HelpKey> list. All offer data
        is scoped to your organization only. The amounts on the page — subtotal, discount, VAT and
        grand total — are computed in real time from the items table, so as you edit the offer and
        change items, every figure updates automatically.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a back arrow (<HelpKey>←</HelpKey>), the offer title, and below it the
          offer number plus a colored <strong>status badge</strong>; if the type isn't commercial, a
          type tag (e.g. <strong>Equipment</strong>, <strong>Services</strong>) appears next to it. A
          row of action buttons sits at the top right. Below comes the status pipeline, four KPI cards,
          (if there are items) the items table + totals block, and at the bottom two cards:{" "}
          <strong>Offer Details</strong> and <strong>Client Information</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">The offer's current state: Draft, Sent, Approved or Rejected — each in its own color.</HelpDef>
          <HelpDef term="Status pipeline">A horizontal bar showing Draft → Sent → Approved; the current stage is highlighted. If rejected, a red "Rejected" block is appended at the end.</HelpDef>
          <HelpDef term="TOTAL">The grand total monetary value of the offer with discount and VAT applied (shown with the currency).</HelpDef>
          <HelpDef term="Items">The number of line rows (product/service) on the offer.</HelpDef>
          <HelpDef term="Valid Until">Days remaining until the validity date; if the date has passed it shows "Expired".</HelpDef>
          <HelpDef term="Days open">How many days have passed since the offer was created.</HelpDef>
          <HelpDef term="Items table">Each row: name, quantity, unit price, discount %, and line total; below it subtotal, discount, VAT (18%) and TOTAL.</HelpDef>
        </dl>
        <p>
          The action buttons depend on status: while the offer is <strong>Draft</strong> a{" "}
          <HelpKey>Send</HelpKey> button is shown, and when the offer is <strong>Approved</strong> (or
          accepted) a <HelpKey>Convert to Invoice</HelpKey> button appears. The{" "}
          <HelpKey>PDF</HelpKey>, <HelpKey>Edit</HelpKey> and <HelpKey>Delete</HelpKey> buttons are
          always available.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: send the offer by email">
        <HelpStep n={1}>
          <p>
            If the offer is in <strong>Draft</strong>, click the <HelpKey>Send</HelpKey> button at the
            top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Send Offer" dialog opens. The <strong>Recipient Email *</strong>, <strong>Subject</strong>{" "}
            and <strong>Message</strong> fields come pre-filled — the subject is "Commercial Offer" +
            the number, and the message contains a greeting, the offer number and the computed grand
            total amount.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Check the <strong>Recipient Email</strong> field (it's required), edit the{" "}
            <strong>Subject</strong> and <strong>Message</strong> text if needed, then click the{" "}
            <HelpKey>Send</HelpKey> button at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the email is left empty a red "Email is required" warning appears. While sending, the
            button shows "…"; on success a green "Offer sent successfully" message appears and the
            dialog closes after a couple of seconds. On failure a red error message is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Once the dialog closes, return to the page.</p>
          <HelpCallout kind="see" label="What you'll see">
            In the <strong>Offer Details</strong> card the <strong>Sent</strong> field fills with the
            send date; in the status pipeline the <strong>Sent</strong> stage is highlighted as the
            active stage.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: download the offer as PDF">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>PDF</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The offer's PDF document opens in a new browser tab — with the items, amounts and client
            information. From there you can print or save it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: convert the offer to an invoice">
        <HelpStep n={1}>
          <p>
            When the offer is <strong>Approved</strong>, a <HelpKey>Convert to Invoice</HelpKey> button
            appears at the top right. Click it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly shows "…", then the system creates a new invoice from the offer's items
            and amounts and redirects you straight to that invoice's page. If something goes wrong, a
            warning message appears on screen.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            This button only shows when the offer is <strong>approved</strong>. You can't convert a
            draft or sent offer directly into an invoice — wait for the offer to be approved first.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete the offer">
        <HelpStep n={1}>
          <p>
            To change the content, click the <HelpKey>Edit</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The offer form opens pre-filled with the existing title, type, currency, client, items,
            discount and VAT settings. After you save your changes, the KPI cards, items table and
            grand total update automatically.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete the offer, click the red <HelpKey>Delete</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Offer" confirmation dialog opens, naming which offer will be deleted. After you
            confirm, the offer is removed and you're redirected back to the <HelpKey>Offers</HelpKey>{" "}
            list.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion can't be undone. Think twice before deleting an offer that's been converted to an
            invoice or already sent to a client — you lose the document record. If it's simply no longer
            relevant, consider keeping it and changing the status instead.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The grand total is never typed by hand — it's computed from the line rows (quantity × price −
          line discount), then the general discount and 18% VAT (only if VAT is included) are applied.
          To change the figure, edit the items or the discount/VAT settings.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          An offer belongs to your organization only — you can't see or open another tenant's offers.
          Sending, PDF, conversion and deletion are all scoped to your organization context.
        </p>
      </HelpCallout>
    </div>
  )
}
