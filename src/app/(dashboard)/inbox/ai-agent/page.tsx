"use client";

import { ChannelReplyMatrix } from "@/components/settings/channel-reply-matrix";
import { useState } from "react";
import { InboxAgentEditor } from "@/components/settings/inbox-agent-editor";
import { InboxPageAgents } from "@/components/settings/inbox-page-agents";
import { InboxFollowupSettings } from "@/components/settings/inbox-followup-settings";
import { InboxEscalationKeywords } from "@/components/settings/inbox-escalation-keywords";
import { AiAgentKnowledgeSources } from "@/components/settings/ai-agent-knowledge-sources";
import { AiAgentPageHeader } from "@/components/settings/ai-agent-page-view";
import { HelpButton } from "@/components/help/help-button";

/**
 * Omni-channel AI agent — the Communication group's own AI settings section.
 * Simplified 2026-07: the actual controls (who replies per channel, the agent
 * persona, follow-ups, escalation keywords) come FIRST; the knowledge base — the
 * AI's source of truth — sits below them. The old onboarding wall (setup hero +
 * explainer cards) is gone; the controls are self-explanatory now.
 *
 * Each part draws itself from a pure view (`*-view.tsx` in
 * src/components/settings): the guided demo shows the same screen.
 */
export default function InboxAiAgentPage() {
  // A page's AI switch is the same setting the matrix shows; the matrix reloads when it changes.
  const [matrixKey, setMatrixKey] = useState(0);
  return (
    <div className="space-y-6">
      <AiAgentPageHeader help={<HelpButton slug="inbox-ai-agent" variant="label" />} />

      {/* Controls first — the actual settings, no onboarding wall above them. */}
      <ChannelReplyMatrix key={matrixKey} />
      {/* One agent per page, the organisation's common one for the rest (owner 2026-11-13). */}
      <InboxPageAgents onReplyModeChanged={() => setMatrixKey((k) => k + 1)}>
        <InboxAgentEditor />
      </InboxPageAgents>
      <InboxFollowupSettings />
      <InboxEscalationKeywords />

      {/* Knowledge base — the AI's source of truth, secondary to the controls above. */}
      <AiAgentKnowledgeSources />
    </div>
  );
}
