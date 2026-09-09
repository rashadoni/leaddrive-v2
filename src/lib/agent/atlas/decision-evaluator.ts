/**
 * Atlas decision evaluator — pure validator that gates an LLM-returned
 * `PlanDecision` against:
 *   - the agent's `availableTools` whitelist
 *   - the `TOOL_META` risk-level / approval-required registry
 *   - basic input shape sanity (toolInput is an object for `act`)
 *
 * Driver consumes this to either dispatch the action or short-circuit
 * the session. Pure — no I/O, no Prisma.
 *
 * Part of H2 Atlas Reasoning Engine (Phase 3 slice 1).
 */
import { TOOL_META } from "@/lib/ai/tools"
import type { DecisionEvaluation, PlanDecision } from "./types"

export function evaluateDecision(
  decision: PlanDecision,
  availableTools: string[]
): DecisionEvaluation {
  switch (decision.kind) {
    case "observe":
    case "think":
    case "respond":
    case "ask":
      // Pure reasoning / terminal — always admissible (state-machine gates
      // budget / max-steps elsewhere; this just checks tool-action shape).
      return { admissible: true }

    case "act": {
      if (!decision.toolName || typeof decision.toolName !== "string") {
        return { admissible: false, reason: "act decision missing toolName" }
      }
      if (!availableTools.includes(decision.toolName)) {
        return {
          admissible: false,
          reason: `Tool '${decision.toolName}' not in agent's available tools`,
        }
      }
      const meta = TOOL_META[decision.toolName]
      if (!meta) {
        return {
          admissible: false,
          reason: `Tool '${decision.toolName}' has no registered metadata`,
        }
      }
      if (
        decision.toolInput === null ||
        typeof decision.toolInput !== "object" ||
        Array.isArray(decision.toolInput)
      ) {
        return {
          admissible: false,
          reason: `toolInput must be a plain object for tool '${decision.toolName}'`,
        }
      }
      return {
        admissible: true,
        toolRisk: meta.riskLevel,
        requiresApproval: meta.requiresApproval,
      }
    }
  }
}

/**
 * Filter the full TOOL_META catalogue down to entries the agent is
 * authorised to use. `enabledToolNames` typically comes from
 * `AiAgentConfig.toolsEnabled`. Returns the intersection.
 *
 * Slice 1 returns just the names; slice 2 will also surface
 * `Tool` schemas for the Anthropic SDK tool-use call.
 */
export function resolveAvailableTools(enabledToolNames: string[]): string[] {
  return enabledToolNames.filter(name => name in TOOL_META)
}
