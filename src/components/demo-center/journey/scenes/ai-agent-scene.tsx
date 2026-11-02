"use client"

import type { ReactNode } from "react"
import { AiAgentKnowledgeSourcesView, AiAgentPageHeader } from "@/components/settings/ai-agent-page-view"
import { ChannelReplyMatrixView, type ChannelReplyRow, type UiMode } from "@/components/settings/channel-reply-matrix-view"
import { InboxAgentEditorView, type InboxAgentEditorField } from "@/components/settings/inbox-agent-editor-view"
import type { DemoSceneProps } from "../scene-props"
import { demoTarget } from "../demo-target"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"
import {
  AI_AGENT_DEMO_AGENT,
  AI_AGENT_DEMO_ARTICLES,
  AI_AGENT_REPLY_MODE_PATH,
  demoChannelRows,
  isDemoUiMode,
} from "./ai-agent-demo-data"

/**
 * Communication → AI agent: LeadDrive's own agent, set up, on the product's
 * own /inbox/ai-agent screen — who answers in each channel, the prompt with
 * its style, the knowledge base, the model and the published articles (owner,
 * 2026-10-18: «гид направлял на готовый промт, стиль общения и база знаний,
 * а там уже стояло для LeadDrive CRM»).
 *
 * The screen is the product's pure views (src/components/settings/*-view.tsx)
 * with the demo's data in them. One choice is the prospect's — Telegram's
 * reply mode, kept in the snapshot; the fields are shown, not edited, and
 * every button that would save or leave the page says so instead.
 */
export function AiAgentScene({ snapshot, reviewMode, dispatch, hint }: DemoSceneProps) {
  const chosen = snapshot.ui[AI_AGENT_REPLY_MODE_PATH]
  const telegram: UiMode = isDemoUiMode(chosen) ? chosen : "agent"
  const rows = demoChannelRows(telegram)

  const chooseMode = (row: ChannelReplyRow, mode: UiMode) => {
    if (reviewMode) {
      hint(S.reviewOnly)
      return
    }
    if (row.channelType !== "telegram") return
    dispatch({ type: "ui", path: AI_AGENT_REPLY_MODE_PATH, value: mode })
  }

  const showOnly = () => hint(S.agentSetupReadOnly)
  const simulated = () => hint(S.demoButtonHint)
  const articleHint = () => hint(S.agentArticleHint)

  // The guide points at three parts of the card; the tour ids are written out
  // here, where the coach mark looks for them.
  const decorate = (field: InboxAgentEditorField, node: ReactNode): ReactNode => {
    if (field === "prompt") return <div data-tour-id="inbox-agent-prompt">{node}</div>
    if (field === "knowledge") return <div data-tour-id="inbox-agent-knowledge">{node}</div>
    if (field === "settings") return <div data-tour-id="inbox-agent-settings">{node}</div>
    return node
  }

  return (
    <div data-testid="demo-scene-ai-agent" className="space-y-6">
      <div>
        <AiAgentPageHeader />
        <p className="mt-2 text-xs text-muted-foreground">{S.agentSetupReadOnly}</p>
      </div>

      <div data-tour-id="inbox-reply-matrix">
        <ChannelReplyMatrixView
          rows={rows}
          loading={false}
          savingId={null}
          onUiModeChange={chooseMode}
          onRolloutChange={simulated}
          onThresholdChange={simulated}
          targetFor={(row, mode) =>
            row.channelType === "telegram" && mode === "ai_draft"
              ? demoTarget("ai-agent-reply-mode")
              : undefined}
        />
      </div>

      <InboxAgentEditorView
        agent={AI_AGENT_DEMO_AGENT}
        onAgentChange={showOnly}
        aiOn
        onAiOnChange={showOnly}
        boards={[]}
        qualificationBoardId=""
        onQualificationBoardChange={showOnly}
        saving={false}
        savedTick={false}
        error={null}
        onSave={simulated}
        importing={false}
        onExport={simulated}
        onImport={simulated}
        readOnly
        fitContent
        decorate={decorate}
      />

      <div data-tour-id="inbox-agent-sources">
        <AiAgentKnowledgeSourcesView
          articles={AI_AGENT_DEMO_ARTICLES}
          total={AI_AGENT_DEMO_ARTICLES.length}
          loading={false}
          error={null}
          onOpenArticle={articleHint}
          onManage={articleHint}
        />
      </div>
    </div>
  )
}
