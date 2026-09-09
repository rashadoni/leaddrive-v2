"use client"

/**
 * Cobrowse (T8) — help article for the support/sales agent (English).
 * Covers /cobrowse: the session list, the "Start new session" dialog
 * (optional Contact ID), and the /cobrowse/[id] viewer workflow
 * (join URL, Pause/Resume/End, live video). The customer-facing page
 * (/c/<token>) is separate — only the agent's view is described here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CobrowseHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a support or sales agent"
        goal="Watch a customer's screen live to help them — they pick what to share, and you only see what they show"
      >
        This is the <HelpKey>Cobrowse</HelpKey> page. It lists your organization's active and recent sessions and
        lets you start a new one. How it works: you create a session, the system issues a{" "}
        <strong>join URL</strong> for the customer, you send it via chat / email / SMS; once the customer opens it
        and <strong>chooses what to share</strong>, their screen appears live in your panel. Nothing is recorded,
        and audio is never captured.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows the <HelpKey>Cobrowse</HelpKey> title with the line «Watch a customer's screen during
          support — they pick what to share, you only see what they show» beneath it, and a{" "}
          <HelpKey>Start new session</HelpKey> button in the top-right. Below it you'll see one of three views: a
          «Loading sessions…» line while loading; an empty state if you have none yet; or the session table if you do.
        </p>
        <p>
          The table has four columns: <strong>Session</strong> (a short monospace id, with the customer's contact or
          «anonymous» beneath it), <strong>Status</strong> (a colored badge), <strong>Started</strong> (how long ago
          — e.g. «5d ago»), and an <strong>Open</strong> link on the right. Clicking a row or the id takes you to that
          session's viewer panel (<HelpKey>/cobrowse/&lt;id&gt;</HelpKey>).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Session">One cobrowse encounter — who's joining, its status, and when it started. Open the row to see the live panel.</HelpDef>
          <HelpDef term="Join URL">The address you send the customer (/c/&lt;token&gt;). Opening it asks them to grant screen / tab / window sharing.</HelpDef>
          <HelpDef term="Contact ID (optional)">Ties the session to an existing contact record so a «cobrowse» activity shows on that contact's timeline. Leave it empty and the session is «anonymous».</HelpDef>
          <HelpDef term="Status — pending / awaiting_consent">Session created; the customer hasn't joined or consented yet (grey badge).</HelpDef>
          <HelpDef term="Status — active">The customer has joined and their screen is being shared live (green badge).</HelpDef>
          <HelpDef term="Status — paused">You have temporarily paused the sharing (yellow badge).</HelpDef>
          <HelpDef term="Status — ended">The session is finished (red badge).</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: start a session and send the link">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Start new session</HelpKey> in the top-right. (If you have no sessions yet, the{" "}
            <HelpKey>Start your first cobrowse session</HelpKey> button in the middle of the empty state does the same.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small «Start cobrowse session» dialog opens. It has an explainer line, a <strong>Contact ID
            (optional)</strong> field (placeholder «cln… (leave empty for anonymous)»), and <HelpKey>Cancel</HelpKey>{" "}
            + <HelpKey>Create session</HelpKey> buttons below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Optionally enter a <strong>Contact ID</strong> to tie the session to an existing contact. For quick ad-hoc
            help, just leave it empty (the session is «anonymous»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A hint under the field reads «Tie the session to a Contact record so the timeline gets a "cobrowse"
            activity». What you type appears in the field as you go.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Click <HelpKey>Create session</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to «Creating…». On success the dialog closes, you're taken straight to that session's
            viewer panel, and the new row appears at the top of the list. If it fails, a red error message (e.g. the
            server response) shows in the dialog and it stays open.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In the viewer panel, grab the address in the <strong>Customer join URL</strong> section with the{" "}
            <HelpKey>Copy</HelpKey> button (or click the read-only field to select it manually), then send it to the
            customer via chat / email / SMS.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            At the top there's a <HelpKey>← Back to sessions</HelpKey> button and a monospace heading with the short
            session id, plus a status badge (e.g. <strong>Waiting for customer</strong>) and the start time. The Copy
            button briefly switches to a confirmation (<strong>Copied</strong>) when pressed. Below it reads «Send this
            to the customer via chat, email, or SMS…».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: run the session once the customer joins">
        <HelpStep n={1}>
          <p>
            Until the customer joins, the panel is in a <strong>waiting</strong> state. To check for a status change
            right away you can click <HelpKey>Check now</HelpKey> in the video area (the panel also auto-checks every 5
            seconds).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The black video area shows «Waiting for customer to join…» with a <HelpKey>Check now</HelpKey> button
            beneath it. When the customer agrees to join, the text changes to «Customer accepted — negotiating peer
            connection…» and the status badge becomes <strong>Connecting…</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            After the customer picks what to share, their screen appears live in the area and the status becomes{" "}
            <strong>Live</strong>. If needed, use the <HelpKey>Pause</HelpKey> button in the top-right to temporarily
            stop the sharing.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The customer's shared screen / tab / window starts playing in the black area. The status badge turns green{" "}
            <strong>Live</strong>; the <HelpKey>Pause</HelpKey> and <HelpKey>End</HelpKey> buttons appear in the
            top-right. If you pause, the status turns yellow <strong>Paused</strong> and the button switches to{" "}
            <HelpKey>Resume</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            When you're done, click the red <HelpKey>End</HelpKey> button in the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The video stops, the status turns red <strong>Ended</strong>, and «Session ended.» appears. The join URL
            section disappears. If you go back with <HelpKey>← Back to sessions</HelpKey>, that row now shows status{" "}
            <strong>ended</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          If the customer loses the link (e.g. closes the tab), the <strong>Customer join URL</strong> section stays
          visible in the viewer until the session ends — just <HelpKey>Copy</HelpKey> the same link again and resend
          it. To move between sessions, use <HelpKey>← Back to sessions</HelpKey> — that does not end the live session,
          it only returns you to the list.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Don't close the browser tab directly while a session is live or paused — if you do, the browser shows a
          «leave site?» prompt and the session may be auto-marked <strong>ended</strong>. If you want to keep working
          with the customer, leave the tab open instead of closing it.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Cobrowse is fully consent-based: you can't «force» your way onto any screen — the customer opens the link and{" "}
          <strong>chooses what to share (screen / tab / window)</strong>, can stop sharing at any moment, nothing is
          recorded, and audio is never captured. Every session belongs to your organization only; for security the
          join token is not included in the session-list JSON — it's loaded separately only when you open the viewer.
        </p>
      </HelpCallout>
    </div>
  )
}
