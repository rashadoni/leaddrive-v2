"use client"

/**
 * Contract Editor — help article (English). Mirror of az.tsx.
 * Covers only the contract body editor page (/contracts/[id]/editor):
 * 3-pane shell (left Outline, center body canvas, right Variables),
 * formatting toolbar, autosave, variable fill, PDF export, .docx import,
 * read-only states (terminal status / signature in progress).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractEditorHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a lawyer, sales rep, or operations user working with contracts"
        goal="Write and format the contract body in the browser, fill in placeholder variables, and export it as a PDF"
      >
        You reach this page from a contract via the <HelpKey>Edit</HelpKey> (body editor) button;
        the URL looks like <HelpKey>/contracts/&lt;id&gt;/editor</HelpKey>. Everything you write
        belongs to your organization. <strong>There is no “Save” button</strong>: the body
        autosaves a moment after you stop typing. If the contract is already in a final status
        (e.g. “Executed”) or a signature is in progress, the canvas is read-only — an amber banner
        at the top tells you so.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The page is a full-screen editor in three parts. The <strong>top bar</strong> has a back
          arrow (<HelpKey>Back to contract</HelpKey>), the contract title, a status badge, an amber
          “unresolved” badge (if any), a save indicator, the <HelpKey>Done</HelpKey> button, and a
          three-dot <HelpKey>More actions</HelpKey> menu. Below it sits the{" "}
          <strong>formatting toolbar</strong>, and under that three panes:{" "}
          <strong>Outline</strong> (left), the <strong>body canvas</strong> (center), and{" "}
          <strong>Variables</strong> (right). The side panes only appear on wide screens; on narrow
          ones you just get the canvas.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Save indicator">
            The small line up top: “Saving…” while you type, “All changes saved” when you stop, or a
            red “Save failed” on error.
          </HelpDef>
          <HelpDef term="Outline">
            Left pane — a list of the headings (H1/H2/H3) in the body. Click one and the canvas jumps
            to it. With no headings it reads “Add headings to build an outline.”
          </HelpDef>
          <HelpDef term="Variables (placeholders)">
            Right pane — unresolved tokens in the body like <HelpKey>{"{{name}}"}</HelpKey>. Type a
            value for each and replace it in one click. With no such tokens the pane shows an empty
            explanation.
          </HelpDef>
          <HelpDef term="“unresolved” badge">
            The amber badge in the title and the count in the right pane — how many variables are
            still empty. Unresolved variables block “Submit for Approval.”
          </HelpDef>
          <HelpDef term="Formatting toolbar">
            Undo/redo, bold/italic/underline, headings, lists, quote, code, divider, alignment,
            subscript/superscript, link, highlight, image, clear formatting and table tools; a
            word/character counter sits on the right edge.
          </HelpDef>
          <HelpDef term="Read-only banner">
            An amber banner with a lock icon — shown when the contract is in a final status or a
            signature is in progress; the canvas and tools are then locked for editing.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: write and format the body">
        <HelpStep n={1}>
          <p>
            Click the white sheet (canvas) in the center and start typing. An empty canvas shows the
            hint “Start writing the contract body…”.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, the indicator up top reads “Saving…”, then switches to a green tick with
            “All changes saved” a second or two after you stop. The word/character counter on the
            right updates too.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Select text and style it from the toolbar:{" "}
            <HelpKey>Bold</HelpKey>, <HelpKey>Italic</HelpKey>, <HelpKey>Underline</HelpKey>,{" "}
            <HelpKey>Heading 1/2/3</HelpKey>, bullet/numbered list, <HelpKey>Quote</HelpKey>,
            alignment, and so on. Made a mistake? <HelpKey>Undo (⌘Z)</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The active format button is highlighted (blue background). The moment you add a heading it
            shows up in the left <strong>Outline</strong> list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Need a table? Click <HelpKey>Insert table</HelpKey> (a 3×3 table with a header row is
            added). Then use the <HelpKey>Table options</HelpKey> menu to add or delete rows/columns —
            that menu is only active when the cursor is inside a table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A 3-row × 3-column table is inserted into the canvas. Opening{" "}
            <HelpKey>Table options</HelpKey> reveals choices like “Add row below”, “Add column right”,
            and “Delete table”.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To add a link, select text and click <HelpKey>Link</HelpKey>, type the address
            (<HelpKey>https://…</HelpKey>) in the small popover and press <HelpKey>Apply</HelpKey>. For
            an image, use <HelpKey>Insert image</HelpKey> and pick a file from your computer.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The link popover shows the hint “Allowed: http, https, mailto — anything else is stripped
            on save”; entering another protocol raises “Only http(s) and mailto links are allowed”. An
            image over 5 MB triggers “Image too large. Max 5MB”.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: fill in variables (placeholders)">
        <HelpStep n={1}>
          <p>
            If the template body has tokens like <HelpKey>{"{{client_name}}"}</HelpKey>, they're
            listed automatically in the right <strong>Variables</strong> pane. Type the matching value
            into the field under each token.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The title and the top of the right pane carry a badge with how many variables are still
            empty. If there are no such tokens, the pane reads “This contract has none — nothing to
            fill in.”
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            After typing a few values, click <HelpKey>Fill values</HelpKey> at the bottom of the pane.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Tokens that have a value are replaced in the body with the real values and disappear from
            the pane; the save indicator runs again. If a token is split by formatting (e.g. half of it
            bold), you get “Couldn't auto-fill (split formatting?)” and have to place that value
            manually.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: export, import, and navigate">
        <HelpStep n={1}>
          <p>
            Click any heading in the left <strong>Outline</strong> list to navigate a long contract
            quickly.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The canvas scrolls to that heading and the cursor moves there.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Open the three-dot (<HelpKey>More actions</HelpKey>) menu at the top right. It contains{" "}
            <HelpKey>Open contract</HelpKey>, <HelpKey>Export PDF</HelpKey>, and{" "}
            <HelpKey>Import .docx</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Export PDF</HelpKey> opens a server-rendered PDF in a new tab. If the browser
            blocks the pop-up, you'll see “The browser blocked the PDF tab — allow pop-ups and try
            again.”
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To start from an existing Word document, choose <HelpKey>Import .docx</HelpKey> and pick the
            file.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A “Replace the contract body?” confirmation appears — it explains that import replaces the
            current body and that the current version stays in history. After you confirm, “Importing…”
            shows, the new body loads into the canvas, and an “Imported — version N” toast appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            When you're finished, return to the contract with <HelpKey>Done</HelpKey> (or the back
            arrow).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The system saves your latest changes first, then sends you back to the contract page. If the
            last save failed, a “Changes not saved” dialog appears: <HelpKey>Stay</HelpKey> (remain on
            the page) or <HelpKey>Leave anyway</HelpKey> (leave and lose the edits).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Don't look for a “Save” button — the body autosaves as soon as you stop typing. The green
          tick and “All changes saved” up top confirm your work is stored. The browser tab title also
          shows the contract number (if any), so you don't get lost when working across several tabs.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Import .docx</HelpKey> <strong>replaces the current body entirely</strong> (the old
          version stays in history). While any variables remain unresolved, the contract's{" "}
          <strong>“Submit for Approval”</strong> action is blocked — fill them all in first. If the
          save indicator turns red with “Save failed”, resolve the issue before leaving; otherwise your
          latest edits may be lost.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All contract body text, versions, and uploaded images are scoped to your organization — you
          never see another tenant's content. Links allow only the <HelpKey>http</HelpKey>,{" "}
          <HelpKey>https</HelpKey>, and <HelpKey>mailto</HelpKey> protocols; anything else is stripped
          on save. When the contract is in a final status or a signature is in progress the canvas is
          locked automatically — this prevents accidental edits to a signed body.
        </p>
      </HelpCallout>
    </div>
  )
}
