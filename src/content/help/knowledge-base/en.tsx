"use client"

/**
 * Knowledge Base — help article (English).
 * Split out of the old shared "support" article: covers ONLY the
 * Knowledge Base page (article create/edit, published/draft status,
 * category management, search and filters, grouped table). The
 * tickets/support side is NOT included here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function KnowledgeBaseHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support team member or content administrator"
        goal="Write guides and articles for customers and your team, organize them into categories, and publish them"
      >
        You reach the page from the left menu under <HelpKey>Knowledge Base</HelpKey>. All articles and
        categories belong to your organization only. The name in the header, the counts above the
        table, the table, and the filters all read from the same article list, so as you add an article
        or change its status the counts at the top update immediately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Knowledge Base</HelpKey> title with a one-line summary under it:{" "}
          <em>"X articles · Y published · Z views"</em>. Top-right there are two buttons:{" "}
          <HelpKey>Categories</HelpKey> (gear icon) and <HelpKey>New Article</HelpKey> (plus icon).
          Below them a "Did you know?" tip panel may appear.
        </p>
        <p>
          Underneath comes the filter row: on the left a <strong>search box</strong> (magnifier icon,
          "Search..." placeholder), then three status buttons — <HelpKey>All</HelpKey>,{" "}
          <HelpKey>Published</HelpKey>, <HelpKey>Drafts</HelpKey> (each with a count) — and on the far
          right a <strong>category dropdown</strong> (shown only once you have at least one category or
          a categorized article).
        </p>
        <p>
          The main area is the article table. When the filter is "All categories", articles are grouped
          into <strong>collapsible category blocks</strong> (folder icon, name, and a count badge).
          Picking a specific category switches to a plain headed table instead. If there are no articles
          at all, an empty state with a book icon is shown instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Article">A knowledge entry with a title, body (Markdown), status, category, tags, and view/helpful counts.</HelpDef>
          <HelpDef term="Published">Status of an article visible to portal users and customers (marked with a green dot).</HelpDef>
          <HelpDef term="Draft">Status of an article still being written, not visible to customers (marked with a yellow dot).</HelpDef>
          <HelpDef term="Category">A named folder for grouping articles; uncategorized articles collect under "No category".</HelpDef>
          <HelpDef term="Tags">Comma-separated keywords; the first three show as small chips under the title in the table and are searchable.</HelpDef>
          <HelpDef term="Views">A count of how many times the article has been opened (eye-icon column).</HelpDef>
        </dl>
        <p>
          Each table row has a file icon, the title (a link that opens the article page), tags beneath
          it, a short preview of the body, the status dot, the view count, and the last-updated date.
          Hovering over a row reveals an <strong>edit</strong> (pencil) and a <strong>delete</strong>{" "}
          (red trash) icon on the right.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new article">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Article</HelpKey> at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Add Article" dialog opens. It has a <strong>Title *</strong> field, a large{" "}
            <strong>Content *</strong> text area (about 8 rows), then side-by-side{" "}
            <strong>Category</strong> and <strong>Status</strong> dropdowns, and a{" "}
            <strong>Tags</strong> field at the bottom (with a "tag1, tag2, tag3" placeholder).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Enter a <strong>Title</strong> and <strong>Content</strong> — both are required (marked
            with a *). The content accepts Markdown (headings, bold/italic, links).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Text appears in the fields as you type. If the title or content is left blank, the browser
            blocks submission and flags the empty required field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Optionally pick a <strong>Category</strong> (the list holds your existing categories plus a
            "No category" option), set the <strong>Status</strong> (defaults to <HelpKey>Draft</HelpKey>;
            choose <HelpKey>Published</HelpKey> to show it to customers), and add{" "}
            <strong>Tags</strong> separated by commas.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Status dropdown offers exactly two choices: "Draft" and "Published". The category list
            is filled from the categories you created in your organization.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Create</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving..." while it saves, then the dialog closes and the new
            article appears in the table. The header counts (<em>articles</em>, and <em>published</em>{" "}
            if you chose <HelpKey>Published</HelpKey>) go up accordingly. If saving fails, a red error
            message is shown at the top of the form.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search and filter articles">
        <HelpStep n={1}>
          <p>
            Type a keyword into the magnifier <HelpKey>Search...</HelpKey> box on the left. Search runs
            across the title, the tags, and the article body.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table filters instantly as you type — only matching articles remain. If nothing
            matches, the "No articles found" empty state with a book icon appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To narrow by status, click <HelpKey>All</HelpKey>, <HelpKey>Published</HelpKey>, or{" "}
            <HelpKey>Drafts</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button appears filled (highlighted) while the others stay outlined. The number
            in parentheses on each button shows how many articles are in that status.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To filter by category, pick a category (or <HelpKey>No category</HelpKey>) from the
            dropdown on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Picking a specific category switches the table from grouped mode to a plain table with
            column headers (Title, Preview, Status, views, Date), showing only that category's articles.
            Returning to <HelpKey>All categories</HelpKey> brings back the folder grouping.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In "All categories" mode you can click a folder header to collapse or expand that category.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chevron on the header flips between down (open) and right (collapsed); a collapsed
            folder hides its articles, but its count badge stays visible.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: open, edit, or delete an article">
        <HelpStep n={1}>
          <p>
            To read an article, click its <strong>title link</strong> in the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The article's own page opens, and its view count goes up by one.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To change an article, hover its row and click the pencil (<HelpKey>Edit</HelpKey>) icon that
            appears on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Edit Article" dialog opens, pre-filled with the existing title, content, category,
            status, and tags. Make your changes and confirm with the <HelpKey>Update</HelpKey> button
            at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete an article, click the red trash (<HelpKey>Delete</HelpKey>) icon in the same spot.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Article" confirmation dialog opens, showing the name of the article to be deleted.
            After you confirm, the article leaves the table and the header counts update.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deleting cannot be undone. If you only want to hide an article from customers temporarily,
            edit it and set its status back to <HelpKey>Draft</HelpKey> instead of deleting — the
            article stays, it just no longer counts as published.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: manage categories">
        <HelpStep n={1}>
          <p>
            Click the gear-icon <HelpKey>Categories</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Manage Categories" dialog opens. At the top there's an input for a new category name and
            an <HelpKey>Add</HelpKey> button, and below it the list of existing categories; if there are
            none yet, "No categories yet" is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a name for the new category and click <HelpKey>Add</HelpKey> (or press Enter).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The input clears and the new category appears in the list below with a folder icon. The{" "}
            <HelpKey>Add</HelpKey> button stays disabled while the name is empty.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete a category, click the red trash icon on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The category disappears from the list immediately. Articles that were in it are not deleted —
            they move to <strong>"No category"</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            When you're done, close the dialog with the <HelpKey>Close</HelpKey> button at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dialog closes; new categories are now available both in the filter dropdown and in the
            article form's "Category" picker.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status is the backbone of your workflow: keep an article as a <HelpKey>Draft</HelpKey> while
          you prepare it (only your team sees it), then edit and set it to <HelpKey>Published</HelpKey>{" "}
          when it's ready. The colored dot in the table — green for published, yellow for draft — tells
          you at a glance which articles are live.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All articles and categories are scoped to your organization — you don't see another
          organization's knowledge base and they don't see yours. <HelpKey>Published</HelpKey> status
          makes an article visible to portal users and customers, so review sensitive or internal notes
          before publishing.
        </p>
      </HelpCallout>
    </div>
  )
}
