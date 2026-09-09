"use client"

/**
 * T8 Cobrowse — agent session-viewer page (English).
 *
 * Covers only `/cobrowse/[id]`: the customer join URL, the status
 * badge (waiting → live → ended), the live video region, and the
 * Pause/Resume/End controls. Session creation (list page dialog) is
 * NOT covered here — only mentioned in passing.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function cobrowsesessiondetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support or sales rep"
        goal="Run a cobrowse session with a customer, watch their screen live, pause when needed, and end the session"
      >
        You reach this page by opening a session from the <HelpKey>Cobrowse</HelpKey>{" "}
        list (or by being redirected here right after creating a new session). All
        sessions belong only to your organization. <strong>You don&apos;t start the
        customer&apos;s screen</strong> — you send them a join link, they choose what
        to share (screen / tab / window), and you only ever see what they show.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Top-left has a <HelpKey>← Back to sessions</HelpKey> link, and below it the{" "}
          <strong>Session &lt;ID&gt;…</strong> heading (the first 8 characters of the
          session id). Under the heading you see a colored status badge and the
          session start time (<strong>Started …</strong>). Top-right, when the
          session is live or paused, the action buttons appear
          (<HelpKey>Pause</HelpKey>/<HelpKey>Resume</HelpKey> and{" "}
          <HelpKey>End</HelpKey>).
        </p>
        <p>
          Below sit two blocks: the <strong>Customer join URL</strong> (the
          customer&apos;s join link — visible until the session ends) and a large
          black <strong>live video region</strong>. Depending on the state, the video
          region shows either a &quot;waiting for customer&quot; message or the screen
          the customer is sharing.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Waiting for customer">Session created, but the customer hasn&apos;t opened the link and consented yet. The page auto-refreshes every 5 seconds.</HelpDef>
          <HelpDef term="Connecting…">Customer accepted — the WebRTC peer connection is being negotiated, no video yet.</HelpDef>
          <HelpDef term="Live">The customer&apos;s screen is streaming live and shows in the video region.</HelpDef>
          <HelpDef term="Paused">The session is temporarily on hold — the stream is suspended but the session isn&apos;t ended.</HelpDef>
          <HelpDef term="Ended">The session is over (you ended it, the customer left, it timed out, or an error). After this the join link is hidden.</HelpDef>
          <HelpDef term="Customer join URL">A ready-to-send link for the customer — a read-only field with a &quot;Copy&quot; button beside it.</HelpDef>
          <HelpDef term="Join token">The secure key at the end of the link (`/c/&lt;token&gt;`); the customer can&apos;t join the session without it.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: invite the customer to the session">
        <HelpStep n={1}>
          <p>
            As soon as the session opens, look at the <strong>Customer join URL</strong>{" "}
            block. Press the <HelpKey>Copy</HelpKey> button beside it to copy the link.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The link shows in a read-only text field. After you press{" "}
            <HelpKey>Copy</HelpKey>, the button briefly switches to{" "}
            <HelpKey>Copied</HelpKey> (with a check icon) and reverts after ~2 seconds.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Send the link to the customer — via chat, email, or SMS. The note under
            the block reminds you of exactly this.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the field there&apos;s the note &quot;Send this to the customer via
            chat, email, or SMS.&quot;: when the customer opens the link they&apos;ll
            be asked to share a screen, tab, or window.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Wait for the customer to join. If you like, use the{" "}
            <HelpKey>Check now</HelpKey> button in the video region to check the state
            immediately (without waiting for the auto-refresh).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The black video region shows a &quot;Waiting for customer to join…&quot;
            message and a <HelpKey>Check now</HelpKey> button. The status badge reads{" "}
            <strong>Waiting for customer</strong>. As soon as the customer consents,
            the badge goes first to <strong>Connecting…</strong>, then{" "}
            <strong>Live</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: manage the live session">
        <HelpStep n={1}>
          <p>
            When the customer joins and video arrives, the region shows the screen
            they&apos;re sharing. Top-right, the <HelpKey>Pause</HelpKey> and{" "}
            <HelpKey>End</HelpKey> buttons become active.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge turns green <strong>Live</strong>. The black region
            fills with the customer&apos;s live screen. There is no audio — video
            only (the stream is muted).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To pause temporarily, press <HelpKey>Pause</HelpKey>. To continue, press
            the <HelpKey>Resume</HelpKey> button that appears in the same place.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            While paused, the status badge turns yellow <strong>Paused</strong> and
            the button changes from <HelpKey>Pause</HelpKey> to{" "}
            <HelpKey>Resume</HelpKey>. The customer&apos;s side flips to a paused state
            immediately too — a signal is sent to them. Pressing{" "}
            <HelpKey>Resume</HelpKey> returns the badge to <strong>Live</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To finish the session, press the red <HelpKey>End</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge turns red <strong>Ended</strong>, the video region shows
            &quot;Session ended.&quot;, and the <strong>Customer join URL</strong>{" "}
            block and action buttons disappear. The customer is also signaled that the
            session has ended.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: switch between sessions or leave">
        <HelpStep n={1}>
          <p>
            To move to another session or return to the list, press the top-left{" "}
            <HelpKey>← Back to sessions</HelpKey> link.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            You return to the <HelpKey>Cobrowse</HelpKey> list page. The current live
            or paused session is <strong>not ended</strong> by this action — Back is
            treated as intentional navigation and keeps the session alive.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <HelpKey>Back to sessions</HelpKey> does not end the session, but{" "}
            <strong>closing the tab or window</strong> is different: on a live or
            paused session the browser shows a &quot;Leave site?&quot; prompt, and if
            you confirm the session is marked as &quot;agent ended&quot;. If you want
            to leave the customer connected and switch to other work, don&apos;t close
            the tab — navigate with <HelpKey>Back to sessions</HelpKey>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If the customer loses the link, the <strong>Customer join URL</strong> block
          stays visible even while the session is live — you can re-copy and re-send
          the same link. If the &quot;Copy&quot; button doesn&apos;t work (for example
          on a site that isn&apos;t HTTPS yet), click into the read-only field and
          select the text by hand to copy it.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All cobrowse sessions are scoped to your organization — you can&apos;t see
          another org&apos;s sessions. <strong>Control stays with the customer</strong>:
          they choose what to share, and you only see the screen they show (you have
          no control over their keyboard/mouse). The join token is not stored on the
          session list and is fetched separately only on this viewer page, so it
          can&apos;t leak into devtools.
        </p>
      </HelpCallout>
    </div>
  )
}
