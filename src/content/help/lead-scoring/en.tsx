"use client"

/**
 * Lead Scoring (Da Vinci lead scoring) — help article (English).
 * Covers only the /lead-scoring page: the "Score All Leads" button, four stat
 * cards, the A–F grade distribution, the results table (eight columns, per-row
 * rescore) and the lead detail modal opened by clicking a row (six tabs:
 * Details / Activity / Sentiment / Tasks / Da Vinci Text / Da Vinci Scoring).
 * Creating/managing the leads themselves is NOT in scope.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LeadscoringHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager or rep"
        goal="Have Da Vinci score your leads so you know which ones to work first — and act on the hottest ones right away"
      >
        This page is a visual dashboard that ranks your leads by <strong>score (0–100)</strong> and{" "}
        <strong>grade (A–F)</strong>. You don't create leads here — existing leads load
        automatically; you just score them, dig into each one, and act when needed. All leads and
        scores are scoped to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Da Vinci Command Center</HelpKey> with a one-line
          description below it, and the main action button on the top right —{" "}
          <HelpKey>Score All Leads</HelpKey>. Below it comes the page description, then four stat
          cards, then five grade cards (A–F), and at the bottom a results table titled{" "}
          <strong>Performance Stats</strong>. If there are no leads yet, an empty state shows in
          place of the table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Avg score">Average score of the scored leads (those with a score above 0), out of 100.</HelpDef>
          <HelpDef term="Probability">Average conversion probability of those leads (as a percentage).</HelpDef>
          <HelpDef term="Total Sessions">A ratio shown as "leads scored / total leads" (e.g. 12 / 40).</HelpDef>
          <HelpDef term="Active">Whether the last scoring run used real Da Vinci (Yes) or simple rules (No).</HelpDef>
          <HelpDef term="Grade (A–F)">A label by score range: A Hot (80–100), B Warm (60–79), C Neutral (40–59), D Cold (20–39), F Dead (0–19). Each grade card shows the count of leads in that range.</HelpDef>
          <HelpDef term="Score">The lead's 0–100 scoring value; the table is sorted by it, highest first.</HelpDef>
          <HelpDef term="Conversion">The lead's probability of converting into a deal (as a percentage).</HelpDef>
        </dl>
        <p>
          The results table has eight columns: <strong>Score</strong> (the grade badge),{" "}
          <strong>Score</strong> (the number), <strong>Name</strong> (with email beneath),{" "}
          <strong>Company</strong>, <strong>Source</strong>, <strong>Conversion</strong> (percent),{" "}
          <strong>Performance Stats</strong> (Da Vinci's short reasoning, truncated to two lines) and{" "}
          <strong>Actions</strong>. Rows are sorted from the highest score down. Each row ends with a{" "}
          <HelpKey>Refresh</HelpKey> button; clicking the row itself opens the lead detail modal.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: score all leads at once">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Score All Leads</HelpKey> in the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A spinner appears on the button and its label changes to <HelpKey>Loading...</HelpKey>;
            the button stays disabled until the run finishes. With many leads this can take a few
            seconds.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Wait for scoring to finish — no extra confirmation is required.</p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads with fresh scores and re-sorts highest first. The{" "}
            <strong>Avg score</strong>, <strong>Probability</strong> and{" "}
            <strong>Total Sessions</strong> cards, plus the counts on the five grade cards, all
            update. The <strong>Active</strong> card shows <HelpKey>Yes</HelpKey> if real Da Vinci
            ran, or <HelpKey>No</HelpKey> if it fell back to simple rules.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: rescore a single lead">
        <HelpStep n={1}>
          <p>
            Find that lead's row in the table and click the <HelpKey>Refresh</HelpKey> button in the{" "}
            <strong>Actions</strong> column on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Only that button's icon starts spinning and the button is temporarily disabled; the rest
            of the table stays put. (Clicking this button does NOT open the row — the click only
            affects the button.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Wait for the recalculation to finish.</p>
          <HelpCallout kind="see" label="What you'll see">
            The lead's score, grade badge, conversion percent and the reasoning in the{" "}
            <strong>Performance Stats</strong> column refresh. If the score changed, the row slides
            to its new position in the table.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: investigate a lead and take action">
        <HelpStep n={1}>
          <p>Click anywhere on a lead row in the table (outside the Refresh button).</p>
          <HelpCallout kind="see" label="What you'll see">
            The lead detail modal opens. The top shows the grade circle (A–F), the lead's name,
            company, status and priority badges, email and phone links if present, and on the right{" "}
            <strong>Score</strong>, <strong>Conversion</strong> and (if set) the estimated value.
            Below are six tabs: <HelpKey>Details</HelpKey>, <HelpKey>Activity</HelpKey>,{" "}
            <HelpKey>Sentiment</HelpKey>, <HelpKey>Tasks</HelpKey>, <HelpKey>Da Vinci Text</HelpKey>{" "}
            and <HelpKey>Da Vinci Scoring</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On the <HelpKey>Details</HelpKey> tab, change status and priority directly with the
            buttons, update contact info via <HelpKey>Edit</HelpKey>, or pick one of the actions at
            the bottom: <HelpKey>Convert to deal</HelpKey> (when available), <HelpKey>Lost</HelpKey>{" "}
            or <HelpKey>Delete</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Clicking a status/priority button saves the choice immediately and the badge updates.{" "}
            <HelpKey>Lost</HelpKey> and <HelpKey>Delete</HelpKey> first show a confirmation prompt.
            The <strong>Da Vinci Score</strong> bar below shows the current score and the date it was
            last scored.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To see Da Vinci's reasoning and factors, switch to the <HelpKey>Da Vinci Scoring</HelpKey>{" "}
            tab. You can also refresh the score from here with{" "}
            <HelpKey>Recalculate with Da Vinci</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three cards appear — <strong>Grade</strong>, <strong>Score</strong>,{" "}
            <strong>Conversion</strong> — plus Da Vinci's written reasoning if present. When scoring
            factors exist, each is listed with a name and a progress bar. If the lead hasn't been
            scored yet, a "Not yet scored by Da Vinci" message shows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optional: on the <HelpKey>Da Vinci Text</HelpKey> tab generate an email/SMS tailored to
            the lead (choose type, tone and extra instructions); on <HelpKey>Sentiment</HelpKey> run
            a sentiment analysis; on <HelpKey>Tasks</HelpKey> generate next-step tasks; or on{" "}
            <HelpKey>Activity</HelpKey> log a call/note/meeting.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each tab shows its own generate/analyze button; clicking it changes the label to
            "Generating…" or "Analyzing…", then the result opens inside the modal. Once text is
            generated you can copy it, send it via <strong>Send email</strong> (if the lead has an
            email) or regenerate it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The workflow is simple: first refresh everything with <HelpKey>Score All Leads</HelpKey>,
          then work from the top of the table — the A and B graded, highest-scoring leads first. The
          short reasoning in the <strong>Performance Stats</strong> column tells you at a glance why
          each lead got its score; click the row for a deeper look.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          If the <strong>Active</strong> card shows <HelpKey>No</HelpKey>, the last run used simple
          rules instead of real Da Vinci (e.g. when the Da Vinci key/config isn't reachable). Scores
          still work, but the written reasoning may be simpler — rescore if in doubt. The{" "}
          <HelpKey>Delete</HelpKey> action in the lead modal removes the lead entirely and can't be
          undone; if you just want it out of the way, set its status to <HelpKey>Lost</HelpKey> instead.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All leads, scores and analyses are scoped to your organization — you only see and score
          your own tenant's leads. Sending a generated email goes through your organization's email
          channel.
        </p>
      </HelpCallout>
    </div>
  )
}
