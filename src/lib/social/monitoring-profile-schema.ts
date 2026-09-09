import { z } from "zod"
import {
  MONITORING_SCENARIO_ACTIONS,
  MONITORING_SCENARIO_DIRECTIONS,
  MONITORING_SCENARIO_PLATFORMS,
  MONITORING_SCENARIO_REPLY_MODES,
} from "@/lib/social/monitoring-scenarios"
import {
  MONITORING_SUBJECT_ALIAS_KINDS,
  MONITORING_SUBJECT_TYPES,
} from "@/lib/social/monitoring-subjects"

const aliasSchema = z.object({
  kind: z.enum(MONITORING_SUBJECT_ALIAS_KINDS),
  value: z.string().trim().min(1).max(200),
  isNegative: z.boolean().optional(),
}).strict()

/**
 * The wizard payload. Everything an SMM/PR manager must supply lives in the
 * first three fields — name, platforms, directions. Every other field is an
 * advanced setting with a safe default, so a profile can launch without the
 * advanced section ever being opened.
 */
export const monitoringProfileSchema = z.object({
  subjectId: z.string().trim().max(255).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  type: z.enum(MONITORING_SUBJECT_TYPES).optional(),
  aliases: z.array(aliasSchema).max(200).optional(),
  platforms: z.array(z.enum(MONITORING_SCENARIO_PLATFORMS)).min(1).max(8),
  directions: z.array(z.enum(MONITORING_SCENARIO_DIRECTIONS)).min(1).max(8),
  // Three-state on purpose: omitted leaves a legacy value untouched, and only
  // an explicit boolean is an explicit choice about paid comment collection.
  includeExternalComments: z.boolean().nullable().optional(),
  // Deprecated rolling-client fields. The route accepts their old shape but
  // strips both values before orchestration; scenario collection no longer
  // accepts selected pages or profiles.
  sourceIds: z.array(z.string().trim().min(1).max(255)).max(200).optional(),
  officialSourceIds: z.array(z.string().trim().min(1).max(255)).max(200).optional(),
  languages: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
  geographies: z.array(z.string().trim().min(1).max(100)).max(40).optional(),
  requiredContext: z.array(z.string().trim().min(1).max(200)).max(80).optional(),
  exclusions: z.array(z.string().trim().min(1).max(200)).max(80).optional(),
  extraKeywords: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  minConfidence: z.coerce.number().int().min(1).max(100).optional(),
  action: z.enum(MONITORING_SCENARIO_ACTIONS).optional(),
  replyIdentityId: z.string().trim().max(255).nullable().optional(),
  replyMode: z.enum(MONITORING_SCENARIO_REPLY_MODES).optional(),
  archiveStartAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

export const monitoringProfilePatchSchema = z.object({
  // Required: an omitted action must never fall through to a default that
  // stops collection the operator did not ask to stop.
  action: z.enum(["pause", "resume", "stop"]),
  platforms: z.array(z.enum(MONITORING_SCENARIO_PLATFORMS)).min(1).max(8).optional(),
  directions: z.array(z.enum(MONITORING_SCENARIO_DIRECTIONS)).min(1).max(8).optional(),
}).strict()

export const monitoringProfileSuggestSchema = z.object({
  name: z.string().trim().min(1).max(200),
}).strict()
