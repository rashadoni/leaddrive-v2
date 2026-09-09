"use client"

/** MTM Live Map — concise guide for the read-only team monitoring page. */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmmapHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a field operations manager or supervisor"
        goal="Understand where the team is now and inspect a past GPS trail only when you need it"
      >
        Open <HelpKey>MTM</HelpKey> → <HelpKey>Live Map</HelpKey>. This is a read-only monitoring
        page: it shows server-accepted locations and route information for your organization.
      </HelpScenario>

      <HelpSection title="Understand the page at a glance">
        <p>
          The header has two clear modes — <HelpKey>Live</HelpKey> and <HelpKey>History</HelpKey> —
          plus the last update time and <HelpKey>Refresh</HelpKey>. Below it, a compact summary shows
          the team's current GPS states. The employee list and map are the main work area.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Live">Only a recent, server-accepted coordinate. Shown as a current location.</HelpDef>
          <HelpDef term="Last known">A delayed coordinate with its real age. It is never presented as live.</HelpDef>
          <HelpDef term="No GPS">The employee remains in the list, but there is no admissible map coordinate.</HelpDef>
          <HelpDef term="History">A date-specific GPS trail that you request explicitly.</HelpDef>
          <HelpDef term="ETA">Estimated arrival at the selected employee's next planned stop.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: use Live mode">
        <HelpStep n={1}>
          <p>
            Keep <HelpKey>Live</HelpKey> selected and use the status filters or employee search to find
            a person. Press <HelpKey>Refresh</HelpKey> when you want the newest server result now.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The summary, compact employee list and map update together. Each row states whether its
            coordinate is live, last known or unavailable.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Choose an employee in the list.</p>
          <HelpCallout kind="see" label="What you'll see">
            The map focuses the employee's current admissible coordinate. Today's planned route,
            numbered stops and ETA appear when that data exists. Selecting an employee does not load
            their full movement history.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: inspect a GPS trail">
        <HelpStep n={1}>
          <p>Switch from <HelpKey>Live</HelpKey> to <HelpKey>History</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">
            History controls appear separately from live monitoring. Choose the employee and date,
            then explicitly request the trail.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Open the requested result to inspect the recorded points and replay.</p>
          <HelpCallout kind="see" label="What you'll see">
            The full-day trail belongs only to History mode. Returning to <HelpKey>Live</HelpKey>
            restores the current team view without carrying the old trail into it.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Additional tools">
        <p>
          <HelpKey>Additional tools</HelpKey> is closed by default so the main map stays simple. Open
          it only when you need <HelpKey>Geofence</HelpKey>, <HelpKey>Heatmap</HelpKey> or recent
          events. Closing it does not change employee locations or your current selection.
        </p>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          A background-map failure is not a GPS failure. If CARTO/OSM tiles cannot load, the page says
          that the <strong>map background</strong> is unavailable and offers a retry. Employee names,
          GPS state, coordinate age and selection remain usable in the list. Conversely, a{" "}
          <strong>No GPS</strong> row means that employee has no admissible coordinate even if the
          background map is visible.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          Trust the timestamp and GPS label, not just the marker. Old coordinates stay labelled as
          last known and never become a green live position simply because an employee is online.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Locations, statuses, routes and events are limited to your organization. The page cannot
          edit an employee's location or route.
        </p>
      </HelpCallout>
    </div>
  )
}
