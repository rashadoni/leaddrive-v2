"use client"

/**
 * Sales Forecast (Settings → Sales Forecast) — help article (English).
 * Real UI: Settings → Sales Forecast page — an editable grid of revenue
 * service (department) rows × 12 months, a VAT (18%) toggle, year picker,
 * Excel export/import and Save. Values are always stored without VAT.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function salesforecastsettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a finance or operations admin"
        goal="Enter the monthly sales forecast for each revenue service across a year, view it with or without VAT, and exchange it via Excel"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Sales Forecast</HelpKey> (the back
        arrow in the header returns you to <HelpKey>Budget Configuration</HelpKey>). The grid rows come from
        your budget departments — only the ones that are <strong>revenue</strong> and <strong>active</strong>{" "}
        appear here as service rows. Every forecast amount belongs to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Sales Forecast</HelpKey> title next to a trending-up icon, with a
          short description. In the top-right there are four controls: a <HelpKey>With VAT (18%)</HelpKey>{" "}
          checkbox, a year picker (2025–2028), <strong>download</strong> (Export to Excel) and{" "}
          <strong>upload</strong> (Import from Excel) icon buttons, and a <HelpKey>Save</HelpKey> button.
          Beneath the title is the note «Stored without VAT — toggling shows with 18% VAT».
        </p>
        <p>
          The main area is one table: the left column is <strong>Service</strong> (department names), then a
          column per <strong>month</strong> (Jan, Feb, …), and the rightmost column is <strong>Total</strong>.
          Each month cell is a number input. Below the table are two summary rows: an amber{" "}
          <strong>VAT (18%)</strong> row and a grey <strong>GRAND TOTAL</strong> row.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Service (department)">A revenue, active budget department — one row in the grid. Departments are managed in Budget Configuration, not created here.</HelpDef>
          <HelpDef term="Month cell">The forecast amount for that department in that month. Blank = 0.</HelpDef>
          <HelpDef term="Total (row)">The sum of one department's 12 months.</HelpDef>
          <HelpDef term="VAT (18%) row">The VAT amount per month column (18% of the amount). Read-only, not editable.</HelpDef>
          <HelpDef term="GRAND TOTAL row">The month-by-month and overall total across all departments. Its label reads «GRAND TOTAL (with VAT)» or «GRAND TOTAL (without VAT)» depending on the toggle.</HelpDef>
          <HelpDef term="With VAT (18%) toggle">Changes display only: when checked, cells show with 18% VAT added. Storage is always without VAT.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step-by-step: enter and save a forecast for a year">
        <HelpStep n={1}>
          <p>
            From the year picker in the top-right, pick the year you want to forecast (<HelpKey>2025</HelpKey>–
            <HelpKey>2028</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The grid reloads with the saved values for the chosen year. The card title updates to «Forecast
            for {"{year}"} — N services».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In each service row, click the relevant month cell and type the monthly amount. As you move along
            the row, the <strong>Total</strong> on the right recomputes instantly.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The cell only accepts numbers (the spinner arrows are hidden). As you type, that row's{" "}
            <strong>Total</strong>, plus the bottom <strong>VAT (18%)</strong> and <strong>GRAND TOTAL</strong>{" "}
            rows, update month by month.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally tick the <HelpKey>With VAT (18%)</HelpKey> checkbox to view amounts VAT-inclusive.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The small label next to the card title switches between «Amounts without VAT (net)» and «Amounts
            with 18% VAT», and every cell and total shows grossed up by 18%. This is display only — the stored
            numbers don't change.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            When you're done, click <HelpKey>Save</HelpKey> in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a spinner while saving, briefly switches to <HelpKey>Saved</HelpKey> on success,
            then reverts to <HelpKey>Save</HelpKey>. All 12 months × all services are stored without VAT.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step-by-step: export to Excel and import from Excel">
        <HelpStep n={1}>
          <p>
            To pull the current year into an Excel file, click the <HelpKey>Export to Excel</HelpKey>{" "}
            (download arrow) icon button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The browser downloads a file named <code>sales-forecast-{"{year}"}.xlsx</code>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To load values back from Excel, click the <HelpKey>Import from Excel</HelpKey> (upload arrow) icon
            button and choose an <code>.xlsx</code> or <code>.xls</code> file.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After you pick the file, the grid reloads with the imported values. Import applies to the current
            year — review the numbers before you save.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If you don't see any service rows, it means you have no <strong>revenue</strong>,{" "}
          <strong>active</strong> budget departments yet. Use the back arrow in the header to go to{" "}
          <HelpKey>Budget Configuration</HelpKey> and set up departments there — once you return, they'll show
          up as rows.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The VAT toggle is <strong>display only</strong>: whether it's on or off, storage is always without
          VAT (net). If you type large VAT-inclusive numbers while in «With VAT» mode, the system converts
          them back to net for storage automatically — so to avoid confusion, watch the toggle state while
          entering amounts.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All forecast data is scoped to your organization — you only see your own tenant's departments and
          forecast, with no access to another organization's numbers. Export and import likewise operate only
          on your organization's selected year.
        </p>
      </HelpCallout>
    </div>
  )
}
