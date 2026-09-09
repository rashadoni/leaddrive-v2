"use client"

/**
 * Payment Notifications — help article (English).
 * Covers Settings → Finance notifications: recipient email, four notification
 * categories (overdue payments, advance warning, payment orders, bill payments),
 * each category's on/off toggle, delivery channels (Telegram / In-app / Email),
 * and the days-before-deadline selector for the advance-warning category.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function financenotificationsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a finance administrator or accountant"
        goal="Control which payment events trigger a notification, and which channel (Telegram, in-app, email) they arrive on"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Finance notifications</HelpKey>.
        All settings apply only to your organization. After making changes, remember to confirm them with
        the <HelpKey>Save</HelpKey> button at the top right — if you leave without saving, your changes are lost.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the title <HelpKey>Payment Notifications</HelpKey>, the line "Configure when and
          where financial notifications are sent" below it, and a <HelpKey>Save</HelpKey> button at the top
          right. Top to bottom, the page has five blocks: first a <strong>Notification email</strong> card,
          then four notification categories — <strong>Overdue payments</strong>,{" "}
          <strong>Advance warning</strong>, <strong>Payment orders</strong> and{" "}
          <strong>Bill payments</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Notification email">
            The address financial notifications are sent to when the Email channel is enabled (e.g.
            finance@company.com).
          </HelpDef>
          <HelpDef term="Overdue payments">
            Notification category for payments that are past due.
          </HelpDef>
          <HelpDef term="Advance warning">
            Notification about upcoming deadlines; you choose how many days in advance it fires.
          </HelpDef>
          <HelpDef term="Payment orders">
            Notification category for when a payment order is submitted and executed.
          </HelpDef>
          <HelpDef term="Bill payments">
            Notification category for when a bill payment is recorded.
          </HelpDef>
          <HelpDef term="Delivery channels">
            Where the notification goes: <strong>Telegram</strong>, <strong>In-app</strong> (notification
            center), or <strong>Email</strong>. A category can use more than one channel at once.
          </HelpDef>
          <HelpDef term="Days before deadline">
            Only for Advance warning — how many days ahead the notification fires: 1, 3, 7 or 14 days.
          </HelpDef>
        </dl>
        <p>
          Each category renders as a card: a bell icon on the left, the category name and a short
          description, and an on/off toggle on the right. When the toggle is on, that category's{" "}
          <strong>delivery channels</strong> appear below the card; turning it off hides the channels. While
          the page first loads, a brief <strong>Loading...</strong> message is shown.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: set the notification email">
        <HelpStep n={1}>
          <p>
            In the top <HelpKey>Notification email</HelpKey> card, type an email address into the text field
            (e.g. <HelpKey>finance@company.com</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Under the field is the line "Financial notifications will be sent to this email (when Email
            channel is enabled)". When empty, the field shows <strong>finance@company.com</strong> as faint
            placeholder text.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            For this address to actually be used, make sure at least one category has the{" "}
            <strong>Email</strong> channel selected (see the sections below).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If no category has the Email channel selected, nothing is sent to this address — the field only
            stores where mail should go.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: turn a category on/off and pick channels">
        <HelpStep n={1}>
          <p>
            Click the on/off toggle on the right of the category card you want (e.g.{" "}
            <HelpKey>Overdue payments</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When the toggle switches on, the slider moves to the right and fills with color; a{" "}
            <strong>Delivery channels</strong> block opens below the card. Turning it off slides the toggle
            back and hides the channels again.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the open <HelpKey>Delivery channels</HelpKey> block, tick the box next to the channel(s) you
            want: <strong>Telegram</strong>, <strong>In-app</strong> or <strong>Email</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each channel is shown as a row: its name, a short description below it ("Send Telegram
            notification", "Show in notification center", "Send email notification") and a checkbox on the
            right. Ticking a box fills it; a single category can have several channels selected at once.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: choose the warning days for Advance warning">
        <HelpStep n={1}>
          <p>
            Turn on the <HelpKey>Advance warning</HelpKey> card's toggle.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            This card's bell icon is amber. When opened, below the card you first see the{" "}
            <strong>Days before deadline</strong> row, and below that the delivery channels.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Days before deadline</HelpKey> row, choose one of the buttons:{" "}
            <HelpKey>1 day</HelpKey>, <HelpKey>3 days</HelpKey>, <HelpKey>7 days</HelpKey> or{" "}
            <HelpKey>14 days</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button you choose appears filled (highlighted) while the others stay outlined. Only one
            choice can be active at a time. <strong>7 days</strong> is selected by default.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick the channels from the <HelpKey>Delivery channels</HelpKey> block below, as before.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The day selector and the channel selector sit together in the same card; both belong to that one
            "Advance warning" category.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: save your changes">
        <HelpStep n={1}>
          <p>
            Once you've set up all categories and channels the way you want, click the{" "}
            <HelpKey>Save</HelpKey> button at the top right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While saving, the button shows a spinning icon; when it finishes, it briefly reads{" "}
            <strong>Saved!</strong> and then returns to <strong>Save</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          You pick channels separately for each category — for example, overdue payments could arrive on both
          Telegram and in-app, while bill payments arrive in-app only. If you turn a category fully off, its
          channel selections are hidden but not lost — they come back when you switch the toggle on again.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Changes are not saved automatically. If you flip a toggle or pick a channel and leave the page
          without clicking <HelpKey>Save</HelpKey>, the changes are not applied. Also, if you select the Email
          channel but leave the <HelpKey>Notification email</HelpKey> field above empty, there is no address
          for the email notifications to go to.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          These settings are scoped to your organization — you only configure your own tenant's financial
          notifications and never see another organization's settings. The notification email is used only
          for your organization's financial events.
        </p>
      </HelpCallout>
    </div>
  )
}
