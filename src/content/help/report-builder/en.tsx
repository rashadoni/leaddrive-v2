"use client"

/**
 * Report Builder — help article (English).
 * Split out of the old shared "reports" slug: covers ONLY the
 * Reports → Report Builder page (entity picker, columns, filters,
 * group-by, sort, chart type, live preview, save + email schedule,
 * export). The list of prebuilt/standard reports is NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function reportbuilderHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a sales or operations analyst"
        goal="Build a custom report from your CRM data without writing code, see it as a chart, save it, and export it to Excel or CSV"
      >
        You reach the page via <HelpKey>Reports</HelpKey> → <HelpKey>Report Builder</HelpKey>. All data is
        read from your organization only. The key behavior to know: as you change the configuration on the
        left, the preview on the right refreshes by itself — there is no "Run" button. The result appears
        automatically about half a second after each change.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Report Builder</HelpKey> title with the subtitle "Create custom
          reports with filters, grouping, and visualizations." Two buttons sit top-right:{" "}
          <HelpKey>Export</HelpKey> (download icon — disabled while there is no data) and{" "}
          <HelpKey>Save Report</HelpKey> (disk icon). The page splits into two columns: a narrow
          configuration panel on the left (it's sticky — it stays in place as you scroll) and a wide
          preview area on the right.
        </p>
        <p>
          The left panel is a stack of cards, top to bottom: <strong>Entity</strong>,{" "}
          <strong>Columns</strong>, <strong>Filters</strong>, <strong>Group By</strong>,{" "}
          <strong>Sort By</strong>, <strong>Chart Type</strong> and <strong>Saved Reports</strong>. The
          right panel has three summary cards (number tiles) at the top, with the <strong>Preview</strong>{" "}
          card (chart or table) below.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Entity">
            The data type the report is based on. The dropdown offers: Deals, Contacts, Companies, Leads,
            Tickets, Tasks, Activities.
          </HelpDef>
          <HelpDef term="Columns">
            The fields that appear in the report. Each is a toggle button — when selected it shows a check
            (✓); the card title shows how many columns are selected.
          </HelpDef>
          <HelpDef term="Filter">
            A three-part condition: <strong>field</strong> + <strong>operator</strong> (Equals, Not Equals,
            Greater Than, Less Than, Contains, In, Between) + <strong>value</strong>. A filter with an empty
            value is ignored.
          </HelpDef>
          <HelpDef term="Group By">
            Collapses rows by the chosen field and sums the numeric column (the category axis for charts).
            "None" means no grouping is applied.
          </HelpDef>
          <HelpDef term="Sort By">
            Which field results are ordered by; once a field is chosen, an <strong>Ascending</strong> /{" "}
            <strong>Descending</strong> selector appears below it.
          </HelpDef>
          <HelpDef term="Chart Type">
            Five options: <strong>Table</strong>, <strong>Bar Chart</strong>, <strong>Line Chart</strong>,{" "}
            <strong>Pie Chart</strong>, <strong>Area Chart</strong>. Charts need at least one numeric column.
          </HelpDef>
          <HelpDef term="Preview">
            The live result of the current configuration — rendered as the chart type you picked; if "Table"
            is not selected, a data table also appears below the chart.
          </HelpDef>
          <HelpDef term="Saved Reports">
            Configurations you saved earlier. Clicking one restores all of its settings.
          </HelpDef>
        </dl>
        <p>
          The first of the three summary cards on the right always shows the <strong>Total Records</strong>{" "}
          count. The next two cards show preview totals (aggregates) when the preview returns them;
          otherwise they show the selected <strong>Columns</strong> and <strong>Filters</strong> counts.
          The Preview card header echoes the current <strong>Entity</strong> and <strong>Chart Type</strong>{" "}
          as small badges.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: build a report and watch the live preview">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Entity</HelpKey> card, pick the data type the report is based on from the
            dropdown (e.g. <HelpKey>Deals</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The moment you change the entity, the system auto-picks smart default columns for it (typically
            two text fields plus one numeric field) and clears any previous filters, grouping and sorting.
            The preview immediately refreshes with the new entity's data.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Columns</HelpKey> card, click the field buttons you want in the report. Click a
            button again to deselect it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A selected button is highlighted with a check (✓) on it. The count in the card title (e.g. "3
            selected") updates instantly, and the preview table/chart reflects the new set of columns.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To add a condition, click <HelpKey>Add</HelpKey> at the right of the{" "}
            <HelpKey>Filters</HelpKey> card, then choose a field and operator from the dropdowns and type in
            the <strong>Value</strong> box.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A new filter row is added: a field dropdown, an operator dropdown (Equals, Greater Than,
            Contains, etc.), a "Value" text box, and a trash icon on the right. Because a filter with an
            empty value is ignored, the preview won't change until you type a value.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optional: pick a field in the <HelpKey>Group By</HelpKey> card, and pick a field in the{" "}
            <HelpKey>Sort By</HelpKey> card then set <HelpKey>Ascending</HelpKey> /{" "}
            <HelpKey>Descending</HelpKey> below it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When a Group By field is chosen, rows collapse and the numeric column is summed. As soon as a
            Sort By field is picked, the ascending/descending dropdown appears below it; every change is
            reflected in the preview about half a second later.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            In the <HelpKey>Chart Type</HelpKey> card, choose how you want to see the result —{" "}
            <HelpKey>Table</HelpKey>, <HelpKey>Bar Chart</HelpKey>, <HelpKey>Line Chart</HelpKey>,{" "}
            <HelpKey>Pie Chart</HelpKey> or <HelpKey>Area Chart</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Preview</strong> card on the right switches to the chosen chart type. If no numeric
            column is selected, instead of a chart you'll see a "Select a numeric column for chart" hint with
            quick-add buttons for the numeric fields. For any type other than "Table", a full data table also
            appears below the chart.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Watch the result without saving anything — the builder runs automatically.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While loading, a spinner shows in the <strong>Preview</strong> header and the{" "}
            <strong>Total Records</strong> card. If nothing matches, you'll see "No data to display. Adjust
            your configuration and run a preview."
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: save a report and set an email schedule">
        <HelpStep n={1}>
          <p>
            When the configuration is ready, click <HelpKey>Save Report</HelpKey> at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Save Report" dialog opens. It contains a <strong>Report Name</strong> field, summary badges of
            the current configuration (entity, column count, filter count, chart type) and, below, an "Email
            Schedule (optional)" section.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Report Name</strong> — the save button stays disabled while the name is empty.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Save</HelpKey> button below is inactive until you type a name; it activates as soon
            as the name is filled in.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally, to have the report emailed automatically, choose <HelpKey>Daily</HelpKey>,{" "}
            <HelpKey>Weekly</HelpKey> or <HelpKey>Monthly</HelpKey> from the <HelpKey>Frequency</HelpKey>{" "}
            dropdown, then enter email addresses, comma-separated, in the <strong>Recipients</strong> box.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While the frequency is "No schedule", the recipients box stays hidden; pick any frequency and the{" "}
            <strong>Recipients (comma-separated)</strong> box appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Save</HelpKey>. (If you loaded an existing report and are editing it, this button
            reads <HelpKey>Update</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A brief spinner shows on the button, then the dialog closes and the report appears at the top of
            the <strong>Saved Reports</strong> list in the left panel.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: load a saved report">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Saved Reports</HelpKey> card at the bottom of the left panel, click a report row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows a folder icon, the report name, and its entity plus creation date underneath. If
            nothing has been saved yet, you'll see "No saved reports yet."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Clicking the row restores all of its settings.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The entity, columns, filters, group-by, sort and chart type switch to the saved state, and the
            preview refreshes with that report immediately. If you now open the <HelpKey>Save Report</HelpKey>{" "}
            dialog, its title reads "Update Report".
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: export to CSV or Excel">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Export</HelpKey> at the top right. (If the preview has no rows, this button is
            disabled.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Export Report" dialog opens showing two cards: <strong>CSV</strong> ("Comma-separated values")
            and <strong>Excel</strong> ("XLSX spreadsheet").
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the format you want — <HelpKey>CSV</HelpKey> or <HelpKey>Excel</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The file downloads to your browser (<code>report.csv</code> for CSV, <code>report.xlsx</code> for
            Excel) and the export dialog closes. The exported data reflects the configuration currently on
            screen.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If the chart looks empty, most likely none of the selected columns is numeric. The builder detects
          this and shows a "Select a numeric column for chart" hint together with one-click buttons to add a
          numeric field. The pie chart always aggregates the result by category and limits it to at most 8
          slices (the rest roll into "Other").
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          There is no "Run" button on this page — every change refreshes the preview automatically, but the
          result arrives with about a half-second delay, not instantly. Filters with an empty value are
          completely ignored, so after adding a filter don't forget to fill in the <strong>Value</strong>{" "}
          box. Export only takes the configuration currently on screen — to export a saved report, load it
          first.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All entities, preview results, saved reports and exports are scoped to your organization — you only
          see and export your own tenant's data, and another organization's records are never included. The
          email schedule also delivers only to the recipients you enter.
        </p>
      </HelpCallout>
    </div>
  )
}
