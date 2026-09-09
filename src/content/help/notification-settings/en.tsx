"use client"

/**
 * Notification Preferences — help article (English).
 * Covers Settings → Notification Preferences: managing browser /
 * in-app popup alerts per module (section) group, expanding a group to
 * toggle individual notification kinds, and the dimmed state for
 * sections you can't access. Changes apply instantly (optimistic) and
 * auto-save — there is NO separate "Save" button.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function notificationsettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a CRM user who wants to decide which events show you a popup alert"
        goal="Turn browser and in-app popup notifications on or off per module and cut down on notification noise"
      >
        Reach the page via <HelpKey>Settings</HelpKey> → <HelpKey>Notification Preferences</HelpKey>.
        These preferences apply to <strong>your account only</strong> — they don't affect anyone else's
        notifications. Every toggle you change here is saved immediately; there is no separate "Save"
        button.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a bell icon next to <HelpKey>Notification Preferences</HelpKey>, with the
          description "Control browser and in-app popup alerts for each module…" and an italic reminder:{" "}
          <em>the notification list is always visible — this toggle controls active popups only</em>.
          Below is a card list of module groups: <strong>CRM</strong>, <strong>Sales</strong>,{" "}
          <strong>Contracts Control</strong>, <strong>Support</strong>, <strong>Marketing</strong>,{" "}
          <strong>Finance</strong>, <strong>Analytics</strong>, <strong>Communication</strong>, plus any
          other modules your organization has enabled (e.g. Route &amp; Field, industry clouds).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Module group (section)">
            One card = one module (e.g. CRM, Sales, Support). The card name and short description tell
            you which events it covers (e.g. for CRM, "Tasks, deals, leads, contacts, companies").
          </HelpDef>
          <HelpDef term="Browser &amp; in-app popups">
            The main toggle on the right of each card. It turns popup alerts for the whole module on or
            off in one move.
          </HelpDef>
          <HelpDef term="Notification kind">
            The individual events revealed when you expand a group (e.g. "Task created", "Deal won").
            Each has its own small toggle so you can mute just some kinds without switching off the
            whole group.
          </HelpDef>
          <HelpDef term="You don't have access to this section">
            A grey badge next to a module card you have no access to; that card appears dimmed and its
            toggles are disabled.
          </HelpDef>
        </dl>
        <p>
          Each card has, on the left, an expand chevron (only when the module has individual kinds), in
          the middle the module name and description with "Browser &amp; in-app popups" below it, and on
          the right the module's main toggle. A module you can't access is shown semi-transparent
          (dimmed), carries an alert-icon "You don't have access to this section" badge, and all its
          toggles are inactive.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: turn a whole module on or off">
        <HelpStep n={1}>
          <p>
            Find the card for the module you want to adjust (e.g. <HelpKey>Sales</HelpKey> or{" "}
            <HelpKey>Support</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card shows the module name, a short description below it (e.g. "Tickets and comments" for
            Support) and the "Browser &amp; in-app popups" line. The module's main toggle sits on the
            right.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the main toggle on the right of the card to switch it on or off.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The toggle flips to its new state instantly (optimistic) — no waiting. The change is saved
            automatically in the background. If saving fails, the toggle reverts to its previous state
            and a "Failed to save — try again" toast appears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: tune individual notification kinds only">
        <HelpStep n={1}>
          <p>
            Click the expand chevron on the left of the module card to open the group. (This chevron
            only appears on modules that have individual notification kinds.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The chevron points down and, below the card, indented with a thin left border, every
            notification kind for that module is listed — each with its own small toggle (e.g. for CRM:
            "Task created", "Deal won", "Lead converted").
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click the small toggle next to the specific kind you want to mute (or enable).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Only that one kind changes — the group's other kinds and the main toggle stay untouched. The
            change shows instantly and saves automatically; on error the toggle reverts and the "Failed
            to save" toast appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To collapse the list, click the same chevron (now pointing down) again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The individual kinds hide, the chevron points right again and the card returns to its
            compact view. The changes you made are kept.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If popups are too noisy, instead of switching off a whole module, expand it first and mute
          only the less important kinds (e.g. "Task created") — that way important events like "Deal won"
          still pop up.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          These toggles control <strong>popup alerts only</strong>. The{" "}
          <strong>notification list under the bell icon is always visible</strong> — whatever you mute
          here, the events are still recorded in that list; they just stop appearing as on-screen
          popups. There is also no separate "Save" button: each toggle takes effect immediately.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          These preferences are tied to <strong>your user account only</strong> and don't change
          anyone else's notifications. A dimmed (semi-transparent) card with a "You don't have access to
          this section" badge means your role doesn't reach that module — its toggles are disabled and
          you can't change them.
        </p>
      </HelpCallout>
    </div>
  )
}
