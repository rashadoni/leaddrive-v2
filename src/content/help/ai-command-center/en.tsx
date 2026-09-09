"use client"

/**
 * Da Vinci Command Center — help article (English).
 * Video-script format mirroring az.tsx: covers the /ai-command-center page —
 * the Dashboard (KPIs, alerts, sessions, interaction logs, trace modal) and
 * the Agent Constructor (agent cards, new/edit form, handoffs, intent
 * distribution, rules & restrictions).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function aicommandcenterHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a support or operations admin"
        goal="Build Da Vinci AI agents, watch their conversations with customers, and keep an eye on quality, cost and latency"
      >
        You reach the page from the left menu via <HelpKey>Da Vinci Command Center</HelpKey>. The header
        carries a brain icon, and on the right a green <HelpKey>Agent online</HelpKey> badge with a
        pulsing dot. Below it are two large tabs: <HelpKey>Dashboard</HelpKey> and{" "}
        <HelpKey>Agent Constructor</HelpKey>. All agents, sessions, logs and metrics are scoped to your
        organization only.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          You switch between two tabs. <strong>Dashboard</strong> is read-only analytics: KPI cards,
          alerts, recent sessions and interaction logs. <strong>Agent Constructor</strong> is where you
          create, edit and set rules for agents. On the Dashboard the top row holds four big KPI cards
          (<strong>Total Sessions</strong>, <strong>Deflection Rate</strong>, <strong>CSAT</strong>,{" "}
          <strong>FCR Rate</strong>), followed by six round-icon cards (<strong>Avg. Resolution</strong>,{" "}
          <strong>Total Messages</strong>, <strong>Escalations</strong>, <strong>Avg. Latency</strong>,{" "}
          <strong>Total Cost</strong>, <strong>Quality Score</strong>).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Da Vinci agent">A configuration of your AI assistant — its model, tools, rules and behavior. You can have several agents; one is "active".</HelpDef>
          <HelpDef term="Total Sessions">The total number of chats opened with customers; today's active count is shown below it.</HelpDef>
          <HelpDef term="Deflection Rate">The percentage of chats resolved by the agent without handing off to a live operator; higher is better.</HelpDef>
          <HelpDef term="CSAT">Customer satisfaction score — an average out of 5.</HelpDef>
          <HelpDef term="FCR Rate">First-contact resolution rate.</HelpDef>
          <HelpDef term="Escalation">Handing a chat from the agent to a live operator; controlled by rules in the Constructor.</HelpDef>
          <HelpDef term="Alert">An automatic signal — such as a token spike or high latency; the unread count shows in a red badge.</HelpDef>
          <HelpDef term="Interaction log">A record of each answer to a question — with model, latency, cost, token count and its trace.</HelpDef>
          <HelpDef term="Rule / guardrail">A protective rule describing what the agent is not allowed to do.</HelpDef>
        </dl>
        <p>
          Lower on the Dashboard sits the <strong>Alerts</strong> block (bell icon), then the{" "}
          <strong>Sessions (7 days)</strong> table and the <strong>Interaction logs</strong> list. The
          Constructor tab instead has agent cards, <strong>Agent Handoffs</strong>,{" "}
          <strong>Intent Distribution</strong>, the <strong>Rules and restrictions</strong> block, and at
          the very bottom a "Create configuration by description" panel.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the Dashboard">
        <HelpStep n={1}>
          <p>
            From the tab row at the top, select <HelpKey>Dashboard</HelpKey> (it opens here by default).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The tab takes on a gradient color. Below, four KPI cards appear: <strong>Total Sessions</strong>{" "}
            (message icon), <strong>Deflection Rate</strong> (a percent plus a colored bar),{" "}
            <strong>CSAT</strong> (star, "—" or N/5) and <strong>FCR Rate</strong> (lightning icon). With
            no data yet, the numbers read zero or "—".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Review the six round-icon cards in the second row: <strong>Avg. Resolution</strong> (min),{" "}
            <strong>Total Messages</strong>, <strong>Escalations</strong>, <strong>Avg. Latency</strong> (s),{" "}
            <strong>Total Cost</strong> ($) and <strong>Quality Score</strong> (out of 10).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Many labels have an info icon (a small "i") — hover it and the meaning of that metric opens. Cost
            is in dollars, latency in seconds.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Look at the <HelpKey>Alerts</HelpKey> block. If there are unread alerts, the header shows a red
            count badge and a <HelpKey>Mark read</HelpKey> button on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each alert row shows its type (e.g. token spike or high latency), a message, and how long ago it
            happened. An alert tied to a session has an eye-icon <HelpKey>Trace</HelpKey> link on the right.
            With none, "No alerts" is shown. Pressing <HelpKey>Mark read</HelpKey> clears the amber
            highlights and resets the count.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: open a session or a log trace">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Sessions (7 days)</HelpKey> table, press the <HelpKey>Details</HelpKey> (eye
            icon) button on the right of a row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The table has columns for the (shortened) session id, message count, a status badge (active /
            resolved / closed / escalated) and date; a search field sits above. With none, "No sessions" is
            shown. <HelpKey>Details</HelpKey> opens a chat window — user messages on the right, agent
            replies on the left as bubbles.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <HelpKey>Interaction logs</HelpKey> list below, click any row (the header shows the total
            count in parentheses).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each row shows a number, the start of the user's question, a model badge, latency (seconds — slow
            in red, fast in green), cost and token count. Clicking a row opens the full{" "}
            <strong>trace</strong> modal. With none, "No logs" is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the trace modal, read the processing steps, then close it with the × at top right (or by
            clicking the empty backdrop).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The modal has four cards — <strong>Latency</strong>, <strong>Tokens</strong>, <strong>Cost</strong>,{" "}
            <strong>Quality</strong>; the user's question; a colored processing cascade (KB search, tools, LLM
            call); step-by-step cards (KB search — how many articles found/selected; LLM call — input/output
            tokens; and tool calls if any) and Da Vinci's response at the bottom. A Copilot log carries a
            separate "Copilot" badge.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: create a new Da Vinci agent">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Agent Constructor</HelpKey> tab at the top, then press{" "}
            <HelpKey>New configuration</HelpKey> on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A wide "New AI Agent" form opens. In order it has: an <strong>Agent Name</strong> field with an
            active/inactive toggle beside it, an <strong>AI Model</strong> choice, <strong>Parameters</strong>,{" "}
            <strong>Agent Capabilities</strong>, <strong>Escalation</strong>, agent orchestration, a{" "}
            <strong>System Prompt</strong> and <strong>Notes</strong> sections.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type an <strong>Agent Name</strong> (e.g. "Support Pro"). This is required. Use the toggle beside
            it to decide whether the agent is immediately <HelpKey>Active</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If you try to save with an empty name, a red "Enter agent name" warning appears at the top. The
            toggle reads <strong>Active</strong> when green and <strong>Inactive</strong> when gray.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the <HelpKey>AI Model</HelpKey> section, press one of three choices:{" "}
            <strong>Da Vinci Lite</strong> (fast/cheap), <strong>Da Vinci Pro</strong> (balanced), or{" "}
            <strong>Da Vinci Ultra</strong> (most capable).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each model card shows a name, a short description, and the price per 1 million tokens. The
            selected card gets a border and a "Selected" badge.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Tune the three sliders in <HelpKey>Parameters</HelpKey>: <strong>Response Length</strong>{" "}
            (short↔detailed), <strong>Creativity</strong> (precise↔creative), and{" "}
            <strong>KB Articles</strong> (1↔10).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The current number updates instantly in blue to the right of each slider; the labels at the ends
            (e.g. "Short" / "Detailed") show what each direction means.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            In <HelpKey>Agent Capabilities</HelpKey>, turn on the tool groups the agent may use — for example{" "}
            <strong>CRM Data Access</strong>, <strong>Ticket Creation</strong>, <strong>Knowledge Base</strong>{" "}
            and others.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each group shows a name, a short description, and a toggle on the left. An enabled group turns
            blue. Turning a group on enables all the tools inside it at once.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            In the <HelpKey>Escalation</HelpKey> section, keep the top toggle on for handing off to a live
            operator and check the rules that apply (e.g. customer asks for an operator, angry customer,
            billing question). If you like, type your own rule in the field below and add it with{" "}
            <HelpKey>+</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Some rules carry an "Always" badge — those can't be turned off. A checked rule's background turns
            reddish; custom rules are listed below on an amber background and removed with a trash icon. If you
            turn the Escalation toggle off, all rules are hidden.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Optionally set up agent orchestration: <strong>Agent Type</strong> (General, Sales, Support,
            Marketing, Analyst, Contract), <strong>Department</strong>, <strong>Priority</strong>,{" "}
            <strong>Max Tool Rounds</strong>, the intents it handles, and a custom greeting. Then add a{" "}
            <strong>System Prompt</strong> and <strong>Notes</strong> if you wish.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Agent types appear as a five-column card grid, the selected one bordered orange. Intent labels turn
            orange when clicked. The system prompt and notes are multi-line text fields.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={8}>
          <p>
            Press <HelpKey>Create Agent</HelpKey> at the bottom (if you change your mind — close with{" "}
            <HelpKey>Cancel</HelpKey> or ×).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to "Saving…", then the dialog closes and the new agent appears in the card
            grid in the Constructor. An active agent shows a green "ACTIVE" badge.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: edit, activate or delete an agent">
        <HelpStep n={1}>
          <p>
            In the Constructor, press the <HelpKey>Edit</HelpKey> (pencil icon, amber) button on an agent
            card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens, but every field is pre-filled with the existing configuration. The title
            reads "Edit AI Agent"; make your changes and confirm with <HelpKey>Save</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            To switch on an inactive agent, press the <HelpKey>Activate</HelpKey> (power icon, green) button
            on its card. This button only appears on agents that aren't active.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The card refreshes and comes back with a green "ACTIVE" badge and a brain-icon gradient
            background.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete an agent, press the <HelpKey>Delete</HelpKey> (red trash icon) button on its card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Delete Da Vinci agent" confirmation dialog opens and shows the agent's name. After you confirm,
            the card leaves the grid. With no agents left, an empty state appears (brain icon + "No Da Vinci
            agents configured" + "Create your first agent to get started").
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: add or remove a rule (guardrail)">
        <HelpStep n={1}>
          <p>
            In the <HelpKey>Rules and restrictions</HelpKey> block near the bottom of the Constructor, press
            the red <HelpKey>New rule</HelpKey> button on the right — the page scrolls to the add form below.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The block's header has a shield icon and a "What the agent is not allowed to do" description. With
            no rules, "No rules" is shown.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fill in the <HelpKey>Rule name</HelpKey> field (required), optionally add a{" "}
            <strong>Description</strong> and a prompt-injection text for the system prompt, then press{" "}
            <HelpKey>Add</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The <HelpKey>Add</HelpKey> button stays disabled while the rule name is empty. After adding, the
            new rule appears in the list above with a shield icon and the fields clear.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To remove a rule, press the trash icon on its row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The rule disappears from the list immediately.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          The "Create configuration by description" panel at the very bottom of the Constructor lets you
          describe an agent role in plain text and get a configuration automatically — handy for a quick
          start. You can keep several agents at once; the <strong>Agent Handoffs</strong> and{" "}
          <strong>Intent Distribution</strong> blocks show how work is split between them (they can be empty
          until data accumulates).
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          The Dashboard is <strong>read-only</strong> — you can't change an agent there; all configuration
          changes happen in the <HelpKey>Agent Constructor</HelpKey> tab. Deleting an agent or a rule is not
          reversible; if you only want to pause an agent, turn off its active toggle in the edit form instead
          of deleting it.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All agents, sessions, logs, alerts and rules are scoped to your organization — you never see
          another tenant's data. A more powerful model (Da Vinci Ultra) and longer responses raise the token
          cost; the <strong>Total Cost</strong> card and the cost column on each log help you track that
          spend.
        </p>
      </HelpCallout>
    </div>
  )
}
