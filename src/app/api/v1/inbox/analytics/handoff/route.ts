import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { conversationChannelSql } from "@/lib/inbox-analytics-filters"
import {
  summarizeHandoffAnalytics,
  type LeadHandoffRow,
  type MarketingContactRow,
} from "@/lib/inbox/handoff-analytics"

function validDate(value: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const from = validDate(searchParams.get("from"))
  const to = validDate(searchParams.get("to"))
  const channel = searchParams.get("channel")?.trim() || null
  const agent = searchParams.get("agent")?.trim() || null
  const customerStage = searchParams.get("customerStage")?.trim() || null
  const messageStatus = searchParams.get("messageStatus")?.trim() || null

  const marketingConditions: Prisma.Sql[] = []
  if (from) marketingConditions.push(Prisma.sql`contacts.contact_at >= ${from}`)
  if (to) marketingConditions.push(Prisma.sql`contacts.contact_at <= ${to}`)
  if (channel) marketingConditions.push(conversationChannelSql(channel))
  if (agent) marketingConditions.push(Prisma.sql`contacts.agent_id = ${agent}`)
  if (customerStage === "unclassified") {
    marketingConditions.push(Prisma.sql`social_conversations."customerStage" IS NULL AND cardinality(social_conversations."salesCallOutcomes") = 0`)
  } else if (customerStage) {
    marketingConditions.push(Prisma.sql`(social_conversations."customerStage" = ${customerStage} OR ${customerStage} = ANY(social_conversations."salesCallOutcomes"))`)
  }
  if (messageStatus) {
    marketingConditions.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM channel_messages AS status_messages
      WHERE status_messages."organizationId" = ${orgId}
        AND status_messages."conversationId" = social_conversations.id
        AND status_messages.status = ${messageStatus}
    )`)
  }

  const leadConditions: Prisma.Sql[] = [
    Prisma.sql`leads."organizationId" = ${orgId}`,
    Prisma.sql`social_conversations."organizationId" = ${orgId}`,
  ]
  if (from) leadConditions.push(Prisma.sql`leads."createdAt" >= ${from}`)
  if (to) leadConditions.push(Prisma.sql`leads."createdAt" <= ${to}`)
  if (channel) leadConditions.push(conversationChannelSql(channel))
  if (customerStage === "unclassified") {
    leadConditions.push(Prisma.sql`social_conversations."customerStage" IS NULL AND cardinality(social_conversations."salesCallOutcomes") = 0`)
  } else if (customerStage) {
    leadConditions.push(Prisma.sql`(social_conversations."customerStage" = ${customerStage} OR ${customerStage} = ANY(social_conversations."salesCallOutcomes"))`)
  }
  if (messageStatus) {
    leadConditions.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM channel_messages AS status_messages
      WHERE status_messages."organizationId" = ${orgId}
        AND status_messages."conversationId" = social_conversations.id
        AND status_messages.status = ${messageStatus}
    )`)
  }
  if (agent) {
    leadConditions.push(Prisma.sql`(
      leads."assignedTo" = ${agent}
      OR social_conversations.metadata->>'salesAssignedBy' = ${agent}
    )`)
  }

  const [marketingRows, leadRows] = await Promise.all([
    prisma.$queryRaw<MarketingContactRow[]>`
      WITH marketing_contacts AS (
        SELECT
          events."organizationId" AS organization_id,
          events."conversationId" AS conversation_id,
          CASE
            WHEN events.source = 'backfill'
              THEN COALESCE(first_web_agent."authorUserId", events."changedBy")
            ELSE events."changedBy"
          END AS agent_id,
          CASE
            WHEN events.source = 'backfill'
              THEN COALESCE(first_web_agent."createdAt", first_channel_reply."createdAt")
            ELSE events."createdAt"
          END AS contact_at
        FROM inbox_customer_stage_events AS events
        INNER JOIN social_conversations AS source_conversation
          ON source_conversation.id = events."conversationId"
          AND source_conversation."organizationId" = events."organizationId"
        LEFT JOIN LATERAL (
          SELECT messages."authorUserId", messages."createdAt"
          FROM web_chat_messages AS messages
          WHERE messages."organizationId" = events."organizationId"
            AND messages."sessionId" = source_conversation.metadata->>'webChatSessionId'
            AND messages."fromRole" = 'agent'
          ORDER BY messages."createdAt" ASC
          LIMIT 1
        ) AS first_web_agent ON TRUE
        LEFT JOIN LATERAL (
          SELECT messages."createdAt"
          FROM channel_messages AS messages
          WHERE messages."organizationId" = events."organizationId"
            AND messages."conversationId" = events."conversationId"
            AND messages.direction = 'outbound'
            AND messages.metadata->>'aiGenerated' IS DISTINCT FROM 'true'
            AND messages.metadata->>'autoReply' IS DISTINCT FROM 'true'
            AND messages.metadata->>'aiReply' IS DISTINCT FROM 'true'
            AND messages.metadata->>'chatbotRuleId' IS NULL
          ORDER BY messages."createdAt" ASC
          LIMIT 1
        ) AS first_channel_reply ON TRUE
        WHERE events."organizationId" = ${orgId}
          AND events."toStage" = 'marketing_contacted'
          AND events.source IN ('agent', 'backfill')
          AND (
            events.source = 'agent'
            OR first_web_agent."createdAt" IS NOT NULL
            OR first_channel_reply."createdAt" IS NOT NULL
          )
      )
      SELECT
        contacts.agent_id,
        COUNT(DISTINCT contacts.conversation_id)::int AS contacted
      FROM marketing_contacts AS contacts
      INNER JOIN social_conversations
        ON social_conversations.id = contacts.conversation_id
        AND social_conversations."organizationId" = contacts.organization_id
      ${marketingConditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(marketingConditions, " AND ")}`
        : Prisma.empty}
      GROUP BY contacts.agent_id`,
    prisma.$queryRaw<LeadHandoffRow[]>`
      WITH linked_leads AS (
        SELECT DISTINCT ON (leads.id)
          leads.id,
          leads."assignedTo" AS seller_id,
          leads."customerStage" AS stage,
          leads."salesCallOutcomes" AS outcomes,
          (leads."customerStageUpdatedAt" IS NOT NULL) AS reported,
          social_conversations.metadata->>'salesAssignedBy' AS marketer_id
        FROM leads
        INNER JOIN social_conversations
          ON social_conversations.metadata->>'qualificationLeadId' = leads.id
          AND social_conversations."organizationId" = leads."organizationId"
        WHERE ${Prisma.join(leadConditions, " AND ")}
        ORDER BY leads.id, social_conversations."updatedAt" DESC
      )
      SELECT
        marketer_id,
        seller_id,
        stage,
        outcomes,
        reported,
        COUNT(*)::int AS count
      FROM linked_leads
      GROUP BY marketer_id, seller_id, stage, outcomes, reported`,
  ])

  const employeeIds = Array.from(new Set([
    ...marketingRows.map((row) => row.agent_id),
    ...leadRows.flatMap((row) => [row.marketer_id, row.seller_id]),
  ].filter((id): id is string => Boolean(id))))
  const users = employeeIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: employeeIds }, organizationId: orgId },
        select: { id: true, name: true, email: true },
      })
    : []

  return NextResponse.json({
    success: true,
    data: summarizeHandoffAnalytics(marketingRows, leadRows, users),
  })
})
