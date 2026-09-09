"use client"

/**
 * S6 CPQ — Quotes help article (English).
 *
 * Plain-language guide for sales reps. Keep concise; link to deeper
 * docs only when the topic is genuinely advanced.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function QuotesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpSection title="What is a quote?">
        <p>
          A <strong>quote</strong> (a.k.a. proposal) is the offer document you send to a customer
          between an open deal and a signed contract. It locks in <em>what</em> you're selling,
          <em> how much</em> it costs, and <em>how long</em> the price is valid.
        </p>
        <p>
          Quotes are versioned, status-tracked, and tied back to the parent deal — so every revision,
          send, view, and rejection is on record without leaving the CRM.
        </p>
      </HelpSection>

      <HelpSection title="When to use it">
        <ul className="list-disc pl-5 space-y-1">
          <li>Customer asked &quot;how much would this cost?&quot; — send a quote, not an ad-hoc email.</li>
          <li>You're configuring a multi-line package (e.g. <em>3× subscription + 1× setup fee + 10% discount</em>).</li>
          <li>The deal is in late stage and you need a signed paper trail before kicking off implementation.</li>
        </ul>
      </HelpSection>

      <HelpSection title="Creating a quote">
        <HelpStep n={1}>
          <p>
            Click <HelpKey>New Quote</HelpKey> on the Quotes page (top right).
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pick a <strong>Quote #</strong> (e.g. <code>Q-2026-001</code>), the <strong>currency</strong>{" "}
            (defaults to AZN — must be ISO-4217, three uppercase letters), and optionally a{" "}
            <strong>Valid until</strong> date.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Add line items: product/service name, quantity, unit price, and (optional) per-line discount.
            Click <HelpKey>Add line</HelpKey> for more rows.
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Optionally apply a <strong>quote-level discount</strong> — switch between <em>None</em>,{" "}
            <em>Amount</em>, and <em>%</em>. You can only use one mode at a time.
          </p>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Create draft</HelpKey>. You're taken straight to the editor where you can
            refine line items, change discount, and trigger workflow transitions.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Lifecycle (status flow)">
        <p>Every quote moves through a strict state machine — the UI only shows legal next steps.</p>
        <dl className="rounded-md border p-3">
          <HelpDef term="draft">
            Editable, not yet shared. From here you can go to <em>sent</em> or <em>expired</em>.
          </HelpDef>
          <HelpDef term="sent">
            You've delivered it to the customer (email, PDF, link). Next: <em>viewed</em>,{" "}
            <em>rejected</em>, or <em>expired</em>.
          </HelpDef>
          <HelpDef term="viewed">
            Customer opened it. Next: <em>accepted</em>, <em>rejected</em>, or <em>expired</em>.
          </HelpDef>
          <HelpDef term="accepted">
            Customer signed. Terminal — you can no longer edit, only delete.
          </HelpDef>
          <HelpDef term="rejected">
            Customer declined. A <em>reason</em> is required (see Security note). Terminal.
          </HelpDef>
          <HelpDef term="expired">
            <strong>Valid until</strong> passed before acceptance. Terminal.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Math: how totals are computed">
        <p>
          The total is computed server-side after every save — you can&apos;t accidentally desync
          line items from the summary panel.
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Each line: <code>qty × unitPrice − lineDiscountAmount = lineTotal</code></li>
          <li>Subtotal: sum of all <code>lineTotal</code></li>
          <li>
            Quote total: <code>subtotal − discountAmount</code> <em>or</em>{" "}
            <code>subtotal × (1 − discountPct / 100)</code>, never both
          </li>
          <li>Anything &lt; 0 is clamped to 0. All money values are stored at 4 decimal places.</li>
        </ol>
      </HelpSection>

      <HelpSection title="Rejection reason">
        <HelpCallout kind="security">
          <p>
            When you mark a quote as <strong>rejected</strong>, the reason field is{" "}
            <strong>required</strong>. The text is encrypted at rest with a key bound to your
            organization and to the specific column — even with full database access, the reason
            can&apos;t be decrypted without knowing it came from <code>quotes.rejected_reason</code>.
          </p>
          <p className="mt-2">
            This is intentional: rejection reasons often carry business-sensitive details (the
            customer&apos;s budget cycle, an internal blocker, a competitor&apos;s name) that
            shouldn&apos;t be casually queryable by every operator.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Editing rules">
        <HelpCallout kind="warning">
          <p>
            Once a quote reaches a terminal state (<em>accepted</em>, <em>rejected</em>,{" "}
            <em>expired</em>) it&apos;s locked — line items, discounts, notes, and valid-until all
            become read-only. <strong>Save</strong> is disabled.
          </p>
          <p className="mt-2">
            To revise an accepted/rejected quote, create a new quote (the <em>version</em> counter
            lets you keep them grouped under a single quote number in a future revision flow).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="What's next">
        <HelpCallout kind="next">
          <p>
            Quote builder is the first piece of the CPQ slice. Coming soon:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-0.5">
            <li><strong>PDF render</strong> — one-click download of a branded PDF to send to your customer.</li>
            <li><strong>Email tracking</strong> — auto-transition from <em>sent</em> to <em>viewed</em> when the customer opens it.</li>
            <li><strong>Auto-contract</strong> — accepting a quote spawns a draft contract pre-filled with the quote&apos;s totals.</li>
          </ul>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
