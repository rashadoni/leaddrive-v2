import { z } from "zod"
import {
  MONITORING_SUBJECT_ALIAS_KINDS,
  MONITORING_SUBJECT_RELATION_TYPES,
  MONITORING_SUBJECT_TYPES,
} from "@/lib/social/monitoring-subjects"

const aliasSchema = z.object({
  kind: z.enum(MONITORING_SUBJECT_ALIAS_KINDS),
  value: z.string().trim().min(1).max(200),
  language: z.string().trim().max(20).nullable().optional(),
  weight: z.number().min(0).max(1).optional(),
  isNegative: z.boolean().optional(),
  isAmbiguous: z.boolean().optional(),
}).strict()

const replyIdentitySchema = z.object({
  socialAccountId: z.string().trim().min(1).max(255),
  priority: z.number().int().min(1).max(999).optional(),
  languages: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
  signature: z.string().trim().max(500).nullable().optional(),
  allowOwnedReply: z.boolean().optional(),
  allowExternalReply: z.boolean().optional(),
}).strict()

const relationSchema = z.object({
  relatedSubjectId: z.string().trim().min(1).max(255),
  relationType: z.enum(MONITORING_SUBJECT_RELATION_TYPES),
  weight: z.number().min(0).max(1).optional(),
}).strict()

export const monitoringSubjectSchema = z.object({
  type: z.enum(MONITORING_SUBJECT_TYPES),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  languages: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
  geographies: z.array(z.string().trim().min(1).max(100)).max(40).optional(),
  requiredContext: z.array(z.string().trim().min(1).max(200)).max(80).optional(),
  exclusions: z.array(z.string().trim().min(1).max(200)).max(80).optional(),
  sensitiveCategories: z.array(z.string().trim().min(1).max(100)).max(40).optional(),
  assignedAgentId: z.string().trim().max(255).nullable().optional(),
  replyPolicy: z.record(z.string(), z.unknown()).optional(),
  legalPolicy: z.record(z.string(), z.unknown()).optional(),
  aliases: z.array(aliasSchema).max(500).optional(),
  // Rolling-upgrade compatibility only. Subject APIs accept and strip this
  // deprecated field; sources are managed in their own independent registry.
  sourceIds: z.array(z.string().trim().min(1).max(255)).max(500).optional(),
  replyIdentities: z.array(replyIdentitySchema).max(50).optional(),
  relations: z.array(relationSchema).max(100).optional(),
}).strict()
