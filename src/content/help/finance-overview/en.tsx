"use client"

/**
 * Finance — Financial Overview (Overview tab) help article (English).
 * Split out of the old shared "budgeting" article: covers ONLY the
 * Finance → Overview tab (year/date-range picker, Excel export, alerts,
 * 6 KPI cards, trend/breakdown/aging charts, financial summary).
 * The Receivables/Payables/Funds/Payments tabs are separate and NOT here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function FinanceoverviewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a finance person, business owner, or manager"
        goal="See the whole company picture — revenue, expenses, profit, cash, receivables and payables — on one screen and spot trouble fast"
      >
        Reach the page from the left menu under <HelpKey>Finance</HelpKey>, staying on the{" "}
        <HelpKey>Overview</HelpKey> tab (the page always opens on it). Every number is calculated only
        from your own organization's data. Overview is a read-only dashboard — you don't create anything
        here, you just look, pick a period and export; the actual invoices, payments and funds live in
        the neighboring tabs.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows <HelpKey>Finance</HelpKey> with tour-replay and help buttons next to it.
          Below it sit five tabs: <HelpKey>Overview</HelpKey>, <HelpKey>Receivables (A/R)</HelpKey>,{" "}
          <HelpKey>Payables (A/P)</HelpKey>, <HelpKey>Funds</HelpKey> and{" "}
          <HelpKey>Payments</HelpKey>. This article covers only the <strong>Overview</strong> tab. At
          the top of Overview is the <strong>Financial Overview</strong> heading and the selected period
          (e.g. "Key metrics and trends for 2026", or a date range); on the right are the period controls
          and the <HelpKey>Export Excel</HelpKey> button. Below that — if any — an alerts strip, then six
          KPI cards, then the charts and the financial summary.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Revenue">Income for the selected period; the card shows the actual figure with "Plan" and the percentage variance against plan below it.</HelpDef>
          <HelpDef term="Expenses">Costs for the period; overspending is bad, so the variance is colored inversely (under plan = green).</HelpDef>
          <HelpDef term="Net Profit">Revenue minus expenses; green when positive, red when negative.</HelpDef>
          <HelpDef term="Cash Balance">Current cash on hand; shown in red if negative.</HelpDef>
          <HelpDef term="Receivables (A/R)">Money owed to you; if any invoices are overdue, the count is noted under the card.</HelpDef>
          <HelpDef term="Payables (A/P)">Money you owe; if any payments are overdue, the count is shown.</HelpDef>
          <HelpDef term="Plan / actual">Plan is the budgeted target; actual is what really happened. The percentage on the card is the gap between the two.</HelpDef>
          <HelpDef term="Receivables aging">A breakdown of how old the money owed to you is: Current, 1-30 days, 31-60 days, 61-90 days and 90+.</HelpDef>
          <HelpDef term="Net Position">Receivables minus Payables — the overall balance of who owes whom.</HelpDef>
        </dl>
        <p>
          Each KPI card has a colored bar across the top, a title, a large figure and a currency mark;
          the Revenue and Expenses cards additionally show the plan and an up/down-arrow percentage
          variance. Below sit two rows of charts: the first row has a wide{" "}
          <strong>Revenue &amp; Expense Trend</strong> (bars + line) on the left and a donut{" "}
          <strong>Expense Breakdown</strong> on the right; the second row has a horizontal{" "}
          <strong>Receivables Aging</strong> bar chart on the left and a line-by-line{" "}
          <strong>Financial Summary</strong> card on the right.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: pick a period and read the metrics">
        <HelpStep n={1}>
          <p>
            From the year dropdown at the top right, pick a year (last year, this year and next year are
            offered).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The subtitle changes to "Key metrics and trends for &lt;selected year&gt;", and every KPI
            card, chart and the summary reload with that year's numbers.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For a specific date range, fill the two date fields after the <HelpKey>or</HelpKey> label
            next to the year dropdown — the first is the "from" date, the second the "to" date.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Once both dates are set, the subtitle switches to a "&lt;from&gt; – &lt;to&gt;" range, the
            year dropdown turns gray (disabled), and the metrics recompute over the chosen range. The
            "to" date can't be earlier than the "from" date.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To cancel the range and go back to a full year, click the <HelpKey>Clear range</HelpKey>{" "}
            button that appears next to the dates.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Both date fields empty, the year dropdown becomes active again, and the metrics return to
            that year. The <HelpKey>Clear range</HelpKey> button only shows while a range is set.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Read the six KPI cards: each shows a large actual figure, a currency mark and, where relevant,
            a "Plan" line with a percentage variance.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The variance is marked with a green up-arrow (good), a red down-arrow (bad), or a gray dash
            (no gap). The Expenses card is inverted — spending under plan is green, over plan is red. If
            any documents are overdue, the Receivables and Payables cards show a "&lt;count&gt; overdue"
            note under the figure.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: check the alerts">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Alerts</HelpKey> strip above the KPI cards (it doesn't appear at all when
            there's nothing wrong).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each alert appears as a colored row: red (critical), amber (warning) or blue (info) — with a
            matching icon. The text typically covers overdue invoices, a negative cash balance, budget
            overspend, overdue payments, or fund coverage.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If an alert has an <HelpKey>Open</HelpKey> link, click it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            It takes you to the page that issue belongs to (e.g. the Receivables tab for overdue
            invoices) so you can act directly from there. Not every alert has this link.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the charts and the summary">
        <HelpStep n={1}>
          <p>
            Look at the wide <HelpKey>Revenue &amp; Expense Trend</HelpKey> chart on the left — revenue
            (green bars), expenses (red bars) and net (blue line) by month.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Hovering a bar or the line opens a small tooltip showing that month's revenue, expenses and
            net amount with the currency. Month labels render in your selected language.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <HelpKey>Expense Breakdown</HelpKey> donut on the right — expenses split by
            category.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the donut each category is listed with a colored dot, name and percentage; smaller
            leftover categories are rolled up under "Other". If there's no expense data, "No expense data"
            is shown instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <HelpKey>Receivables Aging</HelpKey> horizontal bar chart — how old the money owed
            to you is (Current, 1-30, 31-60, 61-90, 90+ days).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each aging band gets its own color; hovering a bar shows the amount with the currency. If
            there's no open receivable, "No receivables aging data" is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Read the <HelpKey>Financial Summary</HelpKey> card on the right — a line-by-line list of every
            key figure.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Revenue (plan/actual), Expenses (plan/actual), Net Profit, Cash Balance, Receivables, Payables
            and <strong>Net Position (A/R – A/P)</strong> are laid out line by line with amounts; the key
            lines are set in bold.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: export the report to Excel">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Export Excel</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The financial report for the current view — your selected year or date range — downloads as an
            Excel file. The export already honors whatever period is selected, so pick your year/range
            first, then export.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The year picker and the date range are mutually exclusive: once a range is filled, the year
          dropdown is disabled. Use the date range for an exact view of a specific quarter or month; for
          a full-year comparison the year dropdown is handier.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The Overview tab only reads existing data — it <strong>does not change</strong> any invoice,
          payment or budget. "Plan" figures come from your budget and "actual" figures from real
          invoices/payments, so if the cards look empty or zero, the problem isn't Overview — it's that
          the source data (budget, invoices, payments) hasn't been filled in.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All financial metrics are limited to your own organization — you never see another
          organization's numbers. The Excel export likewise contains only your own tenant's data.
        </p>
      </HelpCallout>
    </div>
  )
}
