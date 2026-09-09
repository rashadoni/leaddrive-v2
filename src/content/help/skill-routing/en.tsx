"use client"

/**
 * Skill Routing — help article (English).
 * One Support-module hub: agent skills + ticket queues on a single page, so an
 * incoming ticket auto-routes to the right agent by its category.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SkillRoutingHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Support lead"
        goal="Set up which agent picks up which ticket — from one page"
      >
        The page has two sections: <strong>Agent Skills</strong> at the top (every
        agent and their skills) and <strong>Ticket Queues</strong> below (the rules
        that route categories to agents). You only see your own organization&apos;s
        agents and queues.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The two sections work together: a <strong>queue</strong> defines the
          canonical skill list, and an <strong>agent</strong>{" "}
          <strong>picks</strong> from that list — they don&apos;t type. That&apos;s
          what stops drift like &ldquo;technical&rdquo; / &ldquo;texniki&rdquo; /
          &ldquo;tech&rdquo;; every skill is stored lowercase.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Skill">A ticket category an agent can handle (e.g. technical, complaint).</HelpDef>
          <HelpDef term="Queue">A routing rule that groups one or more skills.</HelpDef>
          <HelpDef term="Catch-all queue">A queue with no skills — it takes the ticket when no specific queue matches.</HelpDef>
          <HelpDef term="Method">Least Loaded (agent with the fewest open tickets) or Round Robin (in turn).</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="How routing works">
        <p>When a new ticket arrives, the system walks this chain:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>It reads the ticket&apos;s <strong>category</strong> (e.g. technical).</li>
          <li>It finds the <strong>queue</strong> whose skills include that category.</li>
          <li>It picks the <strong>available</strong> agents (active, under their ticket limit) whose skills overlap the queue.</li>
          <li>It assigns one of them by the queue&apos;s <strong>method</strong>.</li>
        </ol>
        <p>
          If no skill-queue matches, the ticket falls to the{" "}
          <strong>catch-all queue</strong> and goes to the least-loaded agent.
        </p>
        <HelpCallout kind="warning">
          If an agent has no skills, they never land in a skill-queue — they only
          receive tickets from the catch-all. For routing to fire you need{" "}
          <strong>both the skill on the queue AND that skill on the agent</strong>.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: build a queue">
        <HelpStep n={1}>
          <p>
            In the <strong>Ticket Queues</strong> section below, click{" "}
            <HelpKey>New Queue</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <strong>Create Ticket Queue</strong> dialog opens: Queue Name,
            Skills, Priority, Assignment Method, and an &ldquo;Auto-assign
            tickets&rdquo; toggle.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Skills</HelpKey> field, pick existing chips; if you need
            a new skill, type it in the &ldquo;Add a skill…&rdquo; box and add it.
            The skill must equal the ticket category (e.g. <em>technical</em>,{" "}
            <em>complaint</em>). Leave it empty for a catch-all queue.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Selected skills show as orange chips — that&apos;s this queue&apos;s
            canonical list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Set <HelpKey>Priority</HelpKey> (higher = preferred) and{" "}
            <HelpKey>Assignment Method</HelpKey> (<strong>Least Loaded</strong> or{" "}
            <strong>Round Robin</strong>). <HelpKey>Auto-assign tickets</HelpKey> is on by
            default (turn it off if you don&apos;t want it), then click{" "}
            <HelpKey>Create Queue</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The queue appears in the list with its Skills (chips, or{" "}
            <strong>Catch-all</strong> if empty), Method, Priority, and{" "}
            <strong>Status</strong> — click the status to toggle Active/Inactive.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: give an agent skills">
        <HelpStep n={1}>
          <p>
            In the <strong>Agent Skills</strong> section at the top, each agent is a
            row — initials, name, and role.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row has a chip picker; the chips come from the skills you defined on
            the queues (agents pick, they don&apos;t type).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tap the chips for the skills that agent handles.{" "}
            <strong>There&apos;s no Save button</strong> — each tap saves immediately.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A small spinner next to the name (saving) → a green ✓ (saved). On a
            network error a red marker appears and the change is reverted
            (<strong>Couldn&apos;t save</strong>).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          If you see &ldquo;Add skills to a queue below first…&rdquo; instead of
          chips, no queue has any skills yet — build a queue first.
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        Both agents and queues are scoped to your own organization; you need
        settings-write permission to make changes.
      </HelpCallout>

      <HelpCallout kind="next">
        Once skills and queues are set up, incoming WhatsApp / web tickets
        auto-route to the right agent by category — watch the result in{" "}
        <strong>Tickets</strong> and <strong>Agent Desktop</strong>.
      </HelpCallout>
    </div>
  )
}
