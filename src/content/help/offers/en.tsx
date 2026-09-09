"use client"

/**
 * Offers (commercial proposals) — help article (English).
 * Covers only the Offers list page: KPI cards, status tabs,
 * search/table, the new-offer form (type/title, client from CRM or
 * manual, line-item table, currency/VAT/discount, live totals), edit
 * and delete. The offer detail page is NOT included.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function OffersHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a sales rep or sales manager"
        goal="Build a commercial offer (quote) for a client, get the line items, currency, VAT and discount right, and track each offer by status"
      >
        Reach the page from the left menu under <HelpKey>Offers</HelpKey>. Every offer belongs only to
        your organization. When the page opens the list loads from the server; until it does you see grey
        skeleton cards. The stat cards, the status tabs and the totals in the line-item table are all
        computed from the same list, so the numbers refresh instantly as you add, delete, or restatus
        offers.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Offers</HelpKey> (with a replay-tour button next to it), the
          subtitle "Create and track proposals" below it, and the <HelpKey>New Offer</HelpKey> button at
          the top right. Below come a page description and a "Did you know?" tip strip. Then a row of four
          KPI cards, the status filter tabs, a table with a search box above it, and — at the very bottom —
          the form and delete dialogs.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">Count of all offers in the current list (the KPI card and the "All" tab show the same number).</HelpDef>
          <HelpDef term="Amount">Sum of the monetary value of all offers, shown in the currency of the first offer.</HelpDef>
          <HelpDef term="Approved">Count of offers whose status is "Approved" (or accepted).</HelpDef>
          <HelpDef term="Rejected">Count of offers whose status is "Rejected".</HelpDef>
          <HelpDef term="Status">The offer's lifecycle: Draft → Sent → Approved / Rejected.</HelpDef>
          <HelpDef term="Offer Type">Commercial, Invoice, Equipment or Services — the kind of offer.</HelpDef>
          <HelpDef term="Valid Until">The offer's expiry date; once past, the table shows it in red with an "Expired" note.</HelpDef>
          <HelpDef term="Line item">A row inside an offer — one product/service with its name, quantity, price and discount.</HelpDef>
        </dl>
        <p>
          Table columns: <strong>Number</strong> (clickable, opens the offer), <strong>Title</strong>,{" "}
          <strong>Offer Type</strong>, <strong>Amount</strong>, <strong>Status</strong> (a colored badge),{" "}
          <strong>Valid Until</strong>, and on the far right two action buttons — edit (pencil icon) and
          delete (red trash icon). Most column headers are sortable and carry an explanatory hint marker.
          Clicking anywhere on a row (or on the number) opens the offer's detail page.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: filter and search offers by status">
        <HelpStep n={1}>
          <p>
            Pick one of the status tabs below the KPI cards: <HelpKey>All</HelpKey>,{" "}
            <HelpKey>Draft</HelpKey>, <HelpKey>Sent</HelpKey>, <HelpKey>Approved</HelpKey> or{" "}
            <HelpKey>Rejected</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each tab shows the count of offers in that status in a round badge. The selected tab appears
            filled (colored) and the table narrows to only that status. The filter re-queries the server,
            so the list refreshes briefly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a specific offer, type part of its title into the <HelpKey>Search offers...</HelpKey>{" "}
            box above the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, the table filters by title and only matching rows remain. This search works
            together with the status filter — the tab narrows by status first, then the text narrows by
            title.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a new offer">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Offer</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled "New Offer" opens. At the top there's an <strong>Offer Type</strong> dropdown
            next to an <strong>Offer Title *</strong> field, with "Client Information", "Items" and a
            summary section below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Choose the <strong>Offer Type</strong> (<HelpKey>Commercial</HelpKey>,{" "}
            <HelpKey>Invoice</HelpKey>, <HelpKey>Equipment</HelpKey> or <HelpKey>Services</HelpKey>) and
            type the <strong>Offer Title</strong> — this is the only required field (e.g. "Commercial
            offer").
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The title field shows the placeholder "Commercial offer...". If you try to save with an empty
            title, a red "Offer title is required" warning appears at the top of the dialog.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the "Client Information" card pick the source: <HelpKey>From CRM</HelpKey> (default) or{" "}
            <HelpKey>Enter manually</HelpKey>. In CRM mode choose the company from{" "}
            <strong>Select company</strong>, then the <strong>Contact person</strong>. In manual mode you
            get <strong>Client name</strong>, <strong>Tax ID (VOEN)</strong>,{" "}
            <strong>Contact person</strong> and <strong>Contract №</strong> fields.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Two small toggle buttons — <HelpKey>From CRM</HelpKey> / <HelpKey>Enter manually</HelpKey> — sit
            in the top-right corner of the card; the active mode appears filled. In CRM mode the "Contact
            person" list stays disabled until a company is chosen, then fills with that company's contacts.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Fill the rows in the "Items" section. To add from an existing product use the{" "}
            <HelpKey>From Products</HelpKey> button at the top right (shown when products exist); to add a
            blank row use <HelpKey>Add Item</HelpKey>. For each row enter <strong>Name</strong>,{" "}
            <strong>Qty</strong>, <strong>Unit Price</strong> and <strong>Discount %</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table header is a colored strip: <strong>Name · Qty · Unit Price · Discount % · Total</strong>.
            Each row ends with an auto-computed <strong>Total</strong> and a trash icon to remove it (the
            delete button is dimmed when only one row remains). Clicking <HelpKey>From Products</HelpKey>{" "}
            drops down a list of products with their prices; picking one adds it as a new row.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            At the bottom set the offer settings: <strong>Currency</strong>, <strong>Valid Until</strong>{" "}
            (expiry date), the <strong>VAT 18%</strong> checkbox, the <strong>General discount</strong>{" "}
            percentage and <strong>Notes</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A live totals panel sits on the right: <strong>Subtotal</strong>, an orange{" "}
            <strong>Discount (percent)</strong> line if a discount is set, a <strong>VAT (18%)</strong> line
            if VAT is ticked, and the large <strong>TOTAL</strong> at the bottom. Every change (qty, price,
            discount, VAT) updates these figures instantly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving..." while it saves, then the dialog closes and the new offer
            appears in the list. The <strong>Total</strong> KPI card count goes up by one. A new offer is
            created in "Draft" status by default.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete an offer">
        <HelpStep n={1}>
          <p>
            To change an existing offer, click the pencil-icon button (<HelpKey>Edit</HelpKey>) on the right
            of its table row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens, titled "Edit Offer" and pre-filled with the existing type, title, client,
            line items, currency, VAT, discount and notes. Make your changes and confirm with{" "}
            <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete an offer, click the red trash-icon button (<HelpKey>Delete</HelpKey>) on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Offer" confirmation dialog opens and asks which offer (by title) you're removing.
            After you confirm, the offer disappears from the list and the KPI cards and tab counts update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion can't be undone — the offer and all its line items are gone for good. If you only want
            to take an offer out of play, track it by status instead: mark offers you no longer need as
            "Rejected" and keep them in the list.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If you offer the same products often, save them in the Products section first — then in the offer
          form <HelpKey>From Products</HelpKey> drops in the name and price with one click instead of typing
          them by hand. Always fill the <strong>Valid Until</strong> date: once it passes, the table flags
          the offer in red with an "Expired" note, so old offers are easy to spot.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All offers are scoped to your organization — you can only see, edit and delete your own tenant's
          offers, never another organization's. The company and contact-person lists in the client form
          also come only from your own CRM data.
        </p>
      </HelpCallout>
    </div>
  )
}
