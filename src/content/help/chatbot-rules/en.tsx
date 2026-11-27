"use client"

/** «Автоответы» (/inbox/chatbot-rules) — help article, rewritten with the page on 2026-11-27. */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ChatbotRulesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="You handle conversations with customers" goal="So the bot answers frequent questions by itself and the right conversations go straight to the right person">
        <HelpKey>Auto-replies</HelpKey> are rules by which the bot answers a customer by itself: «if they write <em>price</em> → reply … → hand to Leila». When no rule fits, the AI agent or a manager answers.
      </HelpScenario>

      <HelpSection title="What is on the page">
        <dl className="rounded-md border p-3">
          <HelpDef term="The «Auto-replies are on» switch">The main one. While it is off, the bot answers by no rule. Next to it — the channels the bot answers in.</HelpDef>
          <HelpDef term="Try it: write as a customer">Write a message — see which rule fires and what the customer gets. Nothing is sent.</HelpDef>
          <HelpDef term="Rules">Checked top to bottom; the first that fits fires. Reorder with the arrows, switch a rule off with its switch.</HelpDef>
          <HelpDef term="Leads from conversations — to a board">When a customer is seriously interested and leaves a phone number, the AI creates a lead and a task on the chosen board.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Creating a rule">
        <HelpStep n={1}><p>Press <HelpKey>New rule</HelpKey> and give it a name.</p></HelpStep>
        <HelpStep n={2}><p>Under «When the customer writes» choose: words (type one and Enter), the first message, or any message.</p></HelpStep>
        <HelpStep n={3}><p>Write the reply. <HelpKey>+ Customer's name</HelpKey> puts the name in when it is sent; you can also take a text from Saved replies.</p></HelpStep>
        <HelpStep n={4}>
          <p>Under «Then» you can choose <HelpKey>Hand to a person</HelpKey>: the conversation is assigned to them, they get a notice, and the AI no longer answers it. Several chosen — it goes to whoever has fewer open conversations.</p>
          <HelpCallout kind="tip">Start with the ready rules at the bottom of the page — each is added with one click and works at once.</HelpCallout>
        </HelpStep>
      </HelpSection>
    </div>
  )
}
