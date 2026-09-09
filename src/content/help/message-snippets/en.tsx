"use client"

import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MessageSnippetsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're an inbox admin or team lead"
        goal="Prepare reusable replies so agents can answer faster without rewriting the same text"
      >
        Message snippets are saved replies for the inbox composer. Agents type a slash command such as{" "}
        <HelpKey>/greeting</HelpKey>, choose the snippet, review the text, and send it from the conversation.
      </HelpScenario>

      <HelpSection title="What each field means">
        <dl className="rounded-md border p-3">
          <HelpDef term="Shortcut">The word agents type after slash. Use one token, with no spaces and no /.</HelpDef>
          <HelpDef term="Title">An internal name for the team. Customers do not see it.</HelpDef>
          <HelpDef term="Message">
            The actual reply text. You can include variables such as <code>{"{{contact.name}}"}</code> and{" "}
            <code>{"{{agent.name}}"}</code>.
          </HelpDef>
          <HelpDef term="Channels">
            Leave empty when the wording is safe everywhere. Choose channels when a reply should appear only for
            WhatsApp, Telegram, SMS, email, or web chat.
          </HelpDef>
          <HelpDef term="Active">
            Turn this off to keep a snippet saved while hiding it from agents in the inbox.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Create a snippet">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New snippet</HelpKey>, enter a short shortcut, then add a clear internal title.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Write the reply in <HelpKey>Message</HelpKey>. Keep it ready to send, but assume agents will review it
            before sending.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Leave <HelpKey>Channels</HelpKey> empty for all channels, or pick the exact channels where the snippet
            should appear.
          </p>
          <HelpCallout kind="tip">
            Channel-specific snippets are useful when tone, links, or formatting differ between WhatsApp, SMS,
            email, and web chat.
          </HelpCallout>
        </HelpStep>
      </HelpSection>
    </div>
  )
}
