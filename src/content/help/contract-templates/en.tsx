"use client"

/**
 * Contract Templates & Clauses — help article (English).
 * Rewritten into the video-script format: covers ONLY the
 * /contracts/templates page — two tabs (Templates + Clause Library),
 * search/filters, the template and clause editors, the AI
 * clause-drafting co-pilot, approve/retire governance and deletion.
 * Contract GENERATION (the Contracts page) is NOT covered here.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function contracttemplatesHelpEn() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="You're in a legal, sales-ops or admin role"
        goal="Build reusable contract templates and maintain a governed library of pre-approved legal clauses"
      >
        The page is titled <HelpKey>Templates &amp; Clauses</HelpKey>, with the line "Manage reusable
        contract templates and the governed clause library" underneath. It has two tabs:{" "}
        <HelpKey>Templates</HelpKey> and <HelpKey>Clause Library</HelpKey>. Everything is scoped to
        your organization — you never see another tenant's templates or clauses.
      </HelpScenario>

      <HelpSection title="What's on the page">
        <p>
          A document icon sits next to the title, and this help button is at the top right. Below
          come the two tabs; each tab name shows a small count badge of how many items it holds (e.g.{" "}
          <HelpKey>Templates 3</HelpKey>). The <strong>Templates</strong> tab is open by default.
        </p>
        <p>
          The <strong>Templates</strong> tab has a search box and a <HelpKey>New Template</HelpKey>{" "}
          button on top, then the template list. Each row shows the name, the (optional) description,
          the contract type, a <strong>v{"{number}"}</strong> version badge, the clause count, and on
          the right an edit (pencil) and delete (trash) button.
        </p>
        <p>
          The <strong>Clause Library</strong> tab has a search box, three filters (status, risk,
          category), a <HelpKey>New Clause</HelpKey> button and a <HelpKey>Draft with AI</HelpKey>{" "}
          button, then the clause list. Each clause row shows the title, the (optional) category, a
          risk badge, a status badge, a version badge, an approve/retire button, plus edit and
          delete.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Template">A named contract blueprint — it bundles a contract type, an optional default duration (months), a list of clause blocks and a set of variables.</HelpDef>
          <HelpDef term="Clause block (inside a template)">One section of a template: a block with a title and body. The body references variables as <code>{"{{variableName}}"}</code>; a block can be conditional.</HelpDef>
          <HelpDef term="Variable">A named placeholder — of type Text, Number, Date or Yes/No. It can be marked Required and carry a label and hint.</HelpDef>
          <HelpDef term="Version">Every save bumps the version (v1, v2, …). The list always shows the latest version.</HelpDef>
          <HelpDef term="Library clause">A single, governed legal paragraph — with a risk level, status, category, governing law, owner and a link to a primary clause.</HelpDef>
          <HelpDef term="Risk level">"Standard" (green), "Fallback" (yellow) or "High Risk" (red) — signals how standard the clause is.</HelpDef>
          <HelpDef term="Status">"Draft", "Approved" or "Retired" — shows whether the clause is fit for use.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Step by step: create a new template">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>Templates</HelpKey> tab, click <HelpKey>New Template</HelpKey> on the
            right. (If you have no templates yet, the <HelpKey>Create first template</HelpKey> button
            in the centre of the empty state opens the same dialog.)
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A wide "New Template" dialog opens. At the top, <strong>Template name</strong> and{" "}
            <strong>Contract type</strong> sit side by side, with <strong>Description</strong> and{" "}
            <strong>Default duration (months)</strong> below. Further down are the "Variables" and
            "Clause blocks" sections.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Type a <strong>Template name</strong> and pick a <strong>Contract type</strong> (Service
            Agreement, NDA, Maintenance, License, SLA or Other). Optionally add a short{" "}
            <strong>Description</strong> and a <strong>Default duration</strong>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The Contract type dropdown lists six options. The duration field accepts numbers only
            (minimum 1). If you try to save with an empty name, a "Template name is required" toast
            appears.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            In the "Variables" section, use <HelpKey>Add variable</HelpKey> to add the placeholders
            your clause text will reference. Each variable has a name, a type (Text/Number/Date/Yes-No)
            and a <strong>required</strong> checkbox, with a label and hint on a second row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            With no variables yet, the hint "No variables defined — use {"{{variableName}}"} in clause
            bodies to reference them" shows. Each variable you add appears on its own row; the × on
            the right removes it.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            In the "Clause blocks" section, use <HelpKey>Add clause</HelpKey> to create one block per
            section. Each block has a <strong>title</strong> and a <strong>body</strong>; write
            variables in the body as <code>{"{{variableName}}"}</code>. Optionally use{" "}
            <HelpKey>add condition</HelpKey> so the block only appears when a chosen variable equals a
            value.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The form opens with one empty clause block already present. Clicking "+ add condition"
            reveals a "Show if" row: a variable name, the <code>==</code> sign, and a value. When only
            one block is left, its trash button is disabled — a template must keep at least one block.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click <HelpKey>Save</HelpKey> at the bottom (or <HelpKey>Cancel</HelpKey> if you change
            your mind).
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If a clause block has no title, a "Clause title is required" toast appears. Otherwise a
            "Template created" toast shows, the dialog closes, and the new template appears in the
            list with a <strong>v1</strong> badge and its clause count; the tab's count badge ticks
            up too.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Variable names are case-sensitive: <code>clientName</code> and <code>ClientName</code>{" "}
            are different. Keep the spelling identical across the template so the{" "}
            <code>{"{{...}}"}</code> markers in the body match correctly.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: edit or delete a template">
        <HelpStep n={1}>
          <p>
            Click the pencil icon on a template row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The same form opens as "Edit Template", pre-filled with the existing name, type,
            duration, variables and clauses.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Make your changes and confirm with <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Template updated" toast appears and the version badge in the list bumps by one (e.g.
            from v1 to v2).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            To delete a template, click the red trash icon on the row.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A confirmation dialog appears reading "Are you sure you want to delete &quot;{"{name}"}&quot;? This
            cannot be undone." After you confirm, a "Template deleted" toast shows, the row leaves the
            list, and the tab count drops.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Step by step: manage the clause library">
        <HelpStep n={1}>
          <p>
            Switch to the <HelpKey>Clause Library</HelpKey> tab at the top.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A search box, the "All statuses" and "All risk levels" dropdown filters, the "All
            categories" filter (only when the library has categorized clauses), and then the{" "}
            <HelpKey>New Clause</HelpKey> and <HelpKey>Draft with AI</HelpKey> buttons.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Click <HelpKey>New Clause</HelpKey>. The dialog has a <strong>Clause title</strong> and{" "}
            <strong>Clause body</strong> (both required), plus <strong>Category</strong>,{" "}
            <strong>Risk level</strong>, <strong>Governing law</strong>, <strong>Status</strong>,{" "}
            <strong>Owner</strong> and <strong>Fallback of clause</strong> fields.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A hint above the body reads "Use {"{{variableName}}"} markers". Risk level
            (Standard/Fallback/High Risk) and Status (Draft/Approved/Retired) are dropdowns.{" "}
            <strong>Owner</strong> is chosen from your organization's users, and "Fallback of clause"
            from your existing library clauses.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Fill it in and click <HelpKey>Save</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the title or body is empty, you get "Clause title is required" / "Clause body is
            required" respectively. On success a "Clause created" toast shows and the new clause is
            added with its risk, status (a new clause is a <strong>Draft</strong>) and version
            badges.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            To approve a clause, click the green check (✓) button on its row; on an already-approved
            clause that button becomes an archive icon that <HelpKey>Retires</HelpKey> it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            On success a "Clause approved" or "Clause retired" toast appears and the status badge
            changes accordingly. If you lack permission, the server returns an error message and the
            status stays unchanged.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Click the pencil to edit a clause, or the red trash icon to delete it.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            Edit opens the same, pre-filled form. Delete shows an "Are you sure you want to delete
            &quot;{"{name}"}&quot;? This cannot be undone." confirmation; after you confirm, a "Clause deleted"
            toast appears.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Changing a clause's status (approve / retire) is admin-gated on the server. If you don't
            have permission, the button still shows but the action fails and an error message appears
            on screen — this is expected behavior, not a bug.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Step by step: draft a clause with AI">
        <HelpStep n={1}>
          <p>
            On the <HelpKey>Clause Library</HelpKey> tab, click <HelpKey>Draft with AI</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            An "AI Clause-Drafting Co-Pilot" dialog opens. It has a large "Describe the clause" text
            area (with a <strong>0/2000</strong> counter at the bottom right) and an optional{" "}
            <strong>Category</strong> field.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Describe the clause you need in plain language (e.g. "A liability cap limiting our
            exposure to $1 million per incident"), then click <HelpKey>Generate clause</HelpKey>.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            If the description is empty, a "Please describe the clause you want to draft" toast
            appears. While drafting, the button changes to "Drafting…" with a spinning icon.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Review the result: in the panel that opens you can edit the <strong>title</strong>,{" "}
            <strong>body</strong>, <strong>category</strong> and <strong>risk level</strong>. If
            needed, use <HelpKey>Regenerate</HelpKey> to draft again.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            The generated draft appears in a collapsible panel. You can freely change its fields —
            they become the clause that gets saved.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            When you're happy, click <HelpKey>Save as draft clause</HelpKey> at the bottom.
          </p>
          <HelpCallout kind="see" label="What you'll see">
            A "Draft clause saved to the library" toast appears, the dialog closes, and the new
            clause lands in the list with a <strong>Draft</strong> status. You can edit and later
            approve it as usual.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Search and filters work together. On the <strong>Clause Library</strong> tab you can
          combine the status, risk and category filters to show, for example, only "Approved"
          clauses at "Standard" risk. The category filter only appears once the library has at least
          one categorized clause.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          All templates and clauses are scoped to your organization — other tenants can't see or use
          them. Changing a clause's status (approve / retire) requires admin permission, which keeps
          control over who governs approved legal language. The <strong>Owner</strong> and "Fallback
          of clause" choices come only from your own organization's users and clauses.
        </p>
      </HelpCallout>
    </div>
  )
}
