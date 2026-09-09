"use client"

/**
 * New complaint / suggestion — help article (English).
 * Covers only the Complaints → New complaint / suggestion page
 * (src/app/(dashboard)/complaints/new/page.tsx): the four-section form
 * (Customer / Request / Product & object / Assignment & priority),
 * the AI suggestion button, datalist autocomplete (facets) and saving.
 * The registry list and the complaint detail page are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function complaintnewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a hotline operator, customer-service agent or quality-control specialist"
        goal="Log a complaint or suggestion from a customer and route it to the responsible department"
      >
        You reach this page from the <HelpKey>Complaints</HelpKey> registry via{" "}
        <HelpKey>New complaint / suggestion</HelpKey>, or directly at <HelpKey>/complaints/new</HelpKey>.
        The form opens blank; the only required field is <strong>Content</strong>. Everything is saved
        under your organization. The <HelpKey>Back to registry</HelpKey> link at the top takes you back
        without saving.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a <HelpKey>Back to registry</HelpKey> link, then the heading{" "}
          <strong>New complaint / suggestion</strong>. The form has four bordered sections:{" "}
          <strong>Customer</strong>, <strong>Request</strong>, <strong>Product &amp; object</strong> and{" "}
          <strong>Assignment &amp; priority</strong>. At the very bottom are the <HelpKey>Cancel</HelpKey>{" "}
          and <HelpKey>Create</HelpKey> buttons. The brand, area, category, object and department fields
          offer autocomplete suggestions (a datalist) drawn from your previous records as you type.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Customer">The requester's Full name and Phone (both optional).</HelpDef>
          <HelpDef term="Source">Where the request came from: Hotline, E-mail, Sales rep, WhatsApp, Instagram, Facebook or Portal / chat.</HelpDef>
          <HelpDef term="Type">Whether the request is a Complaint or a Suggestion.</HelpDef>
          <HelpDef term="Content">The text of the customer's request — the only required field.</HelpDef>
          <HelpDef term="AI suggestion">A button that reads the content and auto-fills the risk level, responsible department and type (enabled once the content is at least 20 characters).</HelpDef>
          <HelpDef term="Brand / Production area / Product category / Complaint object">Hierarchical fields that narrow down which product the request concerns; changing a parent field resets the ones below it.</HelpDef>
          <HelpDef term="Responsible department">The internal department that will handle the request (e.g. Quality Control).</HelpDef>
          <HelpDef term="Risk level">The urgency of the request: Low, Medium or High.</HelpDef>
        </dl>
        <p>
          Most fields are optional — only <strong>Content</strong> keeps the <HelpKey>Create</HelpKey>{" "}
          button disabled until it's filled. You can complete the rest later from the complaint detail
          page.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: log the customer and request">
        <HelpStep n={1}>
          <p>
            In the <strong>Customer</strong> section, fill in <HelpKey>Full name</HelpKey> and{" "}
            <HelpKey>Phone</HelpKey> (both optional).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Two fields side by side. The Phone field shows a <HelpKey>055 XXX XX XX</HelpKey> placeholder —
            leaving it empty still lets the complaint be created.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Request</strong> section, pick a <HelpKey>Source</HelpKey> and a{" "}
            <HelpKey>Type</HelpKey> from the dropdowns.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Source dropdown has seven options (default — <strong>Hotline</strong>); the Type dropdown
            has <strong>Complaint</strong> (default) and <strong>Suggestion</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Type the customer's request into the <HelpKey>Content</HelpKey> field. This is the only
            required field.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A five-row text area with the placeholder "Describe the customer's request…". Below it, on the
            right, is the <HelpKey>AI suggestion</HelpKey> button — it looks greyed-out/disabled while the
            content is under 20 characters.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: suggest department and risk with AI (optional)">
        <HelpStep n={1}>
          <p>
            After writing the content, click the <HelpKey>AI suggestion</HelpKey> button (with the sparkle
            icon). It only enables once the content is at least 20 characters.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button label changes to <strong>Analyzing…</strong> while it works. Hovering shows the
            tooltip "Automatically suggest department and risk level".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            When the analysis finishes, the result is placed into the form automatically.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Risk level</strong>, <strong>Responsible department</strong> and <strong>Type</strong>{" "}
            fields update with the AI's suggestion. If the AI can't determine a department, the existing
            value is kept — you can override any suggestion by hand.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set product and assignment">
        <HelpStep n={1}>
          <p>
            In the <strong>Product &amp; object</strong> section, fill in <HelpKey>Brand</HelpKey>,{" "}
            <HelpKey>Production area</HelpKey>, <HelpKey>Product category</HelpKey>,{" "}
            <HelpKey>Complaint object</HelpKey> and <HelpKey>Complaint object 2</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you start typing in these fields, suggestions from previous complaints appear in a
            dropdown. Changing the <strong>Brand</strong> automatically clears the area, category and
            object fields below it (so the hierarchy stays consistent).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Assignment &amp; priority</strong> section, type the{" "}
            <HelpKey>Responsible department</HelpKey> and choose a <HelpKey>Risk level</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Responsible department field shows the placeholder "Marketing, QC department…" and a
            suggestion list. The Risk dropdown has three options: <strong>Low</strong>,{" "}
            <strong>Medium</strong> (default) and <strong>High</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: save">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Create</HelpKey> button at the bottom of the form. (If you change your
            mind, <HelpKey>Cancel</HelpKey> returns you to the registry.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to <strong>Saving…</strong>. On success you're taken automatically to the
            new complaint's detail page (<HelpKey>/complaints/&lt;id&gt;</HelpKey>). On error, a red bordered
            message (e.g. "Failed to save" or "Network error") appears above the buttons and the form stays
            open.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <HelpKey>Create</HelpKey> button only activates once <strong>Content</strong> is filled —
          every other field is optional. For a quick entry, just type the content and save; you can refine
          the brand, department and risk later from the complaint detail page.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The AI suggestion is only a <strong>suggestion</strong> — it auto-fills the risk level,
          department and type, but it's your responsibility to review and correct them before saving.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All complaints are scoped to your organization — anything you create is visible only within your
          tenant. The autocomplete suggestions (brand, area, department, etc.) also come only from your own
          organization's previous records.
        </p>
      </HelpCallout>
    </div>
  )
}
