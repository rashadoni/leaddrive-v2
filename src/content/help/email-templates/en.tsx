"use client"

/**
 * Email Templates — help article (English).
 * Split out of the old shared "email" article: covers ONLY the
 * Email Templates page — creating templates, category/language
 * filters, search, the editor (HTML/Visual), variables, blocks,
 * preview and delete. Sending / campaign features are NOT included.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EmailTemplatesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a marketing or sales team member"
        goal="Create and manage reusable email templates — personalized with variables — for campaigns and notifications"
      >
        This page keeps all your email templates in one place. You build a template once, then reuse
        it across campaigns and notifications. Variables like{" "}
        <HelpKey>&#123;&#123;client_name&#125;&#125;</HelpKey> are replaced with real data at send
        time. Every template belongs to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Email Templates</HelpKey> title and the line «Create reusable
          email templates for campaigns». Top-right has two buttons:{" "}
          <HelpKey>From template</HelpKey> (start from a ready-made library template) and{" "}
          <HelpKey>New Template</HelpKey> (build from scratch). Below it: a search box, then two
          filter rows — <strong>Language</strong> and <strong>Category</strong> — and at the bottom a
          grid of template cards (up to three columns on screen).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Template">A saved, reusable email with a name, subject, body, category and language.</HelpDef>
          <HelpDef term="Subject">The email subject line recipients will see (shown on the card as «Subject: …»).</HelpDef>
          <HelpDef term="Category">The template's type — General, Welcome, Onboarding, Notification, Marketing, Follow-up, Proposal.</HelpDef>
          <HelpDef term="Language">The content language of the template (marked with 🇦🇿 AZ / 🇷🇺 RU / 🇬🇧 EN flags).</HelpDef>
          <HelpDef term="Variable">A placeholder like &#123;&#123;client_name&#125;&#125; or &#123;&#123;company&#125;&#125; — filled with real data at send time.</HelpDef>
          <HelpDef term="Active / Inactive">The template's status — an inactive card appears dimmed (semi-transparent).</HelpDef>
        </dl>
        <p>
          Each card shows the name, a green/grey dot (active state) and a language flag next to it,
          then «Subject: …», then a plain-text preview of the body (the first lines, stripped of
          HTML). At the bottom you see the category chip, an <strong>Active</strong> /{" "}
          <strong>Inactive</strong> badge, and the variable count if any («N variables»). Clicking a
          card opens the edit form. If there are no templates, you see «No templates» with «Create
          your first email template» below it; if search/filters return nothing, it shows «Nothing
          found».
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a template from scratch">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Template</HelpKey> at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A large near-fullscreen form opens. Its header reads «New Template», the top row has four
            fields — <strong>Name</strong>, <strong>Category</strong>, <strong>Subject</strong>,{" "}
            <strong>Language</strong> — and the content editor sits below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill in <strong>Name</strong> and <strong>Subject</strong> (both required). Pick a{" "}
            <strong>Category</strong> and <strong>Language</strong> from their dropdowns.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Category dropdown has seven options (General, Welcome, Onboarding, Notification,
            Marketing, Follow-up, Proposal). The Language dropdown lists 🇷🇺 RU / 🇦🇿 AZ / 🇬🇧 EN. If you
            try to save with Name or Subject empty, a red «Name and subject are required» warning
            appears at the top of the form.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Write the content. By default the <HelpKey>✏️ HTML</HelpKey> editor is open — the toggle
            at the top also lets you switch to the <HelpKey>🎨 Visual</HelpKey> editor. The HTML
            editor has a formatting toolbar (bold, italic, underline, font size, color, alignment,
            lists, link, image upload) and three tabs: <HelpKey>✏️ Editor</HelpKey>,{" "}
            <HelpKey>👁 Preview</HelpKey> and <HelpKey>⬛ Split</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On the Editor tab, a «🧱 Blocks» panel appears above the writing area — buttons for Hero,
            text block, CTA button, 2 columns, image and more. Clicking a block drops its ready-made
            HTML at the cursor, where you can then edit it inline.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            For personalization, use the <strong>Client Data</strong> variable buttons in the blue
            strip — for example <HelpKey>👤 Client Name</HelpKey>, <HelpKey>🏢 Company</HelpKey>,{" "}
            <HelpKey>📆 Date</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking a button inserts a tag like{" "}
            <HelpKey>&#123;&#123;client_name&#125;&#125;</HelpKey> at the cursor. Hovering a button
            shows its exact variable name (e.g. <code>&#123;&#123;company&#125;&#125;</code>) as a
            tooltip.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Check the result by switching to the <HelpKey>👁 Preview</HelpKey> tab (or use{" "}
            <HelpKey>⬛ Split</HelpKey> to see the HTML and a live preview side by side).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            In Preview, variables are replaced with sample values and highlighted in yellow — e.g.{" "}
            <HelpKey>&#123;&#123;client_name&#125;&#125;</HelpKey> → «Иван Иванов»,{" "}
            <HelpKey>&#123;&#123;company&#125;&#125;</HelpKey> → «Güven Technology». This is preview
            only; the saved template keeps the variables intact.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Click <HelpKey>Save</HelpKey> at the bottom-right. (Changed your mind? Use{" "}
            <HelpKey>Cancel</HelpKey> or the × at the top-right.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button changes to «Saving...», then the form closes and the new template appears in
            the card grid. The counts on the Language and Category filters (e.g. «🇬🇧 EN (1)») tick up
            accordingly.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: start from a library template">
        <HelpStep n={1}>
          <p>
            Instead of writing from scratch, click <HelpKey>From template</HelpKey> at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Template Library» dialog opens with the line «Choose a pre-built template to get
            started» and a list of ready-made template cards. Each card has an icon, a name, a short
            description and a category chip.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the card you like.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The library dialog closes and the New Template form opens pre-loaded with that design (in
            visual editor mode). You can now type the name and subject and edit the content with your
            own text.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Fill in the name and subject, tweak the design if needed, and click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After saving, the template shows up as a normal card in the grid, open to search, filter
            and editing like any other.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: find, edit or delete a template">
        <HelpStep n={1}>
          <p>
            To find a template, type a name or subject into the search box, or use the{" "}
            <strong>Language</strong> / <strong>Category</strong> filter buttons.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The filters only show languages/categories that actually exist, each with a count (e.g.
            «📣 Marketing (3)»). The selected filter button appears filled (highlighted). Search
            matches both name and subject; if nothing matches, it shows «Nothing found».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To edit a template, click its card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same large form opens with the title «Edit Template», pre-filled with the existing
            name, subject, category, language and content. The header also shows an{" "}
            <HelpKey>Active</HelpKey> / <HelpKey>Inactive</HelpKey> badge — click it to toggle the
            template active or inactive.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Make your changes and confirm with <HelpKey>Save</HelpKey>. To delete the template,
            click the red trash icon in the bottom-left corner of the form.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking the trash icon closes the form and opens a «Delete Template» confirmation dialog
            showing the template's name. Once confirmed, the template disappears from the card grid
            and the filter counts update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The visual editor (🎨 Visual) depends on the <code>editor.unlayer.com</code> service. If an
          ad blocker or corporate firewall blocks it, the editor may fail to load — in that case
          switch to <HelpKey>✏️ HTML</HelpKey> mode; it's a full-featured fallback and needs no
          external service.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Deletion can't be undone. If you only want to hide a template temporarily, don't delete
          it — set it to <HelpKey>Inactive</HelpKey> with the badge in the edit form. The template
          stays, just appears dimmed and isn't counted as active.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All templates are scoped to your organization — you only see and edit your own tenant's
          templates, and other organizations' templates are invisible to you. Images you upload also
          go to your organization's storage.
        </p>
      </HelpCallout>
    </div>
  )
}
