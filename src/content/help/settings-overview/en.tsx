"use client"

/**
 * Settings — help article (English).
 *
 * Covers the Settings hub (/settings) and Dashboard Settings
 * (/settings/dashboard). The hub is a launcher grid into ~19 config
 * areas; Dashboard Settings is the per-widget show/hide control whose
 * choices the main dashboard reads at render time. One article wired to
 * both page headers.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SettingsOverviewHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          <strong>Settings</strong> is the launcher for everything that controls how your CRM
          behaves — your organization profile, roles, channels, billing, security, and more. It
          isn&apos;t one form; it&apos;s a grid of cards, each opening a focused configuration
          page.
        </p>
        <p>
          <strong>Dashboard Settings</strong> is one of those cards. It decides which widgets
          appear on the main dashboard — turn off the ones your team doesn&apos;t use and the home
          screen gets shorter and faster for everyone.
        </p>
      </HelpSection>

      <HelpSection title="The Settings hub — one card per area">
        <p>
          Each card shows a title, a one-line description, and an{" "}
          <HelpKey>i</HelpKey> info hint; click anywhere on the card to open that area. The cards
          group into a few themes:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Workspace">Organization, Billing, Roles &amp; Permissions</HelpDef>
          <HelpDef term="Channels &amp; automation">Channels, Workflows, Macros, AI Automation, Web Chat Widget</HelpDef>
          <HelpDef term="Finance">Invoice Settings, Payment Notifications, Currencies</HelpDef>
          <HelpDef term="Support &amp; access">SLA Policies, Portal Users</HelpDef>
          <HelpDef term="Platform">Dashboard Settings, Custom Fields, Custom Domains, Integrations</HelpDef>
          <HelpDef term="Governance">Security, Audit Log</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Hover the <HelpKey>i</HelpKey> on any card for a one-line reminder of what lives inside
            before you open it — handy when you&apos;re hunting for a specific setting and
            don&apos;t want to click through several pages.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Dashboard Settings — show or hide widgets">
        <p>
          Open it from the <strong>Dashboard Settings</strong> card (or go to{" "}
          <HelpKey>/settings/dashboard</HelpKey>). You get a grid of widget cards, each with an
          icon, a name, a short description, and an on/off <HelpKey>Switch</HelpKey>. The header
          counts how many are <strong>active</strong> versus <strong>hidden</strong>.
        </p>
        <HelpStep n={1}>
          <p>
            Click a card — or its switch — to flip a widget on or off. A green, highlighted card is
            on; a dimmed, transparent card is off.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Every toggle saves <strong>automatically</strong> — there is no Save button. A small
            spinner appears on the card while the change is being written.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Open the main dashboard to see the result: the widgets you left on render in the same
            order shown here, and the ones you turned off are gone.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            The widgets you can toggle here include the <strong>Risks Banner</strong>,{" "}
            <strong>KPI Cards</strong>, the AI widgets (<strong>AI action queue</strong>,{" "}
            <strong>AI value this month</strong>, <strong>Da&nbsp;Vinci Lead Scoring</strong>),{" "}
            <strong>Sales Pipeline</strong>, <strong>Revenue Trend</strong>,{" "}
            <strong>Lead Sources</strong>, <strong>Recent Deals</strong>,{" "}
            <strong>Recent Activity</strong>, <strong>Campaigns</strong>, <strong>Events</strong>,{" "}
            <strong>Weekly Metrics</strong>, <strong>Recommended Actions</strong>, and{" "}
            <strong>Churn Risk</strong>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="How widget visibility is decided">
        <p>
          Each widget carries two things: whether it&apos;s <strong>enabled</strong> and a list of{" "}
          <strong>roles</strong> allowed to see it. The dashboard shows a widget only when it is
          enabled <em>and</em> either the role list is empty or it includes the current user&apos;s
          role.
        </p>
        <p>
          Most widgets default to enabled for every role. By default the two AI widgets — the{" "}
          <strong>AI action queue</strong> and <strong>AI value this month</strong> — are scoped to{" "}
          <strong>admin</strong> and <strong>manager</strong> roles, so other roles won&apos;t see
          them even while they&apos;re on.
        </p>
        <HelpCallout kind="warning">
          <p>
            Toggling a widget off here hides it for the <strong>whole organization</strong>, not
            just for you. If a teammate reports a missing dashboard card, check this page first.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Where your choices are stored">
        <p>
          Widget choices are saved on your <strong>organization</strong>, not per user — so the
          dashboard layout is consistent for everyone in your workspace. The settings hub itself
          stores nothing; it only routes you to the page that owns each setting.
        </p>
        <HelpCallout kind="next">
          <p>
            New to setup? A common first pass is: <strong>Organization</strong> (name, logo, plan)
            → <strong>Roles &amp; Permissions</strong> → <strong>Channels</strong> → then{" "}
            <strong>Dashboard Settings</strong> to trim the home screen to what your team actually
            uses.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Everything under Settings is scoped to your organization and gated by your role&apos;s
          permissions — you only see and change your own tenant&apos;s configuration. Dashboard
          widget changes are written to your organization&apos;s settings and take effect for all
          members on their next dashboard load.
        </p>
      </HelpCallout>
    </div>
  )
}
