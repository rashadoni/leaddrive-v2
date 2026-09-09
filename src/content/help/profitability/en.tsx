"use client"

/**
 * Profitability — help article (English), video-tutorial script.
 * Mirror of az.tsx. Source page: src/app/(dashboard)/profitability/page.tsx
 * + sub-tabs (overhead-tab, employees-tab, parameters-tab, clients-tab, ai-observations).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProfitabilityHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a finance or operations lead"
        goal="See what each service and client actually costs, track margin, and keep the cost-model inputs (employees, overheads, parameters) up to date"
      >
        You reach the page from the left menu under <HelpKey>Profitability</HelpKey>. Every figure is
        computed from your organization's data only. The moment the page opens the whole cost model is
        calculated in the background — you'll see a brief spinner, then the numbers appear. As you change
        the model's inputs (employee roster, overheads, parameters) the figures on every tab recalculate
        automatically.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a calculator icon with the <HelpKey>Profitability</HelpKey> name, a replay-tour
          button and this Help button beside it; below it the «Cost model analytics» subtitle and a page
          description. Underneath sits a row of six tabs, each with a small «i» hint (hover to learn what
          the tab does): <strong>Analytics</strong>, <strong>Services</strong>, <strong>Clients</strong>,{" "}
          <strong>Overhead</strong>, <strong>Employees</strong> and <strong>Parameters</strong>. The{" "}
          <strong>Analytics</strong> tab is open by default.
        </p>
        <p>
          If data can't load, the header stays and a «Failed to load data. Check parameters and overheads.»
          message appears — this usually means parameters or overheads are empty.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Sec F (Total Cost)">
            Minimum cost: Admin + Tech + IT/InfoSec + Business Trip + Risk reserve. Shown in the center of
            the donut chart.
          </HelpDef>
          <HelpDef term="Sec G (Full Service Cost)">
            Full cost: all departments + admin allocation + tech direct. The «TOTAL COST / MONTH» card shows
            this.
          </HelpDef>
          <HelpDef term="Margin">
            Revenue minus cost. Green when positive, red when negative.
          </HelpDef>
          <HelpDef term="Overhead">
            Costs not tied to a single service — office rent, insurance, licenses, etc. Split into two
            kinds: <strong>Admin</strong> (distributed by headcount) and <strong>Tech</strong> (routed
            directly to a service).
          </HelpDef>
          <HelpDef term="Cost (per client)">
            The sum of fixed + variable costs allocated to a single client.
          </HelpDef>
          <HelpDef term="Da Vinci Analysis">
            Short AI-generated observations and recommendations based on the current tab's figures.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: read the Analytics tab">
        <HelpStep n={1}>
          <p>
            Stay on the <HelpKey>Analytics</HelpKey> tab (it's open by default). Look at the five colored
            stat cards at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Five cards: <strong>TOTAL COST / MONTH</strong> (Sec G), <strong>TOTAL REVENUE / MONTH</strong>,{" "}
            <strong>MARGIN / MONTH</strong>, <strong>PROFITABLE CLIENTS</strong> (a count) and{" "}
            <strong>COST / 1 USER</strong>. Each card has a matching icon in its corner.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the left chart — the <HelpKey>Cost Composition</HelpKey> donut. Click any of the
            category rows below it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The donut's center reads «Sec F» plus the cost rounded to thousands. Below it five categories are
            listed with percentages: Admin OH, Tech Infra, Direct Labor, Business Trip, Risk Reserve.
            Further down the same categories appear as a list — rows with a triangle (▸) expand into
            sub-items (e.g. admin overhead items, back-office salaries). At the very bottom you get{" "}
            <strong>Total Cost (F)</strong> and <strong>Full Service Cost (G)</strong>, followed by the Sec
            F / Sec G descriptions and the allocation split (fixed % + variable %).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the right chart — the <HelpKey>Service Cost vs Revenue</HelpKey> horizontal bar chart.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Two bars per service: red (Cost) and green (Revenue). Below the chart each service's balance is
            shown — green «+» when positive, red when negative.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally, in the <HelpKey>Da Vinci Analysis</HelpKey> card at the bottom, click the button of
            the same name (see the «Da Vinci Analysis» section below).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Until you click it, the card shows «Da Vinci analysis has not started yet.»
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: read the Services tab">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Services</HelpKey> tab at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Four summary cards at the top: <strong>Total Cost</strong>, <strong>Total Revenue</strong>,{" "}
            <strong>Total Balance</strong> and <strong>Profitable / Loss</strong> (e.g. «5 / 3»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the service cards below (Permanent IT, InfoSec, ERP, GRC, Projects (PM), HelpDesk,
            Cloud, WAF).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows the service name with a <strong>Profit</strong> / <strong>Loss</strong> badge on
            the right, red Cost and green Revenue bars below, and four metrics at the bottom:{" "}
            <strong>MARGIN</strong> (%), <strong>STAFF</strong> (count), <strong>CLIENTS</strong> (count)
            and <strong>COST/STAFF</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search and sort on the Clients tab">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Clients</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Four summary cards (<strong>Total Cost</strong>, <strong>Total Revenue</strong>,{" "}
            <strong>Total Balance</strong>, <strong>Clients</strong> — the last one shows green «Profitable»
            and red «Loss» counts), and below them a table titled <strong>Client Profitability</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a client name or code into the search box at the top right (<HelpKey>Search by name or
            code...</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table filters as you type. If nothing matches you get «No results found»; if there are no
            clients at all, «No client data».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click any column header to sort (Client, Users, Price, HelpDesk, Primary Revenue, Cost, Primary
            Margin, Full Margin, %). Clicking the same header again flips ascending/descending.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each header has a two-way arrow icon (↕). Margin columns show green «+» when positive and red
            when negative; the <strong>Status</strong> column has a colored badge — green «Profitable»,
            yellow «Low», red «Loss» or grey «No revenue». The client name is a link — clicking it opens
            that client's detail page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add or edit an overhead item">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Overhead</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three summary cards: <strong>Admin Overhead</strong>, <strong>Technical Infrastructure</strong>{" "}
            and <strong>Total Overhead</strong> (monthly totals). Below them a table titled «Overhead Cost
            Items (N)» with an <HelpKey>Add Item</HelpKey> button at the top right. Table columns: Label,
            Category, Amount, Calculation, VAT, Service, Type, Monthly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>Add Item</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A new row opens in edit mode right away — Label «New cost», Amount 0. The columns turn into
            inputs: text (Label), a dropdown (Category), a number (Amount), Calculation (Monthly / Annual÷12
            / Amort÷mo), a VAT checkbox and a <strong>Service</strong> dropdown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Fill in the fields. In the <strong>Service</strong> dropdown, picking «None (Admin)» makes the
            item <strong>Admin</strong>; picking a service makes it <strong>Tech</strong>. Ticking VAT adds
            18% automatically; choosing «Amort÷mo» lets you enter the number of months beside it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The badge in the <strong>Type</strong> column flips between «Admin» ↔ «Tech»; the{" "}
            <strong>Monthly</strong> value on the far right recalculates instantly as you type.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Save with the green check (✓) at the right of the row. (To abandon, click the red ×.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While saving, the check turns into a spinner, then the row returns to its plain (read) view. The
            three summary cards above and the breakdown on the Analytics tab update immediately. On error, a
            red-bordered message appears above the table.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            To change an existing item click the pencil icon at the right of its row; to remove it click the
            red trash icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The pencil puts the row back into edit mode. The trash icon removes the row from the table
            immediately and the totals update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add or edit an employee position">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Employees</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three summary cards: <strong>Total Headcount</strong>, <strong>Total Labor Cost/mo</strong> and{" "}
            <strong>Departments</strong>. Below them department filter buttons (<HelpKey>All (N)</HelpKey>{" "}
            plus one button per department with a count), and further down an «Employee Roster (N positions)»
            table. Table columns: Department, Position, Count, Net Salary, Gross, Super Gross, Total Cost/mo.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the <HelpKey>Add Position</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A new row opens in edit mode (default department IT, position «New Position», count 1, net 0).
            Department is a dropdown, Position a text field, Count and Net Salary are number fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Enter the department, position, count and net salary. <strong>Gross</strong> and{" "}
            <strong>Super Gross</strong> are computed automatically (14% income tax plus employer tax are
            added) — you don't type them.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you change Net Salary, Gross, Super Gross and the <strong>Total Cost/mo</strong> on the far
            right recalculate instantly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Save with the green check (✓). Edit an existing row with the pencil icon, delete it with the red
            trash icon.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After saving, the row returns to its read view; the department shows as a colored badge.{" "}
            <strong>Total Headcount</strong>, <strong>Total Labor Cost/mo</strong>, the counts on the filter
            buttons and «Direct Labor» on the Analytics tab all update immediately.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Optionally filter the table with the department buttons — e.g. to see only <HelpKey>InfoSec</HelpKey>{" "}
            positions.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected department button highlights as filled, the table shows only that department's
            rows, and the «(N positions)» count in the title adjusts.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: tune the Parameters">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Parameters</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top an explanatory line and the allocation split (Fixed % + Variable %), with{" "}
            <HelpKey>Reset</HelpKey> and <HelpKey>Save</HelpKey> buttons on the right. Below, fields grouped
            into cards: <strong>General Info</strong> (Total User Count), <strong>HEADCOUNT</strong>,{" "}
            <strong>TAXES</strong>, <strong>RATIOS</strong>, <strong>OVERHEAD ALLOCATION</strong>, and at
            the very bottom <strong>Calculated Values</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Change the number in any field. Percentage fields take a value as a percent (with «%» beside
            them); the rest take a plain number.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After the first change, a red <strong>Changed</strong> badge appears next to <HelpKey>Save</HelpKey>{" "}
            and <HelpKey>Reset</HelpKey> becomes active. Percentage fields show the raw decimal value as
            «(raw: …)» beside them.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If your <strong>Total User Count</strong> differs from the real number across companies, use the{" "}
            <HelpKey>Sync → N</HelpKey> button beside it to match it in one click.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When there's a mismatch you get an orange «⚠ Actual: N (from companies)» warning and the «Sync»
            button; when they match it reads green «✓ Matches company data».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            When you're happy with the edits, click <HelpKey>Save</HelpKey>. (To undo, use <HelpKey>Reset</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner appears on the button, then the «Changed» badge disappears. Cost figures across every
            tab recalculate against the new parameters; the <strong>Calculated Values</strong> at the bottom
            (variable overhead ratio, salary burden factor, etc.) also refresh.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: Da Vinci Analysis">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Da Vinci Analysis</HelpKey> card at the bottom of the Analytics, Services,
            Clients or Overhead tab, click the button of the same name.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Until you click it the card shows a brain icon and «Da Vinci analysis has not started yet.» After
            clicking, «Da Vinci is thinking... (30-60 sec)» appears with a live animation.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            When it's ready, read the observations. Optionally expand the <HelpKey>Thinking process</HelpKey>{" "}
            row to see the model's reasoning; click <HelpKey>Refresh</HelpKey> to recompute.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text renders as the analysis; the «Thinking process» triangle toggles open and closed. If
            the result is served from cache, the title shows a «Cached» badge. On error you get a red message
            and a <HelpKey>Retry</HelpKey> button.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If the numbers look wrong, the cause is usually the inputs: first check the user/staff counts and
          rates on the <HelpKey>Parameters</HelpKey> tab, then confirm the <HelpKey>Overhead</HelpKey> and{" "}
          <HelpKey>Employees</HelpKey> lists are complete. All analytics are computed from the inputs on
          exactly these three tabs.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Deleting an overhead or employee row is <strong>not reversible</strong> — the row disappears
          immediately. There's no separate way to temporarily remove it, so be sure before you delete. In
          Parameters, by contrast, you can always cancel your edits with <HelpKey>Reset</HelpKey> before
          saving.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All cost-model data (employees, overheads, parameters, client margins) belongs to your
          organization only — you never see another organization's figures. Da Vinci Analysis only looks at
          your own organization's data on this page.
        </p>
      </HelpCallout>
    </div>
  )
}
