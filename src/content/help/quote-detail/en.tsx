"use client"

/**
 * Quote detail / editor — help article (English).
 * Split out of the old shared "quotes" article: covers ONLY the single
 * quote page — /quotes/[id] (line items, discount, notes, status
 * transitions, PDF, tracking pixel, delete). The quotes LIST is NOT
 * part of this article.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function quotedetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a sales rep or manager"
        goal="Build one quote, send it to the customer, and track its lifecycle — viewed, accepted, rejected"
      >
        You land here by opening a specific quote from the quotes list (or from
        a deal). On open, the page reads that quote from the server. Every figure
        and the status come only from your own organization. <strong>Note:</strong>{" "}
        once a quote reaches a terminal status — accepted, rejected, or expired —
        the editable fields lock; from then on you can only view, export the PDF,
        or delete it.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          While loading you see a centered spinner and <HelpKey>Loading…</HelpKey>.
          If the quote isn't found, a <em>"Quote not found."</em> message and a{" "}
          <HelpKey>Back to quotes</HelpKey> button appear.
        </p>
        <p>
          When it opens, the top-left shows an <HelpKey>All quotes</HelpKey> button
          (back arrow), then the quote number, a <strong>v2</strong>-style version
          tag for versions greater than 1, and a colored <strong>status badge</strong>{" "}
          (Draft / Sent / Viewed / Accepted / Rejected / Expired). If the quote is
          linked to a deal, a <em>"Linked to deal:"</em> line with a clickable deal
          name appears beneath it.
        </p>
        <p>
          The top-right holds a row of action buttons: only the{" "}
          <strong>legal next-status</strong> buttons for the current status (e.g.{" "}
          <HelpKey>Mark as sent</HelpKey>), then <HelpKey>Save</HelpKey>,{" "}
          <HelpKey>PDF</HelpKey>, a <HelpKey>Copy pixel</HelpKey> button (only when
          the status is Sent and a tracking token exists), <HelpKey>Delete</HelpKey>,
          and the question-mark help button.
        </p>
        <p>
          Below sits the <strong>Customer</strong> block (deal picker + a customer
          name for the PDF), then the <strong>Line items</strong> table, and under
          it the <strong>Quote-level discount</strong>, <strong>Valid until</strong>,
          and <strong>Notes</strong> blocks. On the right is the{" "}
          <strong>Summary</strong> card (Subtotal / Discount / Total plus the
          timeline dates).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status badge">
            The quote's current stage: Draft, Sent, Viewed, Accepted, Rejected, or
            Expired. It determines which transition buttons are shown.
          </HelpDef>
          <HelpDef term="Customer (deal)">
            A picker that links the quote to an existing deal. It fills the "for"
            line on the PDF.
          </HelpDef>
          <HelpDef term="Customer name (PDF)">
            A free-text field — when filled, it overrides the linked deal's name on
            the PDF (e.g. "ACME Corp").
          </HelpDef>
          <HelpDef term="Line item">
            One product or service row: product/service name, type, SKU, description,
            quantity, unit price, line discount, and a calculated line total.
          </HelpDef>
          <HelpDef term="Type">
            The line type: Hardware, License, Subscription, Service, or Other. Only{" "}
            <strong>Service</strong> accepts a fractional quantity (e.g. hours); the
            rest require a whole number (≥1).
          </HelpDef>
          <HelpDef term="Quote-level discount">
            A three-mode discount: None / Amount / percent (%). Only one applies at a
            time.
          </HelpDef>
          <HelpDef term="Valid until">
            The last date the quote stays valid for the customer.
          </HelpDef>
          <HelpDef term="Summary">
            Subtotal, total discount, and grand total; below it, whichever of the
            created, sent, viewed, accepted/rejected, and valid-until dates exist.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: edit line items and save">
        <HelpStep n={1}>
          <p>
            In the <strong>Line items</strong> table, type into the{" "}
            <HelpKey>Product / Service</HelpKey> cell or pick a product from the
            catalog dropdown. Picking from the catalog auto-fills the price, SKU,
            and type.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, catalog suggestions open. When you pick a product, that
            row's <strong>Unit price</strong>, <strong>SKU / Part #</strong>, and{" "}
            <strong>Type</strong> cells fill with the product's data.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For each row, choose a <HelpKey>Type</HelpKey> (Hardware / License /
            Subscription / Service / Other), and enter <HelpKey>Qty</HelpKey>,{" "}
            <HelpKey>Unit price</HelpKey>, and an optional <HelpKey>Discount</HelpKey>{" "}
            (a line-level amount).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            For the <strong>Service</strong> type the quantity field accepts a
            fractional value; other types require a whole number (at least 1). The{" "}
            <strong>Line total</strong> column may still show a dash (—) — it is
            computed on the server after you save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Need more rows? Click <HelpKey>Add line</HelpKey> below the table. To
            remove a row, click the trash icon at its end.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A new empty row is appended to the end of the table. When only one row
            remains, the delete icon is disabled — at least one row is always kept.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally, in the <HelpKey>Quote-level discount</HelpKey> block choose{" "}
            <HelpKey>None</HelpKey>, <HelpKey>Amount</HelpKey>, or <HelpKey>%</HelpKey>{" "}
            and enter a value; fill in <HelpKey>Valid until</HelpKey> and{" "}
            <HelpKey>Notes</HelpKey> (internal).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Choosing <strong>Amount</strong> or <strong>%</strong> reveals a number
            field next to the toggles; <strong>None</strong> hides it. The Notes
            field is internal — it does not appear on the customer-facing PDF.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Save</HelpKey> in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a spinner, then a <em>"Quote saved"</em> toast appears.
            The page reloads and the <strong>Summary</strong> card updates Subtotal,
            Discount, and Total with the recalculated figures. Incomplete rows with
            no name and price are dropped on save.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: customer and status transitions">
        <HelpStep n={1}>
          <p>
            In the <strong>Customer</strong> block, use the{" "}
            <HelpKey>Customer (deal)</HelpKey> picker to link the quote to a deal,
            or type a free-text name into <HelpKey>Customer name (PDF)</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Selecting a deal updates the "Linked to deal:" line in the header. If the
            customer name is filled, the PDF shows that name instead of the deal name.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To move the quote forward, click a status button in the top right — only
            the buttons that are legal from the current status appear (e.g. on Draft{" "}
            <HelpKey>Mark as sent</HelpKey>; on Sent <HelpKey>Mark as viewed</HelpKey>{" "}
            / <HelpKey>Mark rejected</HelpKey>; after Viewed <HelpKey>Mark accepted</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a spinner, then a <em>"Quote marked as …"</em> toast
            appears and the status badge changes color. The matching timeline date
            (Sent / Viewed / Accepted) shows up in the <strong>Summary</strong> card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            When you mark a quote accepted, the system may automatically create a
            draft contract.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If so, a <em>"Draft contract … created"</em> toast appears with a{" "}
            <HelpKey>View contract</HelpKey> action — clicking it takes you straight
            to the new contract.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To reject a quote, click <HelpKey>Mark rejected</HelpKey>, type a reason
            in the red panel that opens, and confirm with{" "}
            <HelpKey>Confirm rejection</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A red-tinted panel opens at the top: a "Rejection reason (encrypted)"
            text area with <HelpKey>Confirm rejection</HelpKey> and{" "}
            <HelpKey>Cancel</HelpKey> buttons. While the reason is empty the confirm
            button is disabled and a "Reason is required." note shows beside it. After
            confirming, the status becomes Rejected and the reason is displayed in its
            own block.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: PDF, tracking pixel, and delete">
        <HelpStep n={1}>
          <p>
            To get the customer-facing document, click the <HelpKey>PDF</HelpKey>{" "}
            button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The quote's PDF opens in a new browser tab.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            When the quote is in <strong>Sent</strong> status and has a tracking
            token, the <HelpKey>Copy pixel</HelpKey> button is shown. Click it to
            copy the pixel snippet, then paste it into the body of the email you send.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A <em>"Tracking pixel copied — paste it into your email"</em> toast
            appears. When the customer opens that email the pixel loads and the quote
            flips to Viewed automatically. (This button only appears on quotes that
            are Sent and have a token.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete the quote, click the red <HelpKey>Delete</HelpKey> button in
            the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete quote" confirmation dialog opens, warning that the line items
            are removed along with it. After you confirm, you're returned to the
            quotes list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status moves forward, not back — accepted/rejected/expired is terminal and
          there's no return to draft. So save your line items and figures with{" "}
          <HelpKey>Save</HelpKey> before you mark a transition: in a terminal status
          all editable fields lock.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Deleting can't be undone and also removes <strong>all line items</strong>{" "}
          on the quote. A rejection reason is required and is stored encrypted for the
          audit trail — write it meaningfully.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The quote, its line items, and the linked deal all belong only to your
          organization — you can't open another tenant's quotes. The rejection reason
          is encrypted on the server; this page only sees the plaintext.
        </p>
      </HelpCallout>
    </div>
  )
}
