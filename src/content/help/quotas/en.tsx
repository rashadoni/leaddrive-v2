"use client"

/**
 * Quota Management — help article (English).
 * Source page: src/app/(dashboard)/settings/quotas/page.tsx
 * Split out of the shared "quotas-territories" article — quota management only.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function QuotasHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a sales manager or above"
        goal="Set a sales quota per manager and quarter and track attainment"
      >
        The page lives under <HelpKey>Settings → Quotas</HelpKey>. Only a{" "}
        <strong>manager or above</strong> can add, edit, or delete a quota; lower roles can see the
        table but the create action returns 403. The Actual column is computed automatically — you
        only set the target.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top you'll see the <strong>"Quota Management"</strong> heading and the subtitle
          "Sales quotas by managers and quarters". On the right are three year buttons —{" "}
          <strong>last year, current year, and next year</strong>; the year you pick filters the whole
          page. Below sits the <strong>"Add Quota"</strong> card, and under that the quota table for
          that year.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Manager">The user you set a quota for. Chosen from a dropdown (shows name, or email if no name).</HelpDef>
          <HelpDef term="Quarter">Q1–Q4 — the quarter the quota applies to.</HelpDef>
          <HelpDef term="Quota">The target amount you set (in manat, ₼).</HelpDef>
          <HelpDef term="Actual">The sum of that user's WON deals for that quarter — computed automatically.</HelpDef>
          <HelpDef term="%">Attainment: Actual ÷ Quota, as a percentage. 100%+ green, 70%+ blue, 40%+ amber, below that red.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: pick the year">
        <HelpStep n={1}>
          <p>
            Click one of the year buttons to the right of the heading —{" "}
            <HelpKey>last year</HelpKey>, <HelpKey>current year</HelpKey>, or <HelpKey>next year</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected year button fills with the primary color while the other two stay muted. The
            table reloads with that year's quotas; a brief "Loading..." message shows while data fetches.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add a new quota">
        <HelpStep n={1}>
          <p>
            In the "Add Quota" card, open the <HelpKey>Manager</HelpKey> dropdown and pick a user. It
            reads "Select..." by default.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The dropdown lists your organization's users (by name, or email if no name is set).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            From the <HelpKey>Quarter</HelpKey> dropdown pick one of <HelpKey>Q1</HelpKey>…<HelpKey>Q4</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A narrow dropdown with four options — Q1, Q2, Q3, Q4. Q1 is selected by default.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Type the target number into the <HelpKey>Amount</HelpKey> field. It's a number field (it
            shows 150000 as a placeholder hint).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A numeric input. The "Add" button stays dimmed (disabled) until both a manager and an amount
            are filled in.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Click <HelpKey>Add</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner briefly shows on the button, then the form fields reset (manager and amount clear)
            and the table refreshes with the new row. If you add the same manager + year + quarter again,
            no new row appears — the existing quota is updated instead.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit a quota">
        <HelpStep n={1}>
          <p>
            In the table, click the <HelpKey>Quota</HelpKey> amount of the row you want to change. On
            hover it underlines and shows a "Click to edit" tooltip.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small number input opens in place of the amount and is focused automatically.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the new number, then press <HelpKey>Enter</HelpKey> or click outside the field (blur it).
            To cancel, press <HelpKey>Escape</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Enter or losing focus saves the new amount and the table refreshes — the % column instantly
            recalculates against the new target. Escape closes the editor without changing anything.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: delete a quota">
        <HelpStep n={1}>
          <p>
            Click the <HelpKey>trash</HelpKey> icon at the far right of the row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The row is removed from the table immediately and the table reloads. There is no confirmation
            dialog — one click deletes it, so be careful.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Empty states">
        <p>
          If there are no quotas for the selected year, a centered{" "}
          <strong>"No quotas found for {`{year}`}"</strong> message shows in place of the table. While
          data is still loading you'll see "Loading..." instead. In both cases the "Add Quota" card
          above stays available.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          You don't fill in the <strong>Actual</strong> column by hand — it comes automatically from the
          sum of that user's WON deals in that quarter (the quarter is derived from the date the deal was
          won). You only keep the <strong>target</strong> honest, and the % column shows attainment for you.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Delete has no confirmation prompt. The trash icon removes the quota instantly. If you delete one
          by accident, you can recreate it with "Add Quota" — Actual will recompute from the deals anyway.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Creating, editing, and deleting quotas is restricted to <strong>manager or above</strong>; lower
          roles get a 403 (forbidden) on those actions. All quotas are scoped to your organization — you
          only see your own tenant's users and deals.
        </p>
      </HelpCallout>
    </div>
  )
}
