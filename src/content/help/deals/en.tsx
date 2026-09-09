"use client"

/**
 * Deals (Sales Pipeline) — help article (English).
 * Split out of the old shared "list-power" article — focused only on the
 * Deals page (Kanban / List / Analytics + Da Vinci AI).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function DealsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sales manager"
        goal="Run deals from lead to close on one page"
      >
        The page opens on the <strong>Kanban</strong> view. Three tabs sit at
        the top — <HelpKey>Analytics</HelpKey>, <HelpKey>Kanban</HelpKey>,{" "}
        <HelpKey>List</HelpKey> — and the count of your deals shows under the
        title. All amounts are shown in ₼. You only see your own
        organization's deals.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The top row switches the view; the right side drives the actions. If
          you have more than one pipeline, a <strong>pipeline selector</strong>{" "}
          appears on the right (the default one is marked with ★); in Kanban and
          List a <strong>sort</strong> menu and the orange <HelpKey>New
          Deal</HelpKey> button sit there too.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Analytics">Overview of deals with charts and metrics.</HelpDef>
          <HelpDef term="Kanban">Stage columns; drag deals to move them.</HelpDef>
          <HelpDef term="List">Table view — edit fields in place, bulk actions.</HelpDef>
          <HelpDef term="Probability">Likelihood the deal closes (%) — ≥70 green, ≥40 amber.</HelpDef>
          <HelpDef term="Weighted">Open deals summed after multiplying by their probability.</HelpDef>
        </dl>
        <p>
          Below the tabs is the <strong>Da Vinci</strong> AI button: it
          generates a language-based analysis across your whole pipeline
          (disabled when the pipeline is empty).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new deal">
        <HelpStep n={1}>
          <p>
            Click the orange <HelpKey>New Deal</HelpKey> button in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The deal form opens — fields for name, value, stage, probability,
            expected close and the related company.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill in the fields and confirm with <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form closes, the new deal appears immediately in the table /
            Kanban column, and the counter under the title goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: change stage on the Kanban">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Kanban</HelpKey> tab. Four cards sit at the
            top — <strong>Total Deals</strong>, <strong>Pipeline Value</strong>,{" "}
            <strong>Won</strong> and <strong>Lost</strong> — and below them a
            colored <strong>Pipeline / Weighted</strong> bar by stage (when the
            pipeline has value).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            One column per stage; cards show name, company, amount and
            probability, and stalled deals show a "{"{days}"}d stale" marker.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Grab a card and <strong>drag</strong> it to another column — the
            stage changes. For quick follow-up you can also add a{" "}
            <HelpKey>Task</HelpKey> to a deal from the task field on the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card moves to the new column; the stat cards and the bar update.
            If the move isn't allowed, a red banner explains why and the card
            snaps back.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Click</strong> a card to open that deal's full page.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The deal detail page opens (info, engagement, offers, history, etc.).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search, filter and sort">
        <HelpStep n={1}>
          <p>
            In Kanban or List, type in the search box (<em>Search deals…</em>).
            It looks at name, company and notes.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Results filter live; a <strong>found / total</strong> counter shows
            next to the box (e.g. 8 / 42).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click one of the <strong>stage pills</strong> under the search. The{" "}
            <HelpKey>All</HelpKey> filter resets it; each pill shows the deal
            count for that stage in parentheses.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected pill darkens and only that stage's deals remain.
            Clicking the same pill again clears the filter.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick one from the <strong>sort</strong> menu on the right: newest,
            oldest, amount ↓/↑, name A→Z, probability ↓ or expected close ↑.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The deals reorder instantly by the chosen rule.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit inline in the List">
        <p>
          The <HelpKey>List</HelpKey> view gives a table with Name, Company,
          Deal value, Status (stage), Win probability and Expected close
          columns. Most cells are editable in place.
        </p>
        <HelpStep n={1}>
          <p>
            Click a value, probability or date cell and type a new value; to
            rename, <strong>double-click</strong> the name (a single click on
            the name opens the deal page). To change the stage, click the
            colored dot in the Status cell and pick from the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field enters edit mode; on save the value updates. An invalid
            value (empty or non-numeric) shows a red toast and the cell reverts
            to its previous value.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tick the checkbox on the left to select row(s), or the header
            checkbox to select all.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A <strong>bulk-actions bar</strong> appears at the top: "Move to
            stage…", an assignee picker and <HelpKey>Delete</HelpKey>. The
            header checkbox is tri-state — empty / partial / all.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            From the bar pick a stage, reassign an owner, or delete. Bulk delete
            opens a confirmation dialog.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When done, a toast reports how many deals changed, the selection
            clears, and the table refreshes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To keep a filter set, use the <strong>saved-view</strong> bar above
            the table.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The current search, stage filter, sort and pipeline are bundled into
            one view; one click re-applies it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: Da Vinci AI analysis">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>Da Vinci analytics</HelpKey> button under the tabs
            (the pipeline must have at least one deal).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A card opens below with a spinner, then a text analysis across your
            pipeline appears. On a network error the card shows a red warning.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            When you've read it, close the card with the <HelpKey>×</HelpKey> in
            the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The analysis card collapses; your deals view stays as it was.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Probability</strong> and <strong>expected close</strong> are
          the most impactful fields: the Kanban <em>Weighted</em> bar and the
          Forecast page both read them. Keep both honest on every deal so the
          forecast stays accurate.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Dragging to change a stage obeys the pipeline's transition rules — some
          moves can be blocked and a red banner explains why. When that happens
          the card snaps back to its previous column; don't force it, complete
          the requirements first.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All deals are scoped to your organization — you only see, edit and
          delete your own tenant's deals. Deleting asks for confirmation first;
          bulk delete also confirms with the selected count.
        </p>
      </HelpCallout>
    </div>
  )
}
