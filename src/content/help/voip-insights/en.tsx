"use client"

/**
 * Conversation Intelligence — help article (English).
 * Split out of the old shared "voip" article: covers ONLY the
 * voip/insights page (post-call AI analysis panel — sentiment
 * distribution, competitor mentions, coaching patterns, recent calls
 * list). The call log and provider setup are NOT part of this article.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function voipinsightsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a sales manager or team lead"
        goal="Read the sentiment, action-item, competitor and coaching signals the AI extracts from calls, to see what's actually happening on the phone across the team"
      >
        This page aggregates <strong>post-call AI analysis</strong> — you don't place calls or set up
        a provider here. Everything is scoped to your organization only. Calls are analysed
        automatically once their transcript is captured; this panel rolls those results up across the
        time window you choose.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a brain icon and the <HelpKey>Conversation Intelligence</HelpKey> title,
          with the subtitle «Post-call AI analysis: sentiment, topics, action items, competitor
          mentions, coaching hints». Top-right there are four time-window buttons:{" "}
          <HelpKey>Today</HelpKey>, <HelpKey>Last 7 days</HelpKey>, <HelpKey>Last 30 days</HelpKey>{" "}
          and <HelpKey>Last 90 days</HelpKey> (<strong>Last 7 days</strong> is selected by default).
          Below come four KPI cards, then a sentiment-distribution bar, the competitor-mentions and
          coaching-patterns panels, and at the bottom the recent-calls list.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Calls analysed">Number of calls the AI analysed in the selected window (calls without an insight aren't counted).</HelpDef>
          <HelpDef term="Action items">Total to-dos extracted from those calls.</HelpDef>
          <HelpDef term="Competitors named">Count of distinct competitors mentioned across the window.</HelpDef>
          <HelpDef term="Coaching patterns">Number of repeating coaching signals (rules) across the team.</HelpDef>
          <HelpDef term="Sentiment distribution">A coloured bar splitting analysed calls into five levels: very positive, positive, neutral, negative, very negative.</HelpDef>
          <HelpDef term="Competitor mentions">A panel ranking which competitors were mentioned and how many times.</HelpDef>
          <HelpDef term="Coaching patterns (panel)">Repeating hints across the team — coloured by severity critical → warning → info, each showing how often it occurred (×N).</HelpDef>
          <HelpDef term="Recent calls">The list of calls in the window; each row expands to show topics, action items, competitor mentions and coaching hints.</HelpDef>
        </dl>
        <p>
          Each call row has a direction arrow (blue up-right for outbound, green down-left for
          inbound), the contact name (or the number if none), a one- or two-line summary, duration, a
          relative time («just now», «3 h ago»…), the action-item count, and a sentiment icon on the
          right (from a laughing face down to a trending-down arrow for negative).
        </p>
      </HelpSection>

      <HelpSection title="Step by step: pick the time window and read the KPIs">
        <HelpStep n={1}>
          <p>
            Pick a time window top-right — <HelpKey>Today</HelpKey>, <HelpKey>Last 7 days</HelpKey>,{" "}
            <HelpKey>Last 30 days</HelpKey> or <HelpKey>Last 90 days</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chosen button turns solid (primary colour) while the others stay outlined. The panel
            briefly shows a spinning «Loading…» icon, then all cards, the bar and the list refresh
            with that period's data.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the four KPIs across the top: <strong>Calls analysed</strong>,{" "}
            <strong>Action items</strong>, <strong>Competitors named</strong> and{" "}
            <strong>Coaching patterns</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card has a small icon next to the label with a large number underneath. These
            numbers reflect only the selected window and change immediately when you switch windows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <strong>Sentiment distribution</strong> bar — it gives the team's overall
            mood picture.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The coloured bar is split into segments (very positive — green, …, very negative — red);
            a segment's width equals that sentiment's share, and hovering shows a
            «&lt;sentiment&gt;: &lt;count&gt;» tooltip. Below it a coloured dot, label and count
            appear for each present sentiment. If there are no calls in the window, the bar doesn't
            render at all.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: explore competitors and coaching patterns">
        <HelpStep n={1}>
          <p>
            Look at the <HelpKey>Competitor mentions</HelpKey> list in the left panel.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows the competitor's name with, on the right, a monospace count of how many
            times it was mentioned. If nothing was mentioned in the window, you see «No competitors
            mentioned in window.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the wider <HelpKey>Coaching patterns</HelpKey> panel on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each pattern box shows the message, an occurrence count in the corner
            (<strong>×N</strong>), and the rule label underneath (e.g. «Value proposition missed»,
            «Competitor mentioned», «Call too short»). The box border is coloured by severity:
            critical — red, warning — amber, info — plain grey. If there are no repeating patterns,
            you see «No repeating coaching patterns in window.»
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: open a call and see its detail">
        <HelpStep n={1}>
          <p>
            Under the <strong>Recent calls ({"{count}"})</strong> heading, click a call row in the
            list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The row expands and the detail opens below a thin divider line. Clicking the same row
            again collapses it (only one call stays open at a time).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Read the call's AI detail in the expanded section.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When present you'll see: <strong>Topics</strong> (as small chips),{" "}
            <strong>Action items</strong> (with a checkbox icon, plus owner and due-date hint in
            parentheses if any), <strong>Competitor mentions</strong> (name, ×count and context) and{" "}
            <strong>Coaching hints</strong> (with a triangle/circle/info icon by severity). At the
            very bottom the call may show its <strong>Model</strong> name, latency (ms) and cost ($).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          An empty state is normal. If there are no analysed calls in the selected window, the centre
          shows a brain icon with «No analysed calls in the selected window.» and «Calls are analysed
          automatically once the transcript is captured.» This doesn't mean the panel is broken —
          there just aren't any analysed calls yet. Pick a wider window, or make sure call
          transcripts are being captured.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          When the window holds a lot of calls, an amber banner appears at the top: «Showing the most
          recent N calls. Refine via shorter window for full coverage.» That means the list was
          capped to the latest calls — pick a shorter time window for a complete picture. If loading
          fails, a red error card is shown at the top instead.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          This panel is read-only and scoped to your organization — you only see your own tenant's
          calls and their analysis. No analysis is triggered here: it runs automatically after each
          call's transcript is captured, and this page only displays the finished results.
        </p>
      </HelpCallout>
    </div>
  )
}
