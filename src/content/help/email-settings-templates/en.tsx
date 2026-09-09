"use client"

/**
 * Email Templates — help article (English).
 * Covers Settings → Email Templates: template list, stat cards, the
 * create/edit form (HTML and Visual editors, blocks, formatting toolbar,
 * variables) and deletion.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function emailsettingstemplatesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a marketing or operations administrator"
        goal="Create and manage reusable email templates for campaigns and notifications — personalized with variables and organized by language"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Email Templates</HelpKey>. Every
        template belongs only to your organization. The stat cards, table, and search all read from
        the same template list, so adding or deleting a template updates the stats instantly.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Email Templates</HelpKey> title, a «Create reusable email
          templates for campaigns» line and a one-line «Configure default email templates for system
          notifications» note. Top right is the <HelpKey>New Template</HelpKey> button. Below sit
          three stat cards: <strong>Total Templates</strong>, <strong>Languages</strong> and{" "}
          <strong>Categories</strong>. Under them is the template table with a «Search templates...»
          box above it.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Templates">The total count of all email templates you've created.</HelpDef>
          <HelpDef term="Languages">How many distinct languages are used across templates (EN, RU, AZ).</HelpDef>
          <HelpDef term="Categories">How many distinct categories are used across templates.</HelpDef>
          <HelpDef term="Template">A reusable email draft with a name, subject, body, category and language.</HelpDef>
          <HelpDef term="Variable">{`A placeholder like {{client_name}} you drop into the body — it's replaced with real client data when the email is sent.`}</HelpDef>
          <HelpDef term="Category">The purpose label of a template: General, Welcome, Onboarding, Notification, Marketing, Follow-up, Proposal.</HelpDef>
        </dl>
        <p>
          Each table row is one template. Columns: <strong>Name</strong> (the subject shows in grey
          under the bold name), <strong>Category</strong> (as a badge), <strong>Language</strong>{" "}
          (EN / RU / AZ), <strong>Created</strong> (date) and, on the right, two action buttons: a
          pencil icon (edit) and a red trash icon (delete). The table paginates (10 rows per page).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new template">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>New Template</HelpKey> button in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A large, almost full-screen dialog opens titled «New Template». Across the top sit the{" "}
            <strong>Name</strong>, <strong>Category</strong>, <strong>Subject</strong> and{" "}
            <strong>Language</strong> fields in one row, with the editor area below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter a <strong>Name</strong> and a <strong>Subject</strong> — both are required. The
            name is for your internal reference; the subject is the email headline recipients see.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Text appears in the fields as you type. If you try to save with either empty, a red «Name
            and subject are required» warning shows above the editor.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick a <strong>Category</strong> from the dropdown (General, Welcome, Onboarding,
            Notification, Marketing, Follow-up, Proposal) and a <strong>Language</strong> (🇷🇺 RU,
            🇦🇿 AZ, 🇬🇧 EN).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Category defaults to «General» and language to RU. Your choices feed the matching table
            columns and the <strong>Categories</strong> / <strong>Languages</strong> stat cards.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In the <HelpKey>Content</HelpKey> section choose the editor mode:{" "}
            <HelpKey>✏️ HTML</HelpKey> (the default, with a formatting toolbar) or{" "}
            <HelpKey>🎨 Visual</HelpKey> (a drag-and-drop visual editor).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            HTML mode shows a formatting toolbar, a block palette and the <strong>Editor</strong> /{" "}
            <strong>Preview</strong> / <strong>Split</strong> tabs. The first time you switch to
            Visual, a «Template Library» opens so you can start from a pre-built design.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            In HTML mode, start writing the body. Click a ready-made block from the palette
            (<HelpKey>🧱 Blocks</HelpKey>) — it's inserted at the cursor (Hero / Heading, Text block,
            CTA button, etc.). Use the toolbar buttons (bold, italic, size, color, lists, link,
            image) to format the text.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The empty canvas shows the «Start writing your template...» placeholder. Each block you
            click drops a pre-styled snippet onto the canvas, which you can then edit inline.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            To personalize, click a variable button on the <HelpKey>Client Data</HelpKey> row (e.g.
            👤 Client Name, 📧 Client Email, 🏢 Company, 📅 Date). The button drops a{" "}
            <HelpKey>{`{{client_name}}`}</HelpKey>-style tag into the body.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The tag is inserted at the cursor. Switch to the <strong>Preview</strong> tab and these
            variables light up with sample values (e.g. «Иван Иванов») on a yellow background, so you
            can picture what the recipient gets.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Click <HelpKey>Save</HelpKey> at the bottom right. (Changed your mind? Use{" "}
            <HelpKey>Cancel</HelpKey> or the × in the top right to close.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Saving...» while it saves, then the dialog closes and the new
            template appears in the table. The <strong>Total Templates</strong> card increments by
            one; if a new language or category was used, those cards update too.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete a template">
        <HelpStep n={1}>
          <p>
            To change a template, click the pencil-icon button on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same dialog opens, titled «Edit Template», with name, subject, category, language and
            content pre-filled. An <strong>Active</strong> / <strong>Inactive</strong> toggle also
            appears in the top right. Make your edits and confirm with <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a template quickly, type a name into the «Search templates...» box above the
            table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table filters as you type and shows only templates whose name matches.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete a template, click the red trash-icon button on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Delete Template» confirmation dialog opens showing the name of the template to be
            deleted. After you confirm, the template leaves the table and the stat cards update. If
            deletion fails, a red error message is shown.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion can't be undone — a template can't be restored afterward. If a campaign or
            notification still references it, change that usage first.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Variables are what make a template reusable: drop in{" "}
          <HelpKey>{`{{client_name}}`}</HelpKey> once and every send fills it with the real name.
          Before sending, check the <strong>Preview</strong> tab with sample values so no empty or
          wrong tags slip through.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All templates are scoped to your organization — you only see, edit and delete your own
          tenant's templates. Templates from other organizations are never visible to you.
        </p>
      </HelpCallout>
    </div>
  )
}
