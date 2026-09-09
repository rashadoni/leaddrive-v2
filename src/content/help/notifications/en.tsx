"use client"

/**
 * Notifications — help article (English).
 * Previously shared the dashboard article; now covers only the
 * Notifications list itself: reading, filtering (All / Unread),
 * marking one or all as read, loading more.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function NotificationsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="A sales rep, manager or admin who uses the CRM day to day"
        goal="See, read and clear system alerts about deals, tasks, tickets and other events in one place"
      >
        This is the <HelpKey>Notifications</HelpKey> section in the left menu. Every notification shown
        here belongs to your organization only and loads automatically from the server when you open the
        page. Notifications aren't created on this page — other events (a deal, a task, a ticket) push
        them into the system; this page is where you read and manage them.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          Top left shows the <HelpKey>Notifications</HelpKey> heading with a «{"{"}count{"}"}
          notifications» total line under it, and top right the{" "}
          <HelpKey>Mark all as read</HelpKey> button. Below the heading is a page description —
          «Notifications: system alerts about deals, tasks, tickets and other events». Then come three
          stat cards, two filter buttons under them, and the notification list at the bottom.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total">The total number of notifications (read and unread together); shown with a bell icon.</HelpDef>
          <HelpDef term="Unread">How many notifications you haven't read yet; shown with a crossed-out bell icon.</HelpDef>
          <HelpDef term="Read">How many are already read (total minus unread); shown with a double-check icon.</HelpDef>
          <HelpDef term="All (filter)">Filter button that shows every notification; the total count is shown next to it.</HelpDef>
          <HelpDef term="Unread (filter)">Filter button that shows only unread notifications; the unread count is shown next to it.</HelpDef>
          <HelpDef term="Notification card">One event row — a type-colored icon on the left, a title, the message text, and on the right how long ago it arrived.</HelpDef>
        </dl>
        <p>
          Each card has a type-colored icon on the left: info (blue), warning (yellow), success (green),
          deal (purple dollar sign), lead (orange), message (sky-blue chat icon); an unknown type falls
          back to a plain bell. An unread notification is highlighted — a thin colored bar on its left, a
          tinted background, a bolder title, and a small filled dot next to the title. A read one has none
          of these.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read notifications and mark one as read">
        <HelpStep n={1}>
          <p>
            Open the <HelpKey>Notifications</HelpKey> section from the left menu.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While loading you briefly see grey placeholder bars (a skeleton), then the three stat cards,
            the filter buttons and the notification list appear. If you have no notifications, a card
            reads «No notifications» in place of the list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look over the card you care about — a title, the message under it, and on the right a time
            like «5 min ago», «2 h ago» or «3 d ago» (anything older than a week shows the full date).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Hovering over a card lightens its background slightly — that's a hint the cards are clickable.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To mark an unread notification as read, simply click the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card switches to its plain look — the colored side bar and tinted background disappear,
            and the filled dot next to the title is gone. The <strong>Unread</strong> count drops by one
            and the <strong>Read</strong> count goes up by one. (Clicking an already-read card does
            nothing.)
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: filter — All or Unread">
        <HelpStep n={1}>
          <p>
            Pick one of the two buttons under the stat cards: <HelpKey>All</HelpKey> (with the total
            count beside it) or <HelpKey>Unread</HelpKey> (with the unread count beside it).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected filter button looks filled (highlighted) and the other looks outlined. Choosing{" "}
            <HelpKey>Unread</HelpKey> narrows the list to notifications you haven't read yet.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If nothing is left in the <HelpKey>Unread</HelpKey> filter, a «No unread notifications»
            message appears in place of the list.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The empty-state card shows «No unread notifications»; switch back to <HelpKey>All</HelpKey> to
            see every notification again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: mark all read and load more">
        <HelpStep n={1}>
          <p>
            To clear every unread notification at once, click <HelpKey>Mark all as read</HelpKey> at the
            top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            All cards switch to the read look, the <strong>Unread</strong> count drops to zero, and the
            button itself becomes disabled. (If there were no unread notifications to begin with, the
            button is already disabled — greyed out and unclickable.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            If the list is long, a <HelpKey>Load more</HelpKey> button sits at the very bottom (only in
            the <HelpKey>All</HelpKey> filter). Click it to bring in older notifications.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Loading...» while it works, then the next batch of notifications is
            appended below the existing ones. When there are no older notifications left, the{" "}
            <HelpKey>Load more</HelpKey> button disappears.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The colored icon at the start of a card tells you at a glance where the notification came from:
          purple dollar = deal, orange = lead, sky-blue chat = message, yellow triangle = warning. To see
          only what still needs attention, keep the <HelpKey>Unread</HelpKey> filter on and watch the list
          shrink as you read.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          A single click marks a card <strong>read</strong> right away — there is no confirmation dialog.
          This page has no button to mark something unread again, so don't click hastily before you've
          actually looked at the notification.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Notifications are scoped to your organization — you only see alerts for your own tenant and
          can't open or read another organization's notifications. The list is loaded from the server
          with your organization context.
        </p>
      </HelpCallout>
    </div>
  )
}
