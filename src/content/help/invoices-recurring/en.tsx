"use client"

/**
 * Recurring Invoices — help article (English).
 * Covers only Invoices → Recurring Invoices (creating a recurring rule,
 * title template, frequency/interval, line items, active/paused state,
 * bulk actions, the "Generate & send" flow). One-off invoices are NOT covered.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InvoicesRecurringHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a finance team member or an operations admin"
        goal="Set up recurring rules that automatically generate and email invoices on a fixed cadence (e.g. a monthly subscription or service fee)"
      >
        You reach this screen from the <HelpKey>Invoices</HelpKey> list via{" "}
        <HelpKey>Recurring Invoices</HelpKey>; the <HelpKey>Back to List</HelpKey> button at top-left
        returns you to the regular invoice list. Everything you see here — counts, the rules list and
        results — is scoped to your organization only. A rule does not create the recurring invoice by
        itself: it is the «recipe» that produces the actual invoice when its turn comes due or when you
        run it manually.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          A cyan header bar runs across the top: <HelpKey>Back to List</HelpKey> at the left, the{" "}
          <strong>Recurring Invoices</strong> title with a count of how many rules exist underneath it,
          and two buttons on the right — <HelpKey>Generate &amp; send</HelpKey> (with a refresh icon)
          and <HelpKey>New</HelpKey> (with a plus icon). Below it sit three stat cards:{" "}
          <strong>Total rules</strong>, <strong>Active</strong> and <strong>Paused</strong>. Further
          down come a search box, a «Select all» checkbox and the table of rules.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total rules">The number of all recurring rules you have created (active and paused together).</HelpDef>
          <HelpDef term="Active">The number of rules that are running — they will generate an invoice when due.</HelpDef>
          <HelpDef term="Paused">The number of temporarily switched-off rules that will not generate invoices.</HelpDef>
          <HelpDef term="Frequency / Interval count">How often the rule fires: Daily / Weekly / Monthly / Quarterly / Yearly, multiplied by the interval count (e.g. interval 2 + Monthly = every 2 months).</HelpDef>
          <HelpDef term="Title Template">How the generated invoice's name is built. Supports the {"{month}"}, {"{year}"}, {"{number}"} variables; leave empty to use a static title.</HelpDef>
          <HelpDef term="Next">A table column — the date the rule will next fire.</HelpDef>
          <HelpDef term="Generated">A table column — how many invoices the rule has produced so far.</HelpDef>
        </dl>
        <p>
          The table columns are: a checkbox, <strong>Company / Title</strong>, <strong>Email</strong>,{" "}
          <strong>Status</strong> (a pulsing green dot for <strong>Active</strong> or an orange dot for{" "}
          <strong>Paused</strong>), the <strong>Next</strong> date, the <strong>Generated</strong>{" "}
          count and, on the right, two action buttons: pause/activate (a pause or play icon) and delete
          (a trash icon). When there are no matches the table shows «No results found».
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new recurring rule">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New</HelpKey> button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A wide «New Recurring» dialog opens. It contains a sequence of fields:{" "}
            <strong>Title *</strong>, <strong>Title Template</strong>, <strong>Company</strong>,{" "}
            <strong>Frequency</strong> + <strong>Interval count</strong>, <strong>Start Date</strong> +{" "}
            <strong>End Date</strong>, <strong>Max occurrences</strong>, <strong>Currency</strong> +{" "}
            <strong>Include VAT</strong>, <strong>Payment Terms</strong>,{" "}
            <strong>Recipient Email</strong>, <strong>Notes</strong> and, at the bottom, an{" "}
            <strong>Items</strong> table.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter a <strong>Title</strong> — this is the only required field (e.g. «Monthly service
            fee»). The <strong>Title Template</strong> field auto-fills as{" "}
            <HelpKey>{"{title} — {month} {year}"}</HelpKey> as you type the title; edit it by hand if
            you wish.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Under the Title Template field a hint reads «Variables: {"{month}"}, {"{year}"},{" "}
            {"{number}"}. Leave empty to use static title.». If the Title is empty, the{" "}
            <HelpKey>Create</HelpKey> button at the bottom stays disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally pick the billed <strong>Company</strong> from the dropdown (default: «Select
            Company»). Then set the cadence with <strong>Frequency</strong> and{" "}
            <strong>Interval count</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The company list is populated from your organization's companies. The Frequency dropdown
            offers five choices: <strong>Daily</strong>, <strong>Weekly</strong>,{" "}
            <strong>Monthly</strong>, <strong>Quarterly</strong>, <strong>Yearly</strong>. Interval
            count accepts numbers only (minimum 1).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally set the <strong>Start Date</strong> / <strong>End Date</strong> and a{" "}
            <strong>Max occurrences</strong> (left empty it shows «Unlimited»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The date fields open a calendar picker. When Max occurrences is empty it shows «Unlimited»
            as a placeholder — meaning the rule runs until it is paused or reaches its end date.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Pick a <strong>Currency</strong> and, if needed, tick the <strong>Include VAT</strong>{" "}
            checkbox.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As soon as you tick VAT, a <strong>Tax rate</strong> field appears next to it (default
            0.18, i.e. 18%; entered as a decimal between 0 and 1). Left unticked, the tax rate field is
            not shown at all.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Optionally fill the <strong>Payment Terms</strong> (Net 7 / 15 / 30 / 45 / 60 or «Due on
            Receipt»), the <strong>Recipient Email</strong> and any <strong>Notes</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Payment Terms dropdown defaults to «Select payment terms». The Recipient Email field
            expects an email (placeholder «email@example.com»). This is the address the generated
            invoice is automatically emailed to.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            In the <strong>Items</strong> table at the bottom, enter the invoice lines:{" "}
            <strong>Name</strong>, <strong>Qty</strong>, <strong>Unit Price</strong> and{" "}
            <strong>Discount</strong>. Use <HelpKey>Add Item</HelpKey> for more rows; remove a row with
            the trash icon on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table always keeps at least one empty row — when only the last row remains, its delete
            button is disabled. Rows with a blank Name are ignored when you save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={8}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to a spinning icon with «Saving...», then the dialog closes and the new
            rule appears in the table. The <strong>Total rules</strong> (and, since the rule is active,{" "}
            <strong>Active</strong>) stat card count goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: generate &amp; send now">
        <HelpStep n={1}>
          <p>
            To immediately create and send invoices for every rule that is due, click the{" "}
            <HelpKey>Generate &amp; send</HelpKey> button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button's icon starts spinning (it is working). When finished, a green-bordered result
            panel appears: its heading reads «Last result: N sent, M errors», and inside, each invoice
            is listed on its own line with its number, company and status (<strong>Sent</strong> /{" "}
            <strong>Error</strong> / <strong>Draft</strong>).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Review the results. Close the panel with the <HelpKey>Close</HelpKey> button at its
            top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            «Sent» rows are highlighted green, «Error» rows red (with a short reason text). Each rule's{" "}
            <strong>Next</strong> date and <strong>Generated</strong> count in the table refresh to
            their updated values.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: pause, activate, delete and bulk actions">
        <HelpStep n={1}>
          <p>
            To temporarily switch a rule off, click the pause icon button on its row; to bring it back,
            click the activate (play) icon that appears in the same spot.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The badge in the <strong>Status</strong> column toggles between green <strong>Active</strong>{" "}
            and orange <strong>Paused</strong>, and the <strong>Active</strong> and{" "}
            <strong>Paused</strong> stat-card counts at the top change accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete a rule, click the red trash icon button on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Delete recurring rule» confirmation dialog opens and shows the name of the rule to be
            deleted. After you confirm, the rule disappears from the table and the stat cards refresh.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To manage several rules at once, tick the checkboxes on the left of the rows (or the
            «Select all» checkbox at the top).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A cyan bulk-actions bar appears between the stat cards and the table: an «N selected» label
            and three buttons — <HelpKey>Activate</HelpKey>, <HelpKey>Pause</HelpKey> and{" "}
            <HelpKey>Generate</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Use <HelpKey>Activate</HelpKey> or <HelpKey>Pause</HelpKey> on the bar to switch the whole
            selection's state at once; use <HelpKey>Generate</HelpKey> to immediately run invoice
            generation.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After the action the selection clears (the bar disappears) and the table and stat cards
            refresh.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Search and filter">
        <HelpStep n={1}>
          <p>
            Type into the search box above the table — <HelpKey>Search... (company, title, email)</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table filters instantly: only rules whose title, company name or recipient email
            contain the search text remain. The «Select all (N)» count next to it adjusts; if nothing
            matches, «No results found» is shown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Use <strong>Title Template</strong> variables to auto-refresh the generated invoice names:
          for example <HelpKey>{"Subscription — {month} {year}"}</HelpKey> fills in each month's name
          and year, so every occurrence gets a distinct, readable title. Leave the template empty to
          use the static Title instead.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Generate &amp; send</HelpKey> creates real invoices and emails them to the{" "}
          <strong>Recipient Email</strong> immediately — it is not a dry run. Before running it, double
          check the cadence, recipient email and line items. Deletion is irreversible too; if you only
          want to pause a rule, use the pause button instead of deleting — the rule stays, it just
          stops generating invoices.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All recurring rules and the invoices they generate are scoped to your organization — you can
          only pick your own tenant's companies as the recipient and you never see another
          organization's rules. The company dropdown is drawn from your organization's companies.
        </p>
      </HelpCallout>
    </div>
  )
}
