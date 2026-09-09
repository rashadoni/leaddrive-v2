"use client"

/**
 * VoIP Calls — help article (English), video-script format.
 * Covers only the Support → VoIP Calls page
 * (src/app/(dashboard)/support/voip/page.tsx): connection indicator,
 * stat cards, filter/search, call-log table, empty state, pagination.
 * Provider setup (Settings → VoIP) is a separate article.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function VoipHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a sales or support rep, or a team lead"
        goal="Track every inbound and outbound call in one log, tie each call to the right contact, and confirm your VoIP provider is connected"
      >
        You reach this page via <HelpKey>Support</HelpKey> → <HelpKey>VoIP Calls</HelpKey>. All calls
        are scoped to your organization. Calls only flow into the log once a VoIP provider is
        connected — that's why a live connection indicator sits at the top of the page. If no
        provider is connected yet, the table stays empty.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a phone icon with the title <HelpKey>VoIP Calls</HelpKey> and the
          description «Call log, click-to-call, incoming call notifications». Top-right holds three
          elements: a live <strong>connection indicator</strong> (colored dot + text), a{" "}
          <HelpKey>Test</HelpKey> button, and a <HelpKey>Settings</HelpKey> button (it goes to
          Settings → VoIP). Below that are four stat cards, then the filter row and the call table.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Connection indicator">Green dot + «Connected», red dot + «Disconnected», or a spinning icon + «Checking…» — the current state of the provider link.</HelpDef>
          <HelpDef term="Total Calls">The real count of every call matching the filter (across all pages, returned by the server).</HelpDef>
          <HelpDef term="Inbound / Outbound">The count by direction for the current page only (not a grand total — a summary of the 25 calls you're viewing).</HelpDef>
          <HelpDef term="Avg Duration">The average duration of calls with a duration on the current page, in minutes:seconds.</HelpDef>
          <HelpDef term="Direction">Inbound (blue) or outbound (green) — shown in the table as an arrow icon.</HelpDef>
          <HelpDef term="Status">Initiated, ringing, in progress, completed, no answer, busy, failed — shown as a colored badge.</HelpDef>
          <HelpDef term="Disposition">The outcome the rep tagged: interested, not interested, callback, voicemail, wrong number, no answer, other.</HelpDef>
          <HelpDef term="Recording">The audio recording of the call — if present, a Play icon opens it in a new tab.</HelpDef>
        </dl>
        <p>
          The table columns are <strong>Date</strong>, <strong>Direction</strong>,{" "}
          <strong>Number</strong>, <strong>Contact</strong>, <strong>Duration</strong>,{" "}
          <strong>Status</strong>, <strong>Disposition</strong>, and <strong>Recording</strong>. Each
          page shows 25 calls; a pagination bar appears under the table when there are more.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: check the connection">
        <HelpStep n={1}>
          <p>
            When the page opens, look at the <strong>connection indicator</strong> in the header. To
            re-check at any time, press <HelpKey>Test</HelpKey> in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While testing, the dot is replaced by a spinning icon and the text «Checking…». When it
            finishes you'll see either a green dot + <strong>Connected</strong> (provider is working)
            or a red dot + <strong>Disconnected</strong> (the connection failed).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If it's disconnected, press <HelpKey>Settings</HelpKey> to set up the provider.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            You land on Settings → VoIP, where you pick the provider and enter its credentials. After
            finishing setup and returning here, pressing <HelpKey>Test</HelpKey> should turn the
            indicator green again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter and search calls">
        <HelpStep n={1}>
          <p>
            Pick one of the direction buttons: <HelpKey>All</HelpKey>, <HelpKey>Inbound</HelpKey>, or{" "}
            <HelpKey>Outbound</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected button appears filled (solid) while the others stay outlined. The table
            immediately shows only calls in that direction and the list jumps back to the first page.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To find a specific number, type a phone number into the search box on the left
            (placeholder: «Search by phone number...»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As you type, the table filters to calls matching that number and the{" "}
            <strong>Total Calls</strong> card shows the real count of matching results. The list
            returns to the first page on each change.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Of the cards up top, only <strong>Total Calls</strong> counts all results;{" "}
            <strong>Inbound</strong>, <strong>Outbound</strong>, and <strong>Avg Duration</strong>{" "}
            summarize only the current page you can see. They can change when you move between pages.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: read a call row">
        <HelpStep n={1}>
          <p>
            Look at any row in the table. The <strong>Direction</strong> column uses an arrow icon to
            show inbound (blue) vs. outbound (green); the <strong>Number</strong> column shows the
            other party's number in a monospace font.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Status</strong> column shows a colored badge (e.g. green «Completed», red
            «Failed»), and the <strong>Disposition</strong> column shows the tagged outcome — if
            either is missing, a «—» dash appears. <strong>Duration</strong> reads as
            minutes:seconds.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If the call is tied to a contact, click the name in the <strong>Contact</strong> column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            You go to that contact's page. If the call wasn't matched to any contact, a «—» dash shows
            instead of a name and there's nothing to click.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To listen to the call, press the <HelpKey>Play</HelpKey> icon in the{" "}
            <strong>Recording</strong> column.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The recording opens in a new tab. The Play icon only appears when a recording exists for
            that call; otherwise a «—» dash is shown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: move between pages">
        <HelpStep n={1}>
          <p>
            When there are more than 25 calls, a pagination bar appears under the table. Move with the{" "}
            <HelpKey>Back</HelpKey> and <HelpKey>Next</HelpKey> buttons.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On the left it shows your position as «page / total pages (total calls)».{" "}
            <HelpKey>Back</HelpKey> is disabled on the first page and <HelpKey>Next</HelpKey> on the
            last. If there's only one page, this bar doesn't appear at all.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          While the table loads, a few gray «skeleton» rows are shown. If there are no calls —
          because the provider isn't connected yet or nothing matches your filter — you'll see a phone
          icon with <strong>«No calls yet»</strong> and below it «Calls will appear here when your
          VoIP provider is connected». This isn't an error — there's just nothing in the log yet.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          The connection indicator is checked once automatically when the page opens. If you just
          connected a provider or changed something elsewhere, press <HelpKey>Test</HelpKey> to
          refresh the status before assuming the log is wrong.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All calls, recordings, and contact links are scoped to your organization — you only see
          your own tenant's calls, never another organization's log. Clicking a contact name only
          opens a contact that belongs to your tenant.
        </p>
      </HelpCallout>
    </div>
  )
}
