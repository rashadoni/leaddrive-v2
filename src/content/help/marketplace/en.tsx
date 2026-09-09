"use client"

/**
 * App Marketplace — help article (English).
 * Covers the `/marketplace` page: browsing the catalog, installing an app
 * (Install), disabling/enabling it (Power toggle), and uninstalling it.
 * Every description is taken from the real UI: category-grouped card grid,
 * the status badges and buttons on each card, and the empty state.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MarketplaceHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an administrator or operations lead"
        goal="Extend LeadDrive with additional apps — custom fields, integrations, and automations: pick an app from the catalog, install it, and disable or uninstall it when needed"
      >
        The page is called <HelpKey>App Marketplace</HelpKey>. Every app shown here comes from a shared
        catalog, but the install state — what is <strong>Installed</strong> or <strong>Disabled</strong> —
        belongs to your organization only. When you install or uninstall an app, the cards reload immediately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>App Marketplace</HelpKey> title with the line «Browse and install
          apps that extend LeadDrive with custom fields, integrations, and automations» beneath it. While the
          page opens you briefly see <strong>Loading catalog…</strong>. If the catalog is empty, a package
          icon and the message <strong>The catalog is empty.</strong> are shown in the center. When apps
          exist, they're split into <strong>categories</strong>: each category name (or <strong>Other</strong>{" "}
          for uncategorized apps) becomes a section heading with a grid of app cards below it.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="App card">Represents one app: icon, name, vendor, version, a short summary, and action buttons.</HelpDef>
          <HelpDef term="1st-party">If the app is provided by LeadDrive, this badge appears next to its name (a first-party app).</HelpDef>
          <HelpDef term="Vendor · v…">Below the name the card shows the vendor and the app's version.</HelpDef>
          <HelpDef term="Installed">Green badge — the app is installed in your organization and active.</HelpDef>
          <HelpDef term="Disabled">Yellow badge — the app is installed but temporarily turned off.</HelpDef>
          <HelpDef term="Docs">An external link to the app's documentation page (if any) — opens in a new tab.</HelpDef>
        </dl>
        <p>
          The bottom of each card shows different buttons depending on state. If the app is{" "}
          <strong>not installed</strong>, you see an <HelpKey>Install</HelpKey> button (with a plus icon). If
          the app <strong>is installed</strong>, the card shows a status badge (green <strong>Installed</strong>{" "}
          or yellow <strong>Disabled</strong>) and two icon buttons next to it: a power icon to enable / disable,
          and a red trash icon to uninstall. If the vendor set a documentation URL, a <HelpKey>Docs</HelpKey>{" "}
          link appears on the right.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: install an app">
        <HelpStep n={1}>
          <p>
            Browse the catalog and find the app you want. Because cards are grouped by category, look under the
            relevant section heading.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Under each category heading, app cards appear. Each card has an icon, the app name, the vendor and
            version, an optional two-line summary, and action buttons at the bottom.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On the card of a not-yet-installed app, click the <HelpKey>Install</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to a spinning icon and <strong>Installing…</strong>. Once the install succeeds,
            the card updates: the <HelpKey>Install</HelpKey> button is replaced by a green <strong>Installed</strong>{" "}
            badge, a power-icon toggle, and a red uninstall button.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If the app requires extra configuration, the install will fail and an error appears at the top of
            the page.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top of the page a red bar shows <strong>Install failed</strong>, and if applicable a{" "}
            <strong>(missing: …)</strong> list of the configuration keys that are missing.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: disable or re-enable an app">
        <HelpStep n={1}>
          <p>
            On an installed app's card, click the power-icon button. When the app is active this acts as{" "}
            <HelpKey>Disable</HelpKey>; when it's disabled it acts as <HelpKey>Enable</HelpKey> (hovering over
            the button shows that label as a tooltip).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While the action runs, the buttons are briefly disabled. Then the card's badge switches between
            green <strong>Installed</strong> and yellow <strong>Disabled</strong>. The app is not removed — only
            its active/disabled state changes.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: uninstall an app">
        <HelpStep n={1}>
          <p>
            On an installed app's card, click the red trash-icon (<HelpKey>Uninstall</HelpKey>) button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirmation dialog opens: «Uninstall &lt;app name&gt;? Settings are preserved for audit.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Confirm (<HelpKey>OK</HelpKey>). If you change your mind, choose <HelpKey>Cancel</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            After confirming, the card returns to its «not installed» state: the status badge disappears and an{" "}
            <HelpKey>Install</HelpKey> button takes its place. If the uninstall fails, an{" "}
            <strong>Uninstall failed</strong> message is shown at the top.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            As the confirmation dialog warns, <strong>settings are preserved for audit</strong> — the app is
            removed, but its previous configuration is kept as history. If you only want to pause the app
            temporarily, use the power button to <HelpKey>Disable</HelpKey> it instead of uninstalling.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If an installed app's version lags behind the catalog, the card shows a yellow{" "}
          <strong>(catalog: v…)</strong> note under the name — meaning a newer version is available. For more
          details about an app, use its <HelpKey>Docs</HelpKey> link when present (it opens in a new tab).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Although the catalog is shared across all tenants, install state is scoped to your organization:
          installing, disabling, or uninstalling an app affects your organization only — you don't see or change
          other organizations' installations.
        </p>
      </HelpCallout>
    </div>
  )
}
