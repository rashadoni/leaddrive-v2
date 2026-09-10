"use client"

/**
 * Contacts — Segment insights help article (English).
 * Split out of the old shared "list-power" article: this is ONLY about
 * the /contacts page (Segment insights).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContactsHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sales / marketing manager"
        goal="Read your contact base at a glance and spot the weak spots"
      >
        This page is the <strong>segment insights</strong> view of your contacts — not
        where you edit an individual contact. It breaks existing contacts down by category,
        source and brand, shows SMS coverage and plots the growth trend. The numbers come
        from fields you or your team already filled in on each contact, so an empty chart
        usually means "this field hasn't been filled in yet".
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          The heading is <strong>Segment insights</strong>. Top-right has three buttons:{" "}
          <HelpKey>Contact list</HelpKey> takes you to the full contact table (
          <code className="bg-muted px-1 rounded">/contacts</code>),{" "}
          <HelpKey>Refresh</HelpKey> recomputes the metrics, and <HelpKey>CSV</HelpKey>{" "}
          downloads the category / source / brand breakdown as a file. Below that come the
          cards and charts.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Category">
            A contact's segment — VIP, Regular, Partner, Prospect or Inactive. You set this
            on each contact itself; here you only see the result.
          </HelpDef>
          <HelpDef term="Source">
            Where the contact came from — Website, Referral, Cold call, LinkedIn, Email, SMS,
            Social, Event, Outlook or Other.
          </HelpDef>
          <HelpDef term="SMS attribution">
            The share of contacts linked to at least one campaign SMS — shown as a coverage
            percentage.
          </HelpDef>
          <HelpDef term="Engagement score">
            The average engagement of contacts within a category; the longer the bar, the
            higher the score.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: reading the page">
        <HelpStep n={1}>
          <p>
            Open the page and let it load. On first open the numbers come in automatically; to
            pull fresh ones, click <HelpKey>Refresh</HelpKey> at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Grey "skeleton" blocks while it loads, then two cards at the top open up — on the
            left <strong>SMS attribution</strong>, on the right <strong>Engagement by
            category</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Look at the <strong>SMS attribution</strong> card. It gives three numbers —{" "}
            <HelpKey>Ever received</HelpKey>, <HelpKey>Last 30 days</HelpKey> and{" "}
            <HelpKey>Last 90 days</HelpKey> — with a blue coverage bar underneath.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Counts of contacts who got an SMS ever / in 30 / in 90 days, a blue progress bar,
            and an "X% of contacts have SMS attribution" line. If there are no SMS yet, an amber
            note appears pointing you to campaigns.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Read the <strong>Engagement by category</strong> card on the right — a coloured
            score bar per category.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            One row per category (VIP / Regular / Partner / Prospect / Inactive) with a coloured
            bar, the average score on the right and the count of contacts in that category in
            parentheses.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Scan the four <strong>stat tiles</strong> below.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            <HelpKey>Total contacts</HelpKey>, <HelpKey>New 30d</HelpKey> (with the % vs the
            previous 30 days — green when up, red when down), <HelpKey>With brand</HelpKey> (how
            many unique brands) and <HelpKey>SMS coverage</HelpKey> (percent + a coverage / total
            ratio).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: getting a quick AI read">
        <HelpStep n={1}>
          <p>
            Find the <strong>AI insights</strong> card (violet-blue background) and click{" "}
            <HelpKey>Generate</HelpKey> on the right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The button switches to <strong>Analyzing…</strong>, then a few short observations
            from Claude Haiku about the current numbers appear as a bulleted list.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            After you refresh the data, re-run the read with the <HelpKey>Regenerate</HelpKey>{" "}
            button in the same spot.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The old observations clear and a fresh list appears based on the updated numbers.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          The AI text only summarizes the aggregate numbers on screen — no individual contact
          names are sent. Generating on an empty page produces weak observations; fill in
          category and source on your contacts first.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: reading the charts and drilling in">
        <HelpStep n={1}>
          <p>
            Look at the <strong>By category</strong> pie chart and <strong>click</strong> a
            slice you care about.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Each category is a slice in its own colour with a name and count label. Clicking a
            slice opens the contact list filtered to that category. Below it reads "Showing X
            categorized contacts · Y without category".
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            In the <strong>By source</strong> bar chart, click any bar.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            One bar per source (Website, Referral, Cold call, etc.); clicking a bar opens the
            contact list filtered to that source.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In <strong>Top 10 brands</strong> (horizontal bars) click a brand, and follow the
            growth trend in the <strong>New contacts per week</strong> line.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On the left, the most common brands ranked as bars by count (clicking a brand opens
            the list filtered by a search for that brand); on the right, a line chart of new
            contacts per week over the last 12 weeks.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          The charts only count contacts where the field is filled in. If category, source or
          brand is empty you get a "No contacts have … yet" message — that's not an error, it
          just means the field hasn't been filled in. Fix: open a contact → Edit → set the
          relevant field (Category / Source / Brand).
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: export and jumping to the list">
        <HelpStep n={1}>
          <p>
            To keep the breakdown outside the app, click <HelpKey>CSV</HelpKey> at the top-right.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The browser downloads a <code className="bg-muted px-1 rounded">contacts-segments-DATE.csv</code>{" "}
            file with rows of counts by category, source and brand.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            When you need to work with specific contacts, jump to the full table with the{" "}
            <HelpKey>Contact list</HelpKey> button.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The page moves to the contact list (<code className="bg-muted px-1 rounded">/contacts</code>),
            where you can open and edit each contact.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        What makes this page valuable is <strong>well-labelled contacts</strong>: the more
        category, source and brand you fill in, the more meaningful the charts. To "fix" empty
        segments, click the no-category / no-source group from a chart and fill them in bulk
        in the list.
      </HelpCallout>

      <HelpCallout kind="security">
        Every number here is scoped to your organization — the analytics only read your own
        tenant's contacts. The AI summary processes the aggregate metrics only, not individual
        contact data; and the CSV export contains only the aggregate you can already see.
      </HelpCallout>
    </div>
  )
}
