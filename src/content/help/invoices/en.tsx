"use client"

/**
 * Invoices — help article (English).
 * Video-script format. Mirrors az.tsx and covers ONLY the real Invoices list page
 * (src/app/(dashboard)/invoices/page.tsx): header buttons, Analytics/List tabs,
 * the four financial stat cards, analytics tiles + payment bar, status filter,
 * table columns and per-row actions (View / Edit / Download PDF / Delete) + delete
 * confirm. Invoice creation, recurring rules and the invoice detail live on other
 * screens — only the buttons that lead there are documented, not their own screens.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InvoicesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You work in sales, finance or operations"
        goal="See every invoice raised for customers in one place, filter by status, track how much money has been collected, and run view / edit / PDF / delete actions on individual invoices"
      >
        You reach this page from the sidebar under <HelpKey>Invoices</HelpKey>. Everything shown here —
        the totals, the tiles and the list rows — reads only from your own organization's data. Creating
        an invoice, recurring rules and the invoice itself live on other screens; this page keeps the
        buttons that lead to them, but it is mainly the list and overview hub.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Invoices</HelpKey> title with the subtitle "Create, send and
          track invoices." Next to the title sit a replay-tour button and this help button. Top right
          there are three things: the <strong>Analytics / List</strong> tab switcher, a{" "}
          <HelpKey>Recurring Invoices</HelpKey> button (refresh icon) and the blue{" "}
          <HelpKey>New Invoice</HelpKey> button (plus icon).
        </p>
        <p>
          Below comes a page description line, then a "Did you know?" tip card. Under them{" "}
          <strong>four financial cards are always visible</strong>: <strong>Total Invoiced</strong>,{" "}
          <strong>Paid</strong>, <strong>Outstanding</strong> and <strong>Overdue</strong>. What follows
          depends on the active tab: the <strong>List</strong> tab shows a status filter and the invoice
          table, while the <strong>Analytics</strong> tab shows extra tiles, a payment bar and charts.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Invoiced">The total amount billed to all customers.</HelpDef>
          <HelpDef term="Paid">The total amount actually collected from customers.</HelpDef>
          <HelpDef term="Outstanding">Unpaid invoices — the balance customers still owe.</HelpDef>
          <HelpDef term="Overdue">Unpaid invoices whose due date has passed.</HelpDef>
          <HelpDef term="Status">An invoice's state: Draft → Sent → Viewed → Paid; or Partially paid, Overdue, Cancelled, Refunded.</HelpDef>
          <HelpDef term="Balance Due">The amount still owed on an invoice after recorded payments.</HelpDef>
        </dl>
        <p>
          The list table columns, left to right, are: row number (#), <strong>Number</strong>,{" "}
          <strong>Company</strong>, <strong>Title</strong>, <strong>Amount</strong>,{" "}
          <strong>Status</strong>, <strong>Due Date</strong>, <strong>Balance Due</strong> and the action
          icons at the far right. Status is a colored badge; amounts show two decimals with the currency.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: switch tabs and read the totals">
        <HelpStep n={1}>
          <p>
            The page opens on the <HelpKey>List</HelpKey> tab by default. Look at the four financial
            cards at the top — they don't depend on the tab and are always visible.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Total Invoiced</strong>, <strong>Paid</strong>, <strong>Outstanding</strong> and{" "}
            <strong>Overdue</strong> cards — each with its own icon, an amount, and a hint on hover.
            Amounts show two decimals in the organization's currency.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the switcher at the top right, click the <HelpKey>Analytics</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the financial cards <strong>six tiles</strong> appear: <strong>This month</strong>,{" "}
            <strong>This year</strong>, <strong>Sent</strong>, <strong>Drafts</strong>,{" "}
            <strong>Avg invoice</strong> and <strong>Partial / Cancel</strong>. Each tile shows a count
            with a short caption underneath (for example this month's amount, or how many of the total
            were sent).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <strong>payment bar</strong> under the tiles (it appears only when the total
            invoiced amount is above zero).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Payment progress" heading with the paid / total amount and a green percentage; a filled
            bar below it; and further down a count breakdown with colored dots — <strong>Paid</strong>{" "}
            (green), <strong>Waiting</strong> (orange), <strong>Overdue</strong> (red) and{" "}
            <strong>Partially paid</strong> (yellow). Below that come charts for revenue, payment status
            and debtor balances.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To return to the table, click the <HelpKey>List</HelpKey> tab again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The tiles and charts hide; the status filter and invoice table come back. The four financial
            cards stay in place.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter the list and find an invoice">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>List</HelpKey> tab, open the status dropdown filter above the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The options: <strong>All</strong>, <strong>Draft</strong>, <strong>Sent</strong>,{" "}
            <strong>Paid</strong>, <strong>Overdue</strong>, <strong>Partially paid</strong> and{" "}
            <strong>Cancelled</strong>. As soon as you pick one, the table narrows to invoices with that
            status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a specific invoice, type into the table's search box (search works by invoice
            number).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A field reading "Search invoices..."; as you type, the table filters to matching numbers.
            Rows are tinted by status: <strong>overdue</strong> reddish, <strong>paid</strong> greenish,{" "}
            <strong>partially paid</strong> yellowish.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <strong>Number</strong> column, an invoice generated by a recurring rule has a small
            repeat marker (↻) next to its number.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A normal invoice has no such marker; an invoice from a recurring rule shows a small blue ↻
            chip after the number.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To open an invoice's details, click anywhere on its row (away from the action icons).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            That invoice's detail page opens. (This help article covers the list page; the detail page
            has its own tabs and buttons.)
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: actions on a single invoice (row icons)">
        <HelpStep n={1}>
          <p>
            At the far right of each row there are four icon buttons. The first is the eye-icon{" "}
            <HelpKey>View</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking the eye icon opens the invoice's detail page — same result as clicking the row
            itself.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the second, pencil-icon <HelpKey>Edit</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            That invoice's edit page opens (title, due date, payment terms, currency, notes and so on are
            changed there).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click the third, download-icon <HelpKey>Download PDF</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The stamped PDF version of the invoice opens in a new browser tab — you can save or print it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To delete an invoice, click the red trash-icon <HelpKey>Delete</HelpKey> button on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog showing the invoice number opens. After you confirm, the invoice
            disappears from the list and the financial cards at the top refresh.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Once you confirm <HelpKey>Delete</HelpKey>, the invoice is removed from the list for good. If
            you want to keep an invoice that is no longer relevant to the customer, it's safer to open it
            and set it to <strong>Cancelled</strong> instead of deleting — the record stays but is not
            counted toward outstanding balances.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: go to a new or recurring invoice">
        <HelpStep n={1}>
          <p>
            To raise a new invoice, click the blue <HelpKey>New Invoice</HelpKey> button at the top
            right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The invoice-creation page opens (customer, line items, amount, currency, due date and so on
            are filled in there). This is a separate screen, outside the scope of this article.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To manage invoices that recur each period, click the <HelpKey>Recurring Invoices</HelpKey>{" "}
            button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The recurring-rules management page opens (frequency, start date, next run and so on). This
            is also a separate screen.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status follows the money. You don't set an invoice's <strong>Paid</strong> or{" "}
          <strong>Partially paid</strong> status by hand here — when you open an invoice and record a
          payment, the status and <strong>Balance Due</strong> update automatically, and the{" "}
          <strong>Paid</strong> / <strong>Outstanding</strong> cards at the top adjust too.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          On the <HelpKey>Analytics</HelpKey> tab the <strong>Sent</strong>, <strong>Drafts</strong> and{" "}
          <strong>Partial / Cancel</strong> tiles are clickable — clicking one sets the list filter to
          that status automatically, and clicking it again clears the filter.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All invoices and totals are scoped to your organization — you only see, edit, download and
          delete your own tenant's invoices; another organization's invoices never appear here. The
          financial cards and analytics are computed from the same organization's data.
        </p>
      </HelpCallout>
    </div>
  )
}
