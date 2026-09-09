"use client"

/**
 * Da Vinci Lead Scoring (AI scoring) — help article (English).
 * Rewritten into the video-script format. Covers the /ai-scoring page only:
 * scoring leads with Da Vinci (score, grade, conversion probability, reasoning),
 * the result table, sorting, "Score All Leads" and per-row "Recalculate".
 * Facts cross-checked against src/app/(dashboard)/ai-scoring/page.tsx and
 * src/app/api/v1/lead-scoring/route.ts (getGrade thresholds, rule-based factor
 * weights, conversionProb = score * 0.85, PiiMasker mask/unmask).
 * Agent configuration is NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AiScoringHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager or team lead"
        goal="Rank your leads by quality automatically — let Da Vinci compute which ones are likeliest to convert so you work the hottest leads first"
      >
        The page opens under the <HelpKey>Da Vinci Command Center</HelpKey> heading. All leads and
        their scores belong to your organization only. Scoring is not automatic — you press the
        button; results are stored on each lead, so the page opens already sorted by score and the
        cards and rows refresh the moment a run finishes.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top is a header card with a brain icon: on the left the{" "}
          <HelpKey>Da Vinci Command Center</HelpKey> title with the subtitle &ldquo;Da Vinci powered
          lead scoring: automatic evaluation of lead quality and conversion probability,&rdquo; and on
          the right the <HelpKey>Score All Leads</HelpKey> button. That same description is repeated
          once more in a separate description strip below the header.
        </p>
        <p>
          Next come five <strong>grade cards</strong> in a row — <strong>A</strong>, <strong>B</strong>,{" "}
          <strong>C</strong>, <strong>D</strong>, <strong>F</strong> — each showing the big letter, the
          count of leads in that grade, and the word &ldquo;Leads.&rdquo; Below them is a summary bar:{" "}
          <strong>Avg score</strong>, <strong>Probability</strong>, and <strong>Total Sessions</strong>.
          At the bottom sits the <strong>Leads</strong> table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Score">An integer 0–100 — the lead&apos;s quality rating. Shown in bold in the &ldquo;Score&rdquo; column.</HelpDef>
          <HelpDef term="Grade (A–F)">The letter equivalent of the score by fixed thresholds: A = 80–100, B = 60–79, C = 40–59, D = 20–39, F = under 20. Shown as a colored pill (A green, B blue, C yellow, D orange, F red).</HelpDef>
          <HelpDef term="Conversion">The lead&apos;s probability of converting to a sale (%). Green at 50%+, amber at 30–49%, red below.</HelpDef>
          <HelpDef term="Performance Stats">Da Vinci&apos;s short reasoning for the score — the strengths that lifted it and the gaps that held it back. Has a purple sparkle icon next to it; shows &ldquo;—&rdquo; if there&apos;s no reasoning.</HelpDef>
          <HelpDef term="Avg score">The average score across all leads, out of 100. 0 if there are no leads.</HelpDef>
          <HelpDef term="Probability">The average conversion probability across all leads (%).</HelpDef>
          <HelpDef term="Total Sessions">The number of leads that have actually been scored at least once.</HelpDef>
          <HelpDef term="Da Vinci badge">A sparkle-icon &ldquo;Da Vinci&rdquo; badge under the subtitle — appears only when the last run used a real AI key; otherwise a transparent rule-based formula runs.</HelpDef>
        </dl>
        <p>
          The table columns are: <strong>Score</strong> (grade pill), <strong>Score</strong> (number),{" "}
          <strong>Lead</strong> (contact name), <strong>Company</strong>, <strong>Source</strong>,{" "}
          <strong>Conversion</strong>, <strong>Performance Stats</strong>, and <strong>Actions</strong>.
          Each row ends with a refresh-icon <HelpKey>Recalculate</HelpKey> button. If there are no leads
          yet, the table shows &ldquo;No leads yet. Create the first one!&rdquo; instead.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: score all leads">
        <HelpStep n={1}>
          <p>
            Press the <HelpKey>Score All Leads</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The brain icon inside the button turns into a spinning circle and the label becomes{" "}
            <strong>Loading...</strong>; the button stays disabled until the run finishes.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Wait for the run to finish — every lead in your organization is scored in one pass.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When it&apos;s done, the table fills with updated score, grade, conversion, and{" "}
            <strong>Performance Stats</strong> reasoning. The counts on the five grade cards and the{" "}
            <strong>Avg score</strong> / <strong>Probability</strong> / <strong>Total Sessions</strong>{" "}
            values in the bar below reflect the new results.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Check whether the <HelpKey>Da Vinci</HelpKey> badge appeared under the subtitle.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the badge is there, scores were computed by the real Da Vinci AI — the model weighs
            contact completeness, source quality, engagement, deal potential, and recency. If it&apos;s
            absent, no AI key was available and the system fell back to the rule-based formula — you
            still get scores, just with simpler reasoning.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: recalculate a single lead">
        <HelpStep n={1}>
          <p>
            Find the lead&apos;s row in the table and press the <HelpKey>Recalculate</HelpKey> button at
            the end of it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Only the icon on that button turns into a spinner and the button is disabled; the rest of
            the table&apos;s rows stay untouched.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Wait for the recompute to finish.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            That row&apos;s <strong>Score</strong>, grade pill, <strong>Conversion</strong> percent, and{" "}
            <strong>Performance Stats</strong> reasoning update. The change can also affect the averages
            in the summary bar.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: sort the leads">
        <HelpStep n={1}>
          <p>
            Click the header of the column you want to sort by:{" "}
            <strong>Score</strong> (grade), <strong>Score</strong> (number), <strong>Lead</strong>,{" "}
            <strong>Company</strong>, <strong>Source</strong>, or <strong>Conversion</strong>. (By
            default the table is sorted by score, highest first.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An up or down arrow icon lights up on the active column&apos;s header and the rows reorder by
            that column. <strong>Performance Stats</strong> and <strong>Actions</strong> aren&apos;t
            sortable — they have no arrow icon.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the same header again to flip the direction (descending ↔ ascending).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The arrow on the header flips from down to up (and back) and the row order instantly
            reverses.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Your workflow: first run <HelpKey>Score All Leads</HelpKey> to score everyone, then sort the{" "}
          <strong>Score</strong> column highest-first and start with the top <strong>A</strong> /{" "}
          <strong>B</strong> leads. After you add a lead&apos;s email, phone, or notes, just hit{" "}
          <HelpKey>Recalculate</HelpKey> on its row to refresh that score — no need to re-score the whole
          list. A &ldquo;—&rdquo; in the table simply means that field is empty; filling it in usually
          raises the next score.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          If the <strong>Da Vinci</strong> badge is absent, scores were computed by the rule-based
          fallback — that&apos;s still reliable and built from transparent weights: email (+15), phone
          (+10), company (+10), source (referral +20 / website +15 / email +10 / any other +5), priority
          (high +15 / medium +10 / otherwise +5), status (converted +20 / qualified +15 / contacted
          +10), estimated value (+10), and notes over 10 chars (+5); the total is capped at 100, and
          conversion is derived from the score (about 85% of it). The only difference is that the{" "}
          <strong>Performance Stats</strong> reasoning is shorter.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          You only ever see and score your own organization&apos;s leads — another tenant&apos;s leads
          never appear in this list. Before any lead is sent to Da Vinci, personal data such as email
          addresses and phone numbers is <strong>masked</strong>, and the original values are restored
          only in the result shown back to you.
        </p>
      </HelpCallout>
    </div>
  )
}
