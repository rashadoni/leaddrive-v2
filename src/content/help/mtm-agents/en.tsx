"use client"

/**
 * Field Agents (MTM) — help article (English).
 *
 * Covers the /mtm/agents admin page: the roster of field agents who run
 * the Route & Field module from the mobile app — their roles, status,
 * manager hierarchy, login credentials, and how the web panel differs
 * from what a mobile caller sees.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmAgentsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          <strong>Field Agents</strong> is the roster of people who run the Route &amp; Field
          module from their phones — the field reps and supervisors who visit customer points,
          check in, complete field tasks, and take visit photos. Everything those agents do in
          the mobile app is tied back to a record you create here.
        </p>
        <p>
          This page is the web admin view: you add agents, give them login credentials, set their{" "}
          <strong>role</strong> and <strong>status</strong>, and chain them into a reporting line
          via the <strong>manager</strong> field. Get this list right and the rest of the module —
          routes, visits, territory scope — lines up behind it.
        </p>
      </HelpSection>

      <HelpSection title="The roster at a glance">
        <p>
          Four counters sit across the top, recalculated from the agents currently loaded:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Agents">Every agent record in your organization.</HelpDef>
          <HelpDef term="Active">Agents whose status is <em>Active</em>.</HelpDef>
          <HelpDef term="Online">Agents currently signed in on the mobile app (a live presence flag).</HelpDef>
          <HelpDef term="Managers">Agents with the <em>Manager</em> or <em>Supervisor</em> role.</HelpDef>
        </dl>
        <p>
          Below the counters, each agent is a card: an avatar initial, their name with a live{" "}
          <strong>online dot</strong> (a pulsing green ring when they&apos;re signed in, grey when
          offline), their email or phone, and pills for <strong>role</strong> and{" "}
          <strong>status</strong>. If the agent reports to someone, the manager&apos;s name shows
          on the card too.
        </p>
      </HelpSection>

      <HelpSection title="Find, filter &amp; export">
        <HelpStep n={1}>
          <p>
            Filter the roster by status with the <HelpKey>All</HelpKey> /{" "}
            <HelpKey>Active</HelpKey> / <HelpKey>Inactive</HelpKey> /{" "}
            <HelpKey>Suspended</HelpKey> buttons — each shows its own count.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Search</HelpKey> matches an agent&apos;s name <em>or</em> email. Then{" "}
            <HelpKey>Sort</HelpKey> the result by name (A → Z or Z → A), by role, or by status.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Export</HelpKey> downloads the currently filtered list as a{" "}
            <HelpKey>field-agents.csv</HelpKey> file with name, email, phone, role, and status —
            handy for a quick offline headcount or a share with HR.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Adding &amp; editing an agent">
        <p>
          Press <HelpKey>Add Agent</HelpKey> for a new record, or the pencil icon on a card to
          edit one. The form is the same either way:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Name">Required.</HelpDef>
          <HelpDef term="Email / Phone">Both optional. Email is unique per organization — you can&apos;t reuse one across two agents in the same tenant.</HelpDef>
          <HelpDef term="Password">The agent&apos;s mobile-app login. Required on create (at least 12 characters with uppercase, lowercase, a number and a special character); on edit, leave it blank to keep the current one.</HelpDef>
          <HelpDef term="Role">Agent, Supervisor, or Manager.</HelpDef>
          <HelpDef term="Status">Active, Inactive, or Suspended.</HelpDef>
          <HelpDef term="Manager">Who this agent reports to — picked from the existing roster (an agent can&apos;t be their own manager).</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            The password is what the agent types to sign in to the mobile app — it&apos;s not an
            email invite, so set it, then hand it over to them directly. It&apos;s stored hashed,
            never in plain text, and is never shown back to you after saving.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Roles &amp; the reporting line">
        <p>
          The <strong>Manager</strong> field builds a reporting hierarchy: a Supervisor or Manager
          sits above a group of Agents. That chain isn&apos;t cosmetic — it drives{" "}
          <strong>territory scope</strong> in the mobile app.
        </p>
        <HelpStep n={1}>
          <p>
            In the <strong>web admin panel</strong> (where you are now) you see <em>every</em>{" "}
            agent in your organization, regardless of role.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            On <strong>mobile</strong>, scope narrows by role: a <em>Manager</em> or{" "}
            <em>Supervisor</em> sees their own team or region, while an <em>Agent</em> sees only
            themselves. The chain you set here is exactly what decides that.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Agents are grouped into <strong>teams</strong> (and teams into regions) elsewhere in
            the Route &amp; Field module. The team and region behind an agent are what a manager&apos;s
            mobile scope reads from — so the org chart you build here pays off there.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Status &amp; deleting">
        <p>
          <strong>Status</strong> controls whether an agent is in active rotation:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Active">In service — counts toward the Active stat and works normally.</HelpDef>
          <HelpDef term="Inactive">Parked — kept on the roster but not in active duty.</HelpDef>
          <HelpDef term="Suspended">Blocked from duty without deleting the record.</HelpDef>
        </dl>
        <HelpCallout kind="warning">
          <p>
            <strong>Deleting an agent is permanent</strong> — the trash icon removes the record
            outright (there&apos;s no archive or undo). To take someone out of rotation but keep
            their history, set their status to <em>Inactive</em> or <em>Suspended</em> instead of
            deleting.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Every agent here is scoped to your organization — you only see and manage your own
          tenant&apos;s roster, and an agent&apos;s email has to be unique within it. Passwords are
          stored hashed, never echoed back, and redacted from the audit trail. Every create, edit,
          and delete is written to that audit log, so changes to who can sign in are always
          accountable.
        </p>
      </HelpCallout>
    </div>
  )
}
