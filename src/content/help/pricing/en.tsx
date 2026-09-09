"use client"

/**
 * IT Services Pricing Model — help article (English).
 * Split out of the old shared "profitability" article: covers ONLY
 * the Pricing Model page (/pricing) — its three tabs (Price Model /
 * Edit Prices / Additional Sales), adjustment sliders, charts,
 * companies table, Excel export, and converting won deals into sales.
 * The cost / profitability half is NOT included here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function PricingHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a finance or operations admin, or a sales lead"
        goal="Review the IT-services pricing model, build revenue scenarios with percentage adjustments, edit individual company prices, manage additional sales, and export everything to Excel"
      >
        The page opens under the <HelpKey>IT Services Pricing Model</HelpKey> title. Every number —
        revenue, companies, categories and sales — belongs to your organization only. The slider
        adjustments are a <strong>scenario</strong>: real prices change only when you save in the{" "}
        <HelpKey>Edit Prices</HelpKey> tab. If there is no pricing data on first open, the tables are
        replaced by a “No pricing data” message.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The title sits at the top with a short description below it. To the right of the title four
          controls line up: the <HelpKey>Price Model</HelpKey>, <HelpKey>Edit Prices</HelpKey> and{" "}
          <HelpKey>Additional Sales</HelpKey> tabs, plus an <HelpKey>Export to Excel</HelpKey> button.
          Each tab has a small “i” (info) icon next to it — hover to read what that tab is for. The
          active tab is filled (solid), the others are outlined.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Price Model tab">A read-only view of the current model: four KPI cards, adjustment sliders, charts and the companies table.</HelpDef>
          <HelpDef term="Edit Prices tab">Where you actually change each company's category and service prices — changes saved here are permanent.</HelpDef>
          <HelpDef term="Additional Sales tab">A list of recurring (MRR) and one-time add-on sales; you can also pull won deals here in one click.</HelpDef>
          <HelpDef term="Adjustment">A −50% to +50% percentage slider. It raises or lowers revenue for calculation; it's a scenario, not a saved price.</HelpDef>
          <HelpDef term="Base / New">Base = the current saved monthly revenue; New = the forecast after slider adjustments.</HelpDef>
          <HelpDef term="Group">The segment a company belongs to — sliders and charts are broken down by these groups.</HelpDef>
          <HelpDef term="Category / Service">A category is a group of price line-items; inside it are individual service rows (unit, quantity, price).</HelpDef>
        </dl>
        <p>
          In the <HelpKey>Price Model</HelpKey> tab there are four KPI cards at the top:{" "}
          <strong>Total Monthly Revenue</strong>, <strong>Forecasted Monthly Revenue</strong>,{" "}
          <strong>Annual Effect</strong> and <strong>Average Adjustment</strong>. Below that are two
          columns: on the left the adjustment sliders (Global Adjustment, by Groups, by Categories, by
          Companies), and on the right the charts (“Revenue by Groups” bar chart, “Revenue by
          Categories” pie chart, “Top 15 Companies” chart) with a searchable “Companies Table” at the
          bottom.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: build a revenue scenario with percentage adjustments">
        <HelpStep n={1}>
          <p>
            Make sure the active tab is <HelpKey>Price Model</HelpKey>. In the top-left card, grab the{" "}
            <HelpKey>Global Adjustment</HelpKey> slider and drag it right or left.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The percentage value to the right of the slider updates — green when positive, red when
            negative, grey at zero. The <strong>Forecasted Monthly Revenue</strong>,{" "}
            <strong>Annual Effect</strong> and <strong>Average Adjustment</strong> cards, along with the
            charts and the “New” figures in the table, change instantly. <strong>Total Monthly
            Revenue</strong> (the base) stays as it was.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For finer control, open the collapsible sections below: <HelpKey>Adjustment by Groups</HelpKey>,{" "}
            <HelpKey>Adjustment by Categories</HelpKey> or <HelpKey>Adjustment by Companies</HelpKey>.
            Click a header to expand/collapse it, then drag the slider for the row you want.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each section header shows a count in parentheses (how many groups, categories, companies).
            Below the group, category and company sliders there's a date field (dd.mm.yyyy) to mark when
            the adjustment takes effect. The “Adjustment by Companies” section also has a “Search
            company...” box at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To start the scenario from scratch, click <HelpKey>Reset</HelpKey> under the Global
            Adjustment card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            All sliders (global, group, category and company) return to 0%, the date fields clear, the
            “New” figures line up with the base again, and <strong>Annual Effect</strong> becomes 0.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To verify the result company by company, look at the <HelpKey>Companies Table</HelpKey> below.
            You can sort by clicking the column headers (<HelpKey>Company</HelpKey>,{" "}
            <HelpKey>Group</HelpKey>, <HelpKey>Base</HelpKey>, <HelpKey>New</HelpKey>,{" "}
            <HelpKey>Difference</HelpKey>, <HelpKey>%</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows the company code, its group, base and new amount, the difference (green “+”
            when positive, red when negative) and the percentage. The right column has a small purple
            per-company slider — dragging it changes that company's adjustment in sync with the
            “Adjustment by Companies” section on the left. The sorted column header shows a ↑ or ↓ arrow.
            Typing in the search box filters the table.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit and save one company's prices">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Edit Prices</HelpKey> tab. On the left you'll see a company list with a
            search box.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The left column groups companies by group (each group header shows a count in parentheses),
            and each company shows its monthly amount underneath. On the right, since nothing is selected
            yet, a “Select a company to edit prices” message is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click a company in the list (use the <HelpKey>Search company...</HelpKey> box above to find
            it if needed).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected company is highlighted in blue. The editor opens on the right: the company code,
            a group badge and a red trash icon (delete the company) at the top, with <strong>Total
            Monthly</strong> and the annual amount in the top-right. Below that are{" "}
            <HelpKey>Save</HelpKey>, <HelpKey>Cancel</HelpKey>, <HelpKey>Reset</HelpKey> buttons and the
            category rows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click a category header to expand it, then change the <strong>Quantity</strong> and{" "}
            <strong>Price per unit</strong> cells in its service rows. To add a new service, click the{" "}
            <HelpKey>+</HelpKey> icon on the category row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Expanding a category reveals the service table: Service, Unit, Quantity, Price per unit,
            Total. As you change numbers, the row's and category's “Total”, plus the <strong>Total
            Monthly</strong> at the top, recalculate instantly. An amber “There are unsaved changes”
            warning appears. Clicking <HelpKey>+</HelpKey> opens a blue “New service” form (name, unit,
            quantity, price).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If you need a new category, click <HelpKey>Add Category</HelpKey> at the bottom, type a name,
            and confirm with <HelpKey>Add</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A green “New category” form opens. After you type a name and confirm, an empty category is
            added to the list (it shows “No services” until you add a service to it).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            To persist all changes, click <HelpKey>Save</HelpKey> at the top. (If you change your mind,{" "}
            <HelpKey>Cancel</HelpKey> reverts to the last saved state and <HelpKey>Reset</HelpKey> reloads
            the originally loaded data.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinning loader appears in the header while saving; when it finishes, the “There are unsaved
            changes” warning disappears. The changes are now <strong>real prices</strong> and are
            reflected in the base figures of the <HelpKey>Price Model</HelpKey> tab too.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The sliders in the Price Model tab do <strong>not</strong> change real prices — they are only
            a scenario. A real, permanent change happens only with <HelpKey>Save</HelpKey> in this tab.
            The red trash icon in the editor header deletes the <strong>entire company</strong> — that
            cannot be undone.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: create an additional sale and pull a won deal">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Additional Sales</HelpKey> tab. At the top there's a search box, type
            and status filters, and an <HelpKey>Add Sale</HelpKey> button on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The type filter offers “All types / Monthly (MRR) / One-time”, and the status filter offers
            “All statuses / Active / Cancelled / Completed”. Below are four KPI cards (Total Sales, Sales
            MRR, One-time, Active) and the sales table. If there are no sales yet, the table is replaced
            by “No sales yet. Click "Add Sale" to create the first one.”
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Add Sale</HelpKey> and fill in the “New sale” form: <strong>Company *</strong>,{" "}
            <strong>Type *</strong> (Monthly MRR or One-time), <strong>Name *</strong>, optional category,{" "}
            <strong>Unit</strong>, <strong>Quantity</strong>, <strong>Price per unit</strong> and{" "}
            <strong>Start date *</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form opens. When quantity and price are greater than zero, the “Total:” is calculated
            automatically on the right; when the type is “Monthly (MRR)” a green “/month” label appears
            next to it. The <HelpKey>Create</HelpKey> button stays disabled until the required fields
            (Company, Name) are filled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create</HelpKey> (or <HelpKey>Cancel</HelpKey> to back out).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A brief spinner shows on the button, then the form closes and the new sale is added to the
            table. It shows a green <strong>MRR</strong> or blue <strong>One-time</strong> badge by type,
            and a colored status badge by status. The KPI cards above (Total Sales, Sales MRR, etc.)
            update.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If there are won deals not yet pulled into sales, a green <HelpKey>Won Deals</HelpKey> card
            appears above the table. On the row you want, click <HelpKey>Add to sales</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card lists the deal's name, company, amount and date. When you click the button, a short
            spinner shows, then the deal moves into the table as a recurring sale and leaves the green
            card. If the deal has no linked company, the button is replaced by a disabled “No company”
            and the pull is not possible.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            To remove a sale added by mistake, click the red trash icon at the right of its row in the
            sales table and accept the confirmation.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A “Delete this sale?” confirmation appears; once confirmed, the row leaves the table and the
            KPI cards above recalculate.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: export the model to Excel">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Export to Excel</HelpKey> button to the right of the title.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small popover opens under the button. Inside are a <strong>Template</strong> dropdown
            (“Template 1 — SALES”, “Template 2 — CFO Report”, “Budget P&amp;L”), an <strong>Effective
            date</strong> field and a <HelpKey>Download</HelpKey> button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a template, set an effective date if you want, and click <HelpKey>Download</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner shows on the button while it generates, then the browser downloads the .xlsx file
            and the popover closes. The exported file also accounts for the <strong>adjustments</strong>{" "}
            (the slider scenario) you have applied at that moment.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            The export captures the slider adjustments as a snapshot: first build the scenario you want
            in the Price Model tab, then export — so the Excel file reflects the forecast figures, not
            the base.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          There are two different kinds of “adjustment” — don't confuse them. The sliders in the{" "}
          <strong>Price Model</strong> tab are a temporary scenario — they raise or lower revenue for
          calculation, do not change real prices, and are fully reverted with <HelpKey>Reset</HelpKey>.
          Changes in the <strong>Edit Prices</strong> tab become permanent when you click{" "}
          <HelpKey>Save</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All pricing data, companies, sales and won deals are scoped to your organization — requests
          carry your tenant header (organization id), so you never see another organization's figures.
          Deleting a company or a sale cannot be undone; the exported Excel file contains sensitive
          pricing data, so be careful when sharing it.
        </p>
      </HelpCallout>
    </div>
  )
}
