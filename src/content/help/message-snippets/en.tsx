"use client"

import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function MessageSnippetsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="You lead the team that answers customers" goal="So nobody types the same answer again and again">
        Saved replies are answers you send often. In a conversation type <HelpKey>/</HelpKey> and pick a reply from the list: the customer's name fills in by itself, and you can edit the text before sending.
      </HelpScenario>

      <HelpSection title="The fields in the window">
        <dl className="rounded-md border p-3">
          <HelpDef term="What to type in a conversation">One word after /, for example <HelpKey>/hello</HelpKey>. Spaces and / are removed for you.</HelpDef>
          <HelpDef term="Name">Only your team sees it — to find the reply in the list.</HelpDef>
          <HelpDef term="Reply text">What the customer reads. The «+ Customer's first name» and «+ My name» buttons put an orange word in the text — it becomes the customer's details when the reply is inserted.</HelpDef>
          <HelpDef term="Where to show it">«In every channel» or «Only in chosen ones» — for example, only WhatsApp and SMS.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Creating a reply">
        <HelpStep n={1}>
          <p>First time: in «Start with ready ones» press <HelpKey>Add</HelpKey> on the reply you need.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>For your own text press <HelpKey>New reply</HelpKey> and fill in the three fields. The right side shows what the customer reads.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Press <HelpKey>Save reply</HelpKey> and try it in a conversation by typing /. The window at the top of the page works too.</p>
          <HelpCallout kind="tip">To hide a reply for a while, switch it off in its line — it is not deleted.</HelpCallout>
        </HelpStep>
      </HelpSection>
    </div>
  )
}
