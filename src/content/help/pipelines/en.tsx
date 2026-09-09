"use client"

/**
 * Pipelines & Stages — help article (English).
 *
 * Covers /settings/pipelines: multiple sales pipelines, their stages
 * (order, colour, probability, won/lost), and per-stage validation rules
 * that gate deal stage transitions. One article wired to the page header.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function PipelinesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          A <strong>pipeline</strong> is the set of stages a deal moves through, from first
          contact to closed. This screen is where you shape that path: create one pipeline or
          several, name and reorder the stages, set each stage&apos;s win probability, and add{" "}
          <strong>validation rules</strong> that stop a deal from advancing until it&apos;s
          really ready.
        </p>
        <p>
          Set it up once and every deal board, forecast, and report downstream inherits the same
          structure — so the numbers stay consistent across your team.
        </p>
      </HelpSection>

      <HelpSection title="Pipelines — one path or many">
        <p>
          Each pipeline shows as a tab with its deal count in brackets. A{" "}
          <HelpKey>★</HelpKey> marks the <strong>default</strong> pipeline — the one new deals
          land in unless you say otherwise.
        </p>
        <HelpStep n={1}>
          <p>
            Type a name in the field and press <HelpKey>Add Pipeline</HelpKey>. A new pipeline
            starts pre-filled with the six standard stages (Lead, Qualified, Proposal,
            Negotiation, Won, Lost) so you can start selling immediately and adjust later.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click a tab to switch to it. Use <HelpKey>Set as default</HelpKey> to make it the
            landing pipeline — doing so automatically clears the default flag on the previous one.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Delete</HelpKey> appears only when a pipeline is both non-default and holds{" "}
            <strong>zero deals</strong>. Move or reassign its deals first, and the default
            pipeline can never be deleted.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deleting a pipeline is permanent — there&apos;s no trash. The deal-count guard exists
            precisely so you can&apos;t orphan live opportunities; respect it rather than working
            around it.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Stages — the steps a deal climbs">
        <p>
          Each stage carries a colour, a display name (with its internal code shown in
          parentheses), and a <strong>probability</strong> — the percent chance a deal at that
          stage will close, which feeds weighted forecasting.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Name">Shown on boards and reports; an uppercase code (e.g. PROPOSAL) is derived from it automatically.</HelpDef>
          <HelpDef term="Probability">0–100%. Standard stages run Lead 10 → Qualified 25 → Proposal 50 → Negotiation 75 → Won 100.</HelpDef>
          <HelpDef term="Won / Lost">Flags that mark a closing stage. Each stage is one or the other — never both.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>Add Stage</HelpKey>, set a name, pick a colour from the swatches, and
            choose a probability. New stages are appended to the end of the order.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Open the pencil icon to <HelpKey>Edit Stage</HelpKey> — rename it, recolour it, change
            its probability, or toggle <HelpKey>Won stage</HelpKey> / <HelpKey>Lost stage</HelpKey>{" "}
            (ticking one clears the other). Save to apply.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Reorder with the <HelpKey>↑</HelpKey> / <HelpKey>↓</HelpKey> arrows; the order here is
            the left-to-right order of columns on your deal board. Delete a stage from its edit
            panel.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            A stage with active deals <strong>can&apos;t be deleted</strong> — the system tells you
            how many deals are still in it. Move those deals to another stage first.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Validation rules — gate a stage until a deal is ready">
        <p>
          Expand a stage (click its row) to manage its <strong>validation rules</strong>. A rule
          says &quot;a deal can&apos;t enter this stage unless a condition is met&quot; — for
          example, a value must be filled in or a minimum amount reached.
        </p>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>Add validation rule</HelpKey>, pick the <HelpKey>Field</HelpKey> to
            check (Deal value, Contact person, Company, Notes, Expected close date, Assigned to,
            Tasks, or Activities). The available <HelpKey>Rule type</HelpKey> options change to fit
            the field you chose.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            The rule-type list adapts to the field: <em>Required</em>, minimum / maximum value,
            minimum text length, a future-date check, days-from-today, and task / activity counts.
            Numeric rules ask for a value (e.g. <em>Minimum value 1000</em>). Then write a clear{" "}
            <strong>error message</strong> — this is the exact text the salesperson sees when an
            enforced rule blocks them.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Saved rules list under the stage with a <HelpKey>shield</HelpKey> count badge. Remove
            one with its trash icon. A stage with no rules lets deals transition freely.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Rules are checked when a deal is moved <em>into</em> the gated stage. Today the system
            actively enforces three of them — <em>Required</em>, <em>Minimum value</em> (on Deal
            value), and <em>At least 1 task completed</em>; when one of these fails, the move is
            rejected with a <em>422</em> and your error message is shown, so the deal stays where it
            was. The other rule types can be configured and listed now but aren&apos;t enforced as
            hard gates yet — treat them as documentation of intent until enforcement lands.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="How it all fits together">
        <ol className="list-decimal pl-5 space-y-1">
          <li>You define a <strong>pipeline</strong> and its <strong>stages</strong> here.</li>
          <li>Deals move along those stages on the deal board.</li>
          <li>Each stage&apos;s <strong>probability</strong> weights your forecast automatically.</li>
          <li>A <strong>validation rule</strong> blocks a sloppy move before it happens, keeping your data clean and your forecast honest.</li>
        </ol>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Pipelines, stages, and rules are scoped to your organization — every request is filtered
          by your tenant, so you only ever see and edit your own configuration and never another
          company&apos;s. This screen lives under <strong>Settings</strong>, where shared structure
          like the stages and rules everyone&apos;s deals run against is meant to be managed, not on
          the day-to-day deal board.
        </p>
      </HelpCallout>
    </div>
  )
}
