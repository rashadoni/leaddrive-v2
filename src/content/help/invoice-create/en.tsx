"use client"

/**
 * Create Invoice — help article (English).
 * Covers only the Invoices → Create Invoice page (gradient header + auto
 * number, Client card, Items table, Details + advanced fields, collapsible
 * Notes & Terms, Summary + Save Draft / Save & Send). The invoice list and
 * settings are NOT included.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InvoiceCreateHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You work in sales or accounting"
        goal="Draft a new invoice to send to a client — pick the company, add line items, set discount/VAT and payment terms, all on one page"
      >
        You reach this page from the <HelpKey>Invoices</HelpKey> list via{" "}
        <HelpKey>Create Invoice</HelpKey>. Every list — companies, contacts, deals, contracts and
        products — is read from your organization only. The invoice number is assigned automatically,
        you don't type it. The summary (subtotal, discount, VAT, total) recalculates live as you fill in
        line items.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is a blue gradient header: on the left a <HelpKey>Back to Invoices</HelpKey> button,
          in the middle the «Create Invoice» label with a title field under it, and on the right the
          auto-assigned invoice-number badge. Below, five cards stack top to bottom:{" "}
          <strong>Client</strong>, <strong>Items</strong>, <strong>Details</strong>,{" "}
          <strong>Notes &amp; Terms</strong> (collapsible) and <strong>Summary</strong> (the bottom card —
          totals and the save buttons).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Title">The field in the header — the name you give the invoice (e.g. «Web Development Services — March 2026»). Leave it blank and a name is auto-generated from the number or date.</HelpDef>
          <HelpDef term="Invoice number">The badge top-right — assigned automatically by the system, not editable.</HelpDef>
          <HelpDef term="Company">The only required choice — who the invoice is billed to. Pick it by typing into the search box.</HelpDef>
          <HelpDef term="Item">One row in the table — product/service name, quantity, price and line amount.</HelpDef>
          <HelpDef term="Subtotal">The sum of all line amounts (after per-line discounts, before the overall discount and VAT).</HelpDef>
          <HelpDef term="Payment terms">«Due on receipt / Net 15 / 30 / 45 / 60» — choosing one auto-fills the Due Date.</HelpDef>
          <HelpDef term="VAT">18% rate — ticking the box adds it on top of the after-discount amount.</HelpDef>
          <HelpDef term="Save Draft / Save & Send">Two save modes — draft (draft status) or save-and-send (sent status).</HelpDef>
        </dl>
        <p>
          Under the <strong>Details</strong> card there's a «Show advanced fields (VOEN, signer, contract,
          language)» toggle — clicking it reveals the hidden fields. The <strong>Notes &amp; Terms</strong>{" "}
          card is collapsed by default; if anything is filled in it shows an amber <strong>● filled</strong>{" "}
          marker in the header, otherwise <strong>optional</strong>.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create an invoice">
        <HelpStep n={1}>
          <p>
            Optionally type the invoice name in the title field in the header. This is not required.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The blue header shows placeholder text like «Web Development Services — March 2026»; as you type,
            your text replaces it. The invoice-number badge top-right is already filled in.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Client</strong> card, start typing a company name into the{" "}
            <HelpKey>Company</HelpKey> search box and pick one from the dropdown. This is the only required
            field (marked with *).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, a dropdown of matching companies appears (up to 15 results). If none match,
            «No companies found» shows. Once a company is selected, the neighbouring{" "}
            <HelpKey>Contact Person</HelpKey> and <HelpKey>Deal</HelpKey> dropdowns become active and fill
            with that company's contacts and deals.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally pick a <HelpKey>Contact Person</HelpKey> and a <HelpKey>Deal</HelpKey>. If you pick
            a deal, some fields are auto-filled from it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With no company selected these dropdowns read «Select company first»; with no deals they read
            «No deals». Picking a deal copies its name into the title, its currency into the currency
            field, and fills the first line item with the deal's name and amount.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In the <strong>Items</strong> table, type a name into the first row's{" "}
            <HelpKey>Product, service or work description</HelpKey> cell, then enter{" "}
            <HelpKey>Qty</HelpKey> and <HelpKey>Price</HelpKey>. To add from an existing catalogue, use the{" "}
            <HelpKey>From Products</HelpKey> button top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table header is a blue (cyan) bar; the default columns are: name, <strong>Project</strong>,{" "}
            <strong>Unit</strong>, Qty, Price and <strong>Amount</strong>. Qty × Price is computed instantly
            in the row's <strong>Amount</strong> cell. Clicking <HelpKey>From Products</HelpKey> opens a
            dropdown of products (name and price); selecting one adds it as a new row.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Need more rows? Click <HelpKey>Add Item</HelpKey> (or <HelpKey>Add another item</HelpKey> at the
            bottom of the table). To create your own column, click <HelpKey>Column</HelpKey>. To delete a
            row, click the trash-can icon at the end of the row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Column</HelpKey> opens a small prompt asking for the column name; confirming adds a new
            column to the table (edit its header directly in the table, remove it with the × next to it). If
            only one row is left, its delete button is disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            In the <strong>Details</strong> card, set the <HelpKey>Issue Date</HelpKey>,{" "}
            <HelpKey>Currency</HelpKey> and <HelpKey>Payment Terms</HelpKey>. The invoice number and{" "}
            <HelpKey>Due Date</HelpKey> come pre-filled.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Invoice Number</HelpKey> field has a grey background and is read-only. Each time you
            change payment terms, the <HelpKey>Due Date</HelpKey> recalculates from the issue date (e.g.
            choosing «Net 30» makes it issue + 30 days). You can still override the Due Date manually.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            If you need VOEN, document language, a signer or a contract, click the{" "}
            <HelpKey>Show advanced fields</HelpKey> toggle and fill in the revealed fields.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the toggle, <strong>VOEN</strong>, <strong>Language</strong> (Azerbaijani / Russian /
            English), <strong>Signer Name</strong> and <strong>Signer Title</strong> fields appear. Lower
            down is a <strong>Contract</strong> dropdown alongside editable number/date fields — picking a
            contract auto-fills its number and start date; the «Select a contract or enter manually» hint
            shows underneath.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={8}>
          <p>
            Optionally click the <HelpKey>Notes &amp; Terms</HelpKey> card header to expand it and fill in{" "}
            <strong>Notes</strong>, <strong>Terms &amp; Conditions</strong> and <strong>Footer Note</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card expands to show three text areas. If you type anything, the header keeps an amber{" "}
            <strong>● filled</strong> marker even when collapsed, so you know there's content inside without
            expanding it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={9}>
          <p>
            In the <strong>Summary</strong> card, set a <HelpKey>Discount</HelpKey> (as % or a fixed amount)
            and the <HelpKey>Include VAT (18%)</HelpKey> checkbox if needed, then check the{" "}
            <HelpKey>Total</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <strong>Subtotal</strong>, a discount line (a red negative amount when present), a{" "}
            <strong>VAT (18%)</strong> line when ticked, and the large <strong>Total</strong> at the bottom
            update live. The discount's currency/percent selector and value are controlled here.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={10}>
          <p>
            When you're done, click <HelpKey>Save Draft</HelpKey> (to send later) or{" "}
            <HelpKey>Save &amp; Send</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The buttons switch to «Saving...», then you're redirected to the new invoice's page. If you
            haven't picked a company, a «Select Company» toast appears; if no item has a name, a «Please add
            at least one item» toast appears and the save stops.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Shortcut: pick the company first, then a <HelpKey>Deal</HelpKey> — the deal's name, currency and
          amount are copied into the title and the first line item automatically, so you type less by hand.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Two things are required to save: a <strong>Company</strong> must be selected and at least one{" "}
          <strong>Item</strong> must have a name. You cannot change the invoice number — it's assigned by the
          system.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Every dropdown — companies, contacts, deals, contracts and products — comes from your organization
          only; you can't pick another tenant's data. The created invoice is bound to your organization too.
        </p>
      </HelpCallout>
    </div>
  )
}
