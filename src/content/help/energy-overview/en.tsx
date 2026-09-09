"use client"

/**
 * Energy & Utilities — landing/overview help article (English).
 * Split out of the shared "industries" article: covers ONLY the Energy &
 * Utilities vertical landing page (the utility-customers list) — its stat
 * cards (Total Customers / Active / Meters / Outages), the search + status
 * filter, the customer table, and the row-click into the customer detail.
 * Metering Points, Outages and Service Calls are separate sidebar pages.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energyoverviewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a customer-service or operations admin at a utility"
        goal="Open the Energy & Utilities landing page, search and filter utility customers, and drill into a specific account"
      >
        You reach this page from the <HelpKey>Energy &amp; Utilities</HelpKey> section in the sidebar. This is
        the vertical's landing page — the moment it opens it loads the list of <strong>utility customers</strong>.
        All customers, meters and outages are scoped to your organization only. The numbers in the stat cards
        read from the same source as the list, so the relevant cards update immediately as you change the
        filter or search.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Top-left shows a flame icon, the title <HelpKey>Energy &amp; Utilities</HelpKey>, and the line
          "Utility customers, metering points, outages, and service calls management." A{" "}
          <HelpKey>New Customer</HelpKey> button sits top-right. Below the header come four stat cards, then a
          row with a search box and a status filter, and finally the customer table. If more rows exist, a{" "}
          <HelpKey>Load more</HelpKey> button appears beneath it.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Customers">Count of utility customers loaded for the current filter.</HelpDef>
          <HelpDef term="Active">Count of customers whose status is "Active".</HelpDef>
          <HelpDef term="Meters">Total number of metering points (comes from a separate meters query).</HelpDef>
          <HelpDef term="Outages">Total number of grid outages (comes from a separate outages query).</HelpDef>
          <HelpDef term="Customer row">One utility account — with its account number, name, class, status badge and service city.</HelpDef>
          <HelpDef term="Status">The customer's state: Prospect, Active, Suspended or Terminated — shown as a colored badge.</HelpDef>
        </dl>
        <p>
          The table columns are: <strong>Account #</strong> (in monospace), <strong>Name</strong> (with the
          service city as a small sub-line underneath), <strong>Class</strong>, <strong>Status</strong> (a
          colored badge) and <strong>City</strong>. Metering Points, Outages and Service Calls are NOT on this
          page — they are separate pages in the sidebar; this landing page shows the customer list only.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: open the page and read the stats">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Energy &amp; Utilities</HelpKey> section from the sidebar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The page opens and the customer list loads. Four cards line up across the top:{" "}
            <strong>Total Customers</strong>, <strong>Active</strong>, <strong>Meters</strong> and{" "}
            <strong>Outages</strong>. Each card shows a number next to a matching icon (a person for customers,
            a gauge for meters, a warning triangle for outages).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the numbers in the cards. <strong>Total Customers</strong> and <strong>Active</strong> are
            computed from the currently loaded list; <strong>Meters</strong> and <strong>Outages</strong> come
            from their own separate queries.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If there are no customers, the cards read <strong>0</strong> and the table stays empty. The numbers
            fill in a moment after the page opens.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search and filter customers">
        <HelpStep n={1}>
          <p>
            Type an account number into the search box in the filter row (its placeholder reads "Search by
            account number…").
          </p>
          <HelpCallout kind="see" label="What you'll see">
            About half a second after you stop typing, the table refreshes automatically and only matching
            customers remain. It does not fire a request on every keystroke — it waits, then queries once.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a state from the status dropdown: <HelpKey>All statuses</HelpKey>, <strong>Prospect</strong>,{" "}
            <strong>Active</strong>, <strong>Suspended</strong> or <strong>Terminated</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As soon as you choose, the table reloads and shows only customers in that status. The{" "}
            <strong>Total Customers</strong> and <strong>Active</strong> cards update to match the new result.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To refresh the list, click the refresh button (circular-arrow icon) at the right end of the filter
            row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from scratch with the current search and status filter applied; new or changed
            customers appear.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: open a customer and load more">
        <HelpStep n={1}>
          <p>
            Click any customer row in the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            That customer's detail page opens (with sections such as the address, account details, and meters /
            service calls). To return to the list, use the <HelpKey>Back to Customers</HelpKey> link on the
            detail page.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If a <HelpKey>Load more</HelpKey> button shows beneath the table, click it to append the next batch
            of customers.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The new customers are appended to the end of the existing list (the list does not reset). When no
            more rows remain, the <HelpKey>Load more</HelpKey> button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Search matches the <strong>account number</strong> only, not the name. If a customer is hard to find
          by name, narrow the list with the status filter first, then scan the table by eye. The filter and
          search can be applied together at the same time.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The <strong>Meters</strong> and <strong>Outages</strong> card numbers do not come from the customer
          list — they come from separate metering and outages queries. A 0 in those cards is not necessarily
          an error; it is just the result of that query. To work with meters and outages in depth, go to the{" "}
          <strong>Metering Points</strong> and <strong>Outages</strong> pages in the sidebar.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All utility customers, meters and outages are scoped to your organization — you never see another
          organization's data. The page only fetches data for the organization in your session; if the list
          looks empty, it may simply mean no customers have been created yet.
        </p>
      </HelpCallout>
    </div>
  )
}
