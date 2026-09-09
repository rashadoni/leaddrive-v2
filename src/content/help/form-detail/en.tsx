"use client"

/**
 * P8 No-Code Form Builder — form editor page help article (English).
 * `/forms/[id]` — metadata + field list + publish. Covers the editor
 * page only (form name/status header, metadata block, fields block +
 * "Add field" dialog, save-draft and publish flow). No drag-drop —
 * fields are ordered with up/down buttons.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function FormDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a marketing or operations admin"
        goal="Build a public lead-capture form: add fields, set options, save as draft, and publish when ready"
      >
        You reach this page by clicking a form in the forms list (URL{" "}
        <HelpKey>/forms/&lt;id&gt;</HelpKey>). The form and all its fields belong only to your
        organization. Edits to the field layout aren&apos;t saved to the server until you press{" "}
        <HelpKey>Save draft</HelpKey> or <HelpKey>Publish</HelpKey>.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top left has a <HelpKey>← Back to forms</HelpKey> link, below it the form name (heading)
          and a one-line summary: the status badge (<strong>Draft</strong> /{" "}
          <strong>Published</strong> / <strong>Archived</strong>), the public link path{" "}
          <HelpKey>/f/&lt;slug&gt;</HelpKey>, then view and submission counts. Top right has two
          buttons: <HelpKey>Save draft</HelpKey> and <HelpKey>Publish</HelpKey> (which reads{" "}
          <HelpKey>Re-publish</HelpKey> once the form is already published). Below come two blocks:{" "}
          <strong>Metadata</strong> and <strong>Fields</strong>. If anything fails, a red error bar
          appears above the blocks.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status">The form&apos;s state — Draft (no one sees it), Published (public link is live), or Archived.</HelpDef>
          <HelpDef term="/f/&lt;slug&gt;">The form&apos;s public address — after publishing, visitors fill it out via this link.</HelpDef>
          <HelpDef term="Views / Submissions">How many times the form was opened (views) and how many times it was filled and submitted (submissions).</HelpDef>
          <HelpDef term="Metadata">The form&apos;s name, description, success message, redirect URL, notify emails, campaign link, and the auto-create-Lead option.</HelpDef>
          <HelpDef term="Field">One input a visitor fills in (text, email, dropdown, etc.) — with a key, label, type, and required flag.</HelpDef>
          <HelpDef term="Key">The field&apos;s data key (e.g. email, phone, name) — the submitted value is stored under this key. Auto-create Lead requires the keys email / phone / name.</HelpDef>
        </dl>
        <p>
          In the <strong>Fields</strong> block each field is shown as a row: up/down arrow buttons
          on the left (for ordering), the label plus key + type in the middle, and a trash (remove)
          icon on the right. If there are no fields yet, the text «No fields yet. Add one to get
          started.» appears. Field ordering is NOT drag-drop — you move fields up/down with the
          arrows only.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: build the form fields">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Add field</HelpKey> in the top right of the{" "}
            <strong>Fields</strong> block.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Add field» dialog opens. It contains <strong>Key (form data key)</strong>,{" "}
            <strong>Type</strong> (a dropdown), <strong>Label (shown to user)</strong> fields, a{" "}
            <strong>Required</strong> checkbox, and at the bottom <HelpKey>Cancel</HelpKey> and{" "}
            <HelpKey>Add field</HelpKey> buttons.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Key</strong> — it must start with a letter, be 1–64 chars, and use only
            letters, digits, <HelpKey>_</HelpKey> and <HelpKey>-</HelpKey> (e.g.{" "}
            <HelpKey>email</HelpKey>). Then pick a <strong>Type</strong> and write the{" "}
            <strong>Label</strong> shown to the user (e.g. «Your email»). Tick{" "}
            <strong>Required</strong> if needed.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Type dropdown has 11 types: <strong>Text</strong>, <strong>Email</strong>,{" "}
            <strong>Phone</strong>, <strong>URL</strong>, <strong>Text area</strong>,{" "}
            <strong>Number</strong>, <strong>Dropdown</strong>, <strong>Radio</strong>,{" "}
            <strong>Checkbox</strong>, <strong>Date</strong>, and <strong>Hidden</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If the type is <strong>Dropdown</strong>, <strong>Radio</strong> or{" "}
            <strong>Checkbox</strong>, an extra <strong>Options</strong> field appears. Enter
            options comma-separated, in the format{" "}
            <HelpKey>Label=value, Label2=value2</HelpKey> (e.g. <HelpKey>Red=r, Blue=b, Green=g</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Options field only shows for those three types. The placeholder shows the{" "}
            <HelpKey>Red=r, Blue=b, Green=g</HelpKey> format. If you give no options for these
            types, a red error appears in the dialog.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click the <HelpKey>Add field</HelpKey> button at the bottom of the dialog.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the key has the wrong format, is already used, or the label is empty, a red error
            appears inside the dialog and it stays open. If everything is valid the dialog closes
            and the new field is appended to the end of the <strong>Fields</strong> list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            To reorder a field use the up/down arrow buttons on the left of its row. To remove a
            field click the trash icon on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field slides up/down in the list. The up arrow is dimmed (disabled) on the first
            field, the down arrow on the last. Remove drops the field from the list immediately.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Adding, moving, or removing a field is only an on-screen change — it is not yet saved to
            the server. To avoid losing changes, don&apos;t leave the page without pressing{" "}
            <HelpKey>Save draft</HelpKey> or <HelpKey>Publish</HelpKey>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: set the metadata">
        <HelpStep n={1}>
          <p>
            In the <strong>Metadata</strong> block fill in <strong>Name</strong> and{" "}
            <strong>Description</strong>. The name changes the form name in the heading.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Name is a one-line input, Description is a two-row text area. Text appears as you type.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Set the <strong>Success message</strong> (shown after a submission) and an optional{" "}
            <strong>Redirect URL</strong>. If the URL is empty, the success message is shown after
            submission; if a URL is set, the visitor is redirected there.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Success message field has the placeholder «Thanks for your submission!», and the URL
            field shows the example <HelpKey>https://…/thank-you</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Enter comma-separated addresses in <strong>Notify emails</strong> — each submission
            notifies these addresses (e.g. <HelpKey>alice@org.com, bob@org.com</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field shows <HelpKey>alice@org.com, bob@org.com</HelpKey> as a placeholder.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally pick a campaign from the <strong>Marketing campaign</strong> dropdown. Leave{" "}
            <HelpKey>— No campaign —</HelpKey> if you don&apos;t want to link one. Finally decide
            whether to tick <strong>Auto-create a Lead on each submission</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the campaign dropdown is a hint: a submission by a known contact records a
            multi-touch attribution touchpoint. Next to the auto-create-Lead checkbox is a note:
            this option requires the field keys <HelpKey>email</HelpKey>, <HelpKey>phone</HelpKey>,{" "}
            <HelpKey>name</HelpKey>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: save and publish">
        <HelpStep n={1}>
          <p>
            To save changes without making the form live, press <HelpKey>Save draft</HelpKey> in the
            top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button changes to «Saving…» and is briefly disabled. If the server rejects something
            (e.g. an invalid field layout), the reason is shown in the red bar above the blocks. On
            success the page stays with the refreshed form.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To make the form live press <HelpKey>Publish</HelpKey> (it reads{" "}
            <HelpKey>Re-publish</HelpKey> if already published). This button is disabled when the
            form has no fields.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation appears: «Publish this form? The public URL will be live
            immediately.» After you confirm, the button changes to «Publishing…».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Wait for the confirmation — before publishing, the system automatically saves the
            current changes first, and only then publishes.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the save fails, publishing is HALTED and the red error bar appears — the old version
            isn&apos;t published by mistake. On success the status badge becomes{" "}
            <strong>Published</strong> and the <HelpKey>/f/&lt;slug&gt;</HelpKey> link in the heading
            is now live.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Publish does two things at once: it saves first, then publishes. So you don&apos;t need
            to press <HelpKey>Save draft</HelpKey> separately before publishing — but saving a draft
            is useful when you just want to keep your work without going live.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Publish</HelpKey> makes the public link (<HelpKey>/f/&lt;slug&gt;</HelpKey>) live
          immediately — anyone with the link can fill out the form. So check the required fields,
          labels, and options before publishing.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The form and all its fields are scoped to your organization — you can&apos;t see or edit
          another organization&apos;s forms. The campaign dropdown lists only your
          organization&apos;s campaigns. Auto-create Lead also creates the Lead inside your
          organization.
        </p>
      </HelpCallout>
    </div>
  )
}
