"use client"

/**
 * KPI Arena Configuration — help article (English).
 * Covers Settings → Leaderboard (KPI Arena Configuration): MTM composite
 * weights (task/photo/route sliders), status thresholds (4 number fields +
 * live preview), Save / Reset to defaults. The Arena board itself (the bubble
 * leaderboard) is NOT covered here — this article is the admin config screen only.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function settingsleaderboardHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an organization administrator or operations lead"
        goal="Tune how the KPI Arena boards score agents — set the field (MTM) composite weights and the attainment % at which status colours change"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>KPI Arena Configuration</HelpKey>.
        Every change applies only to your organization. This is not the Arena board <em>itself</em> —
        here you set the rules, and the boards colour the bubbles using those rules. After you save,
        changes apply to the MTM, support, projects and tasks boards <strong>immediately</strong> (the
        sales board uses its own quota pacing and is unaffected by these weights).
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a trophy icon, the <HelpKey>KPI Arena Configuration</HelpKey> title and a
          short description. Below it come two cards: <strong>MTM composite weights</strong> first,{" "}
          <strong>Status thresholds</strong> second (with a live preview inside it). At the very bottom
          is the <HelpKey>Save</HelpKey> button; if you've already customized something, a{" "}
          <HelpKey>Reset to defaults</HelpKey> button sits next to it, otherwise the text "Using
          built-in defaults" shows instead. A brief loading spinner may appear while the page opens.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="MTM composite weights">
            The three factors a field agent's KPI % is built from:{" "}
            <strong>Task completion</strong>, <strong>Photo approval</strong> and{" "}
            <strong>Route completion</strong>. Each is set with a 0–1 slider, and the system
            auto-normalizes them to 100% — so the relative balance is what matters, not the absolute
            numbers.
          </HelpDef>
          <HelpDef term="Status thresholds">
            The minimum KPI % for each status. There are five statuses:{" "}
            <strong>Exceeding</strong>, <strong>On track</strong>, <strong>Behind</strong>,{" "}
            <strong>At risk</strong>, and the lowest one, <strong>Critical</strong> (which has no
            field of its own — anyone below all the others falls into it).
          </HelpDef>
          <HelpDef term="Live preview">
            Inside the Status thresholds card, a row of sample bubbles (130%, 100%, 80%, 60%, 40%,
            15%) — as you change the numbers, their colour and status label update instantly, so you
            see how the board will look before saving.
          </HelpDef>
          <HelpDef term="Defaults">
            The built-in values used if you change nothing: weights{" "}
            <strong>0.50 / 0.30 / 0.20</strong> (task / photo / route) and thresholds{" "}
            <strong>110 / 90 / 70 / 50</strong>.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: tune the MTM weights">
        <HelpStep n={1}>
          <p>
            Find the first card (<HelpKey>MTM composite weights</HelpKey>). It has three sliders:{" "}
            <strong>Task completion</strong>, <strong>Photo approval</strong> and{" "}
            <strong>Route completion</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            To the right of each slider are two numbers: the current weight (e.g. <HelpKey>0.50</HelpKey>)
            and its share of the total (e.g. <HelpKey>50%</HelpKey>). A short line at the top of the
            card explains how much these factors count toward the KPI %.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Drag any slider left or right. Each step is <strong>0.05</strong>, the minimum is{" "}
            <strong>0</strong> and the maximum is <strong>1</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you drag, the number beside it changes and the neighbouring sliders' <strong>%</strong>{" "}
            values recompute too (because the percentages are always shown as a share of the total).
            The "Current sum: …" line under the card reflects the slider total.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Set the balance however you like — for example, if you weigh photos as more important than
            routes, push <strong>Photo approval</strong> up and <strong>Route completion</strong> down.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If you drop all three sliders to <strong>0</strong>, the sum becomes 0 and the{" "}
            <HelpKey>Save</HelpKey> button below goes disabled — at least one factor must carry weight.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set the status thresholds and preview">
        <HelpStep n={1}>
          <p>
            The second card (<HelpKey>Status thresholds</HelpKey>) has four number fields — one per
            status: <strong>Exceeding</strong>, <strong>On track</strong>, <strong>Behind</strong>,{" "}
            <strong>At risk</strong>. Each field has the status's coloured dot on the left and a{" "}
            <strong>%</strong> sign on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each field accepts numbers only (0–200). For example, set <strong>On track</strong> to 90
            and agents whose KPI is at least 90% (but below the "Exceeding" threshold) count as "On
            track".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Keep the numbers in <strong>descending</strong> order: Exceeding ≥ On track ≥ Behind ≥ At
            risk.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the order breaks (e.g. "Behind" is greater than "On track"), a red warning appears
            under the fields: "Thresholds must descend: Exceeding ≥ On track ≥ Behind ≥ At risk." and
            the <HelpKey>Save</HelpKey> button stays disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <strong>Live preview</strong> row at the bottom of the card — it shows a few
            sample bubbles (130%, 100%, 80%, 60%, 40%, 15%).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each sample bubble shows its percentage inside and, underneath, the status label it earns
            under the current thresholds (e.g. "Exceeding", "On track"). As you change the numbers
            these bubbles re-colour (red → amber → green) and re-label instantly — this is exactly how
            the board will look after you save.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: save or reset to defaults">
        <HelpStep n={1}>
          <p>
            When everything looks right, click the <HelpKey>Save</HelpKey> button at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly shows a spinning icon, then a "Configuration saved" toast appears.
            After that, a <HelpKey>Reset to defaults</HelpKey> button shows up next to it — that's the
            sign the configuration is now customized.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To go back to the built-in values, click <HelpKey>Reset to defaults</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Reset to defaults" toast appears, the sliders and thresholds return to the standard
            values (0.50 / 0.30 / 0.20 and 110 / 90 / 70 / 50), the <HelpKey>Reset to defaults</HelpKey>{" "}
            button disappears and the "Using built-in defaults" text shows again.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <HelpKey>Reset to defaults</HelpKey> wipes all of your organization's custom weight and
            threshold settings and restores the built-in standards. It takes effect immediately — if
            you only want to tweak one factor temporarily, just change the slider/number and save
            again instead of resetting.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The weights are <strong>auto-normalized</strong>, so don't agonize over getting the absolute
          numbers "right" — the ratio is what matters. For example, 0.5 / 0.3 / 0.2 gives the same
          result as 5 / 3 / 2. Just think about how many times more important one factor is than
          another.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          This configuration is org-wide and requires the <HelpKey>settings:write</HelpKey> permission
          — an ordinary agent can't change it. Changes affect only your tenant's boards; other
          organizations don't see them. Note: the weights also tune the status colours on the support,
          projects and tasks boards, not just MTM; the sales board runs on its own quota pacing.
        </p>
      </HelpCallout>
    </div>
  )
}
