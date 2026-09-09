"use client"

/**
 * Surveys & NPS — help article (English), video-script format.
 * Covers the list page only (src/app/(dashboard)/surveys/page.tsx):
 * creating a survey, status toggle, public link, sending invites, deleting.
 * The per-survey detail/analytics sub-page (/surveys/[id]) is NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SurveysHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You run customer success, support, or marketing"
        goal="Collect customer feedback — create an NPS, CSAT, or CES survey, share it, and gather responses"
      >
        The page lives under <HelpKey>Surveys</HelpKey> in the left sidebar. Every survey and
        response belongs to your organization only. Each survey has a public link — copy and share
        it, or send invites directly by email/SMS. The stat tiles (responses, promoters, NPS)
        update as responses come in.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading shows a star icon next to <HelpKey>Surveys</HelpKey>, with the line «Collect
          feedback with NPS, CSAT, CES and custom surveys» underneath and a <HelpKey>New survey</HelpKey>{" "}
          button in the top right. Below, surveys are shown as a two-column grid of cards. If you
          have no surveys yet, an empty state appears instead (star icon + «No surveys yet» +{" "}
          <HelpKey>New survey</HelpKey> button).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="NPS">Net Promoter Score — a 0–10 scale measuring how likely a customer is to recommend you.</HelpDef>
          <HelpDef term="CSAT">Customer Satisfaction — a 1–5 scale measuring satisfaction with a specific experience.</HelpDef>
          <HelpDef term="CES">Customer Effort Score — a 1–7 scale measuring how much effort the customer had to spend.</HelpDef>
          <HelpDef term="Custom">A free-form survey with no preset scale.</HelpDef>
          <HelpDef term="Promoters">The count of respondents who scored high on NPS — the ones who recommend you.</HelpDef>
          <HelpDef term="Public link">A /s/... URL — a page anyone can use to answer the survey without signing in.</HelpDef>
          <HelpDef term="Invite">Sending the survey link to recipients by email or SMS.</HelpDef>
        </dl>
        <p>
          Each survey card shows the name at the top (clicking it opens the survey's detail page),
          a <strong>status</strong> badge next to it (<HelpKey>Active</HelpKey>, <HelpKey>Paused</HelpKey>,{" "}
          <HelpKey>Draft</HelpKey>, or <HelpKey>Closed</HelpKey>) and a <strong>type</strong> badge
          (NPS / CSAT / CES / Custom); a description shows below if present. In the middle there are
          three figures: <strong>Responses</strong>, <strong>Promoters</strong> (green), and{" "}
          <strong>NPS</strong> («—» when there's no score yet). At the bottom are action buttons:{" "}
          <HelpKey>Copy public link</HelpKey>, <HelpKey>Open</HelpKey>, the status-toggle button,{" "}
          <HelpKey>Send invites</HelpKey> when the survey is active, and a red <HelpKey>Delete</HelpKey>{" "}
          on the right.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: create a new survey">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New survey</HelpKey> in the top right. (When you have no surveys, the
            button in the center of the empty state does the same thing.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled «Create a new survey» opens. It contains a <strong>Survey name *</strong>{" "}
            field, a <strong>Type</strong> dropdown, a <strong>Description (optional)</strong> field,
            and two checkboxes below.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Survey name</strong> — this is the only required field (e.g.
            «Post-support CSAT»).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The text appears in the field as you type. While the name is empty, the{" "}
            <HelpKey>Create</HelpKey> button below stays disabled (not clickable).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick the survey kind from the <strong>Type</strong> dropdown:{" "}
            <HelpKey>NPS (0–10)</HelpKey>, <HelpKey>CSAT (1–5)</HelpKey>,{" "}
            <HelpKey>CES (1–7)</HelpKey>, or <HelpKey>Custom</HelpKey>. Optionally add a{" "}
            <strong>Description</strong> — this text is shown to respondents.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The selected type shows in the dropdown; NPS is selected by default. The scale range
            (e.g. 0–10) appears next to the type name.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Toggle the checkboxes as needed: the <HelpKey>Email</HelpKey> channel (checked by
            default) and <HelpKey>Send automatically after ticket is resolved</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A check mark appears in each box you tick. The <strong>Email</strong> channel signals
            the survey can be sent by email; the second box turns on the trigger that
            auto-sends the survey when a support ticket moves into «resolved».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create</HelpKey> below. (Changed your mind? Close with{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to <HelpKey>Saving…</HelpKey> while it creates, then the dialog
            closes and the new survey appears as a card in the list — its starting figures at zero
            and NPS at «—».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: share the link or send invites">
        <HelpStep n={1}>
          <p>
            On a survey card, click <HelpKey>Copy public link</HelpKey> to copy the /s/... URL to
            your clipboard.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The link is copied to the clipboard — paste it anywhere (a message, a doc). Anyone who
            opens that URL can answer the survey without signing in.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To check how the survey looks, click <HelpKey>Open</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The public survey page opens in a new tab — the form a respondent will see.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To send the link directly, click <HelpKey>Send invites</HelpKey>.{" "}
            <strong>Note:</strong> this button only appears while the survey is <HelpKey>Active</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A dialog titled «Send survey invites» opens. At the top there are <HelpKey>Email</HelpKey> /{" "}
            <HelpKey>SMS</HelpKey> toggle buttons, a text area below, one checkbox, and an
            explanatory note.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Pick the channel. With <HelpKey>Email</HelpKey> selected, type email addresses; with{" "}
            <HelpKey>SMS</HelpKey> selected, type phone numbers — separate each with a comma or a
            new line. To send to everyone in the org, tick{" "}
            <HelpKey>Send to all active contacts in the org</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Switching the channel changes the text area's label (Email addresses / Phone numbers)
            and the example placeholder (e.g. <code>user1@example.com</code> or{" "}
            <code>+994501234567</code>). A note below explains that unsubscribed recipients are skipped.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Send</HelpKey> below.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a loading state while sending, then a result banner appears in the
            dialog: green on success (how many sent / total / skipped / failed), red on error. While
            both the text area and the «all contacts» box are empty, the <HelpKey>Send</HelpKey>{" "}
            button stays disabled.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: pause, resume, or delete a survey">
        <HelpStep n={1}>
          <p>
            To pause or re-activate a survey, click the status-toggle button on the card. On an
            active survey the button reads <HelpKey>Paused</HelpKey>; on a paused survey it reads{" "}
            <HelpKey>Active</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The status badge at the top of the card changes (e.g. <HelpKey>Active</HelpKey> ↔{" "}
            <HelpKey>Paused</HelpKey>). When the survey is paused, the <HelpKey>Send invites</HelpKey>{" "}
            button disappears from the card, because it's only available for active surveys.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete a survey entirely, click the red <HelpKey>Delete</HelpKey> button on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog opens showing the survey's name. After you confirm, the survey
            leaves the list.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Deletion can't be undone. If you think you might run the survey again, toggle it to{" "}
            <HelpKey>Paused</HelpKey> instead of deleting — the survey and the responses it
            collected stay, only no new invites go out.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Type sets the scale, not just a label: <HelpKey>NPS</HelpKey> is a likelihood question
          (0–10), <HelpKey>CSAT</HelpKey> is satisfaction (1–5), <HelpKey>CES</HelpKey> is effort
          (1–7). Picking the right type is what makes the <strong>NPS</strong> and{" "}
          <strong>Promoters</strong> figures on the card meaningful.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          If a survey is <HelpKey>Paused</HelpKey> or <HelpKey>Draft</HelpKey>, the{" "}
          <HelpKey>Send invites</HelpKey> button isn't shown. Toggle the survey to{" "}
          <HelpKey>Active</HelpKey> before sending invites.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All surveys, responses, and contact lists are scoped to your organization — you only see
          your own tenant's surveys and can only bulk-invite your own active contacts. The public
          link requires no authentication, so only share it with intended recipients. Recipients who
          unsubscribe are skipped automatically on bulk sends.
        </p>
      </HelpCallout>
    </div>
  )
}
