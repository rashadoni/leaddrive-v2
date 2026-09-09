"use client"

/**
 * Health detail (Patient Record) — help article (English).
 * Gold-standard structure: territories/az.tsx.
 * Source page: src/app/(dashboard)/health/[id]/page.tsx —
 * a single patient's read-only record: header card + four tabs
 * (Overview / Encounters / Care Plans / Medical Records).
 * There are NO create / edit / status-change controls on this page.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function HealthDetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You are a clinical staff member, front-desk admin, or provider"
        goal="Read one patient's complete clinical picture — demographics, encounters, care plans, and medical records — all in one place"
      >
        You reach this page by clicking a patient in the{" "}
        <HelpKey>Health Cloud</HelpKey> → <HelpKey>Patients</HelpKey> list. This is a{" "}
        <strong>read-only record</strong>: you view, switch between tabs, and browse entries —
        there are no create, edit, or status-change buttons here. Everything is scoped to your
        organisation.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          At the top there's a <HelpKey>Back to Patients</HelpKey> button. Below it sits a{" "}
          <strong>header card</strong> with a rose heart icon: the patient's{" "}
          <strong>full name</strong>, a coloured status badge next to it (<strong>active</strong> /{" "}
          <strong>inactive</strong> / <strong>deceased</strong>), and a row of short fields —{" "}
          <strong>medical record number (MRN)</strong> in a monospace font, plus date of birth,
          email, and phone where available. Only the fields that are filled in are shown.
        </p>
        <p>
          Under the header card come four <strong>tabs</strong>: <HelpKey>Overview</HelpKey>,{" "}
          <HelpKey>Encounters</HelpKey>, <HelpKey>Care Plans</HelpKey>, and{" "}
          <HelpKey>Medical Records</HelpKey>. The selected tab's label and underline turn rose.{" "}
          <strong>Overview</strong> loads immediately when the page opens; the other three tabs
          fetch their data only when you click them.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="MRN">
            Medical record number — the patient's unique identifier inside your organisation; shown
            in monospace in both the header and the Overview card.
          </HelpDef>
          <HelpDef term="Status">
            The patient's standing: <strong>active</strong> (green), <strong>inactive</strong>{" "}
            (grey), or <strong>deceased</strong> (red).
          </HelpDef>
          <HelpDef term="Encounter">
            An individual clinical visit for this patient — with a type, status, and time stamps.
          </HelpDef>
          <HelpDef term="Care Plan">
            A named long-term programme — with a status, start/end dates, and goals.
          </HelpDef>
          <HelpDef term="Medical Record">
            A clinical document — with a record type, date, and short summary.
          </HelpDef>
        </dl>
        <p>
          Note: some labels in the header and the Overview cards (<HelpKey>Demographics</HelpKey>,{" "}
          <HelpKey>Clinical Summary</HelpKey>, <HelpKey>MRN</HelpKey>, <HelpKey>Status</HelpKey>,{" "}
          <HelpKey>Registered</HelpKey>, and so on) appear in English whatever your interface
          language is — these are system defaults.
        </p>
      </HelpSection>

      <HelpSection title="Step by step: read the patient overview">
        <HelpStep n={1}>
          <p>
            When the page opens, the <HelpKey>Overview</HelpKey> tab is already selected — no extra
            click is needed.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Two side-by-side cards: on the left <strong>Demographics</strong> (MRN, Status, plus
            date of birth, email, phone where present, and the registered date), on the right{" "}
            <strong>Clinical Summary</strong> (the primary provider ID where present, and when the
            record was created).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Press one of the two quick-jump buttons under the <strong>Clinical Summary</strong>{" "}
            card — <HelpKey>Encounters</HelpKey> or <HelpKey>Care Plans</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The page switches straight to that tab (the same result as picking it from the tab row
            above) and that tab's data starts loading.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: review encounters">
        <HelpStep n={1}>
          <p>
            Pick the <HelpKey>Encounters</HelpKey> tab from the tab row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A brief <strong>loading spinner</strong> appears, then this patient's encounters are
            listed card by card. If there are none, a centred «No encounters recorded» message
            shows instead.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Scan an encounter card.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each card shows the <strong>encounter type</strong> on the left (e.g. «in person»,
            «telehealth»), a coloured <strong>status badge</strong> on the right (scheduled /
            checked in / in progress / completed / cancelled / no show), and below it whichever
            time stamps are filled in: scheduled, checked-in, completed, or cancelled.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: review care plans and medical records">
        <HelpStep n={1}>
          <p>
            Pick the <HelpKey>Care Plans</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Plan cards load: each shows the <strong>plan name</strong>, a coloured{" "}
            <strong>status badge</strong> (draft / active / paused / completed / cancelled), the
            start and end dates where present, and a goal count («N goal(s)»). If there are none,
            «No care plans on file» shows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick the <HelpKey>Medical Records</HelpKey> tab.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Record cards load: each shows a document icon, the <strong>record type</strong>, the
            date where present, and (if any) a <strong>summary</strong> clamped to three lines. If
            there are none, «No medical records» shows.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To go back to the patient list, press <HelpKey>Back to Patients</HelpKey> at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The patient record closes and you return to the <HelpKey>Patients</HelpKey> list.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          You can move freely between tabs — each tab loads its own data the first time you open
          it, so one tab finishing doesn't have to wait on another. If a tab looks empty (e.g. «No
          encounters recorded»), it simply means no entries exist yet for that patient — it's not
          an error.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          This page is <strong>read-only</strong>: it gives no way to add a new encounter, plan, or
          record, to change a status, or to edit fields. Those changes are made through the relevant
          clinical flows or the Health API.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Everything here is scoped to your organisation and gated by the <em>health</em> permission
          — you only see your own tenant's patient, encounters, plans, and records. Patient data is
          sensitive: each tab is fetched from the relevant Health API endpoints, sensitive free text
          is stored encrypted, and accesses are written to an audit log.
        </p>
      </HelpCallout>
    </div>
  )
}
