"use client"

/**
 * Inbox Automation — help article (English).
 * Source script for the route-aware help video on /inbox/automation.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxAutomationHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You manage live inbox conversations"
        goal="Build one safe automation route without accidentally replying to customers"
      >
        Open <HelpKey>Omni-Channel</HelpKey> → <HelpKey>Automation</HelpKey>. The page is split by
        task: overview, builder, saved flows, and recent runs. Start in <HelpKey>Builder</HelpKey>;
        the visual canvas is for editing saved scenarios, not for the first setup.
      </HelpScenario>

      <HelpSection title="What the page does">
        <p>
          Inbox Automation creates scenarios for incoming messages. A scenario can assign the
          conversation to a queue, send a fixed reply, let AI answer, hand off to an agent, update a
          contact field, notify the team, or close the conversation.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Queue">The destination team bucket, for example Sales, Support, VIP, or TikTok leads.</HelpDef>
          <HelpDef term="Scenario">The rule that runs when a new inbound message arrives from selected channels.</HelpDef>
          <HelpDef term="Actions">The ordered steps LeadDrive runs after the trigger.</HelpDef>
          <HelpDef term="Runs">The audit trail to check what happened during a controlled test.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: create the first route">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>Builder</HelpKey>. In the work map, check the first missing step. If no
            queue exists yet, create one in <HelpKey>Team queues</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The setup strip marks <HelpKey>Create queue</HelpKey> as the next step. After saving a
            queue, the first action can use it as the destination.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Give the scenario a clear name and leave the status as <HelpKey>Draft</HelpKey> or{" "}
            <HelpKey>Paused</HelpKey> while preparing it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The work map marks the scenario name as ready, but live traffic is still protected.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Choose the channels where the route applies: TikTok, WhatsApp, Telegram, email, SMS,
            Facebook, Instagram, VKontakte, or web chat.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Selected channel chips fill in. If you add <HelpKey>Send reply</HelpKey> or{" "}
            <HelpKey>AI reply</HelpKey>, unsupported channels show a validation warning before save.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Add actions in order. For a first safe route, use{" "}
            <HelpKey>Assign to queue</HelpKey>. Add replies only after you have confirmed the target
            channel supports sending.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The scenario preview updates from <HelpKey>message_inbound</HelpKey> to each action and
            then to <HelpKey>end</HelpKey>. Missing queue or empty reply text blocks saving.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Save the scenario, send one controlled test message, then open <HelpKey>Runs</HelpKey>{" "}
            to verify the exact path.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Recent runs show the flow name, conversation, status, current node, and step count.
            Only after this check should the live flag and active status be used together.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning" label="Safety rule">
        Saving a scenario is configuration. It should not start replying to real customers by
        itself. Treat live enablement as a separate controlled step after one successful test.
      </HelpCallout>

      <HelpCallout kind="tip" label="Fastest safe start">
        Use the <HelpKey>Route messages to a team</HelpKey> template first. It creates a simple
        inbound-message-to-queue draft, which is easier to verify than starting with AI replies.
      </HelpCallout>
    </div>
  )
}
