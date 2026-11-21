"use client"

/**
 * Deal detail (record) — help article (English).
 * The page of one deal: /deals/[id]. Mirrors deal-detail/az.tsx.
 * The page as redesigned on 2026-11-21: header and stage track, four tiles,
 * «What to do now» with planned tasks, four sections opened on demand,
 * Da Vinci as a side panel.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function dealdetailHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona={"You're a sales rep or sales manager"}
        goal={"Open a deal, see at once what to do about it, do it on the spot, and move it through its stages"}
      >
        You reach this page by clicking a deal in the <HelpKey>Sales Pipeline</HelpKey> list or board. It reads top to bottom: what the deal is and where it stands, its four numbers, what to do now, and below that the details, which stay closed until you need them.
      </HelpScenario>

      <HelpSection title={"What's on the page"}>
        <p>At the top is the <strong>header</strong>: the deal name, a coloured stage badge, the company, the contact and tags. On the right are <HelpKey>Reach out</HelpKey>, <HelpKey>Add a record</HelpKey>, <HelpKey>Da Vinci</HelpKey>, <HelpKey>Edit</HelpKey> and the bin. Under it is the <strong>stage track</strong>: passed stages carry a tick, the current one is filled, and <HelpKey>Lost</HelpKey> stands apart on the right because it is an outcome, not the next step.</p>
        <p>Then come <strong>four tiles</strong> (amount, payment, owner, next step), the <strong>What to do now</strong> block and a row of four sections: <HelpKey>Customer</HelpKey>, <HelpKey>Sale</HelpKey>, <HelpKey>Money and purchasing</HelpKey>, <HelpKey>History</HelpKey>. Hover any tile, section or stage for a hint about what it is and what a click does.</p>
        <dl className="rounded-md border p-3">
          <HelpDef term={"Tile"}>One number of the deal. A click leads to where it is worked on: amount opens products, payment opens invoices, owner opens the choice of a person, next step opens planning.</HelpDef>
          <HelpDef term={"What to do now"}>What is wrong with the deal and what the next stage asks for: unpaid invoices, no owner, no contact, the rules of the next stage. Each step is done right here.</HelpDef>
          <HelpDef term={"Planned"}>Dated tasks for the deal. The nearest one is on the «Next step» tile; the task also appears in Tasks, and a reminder comes on its day.</HelpDef>
          <HelpDef term={"Section"}>Details of the deal, closed until needed. A closed section says what is inside; a click opens it in place, with its own parts.</HelpDef>
          <HelpDef term={"Da Vinci"}>A panel on the right with the forecast, risks, advice and what to offer the customer. It opens by its button and takes no room on the page.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title={"Step by step: do what is needed now"}>
        <HelpStep n={1}>
          <p>In <strong>What to do now</strong> find the top step. An overdue invoice comes first and is marked red. Click <HelpKey>Record payment</HelpKey>.</p>
          <HelpCallout kind="see" label={"What you'll see"}>A form opens under the step with the debt and today&apos;s date. More than the debt cannot be recorded: the page says so and sends nothing. After saving, the «Payment» tile, the debt and the step are recounted.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Click <HelpKey>Assign</HelpKey> in the owner step and choose a person. In the contact step click <HelpKey>Add</HelpKey> and choose the customer&apos;s person.</p>
          <HelpCallout kind="see" label={"What you'll see"}>The step gets a tick and the counter on the right grows. When everything is done the list folds into one line; <HelpKey>Show steps</HelpKey> opens it again.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Click <HelpKey>Plan</HelpKey>, write what to do and choose a day.</p>
          <HelpCallout kind="see" label={"What you'll see"}>The task appears in the «Planned» row and on the «Next step» tile. <HelpKey>Done</HelpKey> closes it, the bin removes it from the plan.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title={"Step by step: move the deal to another stage"}>
        <HelpStep n={1}>
          <p>Click the stage you want in the track.</p>
          <HelpCallout kind="see" label={"What you'll see"}>Between ordinary stages the deal moves at once, and the message that pops up has <HelpKey>Undo</HelpKey>. If the stage has rules that are not met, the deal stays where it is and the page says under the track what is missing. The same rules are listed in advance in «What to do now».</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>To win the deal click the <HelpKey>Won</HelpKey> stage.</p>
          <HelpCallout kind="see" label={"What you'll see"}>The page asks first: winning sets off what your company hung on it, such as notifications and the customer survey.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>To lose it click <HelpKey>Lost</HelpKey>, choose a reason and click <HelpKey>Mark as lost</HelpKey>.</p>
          <HelpCallout kind="see" label={"What you'll see"}>The deal is not marked without a reason. The reason is saved in the deal and goes into the report on lost deals. A lost deal can be taken back with <HelpKey>Take back to work</HelpKey>.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title={"Step by step: reach the customer and log activity"}>
        <HelpStep n={1}>
          <p>Click <HelpKey>Reach out</HelpKey> in the header.</p>
          <HelpCallout kind="see" label={"What you'll see"}>A panel opens under the track with the contact: a call through the CRM phone, a letter, and WhatsApp with a ready text. WhatsApp opens with that text and you press send there. With no contact, the panel offers to add one.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Click <HelpKey>Add a record</HelpKey>.</p>
          <HelpCallout kind="see" label={"What you'll see"}>The «History» section opens on its <HelpKey>Feed</HelpKey> part: the letter composer on top, and under it the feed where a note, a call and a meeting are logged.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title={"Step by step: open the details"}>
        <HelpStep n={1}>
          <p>Click a section. <HelpKey>Customer</HelpKey> holds the company and contact, team and roles, competitors. <HelpKey>Sale</HelpKey> holds products, offers, terms and MEDDPICC. <HelpKey>Money and purchasing</HelpKey> holds invoices, purchases for the deal and customer approvals. <HelpKey>History</HelpKey> holds the feed, stages and files.</p>
          <HelpCallout kind="see" label={"What you'll see"}>The section opens across the full width under the row. Its parts with counters are on top, <HelpKey>Collapse</HelpKey> is on the right. Nothing inside scrolls apart from the page.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>In «History» open the <HelpKey>Stages</HelpKey> part.</p>
          <HelpCallout kind="see" label={"What you'll see"}>A table shows how many days the deal stood on each stage. If the journal has no moves, only the current stage is shown, and the page says so.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>Tags are edited right in the header: type a word into <HelpKey>+ Add tag</HelpKey> and press Enter. The main fields of the deal are changed with <HelpKey>Edit</HelpKey>.</p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>The page always asks before «Won» and «Lost». Deleting a deal cannot be undone.</p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>The deal and everything tied to it is limited to your organization. Action buttons show only to those with the right: no invoice right means no payment recording, no task right means no planning, and the «Purchasing» part exists only for an organization with that module.</p>
      </HelpCallout>
    </div>
  )
}
