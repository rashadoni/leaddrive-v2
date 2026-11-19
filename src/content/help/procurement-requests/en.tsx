"use client"

/**
 * «Purchase requests» — where buying for a customer order starts (English).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementRequestsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="A salesperson or a purchasing officer" goal="Ask purchasing to buy what a customer order needs and pick the best supplier price">
        The Purchasing module must be on for your organization. Sales raises the request, purchasing collects prices; purchase prices are seen only by management, finance and purchasing.
      </HelpScenario>

      <HelpSection title="The whole way at a glance">
        <p>Sales agrees with the customer and adds products to the deal → requests a purchase → purchasing collects supplier quotes and picks the best → a purchase order is made from the quote → the order is approved by the limits, sent and received → the deal shows its real cost and margin. The video above walks through it end to end.</p>
      </HelpSection>

      <HelpSection title="What's on the page">
        <dl className="rounded-md border p-3">
          <HelpDef term="List">each request's number (PR-0001), title, deal, status and number of lines.</HelpDef>
          <HelpDef term="Filters"><HelpKey>Open</HelpKey>, <HelpKey>Draft</HelpKey>, <HelpKey>Ordered</HelpKey>, <HelpKey>Closed</HelpKey>, <HelpKey>All</HelpKey>.</HelpDef>
          <HelpDef term="Statuses">Draft → Sent to purchasing → In purchasing → Ordered → Closed; or Cancelled.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: a request from a deal">
        <HelpStep n={1}>
          <p>Open the deal, go to the <HelpKey>Purchasing</HelpKey> tab and press <HelpKey>Request purchase</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">A window opens with the deal's lines already filled in, units included; you can change quantities, remove a line, set the needed-by date and a note.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Keep <HelpKey>Send to purchasing now</HelpKey> ticked and press <HelpKey>Create</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The request appears with the status «Sent to purchasing» and purchasing is notified. For a request without a deal, this page has <HelpKey>New request</HelpKey>.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: quotes and the order">
        <HelpStep n={1}>
          <p>Open the request and press <HelpKey>Take</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">The status becomes «In purchasing» and the request is yours.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p><HelpKey>Add quote</HelpKey>: pick the supplier, fill in <HelpKey>Lead time, days</HelpKey>, <HelpKey>Terms</HelpKey> and the <HelpKey>Price per unit</HelpKey> of every line.</p>
          <HelpCallout kind="see" label="What you'll see">The quote becomes a column of the table; each row's best price is highlighted green, each quote's total is at the bottom.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Under the winning quote press <HelpKey>Make order</HelpKey>.</p>
          <HelpCallout kind="see" label="What you'll see">A draft purchase order is created and listed under «Orders from this request»; the request becomes «Ordered».</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">No need to delete a quote you don't want — press <HelpKey>Reject</HelpKey>, and <HelpKey>Restore</HelpKey> brings it back.</HelpCallout>

      <HelpCallout kind="warning">If the deal changes after the request was sent (quantity, line, a change the customer approved), the request is flagged «the deal changed — check» and purchasing is notified.</HelpCallout>

      <HelpCallout kind="security">Sales follows its own request but does not see supplier prices: «Prices are seen by management, finance and purchasing».</HelpCallout>
    </div>
  )
}
