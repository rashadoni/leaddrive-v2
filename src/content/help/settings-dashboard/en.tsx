"use client"

/**
 * Dashboard Widgets (Settings → Dashboard) — help article (English).
 * Split out of the shared "settings-overview" slug: covers ONLY the
 * Settings → Dashboard sub-page (toggling dashboard widgets on/off,
 * auto-save, active/hidden counters). Other settings sections are NOT
 * included here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function settingsdashboardHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are an organization admin or team lead"
        goal="Choose which widgets appear on the home dashboard — hide the ones you don't need, show the ones you do"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Dashboard</HelpKey>. Here you turn
        widgets on and off; there is no separate "save" button — every change is saved automatically.
        The configuration applies to your whole organization and is scoped to your tenant only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Dashboard Widgets</HelpKey> with the subtitle "Toggle
          widgets on/off — changes are saved automatically". Below it sit two small counters: a green eye
          icon showing how many widgets are <strong>active</strong>, and a gray eye-off icon showing how
          many are <strong>hidden</strong>. Underneath, the widget cards are laid out in a three-column
          grid — the same order as the dashboard itself.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="active counter">How many widgets are currently turned on (visible on the dashboard) — with a green eye icon.</HelpDef>
          <HelpDef term="hidden counter">How many widgets are turned off — with a gray eye-off icon.</HelpDef>
          <HelpDef term="Widget card">One card per widget: a colored icon, the widget name, a one-line description, and a toggle (Switch) on the right.</HelpDef>
          <HelpDef term="Switch (toggle)">The slider on the right of the card — to the right (green) when the widget is on, to the left when off.</HelpDef>
        </dl>
        <p>
          When a card is on it has a green border, a light-green tint, and a green icon. When it's off it
          turns gray and slightly faded (dimmed). The grid contains fifteen widgets, including:{" "}
          <strong>Risks Banner</strong>, <strong>KPI Cards</strong>, <strong>AI action queue</strong>,{" "}
          <strong>AI value this month</strong>, <strong>Sales Pipeline</strong>,{" "}
          <strong>Revenue Trend</strong>, <strong>Lead Sources</strong>, <strong>Recent Deals</strong>,{" "}
          <strong>Da Vinci Lead Scoring</strong>, <strong>Recent Activity</strong>,{" "}
          <strong>Campaigns</strong>, <strong>Events</strong>, <strong>Weekly Metrics</strong>,{" "}
          <strong>Recommended Actions</strong> and <strong>Churn Risk</strong>.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: turn a widget off or on">
        <HelpStep n={1}>
          <p>
            When the page opens you may briefly see a "loading" state (gray, pulsing empty cards) — wait
            for the configuration to arrive.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            As soon as loading finishes, the empty gray cards are replaced by the real widget cards and
            the <strong>active</strong> / <strong>hidden</strong> counters appear in the header.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Find the widget you want to change (e.g. <HelpKey>Revenue Trend</HelpKey>). You can click
            anywhere on the card, or just press the toggle (<HelpKey>Switch</HelpKey>) on the right — both
            do the same thing.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card flips between on and off: when turned on it gains a green border/tint and a green
            icon; when turned off it goes gray and dimmed. The toggle slides to the right or left
            accordingly.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Don't look for a "save" button — the change is committed automatically right away.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While the change is being saved, a small spinning circle (loading indicator) appears briefly
            next to the widget's name, then disappears. The <strong>active</strong> and{" "}
            <strong>hidden</strong> counters in the header update to match.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Repeat for as many widgets as you like. When you return to the dashboard, only the widgets you
            kept active will be shown.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After each toggle the <strong>active</strong> count goes up or down and the{" "}
            <strong>hidden</strong> count moves the opposite way — the two always add up to the total
            number of widgets.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Read the small description under each card — it briefly explains what the widget shows on the
          dashboard (e.g. "12-month revenue area chart" or "Last 5 deals list"). This helps you decide
          which widgets are worth keeping.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Turning a widget off does NOT delete the data it shows — it just hides it from the dashboard.
          You can turn it back on at any time. If a save fails because of a network error, the toggle is
          reverted to its previous state — in that case press the widget's toggle again.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          This configuration is organization-level and scoped to your tenant only — the change applies to
          your organization's dashboard and does not affect other organizations' views.
        </p>
      </HelpCallout>
    </div>
  )
}
