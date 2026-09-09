"use client"

/**
 * Media Cloud → Ad Campaigns (ad-campaigns list) — help article (English).
 * Standalone article split from the Media section: covers ONLY
 * Media → Ad Campaigns list page (stat cards, search/status filter,
 * campaign table, "Load more"). This page is read-only — there is NO
 * create/edit campaign button here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mediaadcampaignsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You work in media or advertising operations"
        goal="Review the list of ad campaigns, track status and budget at a glance, and quickly find a specific campaign"
      >
        You reach this page via <HelpKey>Media</HelpKey> → <HelpKey>Ad Campaigns</HelpKey>. All campaigns
        belong to your organization only. This is a read (browse) page — you see stats, filters, and the
        list; there is no create/edit campaign button on this page. The numbers on the stat cards are
        computed from the currently loaded list, so they update as you change the filter.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a TV icon next to the title <HelpKey>Ad Campaigns</HelpKey>, with the
          description «Advertising campaigns — budget, flight dates, and performance.» below it. Under
          that sit four stat cards: <strong>Total Campaigns</strong>, <strong>Running</strong>,{" "}
          <strong>Completed</strong>, and <strong>Total Budget</strong>. Below the cards is a filter bar
          (search box, status dropdown, and a refresh button), and beneath that the campaign table. If the
          list is long, a <HelpKey>Load more</HelpKey> button appears at the bottom.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Campaigns">The number of campaigns currently loaded.</HelpDef>
          <HelpDef term="Running">The number of campaigns whose status is «Running».</HelpDef>
          <HelpDef term="Completed">The number of campaigns whose status is «Completed».</HelpDef>
          <HelpDef term="Total Budget">The sum of the total budgets of the loaded campaigns (formatted as currency).</HelpDef>
          <HelpDef term="Campaign">In each table row, the campaign name with its campaign number below it in monospace font.</HelpDef>
          <HelpDef term="Status">The campaign state as a colored badge: Draft, Scheduled, Running, Paused, Completed, Cancelled.</HelpDef>
          <HelpDef term="Budget / Spent">The campaign's total budget and the amount spent so far (with currency).</HelpDef>
          <HelpDef term="Start / End Date">The campaign's flight dates; «—» is shown when not set.</HelpDef>
        </dl>
        <p>
          The table columns from left to right are: <strong>Campaign</strong>, <strong>Status</strong>,{" "}
          <strong>Budget</strong>, <strong>Spent</strong>, <strong>Start Date</strong>, and{" "}
          <strong>End Date</strong>. You can click any column header to sort by it.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the list and check the numbers">
        <HelpStep n={1}>
          <p>
            As soon as the page opens, glance at the four stat cards: <HelpKey>Total Campaigns</HelpKey>,{" "}
            <HelpKey>Running</HelpKey>, <HelpKey>Completed</HelpKey>, and <HelpKey>Total Budget</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card has its own icon (a speech bubble, a play glyph, a dollar sign) and a number value.
            The <strong>Total Budget</strong> card shows its value as currency (e.g. $0).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Below, look at the campaign table. Each row carries the campaign name, the campaign number
            beneath it, then the status badge, budget, amount spent, and the flight dates.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status column appears as a colored badge — for example green <strong>Running</strong>,
            amber <strong>Paused</strong>, gray <strong>Draft</strong>. Fields with no date show «—». If
            there are no campaigns, the table shows its empty state.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: search and filter by status">
        <HelpStep n={1}>
          <p>
            In the filter bar, type a campaign number (or email) into the search box — its placeholder
            reads <HelpKey>Search by number or email…</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Shortly after you stop typing (about half a second), the list refreshes automatically — no
            need to press a button. Matching campaigns stay; the rest drop out of the table.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a state from the status dropdown (e.g. <HelpKey>Running</HelpKey> or{" "}
            <HelpKey>Completed</HelpKey>). To show every campaign, keep <HelpKey>All statuses</HelpKey>{" "}
            selected.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As soon as you choose, the list refreshes with only the campaigns in that status. The stat
            cards adjust to the visible result.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To pull the list from the server again, press the refresh (circular arrow) icon button on the
            right of the filter bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table reloads from the first page; your current search and status filter stay in effect.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: load more campaigns and sort">
        <HelpStep n={1}>
          <p>
            The table shows a fixed number of campaigns per page. If there are more, press the{" "}
            <HelpKey>Load more</HelpKey> button at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The next campaigns are appended to the end of the existing list (it is not reset). While
            loading, the button is temporarily disabled. When no more campaigns remain, the button
            disappears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To sort, click any column header — <HelpKey>Campaign</HelpKey>, <HelpKey>Status</HelpKey>,{" "}
            <HelpKey>Budget</HelpKey>, <HelpKey>Spent</HelpKey>, <HelpKey>Start Date</HelpKey>, or{" "}
            <HelpKey>End Date</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table re-sorts by that column; clicking again flips the direction (ascending/descending).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The numbers on the stat cards are computed from the currently <strong>loaded</strong> list, not
          the whole database. So to get the true overall picture, first add the remaining campaigns with{" "}
          <HelpKey>Load more</HelpKey>, or filter by the status you care about and read that slice.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is read-only — there is no button here to create, edit, or delete a campaign. Status,
          budget, and dates are not changed here; this page is for monitoring the state of existing
          campaigns.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All ad campaigns are scoped to your organization — you only see your own tenant's campaigns;
          another organization's data never appears in this list.
        </p>
      </HelpCallout>
    </div>
  )
}
