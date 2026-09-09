"use client"

/**
 * Sequences — help article (English).
 *
 * Covers the Sales Sequences page (/sequences): building a multi-step
 * follow-up cadence of email / call / task steps, what each step type
 * actually does when it fires, how enrollments advance on the runner cron,
 * and the activate / edit / delete lifecycle. Confirmed against
 * src/app/(dashboard)/sequences/page.tsx, /api/v1/sequences[/[id][/enroll]],
 * /api/cron/sequences, and the SalesSequence / SequenceStep /
 * SequenceEnrollment models in prisma/schema.prisma.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SequencesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="Why this matters">
        <p>
          A <strong>sequence</strong> is an automated follow-up cadence — an ordered list of{" "}
          steps (an email, a call, a task) that fire on a day-by-day schedule after a lead or
          contact is enrolled. You design the cadence once and the runner works it for every
          enrolled person, so nobody falls through the cracks between touches.
        </p>
        <p>
          This page is where you <strong>build and manage</strong> those cadences. Enrolling a
          specific lead or contact happens elsewhere — here you author the steps, watch the
          enrollment counts, and switch a sequence on or off.
        </p>
      </HelpSection>

      <HelpSection title="The dashboard at a glance">
        <p>
          The top row shows three live counts across all your sequences:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Total Sequences">how many sequences exist</HelpDef>
          <HelpDef term="Active">how many are currently switched on</HelpDef>
          <HelpDef term="Total Enrollments">leads and contacts enrolled across every sequence</HelpDef>
        </dl>
        <p>
          Below that, each sequence is a card carrying an <HelpKey>Active</HelpKey> or{" "}
          <HelpKey>Inactive</HelpKey> badge, its step count, and its enrolled count. The{" "}
          search box filters the list by <strong>name</strong> or <strong>description</strong>.
          Click the chevron on a card to expand it and read its steps in order.
        </p>
      </HelpSection>

      <HelpSection title="Build a sequence">
        <p>
          A sequence has a <strong>name</strong>, an optional <strong>description</strong>, an{" "}
          <strong>Active</strong> flag, and an ordered list of <strong>steps</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Step type">email, call, or task</HelpDef>
          <HelpDef term="Delay">whole days to wait before this step (step&nbsp;1 defaults to 0 — same day)</HelpDef>
          <HelpDef term="Subject">email subject, or the title for a call / task step</HelpDef>
          <HelpDef term="Body">email body, or the description for a call / task step</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Press <HelpKey>New Sequence</HelpKey>, give it a name, and optionally a description.
            Leave <HelpKey>Active</HelpKey> ticked to let it start running.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>Add Step</HelpKey> for each touch. Pick the type, set the{" "}
            <strong>delay in days</strong>, and fill in the subject and body. Steps run in the
            order shown (#1, #2, #3…); the delay is counted from the previous step.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hit <HelpKey>Save Sequence</HelpKey>. A name is required; everything else is optional.
            A sequence with no steps is allowed, but it won&apos;t do anything until you add some.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="What each step actually does">
        <p>
          When a step comes due, the type decides what gets created against the enrolled lead or
          contact:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="call / task">creates a <strong>Task</strong> (status <em>pending</em>, priority <em>medium</em>, due that day) linked to the lead or contact, using the step&apos;s subject as the title and body as the description.</HelpDef>
          <HelpDef term="email">logs an <strong>email activity</strong> on the lead or contact&apos;s timeline with the step&apos;s subject and body.</HelpDef>
        </dl>
        <HelpCallout kind="warning">
          <p>
            An <strong>email step records a follow-up activity</strong> — it is a reminder on the
            timeline that an email is due, not an automatic send. Treat call, task, and email
            steps as scheduled to-dos your reps act on, not as a message that goes out by itself.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Enrollment &amp; how the cadence runs">
        <p>
          The <strong>enrolled count</strong> on each card is how many leads and contacts are
          attached to that sequence. A runner processes everyone automatically on a fixed
          schedule — roughly every <strong>15&nbsp;minutes</strong> it picks up enrollments whose
          next step is due and fires it, then schedules the one after.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="active">currently advancing through the steps</HelpDef>
          <HelpDef term="paused">temporarily held; resuming makes the next step due now</HelpDef>
          <HelpDef term="completed">the last step has fired</HelpDef>
          <HelpDef term="stopped">pulled out before finishing</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Each lead or contact can hold <strong>one enrollment per sequence</strong>. You can
            only re-enrol someone after their previous run is <em>stopped</em> or{" "}
            <em>completed</em> — an already-active enrollment is left as-is rather than restarted.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Activate, edit &amp; delete">
        <HelpStep n={1}>
          <p>
            The play / pause button on a card flips a sequence between <HelpKey>Active</HelpKey>{" "}
            and <HelpKey>Inactive</HelpKey>. Switching it off <strong>pauses processing</strong>{" "}
            for all of its enrollments at once — the runner skips an inactive sequence without you
            having to touch each person.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            The pencil opens the editor. Saving steps <strong>replaces the whole step list</strong>{" "}
            with what&apos;s on screen, so reorder or trim carefully — the previous steps are not
            merged in.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            The trash icon deletes the sequence after a confirm. Any of its <em>active</em> or{" "}
            <em>paused</em> enrollments are <strong>stopped first</strong>, then the sequence and
            its steps are removed.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Steps you mark inactive inside a sequence are hidden from the live cadence — the list
            and the runner only ever work the <strong>active</strong> steps, in order.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Every sequence, step, and enrollment is scoped to your organization — you only see and
          run your own tenant&apos;s cadences. Deleting a sequence stops its in-flight enrollments
          rather than abandoning them mid-cadence, and editing the steps replaces them outright,
          so review changes before you save.
        </p>
      </HelpCallout>
    </div>
  )
}
