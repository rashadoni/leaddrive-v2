"use client"

import { HelpCallout, HelpKey, TrainingGuide } from "./guide"

export default function InboxAiTrainingHelpEn() {
  return (
    <TrainingGuide
      persona="You are the administrator who decides who answers customers"
      goal="Teach the AI to answer the way your team does, and hand it the channel when it is ready"
      tocTitle="What is where on the screen"
      intro={
        <>
          Section <HelpKey>Omni-Channel → AI training</HelpKey>. While a channel is in training your team answers,
          and the AI silently reads their answers and learns how they write (character) and what they say
          (knowledge). Customers notice nothing.
        </>
      }
      parts={[
        {
          id: "channels",
          title: "Channels at the top",
          body: (
            <>
              <p>
                Each card is one channel — Instagram, Facebook, WhatsApp, Telegram, TikTok — with who answers now
                (<HelpKey>Training · day N</HelpKey>, <HelpKey>AI answers</HelpKey>, <HelpKey>Your team answers</HelpKey>)
                and its readiness. Click a card to open everything about that channel below.
              </p>
              <p>
                To begin, pick a channel and press <HelpKey>Start training</HelpKey>. The same setting is in{" "}
                <HelpKey>AI Agent → Who replies on each channel</HelpKey>, option <HelpKey>Training</HelpKey>. The AI
                reads the last 7 days of conversations at once.
              </p>
            </>
          ),
        },
        {
          id: "readiness",
          title: "Readiness: how to read the figure",
          body: (
            <>
              <p>
                The big number is on how many of the latest customer questions the AI would have answered with the
                same meaning as your team. On every second question it silently writes its own answer, sends it to
                nobody and compares it with your team&apos;s.
              </p>
              <p>
                The bar below shows <HelpKey>The same</HelpKey>, <HelpKey>Almost the same</HelpKey>,{" "}
                <HelpKey>Differently</HelpKey>, <HelpKey>Would hand to a person</HelpKey>. Below it: growth by day and a
                second figure — how many frequent customer topics the AI already knows. Green — knows, yellow — waits
                for your confirmation, dashed — does not know yet.
              </p>
              <p>
                The same card shows <HelpKey>progress</HelpKey>: how many team answers and conversations of the week
                the AI found and has read, how many silent tries count towards the figure, and when the last and next
                passes are. While the AI reads, the page updates by itself.
              </p>
              <HelpCallout kind="tip" label="When to hand over">
                The figure appears after 30 comparisons, usually in 4–8 days. We recommend handing over from 80%.
              </HelpCallout>
            </>
          ),
        },
        {
          id: "differences",
          title: "«Where the AI would have answered differently»",
          body: (
            <p>
              Next to readiness: questions where the AI would have answered differently — the question, your team&apos;s
              answer and the AI&apos;s side by side. <HelpKey>Remember the team&apos;s answer</HelpKey> makes it knowledge;{" "}
              <HelpKey>The AI&apos;s answer is fine too</HelpKey> counts it as the same; <HelpKey>Open the conversation</HelpKey>{" "}
              jumps to that message in the inbox. Readiness is recalculated.
            </p>
          ),
        },
        {
          id: "bar",
          title: "Section bar and search",
          body: (
            <p>
              As you scroll, a thin bar stays on top: <HelpKey>Readiness</HelpKey>, <HelpKey>Waiting for you</HelpKey>,{" "}
              <HelpKey>Character</HelpKey>, <HelpKey>Knowledge</HelpKey> — click to jump. On the right, search: type
              «price», «address», «delivery» and only matching rows stay.
            </p>
          ),
        },
        {
          id: "prices",
          title: "Prices and offers wait for your «Confirm»",
          body: (
            <>
              <p>
                The AI never tells a customer a price, discount, «free» or promo code it learned until you press{" "}
                <HelpKey>Confirm</HelpKey>. Until then it hands price questions to your team.
              </p>
              <p>
                If your team named different prices the card says <HelpKey>Different prices</HelpKey>: click the one
                that is right now. When a price changes and someone names the new one, the card asks you again.
              </p>
            </>
          ),
        },
        {
          id: "character",
          title: "Character",
          body: (
            <p>
              How your team writes: tone, addressing, length, language, emoji, typical phrases, what they do not do.
              <HelpKey>Edit</HelpKey> or <HelpKey>Remove</HelpKey> any line — the AI never rewrites what you edited. Above
              the cards, <HelpKey>How the AI would answer now</HelpKey>: type a customer question and press{" "}
              <HelpKey>Show the AI&apos;s answer</HelpKey>; nothing is sent.
            </p>
          ),
        },
        {
          id: "knowledge",
          title: "Knowledge",
          body: (
            <>
              <p>
                What the AI tells customers: prices, services, addresses, hours, answers to common questions, rules.
                Filter by type and by source: <HelpKey>Learned by AI</HelpKey> or <HelpKey>Added by you</HelpKey>.
              </p>
              <p>
                Each row has <HelpKey>Edit</HelpKey> and <HelpKey>Delete</HelpKey>; a deleted row can be brought back with{" "}
                <HelpKey>Bring back</HelpKey>, and the AI will not add it again by itself.{" "}
                <HelpKey>From the conversation with …</HelpKey> opens the conversation it came from.{" "}
                <HelpKey>Add knowledge</HelpKey> adds your own — used at once.
              </p>
            </>
          ),
        },
        {
          id: "inbox",
          title: "Training inside the conversation",
          body: (
            <p>
              In the inbox, a channel in training shows a strip under the conversation header —{" "}
              <HelpKey>The AI is silent here and learns…</HelpKey> — with a link here. Under your team&apos;s answers:{" "}
              <HelpKey>The AI would have answered the same</HelpKey>, <HelpKey>The AI would have answered differently</HelpKey>{" "}
              (click to see its answer) and <HelpKey>Learned here: …</HelpKey>, which opens that row in knowledge.
            </p>
          ),
        },
        {
          id: "handover",
          title: "Hand the channel to the AI",
          body: (
            <>
              <p>
                <HelpKey>Hand the channel to the AI</HelpKey> under readiness offers two ways:{" "}
                <HelpKey>The AI writes a draft, your team sends it</HelpKey> — a safe first step — and{" "}
                <HelpKey>The AI answers on its own</HelpKey>. When it does not know or sees a complaint, it hands the
                conversation to your team.
              </p>
              <p><HelpKey>Back to training</HelpKey> returns the channel to training; what was learned is kept.</p>
            </>
          ),
        },
        {
          id: "cost",
          title: "What it costs",
          body: (
            <p>
              Every silent try and every «Show the AI&apos;s answer» is a paid AI call. Training stays within your
              company&apos;s daily AI limit; the spend is in <HelpKey>Settings → AI and spend</HelpKey> as «Inbox — AI training».
            </p>
          ),
        },
      ]}
    />
  )
}
