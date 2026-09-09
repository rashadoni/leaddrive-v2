"use client"

/**
 * Complaints — help article (English).
 * Video-script format mirror of az.tsx: walks the Complaints & Suggestions
 * Register page (built on tickets) step by step — register view, new record,
 * AI triage, working a record, and xlsx import/export.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ComplaintsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're on the quality, support, or customer-care team"
        goal="Log every customer complaint or suggestion in one register, respond to it, and migrate the old xlsx journal into the new system"
      >
        You reach the page from the left menu under <HelpKey>Complaints &amp; Suggestions Register</HelpKey>.
        Behind the scenes every record is a full <strong>ticket</strong> — so you can take it to work,
        respond, and resolve it with a complete change history. All records belong to your organization
        only; whatever you see — the counters, filters, and table — is read from the same list, so the
        counters at the top update the moment you make a change.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading shows <HelpKey>Complaints &amp; Suggestions Register</HelpKey> (with a warning
          icon) and a description line below it. Top-right there are three buttons:{" "}
          <HelpKey>Import xlsx</HelpKey>, <HelpKey>Export xlsx</HelpKey>, and{" "}
          <HelpKey>New complaint</HelpKey>. Below them sit four counter cards, then a row of filters,
          and at the bottom the table of records — if there are no records yet, an empty state is shown
          instead of the table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">The count of all records currently visible.</HelpDef>
          <HelpDef term="Open">Records whose status is "Open" or "In progress" — what needs attention now.</HelpDef>
          <HelpDef term="High risk">Only records flagged with risk level "High".</HelpDef>
          <HelpDef term="Resolved">The count of records with status "Resolved".</HelpDef>
          <HelpDef term="№">Shows the external registry number if present, otherwise the ticket number.</HelpDef>
          <HelpDef term="Risk">low, medium, or high — shown in the table as a colored badge.</HelpDef>
          <HelpDef term="Status">open, in progress, resolved, closed (a record can also be escalated).</HelpDef>
        </dl>
        <p>
          The filter row has two free-text boxes (<strong>Brand</strong> and <strong>Product</strong>)
          and two dropdowns (<strong>Risk</strong> and <strong>Status</strong>). Table columns are: №,
          Customer, Date, Source, Brand, Product, Object, Department, Risk, and Status. The search box
          above the table filters by subject, and clicking a row opens that record in full.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: log a new complaint or suggestion">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New complaint</HelpKey> at the top-right. (If the register is empty, the{" "}
            <HelpKey>Create</HelpKey> button in the middle of the empty state takes you to the same
            form.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The "New complaint / suggestion" page opens. At the top is a{" "}
            <HelpKey>Back to registry</HelpKey> link, and below it four sections:{" "}
            <strong>Customer</strong>, <strong>Request</strong>, <strong>Product &amp; object</strong>,{" "}
            and <strong>Assignment &amp; priority</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Customer</strong> section, fill in <strong>Full name</strong> and{" "}
            <strong>Phone</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The phone box shows the placeholder <HelpKey>055 XXX XX XX</HelpKey>. Neither of these
            fields is required.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <strong>Request</strong> section, pick a <strong>Source</strong> and a{" "}
            <strong>Type</strong>, then write the <strong>Content</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Source dropdown offers Hotline, E-mail, Sales rep, WhatsApp, Instagram, Facebook, and
            Portal / chat; the Type dropdown offers Complaint and Suggestion. Content is required — its
            label carries a red asterisk (<strong>*</strong>) and the record won't save if it's empty.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Fill in the <strong>Product &amp; object</strong> section: Brand, Production area, Product
            category, Complaint object, and Complaint object 2.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, values you've used before appear as an autocomplete list. Changing a "parent"
            field (for example Brand) clears the fields that depend on it (Production area, Product
            category, Complaint object) so the chain stays consistent.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            In <strong>Assignment &amp; priority</strong>, set the <strong>Responsible department</strong>{" "}
            and <strong>Risk level</strong>, then click <HelpKey>Create</HelpKey> at the bottom. (Changed
            your mind? <HelpKey>Cancel</HelpKey> returns you to the register.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Risk level dropdown offers Low / Medium / High (Medium by default). The{" "}
            <HelpKey>Create</HelpKey> button stays disabled while Content is empty; on save it switches
            to "Saving…" and then takes you to that record's full page.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: let AI fill the gaps">
        <HelpStep n={1}>
          <p>
            After writing the content in the Request section, click the <HelpKey>AI suggestion</HelpKey>{" "}
            button below that section.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a sparkle icon. While the content is too short the button stays disabled —
            it activates once there's enough text. When you click it, it switches to "Analyzing…".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Wait for the analysis to finish — the AI reads your content and fills the fields for you.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Risk level</strong>, <strong>Responsible department</strong>, and{" "}
            <strong>Type</strong> (complaint or suggestion) fields update with the AI's suggestion. Check
            these values before saving and correct them by hand if needed.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            <HelpKey>AI suggestion</HelpKey> is only an assistant — the final call is yours. If the
            suggested department or risk is wrong, just change that field; you can press the button again
            anytime.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: work a record">
        <HelpStep n={1}>
          <p>
            Click any row in the register.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The record's full page opens: at the top the № and subject, then the status badge, a risk
            badge if present, and a "suggestion" badge when it's a suggestion. Action buttons are at the
            top-right, and below are the Customer, Request, Product, and Assignment cards, followed by
            Content, Change history, and Response sections.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Move the record forward with one of the action buttons: <HelpKey>Take to work</HelpKey>,{" "}
            <HelpKey>Close ok</HelpKey>, or <HelpKey>not ok</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Take to work</HelpKey> sets the status to "In progress", <HelpKey>Close ok</HelpKey>{" "}
            marks it "Resolved", and <HelpKey>not ok</HelpKey> escalates it. Buttons appear based on the
            current status — for example, if the record is already resolved, "Close ok" isn't shown. The
            status badge updates immediately.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To reply to the customer, type into the <strong>Response</strong> box at the bottom and click{" "}
            <HelpKey>Send</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The sent response appears in that section next to earlier responses, with author and date. If
            there are no responses yet, "No responses yet" is shown. The button is disabled while the box
            is empty.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Check the <strong>Change history</strong> card — it shows who changed what and when.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each line shows the date, the person who made the change, and changes like status / risk /
            department as "before → after", keeping the register auditable.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            The red trash button at the top-right <strong>permanently deletes</strong> the record — after
            the "Permanently delete this record?" confirmation the metadata goes with it and there's no
            undo. For records you just want to close, marking them <HelpKey>Close ok</HelpKey> (resolved)
            is safer than deleting.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: import and export xlsx">
        <HelpStep n={1}>
          <p>
            To migrate the old journal, click <HelpKey>Import xlsx</HelpKey> in the register.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The import page opens — the heading "Import complaints register (xlsx)" with text explaining
            that the client's Azerbaijani column format is supported. In the middle there's a
            drag-and-drop area with a spreadsheet icon and a <HelpKey>Select file</HelpKey> button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Drag the <code>.xlsx</code> file onto the area or pick it with <HelpKey>Select file</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            "Processing…" appears, then a <strong>Preview</strong> card opens: the number of parsed rows,
            the error count (if any), and a table of the first few rows with № / Sıra / Customer / Date /
            Brand / Risk / Status columns. Rows that couldn't be read are listed under "Warnings".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If the preview looks right, click <HelpKey>Import N records</HelpKey> at the top of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When the import finishes a result card appears — with a green check or red error icon —
            showing "Import completed" and how many records were created. From here you can choose{" "}
            <HelpKey>Open registry</HelpKey> or <HelpKey>Import more</HelpKey>. Numbers from the "Sıra"
            column are preserved as the registry number.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To download all records as a file, click <HelpKey>Export xlsx</HelpKey> in the register.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The browser automatically downloads a dated <code>CRM-hesabat-…xlsx</code> workbook — ready
            to send back to the customer or archive.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          You can combine filters — for example, pick Status "Open" and Risk "High" to look at the most
          important records right now, then narrow further by subject with the search box above the
          table. The counter cards always reflect the current view.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Everything here is scoped to your organization — you only see and edit your own tenant's
          register, never another organization's records. This section only opens <em>complaint</em>{" "}
          records; you can't open, change, or delete regular support tickets through the register.
        </p>
      </HelpCallout>
    </div>
  )
}
