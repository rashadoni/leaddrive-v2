"use client"

/**
 * Marketing Attribution — models page help article (English).
 * Covers ONLY the Attribution → Models page: create models
 * (first-touch / last-touch / linear / time-decay / U-shaped / custom curve),
 * edit, set default, activate, archive, delete, recompute, per-campaign
 * breakdown and latest-run status. Other attribution/campaign pages are NOT here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AttributionmodelsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a marketing admin or sales-operations lead"
        goal="Define how a won deal's revenue is split across the campaigns that contributed to it, and see each campaign's credit toward real revenue"
      >
        You reach this page via <HelpKey>Attribution</HelpKey> → <HelpKey>Models</HelpKey>. Every model,
        computation, and revenue figure here belongs to your organization only. The model list loads once
        when the page opens; after any change (create, edit, status) or when you press the refresh button in
        the top-right, the stat cards at the top update immediately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Marketing Attribution</HelpKey> title with a chart icon and the line
          «Multi-touch attribution models split a deal's revenue across the campaigns that contributed to it»
          beneath it. Two buttons sit in the top-right: <HelpKey>New model</HelpKey> (blue, plus icon) and a
          refresh button (circular arrow). Below them are three stat cards: <strong>Total models</strong>,{" "}
          <strong>Active</strong>, and <strong>Captured touchpoints</strong>. Further down, model cards lay
          out in a two-column grid — if there are no models yet, an empty state is shown instead.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Attribution model">A rule that defines how a deal's revenue is divided among the touchpoints (campaigns) on its path — with a name, type, status, and configuration.</HelpDef>
          <HelpDef term="Touchpoint">A marketing interaction — email open, ad click, page view, form submit, event attendance. Models split revenue across exactly these points.</HelpDef>
          <HelpDef term="Total models">The count of all models you've created (active, draft, and archived together).</HelpDef>
          <HelpDef term="Active">The count of models currently in the active state.</HelpDef>
          <HelpDef term="Captured touchpoints">The total number of marketing touchpoints the system has recorded — the raw material models distribute.</HelpDef>
          <HelpDef term="Default model">The model that automatically recalculates campaign credit every time a deal advances. Only one model can be default at a time; its card carries a starred «Default» badge.</HelpDef>
          <HelpDef term="Influences">The count of «this campaign contributed this much to this deal» records the model wrote.</HelpDef>
          <HelpDef term="Attributed revenue">The total revenue from won deals distributed to campaigns under this model.</HelpDef>
        </dl>
        <p>
          Each model card shows the name, a default badge if applicable, a status badge on the right
          (<strong>Active</strong> green, <strong>Draft</strong> amber, <strong>Archived</strong> grey),
          the model-type label with a short description, a config summary (e.g. «First 40% / Middle 20% /
          Last 40%»), and the <strong>Influences</strong> and <strong>Attributed revenue</strong> figures.
          When there are influences, a <HelpKey>Breakdown by campaign</HelpKey> toggle and, at the bottom, a{" "}
          <strong>Latest run</strong> status appear. Along the bottom of the card are the action buttons:{" "}
          <HelpKey>Edit</HelpKey>, <HelpKey>Recompute</HelpKey>, <HelpKey>Set as default</HelpKey>,{" "}
          <HelpKey>Activate</HelpKey> (drafts only), <HelpKey>Archive</HelpKey>, and a red{" "}
          <HelpKey>Delete</HelpKey> on the far right.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new model">
        <HelpStep n={1}>
          <p>
            Press the <HelpKey>New model</HelpKey> button in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Create model» form card opens at the top. It has <strong>Name</strong> and{" "}
            <strong>Description</strong> fields, a <strong>Model type</strong> dropdown, and an{" "}
            <strong>Activate immediately</strong> checkbox below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Name</strong> — this is required (e.g. «First-touch (primary)»). Optionally add a
            one-line <strong>Description</strong> (how and when this model is used).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the fields. If you try to save with an empty name, a red «Name is required»
            warning shows at the top.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick a <strong>Model type</strong>: <HelpKey>First-touch</HelpKey>, <HelpKey>Last-touch</HelpKey>,{" "}
            <HelpKey>Linear</HelpKey>, <HelpKey>Time-decay</HelpKey>, <HelpKey>U-shaped</HelpKey>, or{" "}
            <HelpKey>Custom</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A short description of the chosen type appears under the dropdown (e.g. «Full credit to the first
            touchpoint»). Depending on the choice, extra configuration fields appear below (see the steps
            that follow). Note: the model type cannot be changed once the model is created.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            If you picked <strong>Time-decay</strong>, fill in the <strong>Half-life (days)</strong> field.
            First-touch, last-touch, and linear models need no extra config — you can skip this step.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A single number field with the hint «7 = a touch 7 days before the deal closes is worth half of
            one at close». A non-positive value triggers a «Half-life must be a positive number of days»
            error on save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            If you picked <strong>U-shaped</strong>, fill in the three weights: <strong>First-touch
            weight</strong>, <strong>Middle weight</strong>, and <strong>Last-touch weight</strong> (e.g.
            0.4 / 0.2 / 0.4).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three fields side by side with the hint «The three weights must add up to 1.0». If the sum isn't
            1.0 you get «The three weights must add up to 1.0»; if a weight is outside 0–1 you get «Each
            weight must be between 0 and 1».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            If you picked <strong>Custom</strong>, build your own curve: press one of the{" "}
            <HelpKey>Common shapes</HelpKey> buttons (Equal, Start-heavy, End-heavy, U-shaped, W-shaped), or
            edit the points by hand — each row has a <strong>Position (0–1)</strong> and a{" "}
            <strong>Weight</strong>. Use <HelpKey>Add point</HelpKey> to add rows and the × on the right to
            remove them (at least 2 points must remain).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A live graph of the curve is drawn above the points, with a «First touch … Conversion» axis below
            — the graph updates the moment a weight changes. The hint explains that weights are relative and
            normalized automatically. Fewer than 2 points gives «Add at least 2 curve points»; a position
            outside 0–1 or a non-positive weight shows the matching error.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Optionally tick <HelpKey>Activate immediately</HelpKey>, then press <HelpKey>Save</HelpKey> at the
            bottom. (Changed your mind? Close with <HelpKey>Cancel</HelpKey> or the × in the top-right.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Save button shows a spinner, then the form closes and the new model appears in the list. If{" "}
            <strong>Activate immediately</strong> was unchecked, the card carries an amber{" "}
            <strong>Draft</strong> badge; if checked, it's a green <strong>Active</strong> and the{" "}
            <strong>Active</strong> stat card goes up by one. The <strong>Total models</strong> card goes up
            too.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: compute influences and read the result">
        <HelpStep n={1}>
          <p>
            On a non-archived model card, press <HelpKey>Recompute</HelpKey> (calculator icon, blue). This
            runs the model over your won deals.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While it runs, the other buttons are temporarily disabled. When it finishes, the{" "}
            <strong>Latest run</strong> section at the bottom of the card shows the status: green «Succeeded»,
            red «Failed», or amber «Pending/Running», alongside the source (Manual) and how long ago it ran.
            Below it, the lines «Deals: X / Y processed» and «Influences written: N» appear. The{" "}
            <strong>Influences</strong> and <strong>Attributed revenue</strong> figures refresh.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Once there are influences, press the <HelpKey>Breakdown by campaign</HelpKey> toggle on the card
            to expand it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A three-column table opens: <strong>Campaign</strong>, <strong>Deals</strong>, and{" "}
            <strong>Revenue</strong>. Each row shows how many deals a campaign influenced and the revenue
            credited to it. If there's no breakdown yet, «No per-campaign attribution yet» is shown. Pressing
            again collapses the section.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit, set default, activate, archive, or delete a model">
        <HelpStep n={1}>
          <p>
            To change the name, description, or configuration, press <HelpKey>Edit</HelpKey> (pencil icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Edit model» form opens, pre-filled with the current values. The model type is shown here as a
            read-only field — it can't be changed. Make your edits and confirm with <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To make a model the primary, auto-recalculating one, press <HelpKey>Set as default</HelpKey>
            (star icon). This button only appears on models that aren't already default and aren't archived.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A starred <strong>Default</strong> badge appears at the top of the card and the card border is
            highlighted; the badge is removed from the previous default model (only one can be default at a
            time).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To make a draft ready for use, press <HelpKey>Activate</HelpKey> (power icon, green). This button
            only appears on models in the <strong>Draft</strong> state.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge switches from amber <strong>Draft</strong> to green <strong>Active</strong>, the{" "}
            <strong>Active</strong> stat card goes up by one, and the <HelpKey>Activate</HelpKey> button
            disappears from the card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To retire a model but keep its history, press <HelpKey>Archive</HelpKey> (archive icon).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An «Archive model ‹name›? It will no longer be recalculated» confirmation appears. After you
            confirm, the badge turns grey <strong>Archived</strong> and the <HelpKey>Recompute</HelpKey>,{" "}
            <HelpKey>Set as default</HelpKey>, and <HelpKey>Archive</HelpKey> buttons disappear from the card.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            To remove a model entirely, press the red <HelpKey>Delete</HelpKey> (trash icon) on the far right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A «Delete model ‹name›? Its influences and run history will be removed» confirmation appears.
            After you confirm, the model drops out of the list and the stat cards update.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If recompute runs but you see «Recompute ran, but nothing was attributed»: either there are no
          closed-won deals (close deals in a Won stage), or the won deals have no contact/company set or no
          touchpoints are being recorded. The card spells out which cause applies and exactly what to check.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Deleting is irreversible and also removes the model's influences and run history. If you only want
          to retire a model but keep its results, choose <HelpKey>Archive</HelpKey> instead of deleting. Also
          note the model type cannot be changed after creation — if you need different logic, create a new
          model.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All models, computations, and revenue figures are scoped to your organization — you don't see other
          organizations' models, and recompute runs only over your tenant's deals and touchpoints. Creating
          and editing models typically requires marketing/admin permission.
        </p>
      </HelpCallout>
    </div>
  )
}
