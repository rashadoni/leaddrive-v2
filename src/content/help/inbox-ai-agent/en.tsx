"use client"

/**
 * Inbox AI agent — help article (English).
 * Covers only Settings → Communication group's AI agent section
 * (AI agent: Omni-channel): four cards — persona editor + master switch,
 * per-channel "AI vs agent" matrix, 24h auto-follow-up, and escalate
 * keywords. The inbox itself (conversation list) is NOT in scope.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxaiagentHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're the administrator or communication-team lead responsible for the inbox"
        goal="Control how the AI answers incoming social messages, on which channels, re-engage customers who go silent, and hand a conversation to a human when needed"
      >
        The page is called <HelpKey>AI agent: Omni-channel</HelpKey> and covers only the inbox
        (communication) module's AI settings — it never bleeds into tickets or sales, because each module
        group has its own separate agent. Everything you see here applies only to your organization. The
        page is four independent cards; each card saves its own setting separately.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading shows <HelpKey>AI agent: Omni-channel</HelpKey> with a violet sparkle icon and a short
          description below. Underneath are four cards, top to bottom: <strong>AI agent persona</strong>,{" "}
          <strong>AI replies per channel</strong>, <strong>Auto-follow-up (24h silence)</strong>, and{" "}
          <strong>Escalate to a human</strong>. For the AI to actually answer a channel, three things must
          line up: the master switch on the persona card is on, that channel is set to <HelpKey>AI</HelpKey>
          {" "}in the matrix, and (optionally) a character is written.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="AI agent persona">
            The AI's character (system prompt), model, temperature, greeting, and hand-off behavior. At the
            top sits the master switch that decides whether the AI answers at all.
          </HelpDef>
          <HelpDef term="AI answers automatically">
            The master switch. If it's off, the AI won't reply even where a channel is set to "AI" in the
            matrix.
          </HelpDef>
          <HelpDef term="AI replies per channel">
            A matrix choosing who answers each channel: <HelpKey>Agent</HelpKey> (a human) or{" "}
            <HelpKey>AI</HelpKey>. Only supported channels are changeable; the rest show disabled with a
            "soon" badge.
          </HelpDef>
          <HelpDef term="Auto-follow-up (24h silence)">
            When a customer goes silent for 24h after your reply, the system sends one gentle nudge to
            re-engage them (09:00–21:00 Baku time only, one per conversation).
          </HelpDef>
          <HelpDef term="Escalate to a human">
            A keyword list. If an incoming message contains one of these words, the AI stays silent — the
            conversation is handed to a human and the team is notified.
          </HelpDef>
        </dl>
        <p>
          Each card has its own save control in its lower-right corner; on success a brief{" "}
          <strong>Saved</strong> confirmation lights up. If no TikTok channel is connected, the
          auto-follow-up and escalation cards show a "No TikTok channel connected yet" warning.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: turn the AI on and write its character">
        <HelpStep n={1}>
          <p>
            On the first card — <strong>AI agent persona</strong> — turn on the{" "}
            <HelpKey>AI answers automatically</HelpKey> switch at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the switch is the hint "Master switch. AI replies on channels set to 'AI' in the matrix
            below." The switch changes state immediately; no separate save is needed for it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>System prompt (character &amp; rules)</HelpKey> field, write how the AI should
            speak — its language, tone, and rules, for example. Leave it blank and the built-in default
            prompt is used.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The multiline field shows an example hint: "You are a polite assistant of AAC shoe store. Reply
            briefly in Azerbaijani…".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pick a model from the <HelpKey>Model</HelpKey> dropdown and adjust creativity with the{" "}
            <HelpKey>Temperature (creativity)</HelpKey> slider next to it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            There are three model options: "Haiku — fast &amp; cheap", "Sonnet — balanced", and "Opus —
            smartest". The temperature label shows the current value (0.0–1.0) and updates live as you drag
            the slider.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally type the first automatic message in the <HelpKey>Greeting (first message)</HelpKey>{" "}
            field and set the <HelpKey>Hand off to a human</HelpKey> switch.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The greeting field shows the example "Salam! Welcome to AAC." The "Hand off to a human" switch
            carries the note "AI calls an operator on complaints / human requests / refunds" and is on by
            default.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Save persona</HelpKey> at the bottom of the card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button shows a spinning icon while saving, then a green <strong>Saved</strong> confirmation
            (with a check) appears next to it for a few seconds. On failure, a red "Changes weren't saved"
            message shows above the button.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: choose who answers per channel">
        <HelpStep n={1}>
          <p>
            On the second card — <strong>AI replies per channel</strong> — find the row for the channel you
            want to change (e.g. TikTok). Each row shows the channel name, the config name beneath it, and a
            dropdown on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Unsupported channels carry a gray <HelpKey>soon</HelpKey> badge and their dropdown is disabled
            (not clickable). If no channels are set up, the text "No channels configured" is shown instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            From the dropdown on the right pick <HelpKey>Agent</HelpKey> (a human replies) or{" "}
            <HelpKey>AI</HelpKey> (the AI replies).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The choice saves instantly — there's no separate button. When <HelpKey>AI</HelpKey> is selected
            the dropdown text turns violet. The dropdown briefly disables while saving; on failure the
            choice reverts to its previous value.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            A small note with a bot icon at the bottom of the card reminds you: "AI mode needs the org AI
            assistant enabled (otherwise incoming just waits for an agent)." In other words, before setting a
            channel to <HelpKey>AI</HelpKey>, the <HelpKey>AI answers automatically</HelpKey> master switch on
            the first card must be on.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: set up the 24h auto-follow-up">
        <HelpStep n={1}>
          <p>
            On the third card — <strong>Auto-follow-up (24h silence)</strong> — turn on the{" "}
            <HelpKey>Enable auto-follow-up</HelpKey> switch at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Below the switch the fixed rules are shown: "One nudge per conversation · after 24h of silence ·
            09:00–21:00 (Baku) only". While the switch is off, the text field and its button below are
            disabled.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type the message to send in the <HelpKey>Reminder text</HelpKey> field (leave it blank to use the
            default text), then click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field shows the example "Salam! 👋 If your question is still relevant…" with the note "Leave
            blank to use the default text" beneath it. After saving, the button briefly switches to a{" "}
            <strong>Saved</strong> confirmation. If there's no TikTok channel, a "No TikTok channel connected
            yet — nobody to follow up with" warning is shown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: set escalate-to-human keywords">
        <HelpStep n={1}>
          <p>
            On the fourth card — <strong>Escalate to a human</strong> — type the words the AI must NOT answer,
            comma-separated, into the <HelpKey>Keywords (comma-separated)</HelpKey> field.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field shows an example hint: "complaint, manager, refund, agent". Beneath it is the note "The
            AI skips these messages — a human replies".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On save the words are cleaned automatically — duplicates are removed and extra spaces are trimmed
            — then the button briefly switches to a <strong>Saved</strong> confirmation. If no TikTok channel
            is connected, an amber "No TikTok channel connected yet" warning is shown.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The four cards complement each other: the persona controls <em>how</em> the AI replies, the matrix
          controls <em>where</em> (which channel) it replies, the auto-follow-up re-engages a silent customer,
          and escalation controls <em>when</em> the AI stops and hands off to a human. Save each card on its
          own — a change in one doesn't auto-save another.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All of these settings are scoped to your organization — the persona, channel modes, reminder text,
          and escalation words apply only to your tenant and don't touch another organization's inbox. The
          escalate keywords and auto-follow-up are currently tied to the TikTok channel; until a channel is
          connected they still save but don't act.
        </p>
      </HelpCallout>
    </div>
  )
}
