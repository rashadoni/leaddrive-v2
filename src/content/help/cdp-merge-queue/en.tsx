"use client"

/**
 * CDP — Identity Merge Queue help article (English).
 * Split out of the old shared "cdp" article: covers ONLY the
 * CDP → Identity Merge Queue page (likely-duplicate candidate pairs,
 * match score and its breakdown, side-by-side profile comparison,
 * Merge / Reject decision). Other CDP pages are NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function cdpmergequeueHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a data administrator or operations specialist responsible for the CRM/CDP"
        goal="Review the profile pairs the system thinks are likely duplicates and decide, pair by pair, whether to merge or reject"
      >
        This page shows profile pairs that look alike, detected automatically. Nothing merges on its
        own here — every pair waits for your approval. A daily scan flags likely duplicates by similar
        email, phone, or name; you confirm which two profiles are actually the same person. All profiles
        and candidates belong only to your organization.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a two-arrow icon next to <HelpKey>Identity Merge Queue</HelpKey>, with the
          line «Likely-duplicate profile pairs, detected automatically…» below it. Under that sit four
          stat cards: <strong>Pending review</strong>, <strong>Total flagged</strong>,{" "}
          <strong>Manually merged</strong>, and <strong>Rejected</strong>. Below them is the list of
          candidate pairs — if there are none, an empty state with a green check icon is shown instead.
          At the bottom of the page are two small notes about thresholds and the «daily rescan».
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Profile (CDP profile)">A unified view of one customer pulled together from multiple channels — name, email, phone, spend, and order history.</HelpDef>
          <HelpDef term="Candidate (pair)">Two profiles the system flagged as «maybe the same person». Each candidate becomes one card and waits for your decision.</HelpDef>
          <HelpDef term="Match score">An overall similarity figure from 0–100%, shown as the big number on the left of the card. Computed from email, phone, and name similarity.</HelpDef>
          <HelpDef term="High confidence / Manual review / Weak match">A colored tier badge for the score level: high is green, mid amber, low gray.</HelpDef>
          <HelpDef term="Breakdown (Email / Phone / Name)">Shows which part of the score came from where, as separate percentages; «—» when there's no data for that field.</HelpDef>
          <HelpDef term="Primary (winner)">The profile that is kept in the merge — shown on the left.</HelpDef>
          <HelpDef term="Secondary (merged in)">The profile that is folded into the primary — shown on the right.</HelpDef>
        </dl>
        <p>
          Read each stat card like this: <strong>Pending review</strong> — pairs still waiting for your
          decision (highlighted amber when above 0); <strong>Total flagged</strong> — every pair flagged
          so far; <strong>Manually merged</strong> — pairs you merged by hand; <strong>Rejected</strong>{" "}
          — pairs you rejected.
        </p>
        <p>
          Each candidate card shows the big <strong>match score</strong> on the left, a colored{" "}
          <strong>tier badge</strong> next to it with a «flagged …» line (and a reason if there is one),
          and the <strong>Email / Phone / Name</strong> breakdown at the top right. Below it sit two
          profile cards side by side with a two-arrow icon between them: <strong>Primary (winner)</strong>{" "}
          on the left, <strong>Secondary (merged in)</strong> on the right. Each profile card shows the
          name, email, phone, the last 8 characters of the ID, the <strong>Spent</strong> and{" "}
          <strong>Orders</strong> figures, the last-seen date, and the active-channel count. At the
          bottom right of the card are two buttons: <HelpKey>Reject</HelpKey> and{" "}
          <HelpKey>Merge</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: review a candidate pair">
        <HelpStep n={1}>
          <p>
            Glance at the stat cards at the top and note how many pairs are in{" "}
            <strong>Pending review</strong>. Then look at the first candidate card in the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When <strong>Pending review</strong> is above zero, the number is highlighted amber. Each
            candidate is shown as its own card; if the queue is clear, you'll see the empty state «No
            pending merge candidates — queue is clear.» with a green check icon instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the big percentage on the left — the <strong>match score</strong> — and the colored
            tier badge beside it: <HelpKey>High confidence</HelpKey>, <HelpKey>Manual review</HelpKey>,
            or <HelpKey>Weak match</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the badge is a «flagged &lt;when&gt;» line (e.g. «today», «3 days ago»); if a reason
            was stored for the score, it's appended after a dot.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Check the breakdown at the top right: <strong>Email</strong>, <strong>Phone</strong>, and{" "}
            <strong>Name</strong> similarity are each shown as a separate percentage.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            All three values appear as percentages (e.g. «Email 96%»), or as «—» when there's no
            matching data. This helps you understand which field the overall score mostly came from.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Compare the two profile cards side by side: <strong>Primary (winner)</strong> on the left,{" "}
            <strong>Secondary (merged in)</strong> on the right. Pay attention to name, email, phone,
            spend, order count, and the last-seen date.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows the name, email (envelope icon) and phone (phone icon) if present, the last
            8 characters of the ID at the top right, the <strong>Spent</strong> and{" "}
            <strong>Orders</strong> figures, and below them the last-seen and active-channel count. If
            one profile was deleted before review, «Profile missing (deleted before review)» appears in
            its place. A profile with no name is shown as «No name».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: merge or reject a pair">
        <HelpStep n={1}>
          <p>
            Once you're sure the two profiles are really the same person, press the{" "}
            <HelpKey>Merge</HelpKey> button at the bottom right of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button briefly turns into a spinning icon (resolving), then the card leaves the list.{" "}
            <strong>Pending review</strong> drops by one and <strong>Manually merged</strong> goes up by
            one.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If you think the two profiles are different people, press <HelpKey>Reject</HelpKey> instead.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card leaves the list; <strong>Pending review</strong> drops by one and{" "}
            <strong>Rejected</strong> goes up by one. The profiles stay untouched — nothing is merged.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Move on to the next candidate card and repeat until there are no pairs left to decide.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After you've resolved every pair, the list switches to the empty state «No pending merge
            candidates — queue is clear.» with a green check icon. A short line explaining the
            thresholds appears under it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          When a decision is hard, lean on the <strong>Spent</strong>, <strong>Orders</strong>, and{" "}
          <strong>last-seen</strong> figures on the profile cards: the profile with real history is
          usually the one worth keeping as the «winner». A high <strong>Email</strong> or{" "}
          <strong>Phone</strong> breakdown is usually a strong signal; similarity on <strong>Name</strong>{" "}
          alone can be coincidental — look at those pairs more carefully.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          If you see an amber banner at the top, the queue is truncated — only the first few hundred
          candidates by score are shown. That means: review the highest-scoring (most similar) pairs
          first; as you resolve them, the rest will appear. Per the note at the bottom, scores below the
          manual threshold are not shown at all (ignored), and exact duplicates (identical email or
          phone) are merged automatically and never land here.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All profiles and candidate pairs are scoped to your organization — you only see and merge your
          own tenant's profiles; another organization's data never appears in this queue.
        </p>
      </HelpCallout>
    </div>
  )
}
