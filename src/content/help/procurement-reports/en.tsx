"use client"

/**
 * «Purchasing reports» — spend, timeliness and margin (English).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementReportsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="A manager, finance or purchasing" goal="Look at purchasing over a period: what was spent, were suppliers on time, what the deals earned">
        The report covers purchase orders created in the chosen period. Reports and their files are seen by management, finance and purchasing.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <dl className="rounded-md border p-3">
          <HelpDef term="Figures">Orders, Committed spend, Delivered on time, Average delay, Late now, Approval takes.</HelpDef>
          <HelpDef term="Suppliers">per supplier — orders, spend, on time and late, average delay (days).</HelpDef>
          <HelpDef term="Margin by deal">revenue, cost and margin; an order in another currency is not mixed in — it shows as «another currency».</HelpDef>
          <HelpDef term="Orders">number, supplier, deal, status, expected date and total.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step">
        <HelpStep n={1}>
          <p>Pick the <HelpKey>From</HelpKey> and <HelpKey>To</HelpKey> dates and press <HelpKey>Show</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The figures and the three tables are recalculated for that period.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Need a file — press <HelpKey>Excel</HelpKey> or <HelpKey>PDF</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The report for the chosen period downloads as a file.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">«On time» and «Average delay» count calendar days between the expected date and the actual receipt.</HelpCallout>

      <HelpCallout kind="warning">Currencies are not added up: the CRM has no exchange rates, so spend in another currency is shown apart and stays out of the margin.</HelpCallout>
    </div>
  )
}
