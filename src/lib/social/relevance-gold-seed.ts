/**
 * Синтетический seed для offline relevance-evaluator (CR-2).
 *
 * НЕ является продаваемым gold dataset. Это маленький, полностью синтетический
 * набор без клиентских данных, который демонстрирует формат и служит фикстурой
 * тестов evaluator-а. Настоящий версионированный gold dataset ≥500 размеченных
 * единиц (AZ/RU/EN, posts/comments/replies/captions/OCR/transcripts) предоставляет
 * владелец — см. Evidence log CR-2 (BLOCKED на реальные размеченные данные).
 */

import type { GoldDataset } from "@/lib/social/relevance-evaluator"
import { GOLD_DATASET_SCHEMA_VERSION } from "@/lib/social/relevance-evaluator"

export const RELEVANCE_GOLD_SEED: GoldDataset = {
  schemaVersion: GOLD_DATASET_SCHEMA_VERSION,
  datasetVersion: "seed-2026-07-12",
  locales: ["en", "ru", "az"],
  subjects: [
    {
      id: "s-acme",
      aliases: [
        { value: "Acme Robotics", kind: "IDENTITY", weight: 0.85 },
        { value: "@acmerobotics", kind: "HANDLE", weight: 0.9 },
        { value: "Акме Роботикс", kind: "IDENTITY", weight: 0.85 },
        { value: "Acme Robotiks", kind: "IDENTITY", weight: 0.8 },
        { value: "Acme", kind: "IDENTITY", weight: 0.8, isAmbiguous: true },
        { value: "Акме", kind: "IDENTITY", weight: 0.8, isAmbiguous: true },
        { value: "Acme Coyote", kind: "NEGATIVE", isNegative: true },
      ],
      exclusions: ["cartoon"],
      sources: [{ sourceId: "src-owned-1", relationType: "OWNED", trustWeight: 0.9 }],
    },
    {
      id: "s-vega",
      aliases: [
        { value: "Vega", kind: "IDENTITY", weight: 0.8, isAmbiguous: true },
        { value: "Вега", kind: "IDENTITY", weight: 0.8, isAmbiguous: true },
      ],
      requiredContext: ["singer", "певица", "concert", "konsert"],
    },
  ],
  items: [
    { id: "g1", locale: "en", kind: "POST", text: "Just toured Acme Robotics HQ, the bots are wild", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["alias"] },
    { id: "g2", locale: "en", kind: "COMMENT", text: "@acmerobotics your support team is great", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["handle"] },
    { id: "g3", locale: "ru", kind: "POST", text: "Сегодня были в офисе Акме Роботикс", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["transliteration"] },
    { id: "g4", locale: "en", kind: "REPLY", text: "my new acme robotiks vacuum is amazing", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["typo"] },
    { id: "g5", locale: "en", kind: "POST", text: "Oh sure, Acme Robotics never breaks down", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["sarcasm"] },
    { id: "g6", locale: "en", kind: "OCR", text: "Acme Robotics opens a new lab", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["alias"] },
    { id: "g7", locale: "az", kind: "CAPTION", text: "Acme Robotics məhsulu əladır", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["alias"] },
    { id: "g8", locale: "en", kind: "POST", text: "Acme is the best, honestly", expected: "REJECTED", challenges: ["short_ambiguous", "homonym"] },
    { id: "g9", locale: "ru", kind: "POST", text: "Вега — просто космос", expected: "REJECTED", expectedSubjectId: "s-vega", challenges: ["short_ambiguous", "required_context"] },
    { id: "g10", locale: "en", kind: "POST", text: "Vega concert last night was unreal", expected: "REVIEW", expectedSubjectId: "s-vega", challenges: ["required_context"] },
    { id: "g11", locale: "en", kind: "POST", text: "New product announcement from our team", sourceId: "src-owned-1", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["owned_source"] },
    { id: "g12", locale: "en", kind: "POST", text: "Watched the Acme Coyote cartoon last night", expected: "REJECTED", challenges: ["negative_alias", "exclusion"] },
    { id: "g13", locale: "en", kind: "POST", text: "I bought a new coffee machine today", expected: "REJECTED", challenges: [] },
    { id: "g14", locale: "ru", kind: "COMMENT", text: "Были на встрече с Акмени вчера", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["declension"] },
    { id: "g15", locale: "az", kind: "POST", text: "Acme robotics komandası ilə görüşdük", expected: "ACCEPTED", expectedSubjectId: "s-acme", challenges: ["alias"] },
  ],
}
