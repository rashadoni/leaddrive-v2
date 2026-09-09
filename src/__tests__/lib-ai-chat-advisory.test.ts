import { describe, expect, it } from "vitest"
import { advisoryGroundingTool } from "@/lib/ai/chat-advisory"

describe("advisoryGroundingTool", () => {
  it.each([
    ["почему лиды не превращаются в клиентов", "get_lead_coverage"],
    ["почему наши лиды не конвертируются?", "get_lead_coverage"],
    ["why don't our leads convert", "get_lead_coverage"],
    ["niyə lidlər müştəriyə çevrilmir", "get_lead_coverage"],
    ["как поднять продажи", "get_pipeline_by_stage"],
    ["как нам увеличить выручку в этом деле", "get_pipeline_by_stage"],
    ["почему продажи упали", "get_pipeline_by_stage"],
    ["how to increase sales", "get_pipeline_by_stage"],
    ["satışları necə artıra bilərik", "get_pipeline_by_stage"],
    ["satış niyə azalıb", "get_pipeline_by_stage"],
  ])("grounds %s on %s", (message, tool) => {
    expect(advisoryGroundingTool(message)).toBe(tool)
  })

  it.each([
    // Verified-analytics territory: counts and periods are not advice.
    "сколько сделок в августе",
    "сколько у нас лидов",
    "кто больше всех продал",
    // Plain lookups and chatter.
    "покажи карточку лида Мамедов",
    "привет, что ты умеешь?",
    "переведи фразу на английский",
  ])("stays silent on %s", (message) => {
    expect(advisoryGroundingTool(message)).toBeNull()
  })
})
