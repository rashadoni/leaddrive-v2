"use client"

/**
 * Invoice editor — help article (English).
 * Covers the edit page for an existing invoice (/invoices/[id]/edit):
 * the gradient header bar, the Client / Items / Details / Notes cards,
 * the Summary block at the bottom, and the Save flow. This page does NOT
 * create a new invoice — it edits an existing one and returns to the
 * invoice view page on save.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function invoiceeditHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales or finance team member"
        goal="Adjust an existing invoice's client, line items, amounts, or details and save the changes"
      >
        You reach this page from the edit button on an invoice's view page; the URL looks like{" "}
        <HelpKey>/invoices/&lt;id&gt;/edit</HelpKey>. When the page opens, the invoice's existing data
        is loaded automatically — so you see a pre-filled form, not a blank one. The invoice number
        cannot be changed. All data is scoped to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is a cyan-to-blue <strong>gradient header</strong>: on the left a{" "}
          <HelpKey>Back to Invoices</HelpKey> button, next to it an «Edit — &lt;invoice number&gt;»
          label, and below it an editable <strong>title field</strong> (placeholder: «e.g. Web
          Development Services - March 2026»); on the right the invoice number appears as a mono-font
          badge. Below the header, four cards stack in sequence, each with a different colored stripe
          down its left edge:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Client">
            Cyan-stripe card: <strong>Company *</strong> (required), <strong>Contact Person</strong>{" "}
            (enabled only after a company is chosen) and <strong>Deal</strong> dropdowns.
          </HelpDef>
          <HelpDef term="Items">
            Blue-stripe card: a table of the invoice's line items. Columns — <strong>Name</strong>,{" "}
            <strong>Description</strong>, <strong>Qty</strong>, <strong>Unit Price</strong>,{" "}
            <strong>Discount %</strong> and a calculated <strong>Total</strong>. Top-right has{" "}
            <HelpKey>From Products</HelpKey> and <HelpKey>Add Item</HelpKey> buttons.
          </HelpDef>
          <HelpDef term="Details">
            Violet-stripe card: <strong>Invoice Number</strong> (read-only), <strong>Issue Date</strong>,{" "}
            <strong>Due Date</strong>, <strong>Currency</strong>, <strong>Payment Terms</strong>,{" "}
            <strong>VÖEN</strong> (tax ID) and a contract row (contract picker, contract number,
            contract date).
          </HelpDef>
          <HelpDef term="Notes & Terms">
            Amber-stripe collapsible card: collapsed by default. Expanding it reveals{" "}
            <strong>Notes</strong>, <strong>Terms & Conditions</strong> and <strong>Footer Note</strong>{" "}
            text areas. The header shows an amber «● filled» when any are filled, or «optional» when
            empty.
          </HelpDef>
          <HelpDef term="Summary">
            Bottom card with a cyan top stripe: <strong>Subtotal</strong>, <strong>Discount</strong>{" "}
            (percentage or fixed), an <strong>Include VAT (18%)</strong> checkbox and the bold{" "}
            <strong>Total</strong>. The <HelpKey>Save</HelpKey> button is at the bottom right.
          </HelpDef>
        </dl>
        <p>
          The <HelpKey>Add another item</HelpKey> strip below the table and the trash icon at the end
          of each row let you add and remove line items. All amounts recalculate instantly as you type
          — there's no «calculate» button to press.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: change the client and title">
        <HelpStep n={1}>
          <p>
            To rename the invoice, click the white <strong>title field</strong> in the gradient header
            and edit the text.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text changes directly in the header bar, in the underlined white field. If you leave it
            blank, the invoice number is used as the title on save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Client</HelpKey> card, pick a company from the <strong>Company</strong>{" "}
            dropdown (this is the only required choice, marked with an asterisk).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Once a company is selected, the <strong>Contact Person</strong> dropdown becomes active and
            fills with that company's contacts. The contract dropdown also refreshes with that
            company's contracts.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally pick a <strong>Contact Person</strong> and a <strong>Deal</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If no company is selected yet, the Contact Person field is greyed out and disabled. The Deal
            dropdown lists all of your organization's deals.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit line items">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Items</HelpKey> card's table, click into the cells of existing rows to
            change the <strong>Name</strong>, <strong>Description</strong>, <strong>Qty</strong>,{" "}
            <strong>Unit Price</strong> and <strong>Discount %</strong> values.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row's <strong>Total</strong> cell recalculates immediately (qty × unit price, then the
            row's discount subtracted). Quantity stays at least 1 and discount stays within 0–100.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To add a new blank row, click the <HelpKey>Add Item</HelpKey> button top-right or the{" "}
            <HelpKey>Add another item</HelpKey> strip below the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A blank row is appended to the end of the table; you can start typing a name, quantity
            (defaults to 1) and price there.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To add an item from the product catalog, click <HelpKey>From Products</HelpKey> and pick a
            product from the dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dropdown of products with their names and prices appears below the button. Picking a
            product appends a new row pre-filled with its name, description and price, and the dropdown
            closes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To delete an unneeded row, click the trash icon at the end of that row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The row leaves the table and the totals update. If only one row remains, its trash icon is
            disabled — you can't delete the last line item.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: change details and contract">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Details</HelpKey> card, adjust <strong>Issue Date</strong>,{" "}
            <strong>Due Date</strong>, <strong>Currency</strong>, <strong>Payment Terms</strong> and{" "}
            <strong>VÖEN</strong> as needed.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Invoice Number</strong> field has a grey background and is read-only — it can't
            be changed. The Payment Terms dropdown offers «Due on Receipt», «Net 15», «Net 30», «Net 45»
            and «Net 60».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the contract row, you can pick an existing contract from the <strong>Contract</strong>{" "}
            dropdown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Picking a contract auto-fills the <strong>Contract №</strong> and <strong>Contract date</strong>{" "}
            fields. If no company is selected yet, the dropdown shows «Select a company first»; if the
            company has no contracts, it shows «No contracts».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: summary, discount, VAT and saving">
        <HelpStep n={1}>
          <p>
            In the bottom <HelpKey>Summary</HelpKey> card, to apply an overall discount, choose{" "}
            <HelpKey>%</HelpKey> or the currency (fixed amount) from the discount-type dropdown and type
            the value into the field next to it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the discount is greater than zero, a red <strong>Discount Amount</strong> line appears
            and the <strong>Total</strong> drops immediately. This discount is SEPARATE from each row's
            own discount — it's applied on top of the subtotal.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To add tax, tick the <HelpKey>Include VAT (18%)</HelpKey> checkbox.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Ticking it reveals a <strong>VAT (18%)</strong> line computed as 18% of the after-discount
            amount, which is added to the bold <strong>Total</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To commit all changes, click the <HelpKey>Save</HelpKey> button at the bottom right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving...»; on success the system automatically returns you to that
            invoice's view page. On error, a red toast notification appears and you stay on the page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Line items with an empty name are skipped on save — a blank row is dropped automatically
          before saving, so you don't have to delete it by hand. Amount fields (price, discount) accept
          decimals using a dot.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Changes are only kept after you press <HelpKey>Save</HelpKey>. If you leave the page early
          (<HelpKey>Back to Invoices</HelpKey> or the browser back button), your edits are lost. The
          invoice number cannot be changed from this page.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All data — invoices, companies, contacts, deals, products and contracts — is scoped to your
          organization. The dropdowns only show your own tenant's records, and you can't edit another
          organization's invoice.
        </p>
      </HelpCallout>
    </div>
  )
}
