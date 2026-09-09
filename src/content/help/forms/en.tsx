"use client"

/**
 * Forms (No-Code Form Builder) — help article (English).
 *
 * Covers only the `/forms` list page: the forms table, status badges
 * (Draft / Published / Archived), view/submission counters, the public
 * URL (/f/{slug}) and the "New form" create dialog (name + slug). The
 * editor (/forms/[id]) is OUT OF SCOPE here — only the link to it is shown.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function FormsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a marketing or operations admin"
        goal="Create a standalone form with a public URL, track it (views and submissions), and get it ready to share on your site"
      >
        You reach this page from the <HelpKey>Forms</HelpKey> section. All forms belong to your
        organization only. This page is the <strong>list</strong> of forms — here you create a form,
        see its status and stats, then configure each form's actual content (fields, design) in a
        separate editor.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Forms</HelpKey> title with the line «Standalone forms with a
          public URL. Embed anywhere or share directly.» underneath (it includes a{" "}
          <code>/f/{`{slug}`}</code> example), and a <HelpKey>New form</HelpKey> button at the top
          right. Below is the forms table. If there are no forms yet, an empty state appears instead: a
          document icon, the text «No forms yet.» and a <HelpKey>Create your first form</HelpKey> button.
        </p>
        <p>
          The table columns are: <strong>Name</strong>, <strong>Status</strong>, <strong>Views</strong>,{" "}
          <strong>Submissions</strong>, <strong>Public URL</strong>, and a per-row{" "}
          <HelpKey>Edit</HelpKey> link on the far right. In the <strong>Name</strong> column the form
          name is a clickable link; if it has a description, it appears under the name in small text.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Form">A standalone questionnaire with a public (no-login) URL — embed it on your site or share the link.</HelpDef>
          <HelpDef term="Status">The form's lifecycle: «Draft» (new, not public yet), «Published» (live, works at the public URL), or «Archived».</HelpDef>
          <HelpDef term="Views">A running counter of how many times the form's public page has been opened.</HelpDef>
          <HelpDef term="Submissions">A running counter of how many responses (e.g. lead data) have been submitted through the form.</HelpDef>
          <HelpDef term="Public URL">The address of a published form: <code>/f/{`{slug}`}</code>. Filled in only when the status is «Published»; otherwise it shows «—».</HelpDef>
          <HelpDef term="Slug">The short identifier at the end of the URL (e.g. «contact-us»). Lowercase and dashes only, 1–64 chars; immutable after create.</HelpDef>
        </dl>
        <p>
          Status badges are color-coded: <strong>Draft</strong> is gray, <strong>Published</strong> is
          green, <strong>Archived</strong> is amber. Views and submissions are shown as right-aligned,
          monospaced numbers.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new form">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New form</HelpKey> button at the top right. (If you have no forms yet,
            the <HelpKey>Create your first form</HelpKey> button in the middle of the empty state opens
            the same dialog.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «New form» dialog opens. It has a <strong>Name</strong> field and a{" "}
            <strong>Slug (public URL)</strong> field; below the slug field is the hint «Lowercase,
            dashes only. 1–64 chars. Immutable after create.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter a <strong>Name</strong> (e.g. «Contact us») and a <strong>Slug</strong> (e.g.{" "}
            <HelpKey>contact-us</HelpKey>). The slug is the part that appears in the public URL.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the fields as you type. The create button below stays disabled until
            both fields are filled. The slug is automatically lowercased on save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create draft</HelpKey> below. (Changed your mind? Close it with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Creating…», then the dialog closes and the new form appears at the
            top of the table with a <strong>Draft</strong> status. If the slug or name is rejected, a
            red error message appears below the fields.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit a form's content">
        <HelpStep n={1}>
          <p>
            Click the form's <strong>name</strong> in the table, or the <HelpKey>Edit</HelpKey> link on
            the right of that row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Edit</HelpKey> link has a small external-link icon next to it. Clicking opens
            that form's editor (<code>/forms/{`{id}`}</code>), where fields, design, and publishing are
            managed (out of scope for this article).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            After you publish the form, return to the list and check the <strong>Public URL</strong>{" "}
            column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A form with the <strong>Published</strong> status shows its <code>/f/{`{slug}`}</code>{" "}
            address in the <strong>Public URL</strong> column; forms still in draft show «—» in that
            cell. The <strong>Views</strong> and <strong>Submissions</strong> columns grow as the
            public form is used.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The slug is the tail of the public link — keep it short, readable, and memorable (e.g.
          «contact-us», not a long random string). Because it can't be changed after create, pick it
          carefully before you share it; if you later need a different link, you'll have to create a new
          form.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A form is only live when its status is <strong>Published</strong>, working at{" "}
          <code>/f/{`{slug}`}</code>. While it's a draft, the form isn't public and the Public URL cell
          stays «—» — so before sharing the link, confirm the status reads «Published».
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All forms are scoped to your organization — you only see your own tenant's forms, and the
          forms you create are invisible to other organizations. The form's <strong>public URL</strong>,
          however, requires no login: a published form is open to anyone who has the link, so design
          the form to collect only data you're comfortable exposing publicly.
        </p>
      </HelpCallout>
    </div>
  )
}
