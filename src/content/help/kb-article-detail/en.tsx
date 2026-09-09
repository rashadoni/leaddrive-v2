"use client"

/**
 * Knowledge Base — Article detail — help article (English).
 * Source page: src/app/(dashboard)/knowledge-base/[id]/page.tsx
 * Single-article view: title + status badge, four stat cards (views /
 * tags / category / status), a Content card (sanitized rich HTML), an
 * "Edit" form and a "Delete" confirmation. Covers this page only — the
 * list/portal side is NOT included.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function kbarticledetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a support agent, content editor, or administrator"
        goal="Open and read a specific knowledge base article, edit its content, switch its published/draft status, or delete it"
      >
        You reach this page by clicking an article in the{" "}
        <HelpKey>Knowledge Base</HelpKey> list (URL <HelpKey>/knowledge-base/&lt;id&gt;</HelpKey>).
        The page shows one article and all of it belongs to your organization. Every time the page
        opens, the article is re-fetched from the server, so changes appear immediately after editing.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top-left there is a <HelpKey>back arrow</HelpKey> button — pressing it returns you to the{" "}
          <HelpKey>Knowledge Base</HelpKey> list. Next to it is a book icon, then the{" "}
          <strong>article title</strong> in large type, and below the title (if set) the category
          name with a status badge beside it (<strong>Published</strong> or <strong>Draft</strong>).
          Top-right there are two buttons: <HelpKey>Edit</HelpKey> (pencil icon) and a red{" "}
          <HelpKey>Delete</HelpKey> (trash icon).
        </p>
        <p>
          Under the title sit four stat cards: <strong>views</strong>, <strong>Tags</strong>,{" "}
          <strong>Category</strong> and <strong>Status</strong>. Below them is a card titled{" "}
          <strong>Content</strong> — it shows the article's actual body (rendered as formatted HTML);
          if the body is empty it reads "No data available".
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="views">A counter of how many times the article has been opened (viewCount).</HelpDef>
          <HelpDef term="Tags">The number of tags attached to the article (comma-separated words).</HelpDef>
          <HelpDef term="Category">The name of the category the article belongs to; shows "—" when none is set.</HelpDef>
          <HelpDef term="Status"><strong>Published</strong> (visible to portal users) or <strong>Draft</strong> (visible to your team only).</HelpDef>
          <HelpDef term="Content">The article body — the formatted HTML you wrote in the editor; it is sanitized before display.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: read the article and go back">
        <HelpStep n={1}>
          <p>
            As the page opens, check the title and the status badge at the top — that tells you
            whether this article is published.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While the article loads a pulsing grey placeholder (skeleton) shows for a moment, then the
            real title, category and status badge appear. If the article isn't found, a centered
            "No data available" message shows instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Scroll down and read the full body in the <strong>Content</strong> card. You may also see
            the <strong>views</strong> count on the stat cards go up.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The content renders as formatted text (headings, lists, bold, etc.). If the body is empty,
            the card reads "No data available".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To return to the list, press the <HelpKey>back arrow</HelpKey> button at the top-left.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Knowledge Base</HelpKey> list page opens.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit the article and switch published/draft status">
        <HelpStep n={1}>
          <p>
            Press the <HelpKey>Edit</HelpKey> (pencil icon) button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "Edit Article" dialog opens, pre-filled with the current values:{" "}
            <strong>Title *</strong>, <strong>Content *</strong> (a multi-line text area),{" "}
            <strong>Category</strong> and <strong>Status</strong> dropdowns, and a{" "}
            <strong>Tags</strong> field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Change whatever you need. <strong>Title</strong> and <strong>Content</strong> are required
            (marked with an asterisk). Separate tags with commas (e.g.{" "}
            <HelpKey>tag1, tag2, tag3</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Category</strong> dropdown lists a "No category" option plus your
            organization's categories. The <strong>Status</strong> dropdown has only two choices:{" "}
            <strong>Draft</strong> and <strong>Published</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Setting Status to <strong>Published</strong> exposes the article to portal users; setting
            it back to <strong>Draft</strong> hides it again — publishing/unpublishing is controlled
            right here.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chosen status shows in the dropdown; nothing changes yet — the change applies only
            after you save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Press <HelpKey>Update</HelpKey> at the bottom. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button turns into "Saving..." while it saves, then the dialog closes and the page
            refreshes with the new title, status badge, stat cards and content. If the save fails, a red
            error message appears at the top of the form and the dialog stays open.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Title</strong> and <strong>Content</strong> cannot be empty. If you clear them and
            try to save, the browser asks you to fill them in and the form is not submitted.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: delete the article">
        <HelpStep n={1}>
          <p>
            Press the red <HelpKey>Delete</HelpKey> (trash icon) button at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Article" confirmation dialog opens, warning that the action cannot be undone and
            the article will be permanently deleted.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm by pressing the red <HelpKey>Delete</HelpKey> button. (Changed your mind? Press{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button turns into "Deleting..." with a spinning icon; on success the dialog closes and
            you return to the <HelpKey>Knowledge Base</HelpKey> list. If deletion fails, a red error
            message shows inside the dialog.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion is permanent — the article is gone for good. If you only need to hide the article
            from customers, edit it and switch the status to <strong>Draft</strong> instead; that keeps
            the article but stops it showing in the portal.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The <strong>views</strong> counter signals real interest in an article — if a heavily-viewed
          article is still in <strong>Draft</strong>, it's worth publishing. Tags make the article
          easier to find and group in the list.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The article is read only from your organization (the request carries your tenant id); you
          cannot see or edit another organization's articles. The content is sanitized before it is
          shown (malicious HTML/scripts are stripped), so pasting text from an untrusted source into an
          article is safe.
        </p>
      </HelpCallout>
    </div>
  )
}
