"use client"

/**
 * Web Chat Widget — help article (English).
 * Covers the Settings → Web Chat Widget page: enabling the widget, the embed
 * snippet and public key, appearance (title/color/greeting/position/offline
 * message), behavior (Da Vinci AI auto-reply / ticket escalation / launcher),
 * working hours, and allowed origins.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WebChatSettingsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an admin or marketing owner setting up live chat support on your website"
        goal="Add a floating chat bubble to your site and tune how it looks and behaves"
      >
        You reach this page via <HelpKey>Settings</HelpKey> → <HelpKey>Web Chat Widget</HelpKey>. The
        widget config belongs to your organization only. When the page opens, your current settings load
        from the server; until they arrive you'll see a gray pulsing block. After making changes, always
        confirm with the <HelpKey>Save changes</HelpKey> button at the bottom — nothing saves
        automatically except regenerating and copying the key.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a blue chat icon next to the <HelpKey>Web Chat Widget</HelpKey> title and the
          subtitle "Embed a live chat bubble on your website". Below it sits a stack of section cards:{" "}
          <strong>Widget enabled</strong> toggle, <strong>Embed snippet</strong>,{" "}
          <strong>Appearance</strong>, <strong>Behavior</strong>, <strong>Working hours</strong>, and{" "}
          <strong>Allowed origins</strong>. At the very bottom, aligned to the right, is the{" "}
          <HelpKey>Save changes</HelpKey> button.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Widget enabled">The master toggle that shows/hides the chat bubble across every embed at once.</HelpDef>
          <HelpDef term="Embed snippet">The ready-made &lt;script&gt; line you paste on your site — it carries your public key.</HelpDef>
          <HelpDef term="Public key">The code that ties the widget to your organization; "Regenerate key" resets it.</HelpDef>
          <HelpDef term="Appearance">The chat window's title, primary color, greeting message, on-screen position, and offline message.</HelpDef>
          <HelpDef term="Behavior">Three checkboxes: Da Vinci (AI) auto-reply, create a ticket on an email, and show the floating launcher.</HelpDef>
          <HelpDef term="Working hours">A schedule that, when on, pauses AI replies and shows the offline message outside hours.</HelpDef>
          <HelpDef term="Allowed origins">The list of site URLs allowed to run the widget — leave empty and it runs anywhere.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: enable the widget and embed it">
        <HelpStep n={1}>
          <p>
            In the top <strong>Widget enabled</strong> card, click the toggle on the right to turn it on.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The toggle turns green and its inner dot slides to the right. The "Turn off to hide the bubble
            on all embeds" hint beneath it stays the same. This isn't saved yet — the change only applies
            when you press <HelpKey>Save changes</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>Embed snippet</strong> card, click <HelpKey>Copy snippet</HelpKey> next to the{" "}
            <code>&lt;script&gt;</code> line shown in the gray box.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button's icon switches from the copy glyph to a "✓" check and the label reads{" "}
            <strong>Copied</strong> briefly, then reverts after about 2 seconds. The snippet is now on
            your clipboard.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Paste the copied snippet just before the <code>&lt;/body&gt;</code> tag on any page of your
            site.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The hint under the card reminds you of exactly this: "Paste the snippet before &lt;/body&gt;
            on every page where you want the chat to appear." When the site reloads, the chat bubble
            appears in the corner you chose.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: tune the appearance">
        <HelpStep n={1}>
          <p>
            In the <strong>Appearance</strong> card, type the chat window name into the{" "}
            <HelpKey>Title</HelpKey> field, then click the color picker in <HelpKey>Primary color</HelpKey>{" "}
            and choose a color matching your brand.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The section is a two-column grid: a text box for the title on the left, a color picker (a small
            colored swatch) on the right. The text appears as you type; the swatch changes as you pick a
            color.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Write the first message visitors see into the <HelpKey>Greeting message</HelpKey> box (a
            two-line field).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The greeting box spans the full width of the card and is two rows tall; your text is reflected
            exactly as entered.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick where the bubble shows on screen from the <HelpKey>Position</HelpKey> dropdown:{" "}
            <strong>Bottom right</strong> or <strong>Bottom left</strong>. Optionally fill in the{" "}
            <HelpKey>Offline message</HelpKey> field.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Position dropdown offers only those two options. When the Offline message field is empty it
            shows the placeholder "We're offline — leave us a message" — that's a hint, not saved until you
            type something.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set behavior and working hours">
        <HelpStep n={1}>
          <p>
            In the <strong>Behavior</strong> card, tick the checkboxes you want:{" "}
            <HelpKey>Auto-reply with Da Vinci (AI)</HelpKey>,{" "}
            <HelpKey>Create a ticket when visitor leaves an email</HelpKey>, and{" "}
            <HelpKey>Show floating launcher button</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Three checkbox rows stacked top to bottom, each with its label beside it. Ticking one shows a
            "✓" in the box.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tick the <HelpKey>Enabled</HelpKey> checkbox to the right of the{" "}
            <strong>Working hours</strong> card heading.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            When ticked, rows for the seven weekdays (Mon, Tue, Wed, Thu, Fri, Sat, Sun) appear below.
            Unticking it hides the schedule again, and the hint under the heading stays visible: "When
            disabled, the widget is always online…".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            For each day, tick the <HelpKey>Open</HelpKey> checkbox and set the start/end time that
            appear. Optionally fill in the <HelpKey>Timezone</HelpKey> field below.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On a day marked "Open", two time pickers appear (start — end, defaulting to 09:00 — 18:00);
            unticking it marks the day closed and the time fields disappear. The Timezone field shows the
            "Europe/Warsaw" placeholder.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: allowed origins and saving">
        <HelpStep n={1}>
          <p>
            In the <strong>Allowed origins</strong> card, type the site URLs you allow the widget on,{" "}
            <strong>one per line</strong> as full URLs (e.g. <HelpKey>https://example.com</HelpKey>).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text area is four rows tall in a monospace font; when empty it shows two example URLs as a
            placeholder. The hint above it reads "One per line. Leave empty to allow any origin (not
            recommended for production)."
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Save changes</HelpKey> at the very bottom of the page.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to <strong>Saving…</strong> and becomes disabled while it works. Origins
            are normalized (only scheme + host kept, duplicates dropped). If an URL is invalid, nothing
            saves and a red warning appears under the text area: "Invalid origin: … Use full URL e.g.
            https://example.com".
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: regenerate the public key (security)">
        <HelpStep n={1}>
          <p>
            If you suspect the key has leaked, click <HelpKey>Regenerate key</HelpKey> in the{" "}
            <strong>Embed snippet</strong> card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A browser confirm dialog appears: "Regenerate public key? Existing embeds will stop working."
            After you confirm, the key (data-key) in the snippet is replaced with a new one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Auto-reply with Da Vinci (AI)</strong> and <strong>Working hours</strong> work together:
          when working hours are on, the AI reply pauses outside those hours and the visitor sees your{" "}
          <strong>Offline message</strong> instead. So fill the offline message with something meaningful.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Regenerate key</HelpKey> is irreversible: the old snippet (with the old data-key) on
          your sites stops working immediately. After regenerating, remember to copy the new embed snippet
          and replace it on your sites. Leaving allowed origins empty lets the widget run on any site —
          not recommended for production.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          The entire widget config is scoped to your organization — both loading and saving carry your
          organization identity (<code>x-organization-id</code>) on the request. The allowed-origins list
          is the key security control that keeps the chat from loading on sites you don't trust; fill it in
          for production.
        </p>
      </HelpCallout>
    </div>
  )
}
