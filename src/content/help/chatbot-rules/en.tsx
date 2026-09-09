"use client"

/**
 * Chatbot auto-reply — help article (English).
 * First help article for /inbox/chatbot-rules: the org-level master switch
 * (chatbotAutoReply flag), the sentence-style rule builder (when → reply →
 * channels → priority), the rules list and status management.
 * Real UI only: the `chatbotRules` message namespace + chatbot-engine constants.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ChatbotRulesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're a customer-support or marketing owner"
        goal="Set up automatic replies to messages your customers send on social channels — no coding needed"
      >
        The page is called <HelpKey>Chatbot auto-reply</HelpKey>. The bot reads each incoming message and,
        if it matches one of your rules, replies instantly for you. Two things are required: turn the
        org-level master switch <strong>on</strong>, and create at least one <strong>On</strong> rule. Every
        rule belongs to your organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The header shows a robot icon next to <HelpKey>Chatbot auto-reply</HelpKey>, a short subtitle below
          it, and a <HelpKey>Tour</HelpKey> (replay) button at the top right. Below come four blocks in order:
          a collapsible <strong>“How it works”</strong> guide, the org-level <strong>master switch</strong>,
          the <strong>“New rule”</strong> form, and at the bottom the list of <strong>rules</strong> you've
          created. A yellow <strong>“Did you know?”</strong> tip strip sits between the form and the list.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Master switch">Turns auto-reply on/off for the whole organization. While it's off, even “On” rules won't reply.</HelpDef>
          <HelpDef term="Rule">One condition + one reply: “when a message matches X, the bot says Y”. Each rule has a name, a status, a trigger, and reply text.</HelpDef>
          <HelpDef term="Trigger (when)">The firing condition: contains the words / is exactly / starts with / is any message.</HelpDef>
          <HelpDef term="Status">A rule's state: On, Draft, or Paused. Only <strong>On</strong> rules reply.</HelpDef>
          <HelpDef term="Channels">The social channels the rule works on: Telegram, WhatsApp, Facebook, Instagram, VKontakte. Empty = all channels.</HelpDef>
          <HelpDef term="Priority">When several rules match the same message, this decides which replies first — the higher number wins.</HelpDef>
        </dl>
        <p>
          Each rule row shows the name, a colored status badge next to it (On is green, Draft amber, Paused
          gray), the priority indicator if it isn't 0, a one-line “trigger → start of reply”, and below that
          the channels plus a <HelpKey>{"replied {count}×"}</HelpKey> counter. On the right are a status
          dropdown and a red trash (delete) icon. When there are no rules yet, it reads “No rules yet —
          create one above.”
        </p>
      </HelpSection>

      <HelpSection title="Step by step: turn auto-reply on">
        <HelpStep n={1}>
          <p>
            Look at the master-switch card in the middle of the page. While it's off, the title reads{" "}
            <HelpKey>Auto-reply is OFF for this organization</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A gray power icon, the line “Nothing will reply until you turn this on — even rules marked ‘On’.”,
            and a <HelpKey>Turn on</HelpKey> button on the right.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Turn on</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card switches to a green background, the icon turns green, the title becomes{" "}
            <HelpKey>Auto-reply is ON for this organization</HelpKey>, and the button becomes{" "}
            <HelpKey>Turn off</HelpKey>. Now “On” rules will reply to matching messages.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a new rule">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>New rule</HelpKey> block, type a name in <HelpKey>Rule name (for you)</HelpKey> —
            for example “Price question”. This name is just for you; the customer never sees it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The field shows placeholder text “e.g. Price question”; what you type appears in it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>When should the bot reply?</HelpKey> row, pick a trigger from the dropdown:{" "}
            <HelpKey>contains the words</HelpKey>, <HelpKey>is exactly</HelpKey>,{" "}
            <HelpKey>starts with</HelpKey>, or <HelpKey>is any message</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The word “When the message” sits to the left of the dropdown. For every option except “is any
            message” a text field appears beside it. With “contains the words” a hint shows below: “Separate
            words with commas — the bot replies if the message contains any of them.”
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            If the trigger needs a value, fill the text field: comma-separated keywords for “contains the
            words” (e.g. <HelpKey>price, how much, cost</HelpKey>), or the exact text for the others. If you
            chose <HelpKey>is any message</HelpKey>, no value is needed — the bot replies to every message.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            “contains the words” shows the placeholder “price, how much, cost”; the other triggers show “the
            exact text”.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Write the bot's reply in the <HelpKey>What should the bot reply?</HelpKey> text box.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A multi-line text area with the placeholder “Type the reply the bot will send…”; your text lands here.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            In the <HelpKey>On which channels?</HelpKey> row, select channel chips by clicking them:{" "}
            <HelpKey>Telegram</HelpKey>, <HelpKey>WhatsApp</HelpKey>, <HelpKey>Facebook</HelpKey>,{" "}
            <HelpKey>Instagram</HelpKey>, <HelpKey>VKontakte</HelpKey>. If you pick none, the rule works on
            all channels.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A selected chip fills with color. When none are selected, the text “Empty = all channels” appears
            beside them.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Optionally set the <HelpKey>Priority</HelpKey> number below (default 0). Then click{" "}
            <HelpKey>Create rule</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Create rule</HelpKey> stays dimmed until the name, reply, and (if required) the trigger
            value are filled. After you click it the form clears and the new rule appears at the top of the{" "}
            <HelpKey>Rules</HelpKey> list; the count in the section title goes up by one.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: manage or delete a rule">
        <HelpStep n={1}>
          <p>
            To change a rule's status, pick <HelpKey>On</HelpKey>, <HelpKey>Draft</HelpKey>, or{" "}
            <HelpKey>Paused</HelpKey> from the dropdown on the right of its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The colored status badge in the row updates instantly. Only <strong>On</strong> rules reply;{" "}
            <strong>Draft</strong> and <strong>Paused</strong> rules don't.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To delete a rule entirely, click the red trash icon (<HelpKey>Delete</HelpKey>) on the right of
            its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The rule disappears from the list right away and the count in the title drops by one. If you
            delete them all, it shows “No rules yet — create one above.” again.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Click the collapsible <HelpKey>How it works</HelpKey> guide to see a four-step summary and a live
          example. In the yellow <HelpKey>Did you know?</HelpKey> strip, use <HelpKey>Next tip</HelpKey> to
          cycle through useful details — for instance, the bot won't reply to the same chat twice within 5
          minutes, so it never spams.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          If the master switch is OFF but you have <strong>On</strong> rules, a yellow warning appears at the
          bottom of the page: “You have active rules, but auto-reply is OFF…”. In that state the rules reply
          to nothing — turn on the master switch above to activate them. Also, if no rule matches a message,
          it's left for your team to answer — auto-reply never blocks a real conversation.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All rules and the master switch are scoped to your organization only — you can't see or change
          another organization's rules. The master switch is org-wide, so turning it off stops every
          auto-reply for your whole team.
        </p>
      </HelpCallout>
    </div>
  )
}
